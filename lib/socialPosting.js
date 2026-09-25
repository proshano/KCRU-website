import { escapeHtml } from './escapeHtml.js'

// Admin-driven posting of new publications to X through Buffer.
//
// Nothing is posted by default. The daily sync offers each new feed paper as an
// `available` record with no text. An approver chooses which papers to post
// about at /admin/social, drafts and edits the text, and queues it in Buffer,
// and can undo a queued post until Buffer publishes it.
//
// This module must stay browser-safe: /admin/social imports it for the live X
// character count. Keep node:crypto, Sanity and next imports out of it. The
// hash-based helpers (document ids, email idempotency) live in
// socialPostingServer.js, draft writing lives in socialPostDrafting.js, and
// Sanity access lives in socialPostingStore.js.

export const SOCIAL_POST_TYPE = 'socialPost'
export const SOCIAL_NETWORK_X = 'x'
export const X_MAX_WEIGHTED_LENGTH = 280
export const X_URL_WEIGHT = 23
export const DEFAULT_X_INTRO = 'New publication:'
export const SOCIAL_POST_STATUSES = ['available', 'draft', 'sending', 'queued', 'removing', 'published', 'dismissed', 'seeded']
// Statuses from before approvers chose which papers to post. They read as their
// replacements until scripts/migrate-social-posts-to-available.js converts them.
export const LEGACY_SOCIAL_POST_STATUSES = Object.freeze({ pending: 'available', skipped: 'dismissed' })
// How many queued posts the portal checks in Buffer on each load. Every check is
// one request against the Buffer plan's monthly allowance.
export const SOCIAL_POST_REFRESH_LIMIT = 10
export const SOCIAL_POST_RECENT_LIMIT = 30
export const BUFFER_UNKNOWN_MESSAGE = 'Buffer result unknown — check the Buffer queue'
export const NOT_IN_BUFFER_MESSAGE = 'Not found in Buffer; it may have been deleted there'

const URL_PATTERN = /https?:\/\/\S+/g
const ELLIPSIS = '…'
const BUFFER_ENDPOINT = 'https://api.buffer.com'
const PORTAL_ONLY_NOTE = 'Create, edit and queue posts only in the portal. This email intentionally contains no decision links.'
const CONFLICT_MESSAGE = 'This post is already being changed by someone else. Reload the page to see its current state.'
const POSTING_OFF_MESSAGE = 'Offering new publications for X posts is switched off in Site Settings (Social Media Posting).'
const DRAFT_FIELDS = ['text', 'proposedText', 'generatedBy', 'draftedBy', 'draftedAt']
const BUFFER_FIELDS = ['bufferPostId', 'bufferChannelId', 'dueAt', 'queuedAt', 'queuedBy']
const ERROR_FIELDS = ['lastError', 'lastErrorAt']
const STATUS_DESCRIPTIONS = {
  available: 'not drafted yet',
  draft: 'already a draft',
  sending: 'being sent to Buffer',
  queued: 'queued in Buffer',
  removing: 'being removed from Buffer',
  published: 'already published on X',
  dismissed: 'marked as not posting',
  seeded: 'marked as handled when posting started',
}

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase()
}

function toIso(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function errorMessage(error) {
  return cleanString(error?.message) || 'Unknown error.'
}

// A null field value means "unset this field" to the store.
function unsetAll(names) {
  return Object.fromEntries(names.map((name) => [name, null]))
}

function success(message, post) {
  return { ok: true, status: 200, message, ...(post ? { post } : {}) }
}

export function socialPostRefusal(status, message, post) {
  return { ok: false, status, message, error: message, ...(post ? { post } : {}) }
}

function wrongStatus(status, action) {
  const description = STATUS_DESCRIPTIONS[status] || `in the "${status || 'unknown'}" state`
  return socialPostRefusal(409, `This post is ${description}, so it cannot be ${action}. Reload the page to see its current state.`)
}

export function canManageSocialPosts(access) {
  return Boolean(access?.approvals)
}

export function normalizeSocialPostStatus(status) {
  const value = cleanString(status)
  return LEGACY_SOCIAL_POST_STATUSES[value] || value
}

function codePointWeight(codePoint) {
  if (codePoint <= 0x10ff) return 1
  if (codePoint >= 0x2000 && codePoint <= 0x200d) return 1
  if (codePoint >= 0x2010 && codePoint <= 0x201f) return 1
  if (codePoint >= 0x2032 && codePoint <= 0x2037) return 1
  return 2
}

// X counts every link as 23 characters and most other scripts, emoji and
// CJK as two characters each.
export function xWeightedLength(text) {
  let length = 0
  const withoutUrls = String(text ?? '').replace(URL_PATTERN, () => {
    length += X_URL_WEIGHT
    return ''
  })
  for (const character of withoutUrls) length += codePointWeight(character.codePointAt(0))
  return length
}

function truncateToWeight(text, maxWeight) {
  let kept = ''
  for (const word of text.split(' ')) {
    const candidate = kept ? `${kept} ${word}` : word
    if (xWeightedLength(`${candidate}${ELLIPSIS}`) > maxWeight) break
    kept = candidate
  }
  if (!kept) {
    // The first word alone is too long, so cut it by character.
    for (const character of text) {
      if (xWeightedLength(`${kept}${character}${ELLIPSIS}`) > maxWeight) break
      kept += character
    }
  }
  return `${kept.replace(/[\s,;:.\-–—]+$/, '')}${ELLIPSIS}`
}

// The template draft, used when the AI draft is unavailable.
export function buildXPostText({ intro, title, link } = {}) {
  const opening = cleanString(intro) || DEFAULT_X_INTRO
  const paperTitle = cleanString(title)
  const paperLink = cleanString(link)
  const full = [opening, paperTitle, paperLink].filter(Boolean).join(' ')
  if (!paperTitle || xWeightedLength(full) <= X_MAX_WEIGHTED_LENGTH) return full

  const withoutTitle = [opening, paperLink].filter(Boolean).join(' ')
  const titleBudget = X_MAX_WEIGHTED_LENGTH - xWeightedLength(withoutTitle) - 1
  if (titleBudget < 2) return withoutTitle
  return [opening, truncateToWeight(paperTitle, titleBudget), paperLink].filter(Boolean).join(' ')
}

export function validateXPostText(text) {
  const value = String(text ?? '').trim()
  const weightedLength = xWeightedLength(value)
  if (!value) return { ok: false, weightedLength, error: 'Post text is empty.' }
  if (weightedLength > X_MAX_WEIGHTED_LENGTH) {
    return {
      ok: false,
      weightedLength,
      error: `Post text is ${weightedLength} characters as X counts them; the limit is ${X_MAX_WEIGHTED_LENGTH}.`,
    }
  }
  return { ok: true, weightedLength, error: null }
}

function itemGuid(item) {
  return String(item?.identity?.guid || '')
}

function itemTime(item) {
  const time = new Date(item?.date).getTime()
  return Number.isNaN(time) ? 0 : time
}

// Items are publication feed entries from selectFeedPublications():
// { publication, date, identity: { guid, link } }. Nothing is drafted or posted
// automatically, so every unrecorded item is offered; a large sync only means a
// longer email. `seed` marks the unrecorded items handled without offering them.
export function planSocialPostSync({ items = [], records = [], seed = false } = {}) {
  const recordedGuids = new Set((records || []).map((record) => record?.guid).filter(Boolean))
  const unrecorded = (items || [])
    .filter((item) => itemGuid(item) && !recordedGuids.has(itemGuid(item)))
    .sort((left, right) => (itemTime(left) - itemTime(right)) || itemGuid(left).localeCompare(itemGuid(right)))
  if (seed) return { mode: 'seed', toSeed: unrecorded }
  return { mode: 'create', toCreate: unrecorded }
}

function timeOf(value) {
  const time = Date.parse(value || '')
  return Number.isNaN(time) ? null : time
}

function newestFirstBy(...fields) {
  return (left, right) => {
    for (const field of fields) {
      const difference = (timeOf(right[field]) ?? -Infinity) - (timeOf(left[field]) ?? -Infinity)
      if (difference && !Number.isNaN(difference)) return difference
    }
    return 0
  }
}

// Earliest first, with posts that have no scheduled time last.
function byDueAt(left, right) {
  const difference = (timeOf(left.dueAt) ?? Infinity) - (timeOf(right.dueAt) ?? Infinity)
  return Number.isNaN(difference) ? 0 : difference
}

// Each paper is announced once: only offered papers that were never in an email.
export function selectSocialPostsToNotify(records = []) {
  return (records || [])
    .filter((record) => normalizeSocialPostStatus(record?.status) === 'available' && !cleanString(record?.lastNotifiedAt))
    .sort(newestFirstBy('publishedAt', 'createdAt'))
}

export function groupSocialPostsForPortal(records = [], { recentLimit = SOCIAL_POST_RECENT_LIMIT } = {}) {
  const groups = { available: [], drafts: [], queued: [], needsChecking: [], published: [], dismissed: [] }
  for (const record of records || []) {
    if (!record) continue
    const status = normalizeSocialPostStatus(record.status)
    const post = { ...record, status }
    if (status === 'available') groups.available.push(post)
    else if (status === 'draft') groups.drafts.push(post)
    else if (status === 'queued') groups.queued.push(post)
    else if (status === 'sending' || status === 'removing') groups.needsChecking.push(post)
    else if (status === 'published') groups.published.push(post)
    else if (status === 'dismissed') {
      groups.dismissed.push({
        ...post,
        dismissedBy: record.dismissedBy || record.skippedBy,
        dismissedAt: record.dismissedAt || record.skippedAt,
      })
    }
  }
  groups.available.sort(newestFirstBy('publishedAt', 'createdAt'))
  groups.drafts.sort(newestFirstBy('publishedAt', 'createdAt'))
  groups.queued.sort(byDueAt)
  groups.needsChecking.sort(newestFirstBy('lastErrorAt', 'queuedAt', 'createdAt'))
  groups.published = groups.published.sort(newestFirstBy('sentAt', 'queuedAt')).slice(0, recentLimit)
  groups.dismissed = groups.dismissed.sort(newestFirstBy('dismissedAt', 'createdAt')).slice(0, recentLimit)
  return groups
}

export function formatSocialPostDate(value) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return 'Not available'
  // Publication dates are stored as UTC midnight.
  return date.toLocaleDateString('en-US', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' })
}

function formatTeamMembers(post) {
  return (post.teamMembers || []).map(cleanString).filter(Boolean).join(', ') || 'Not recorded'
}

export function buildSocialPostNotificationEmail({ posts = [], portalUrl } = {}) {
  const count = posts.length
  const subject = `${count} new publication${count === 1 ? '' : 's'} you could post about`
  const intro = 'New team publications you could post about on X. Nothing is posted unless you create a post and queue it in the portal.'

  const textItems = posts.map((post, index) => [
    `${index + 1}. ${cleanString(post.title)}`,
    `Journal: ${cleanString(post.journal) || 'Not recorded'}`,
    `Published: ${formatSocialPostDate(post.publishedAt)}`,
    `Team members: ${formatTeamMembers(post)}`,
    `Lay summary: ${cleanString(post.laySummary) || 'Not available'}`,
    `Paper: ${cleanString(post.link) || 'Not available'}`,
  ].join('\n'))
  const text = [
    intro,
    '',
    ...textItems.flatMap((item) => [item, '']),
    `Open the social media portal: ${portalUrl}`,
    PORTAL_ONLY_NOTE,
  ].join('\n')

  const htmlItems = posts.map((post) => {
    const link = cleanString(post.link)
    const paperLink = /^https?:\/\//i.test(link)
      ? `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`
      : escapeHtml(link || 'Not available')
    return `
      <li style="margin-bottom:20px">
        <strong>${escapeHtml(cleanString(post.title))}</strong><br>
        Journal: ${escapeHtml(cleanString(post.journal) || 'Not recorded')}<br>
        Published: ${escapeHtml(formatSocialPostDate(post.publishedAt))}<br>
        Team members: ${escapeHtml(formatTeamMembers(post))}
        <div style="border-left:3px solid #ccc;padding:8px 12px;margin:8px 0">${escapeHtml(cleanString(post.laySummary) || 'Lay summary not available.')}</div>
        Paper: ${paperLink}
      </li>
    `
  }).join('')
  const html = `
    <p>${escapeHtml(intro)}</p>
    <ol>${htmlItems}</ol>
    <p><a href="${escapeHtml(portalUrl)}">Open the social media portal</a></p>
    <p>${escapeHtml(PORTAL_ONLY_NOTE)}</p>
  `

  return { subject, text, html, count }
}

function bufferError(message, ambiguous, extra = {}) {
  const error = new Error(message)
  error.ambiguous = ambiguous
  Object.assign(error, extra)
  return error
}

function isNotFoundGraphqlError(entry) {
  return entry?.extensions?.code === 'NOT_FOUND' || /not\s*found/i.test(String(entry?.message || ''))
}

const ORGANIZATIONS_QUERY = 'query { account { organizations { id name } } }'
const CHANNELS_QUERY = 'query Channels($input: ChannelsInput!) { channels(input: $input) { id name service } }'
const CREATE_POST_MUTATION = 'mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id dueAt } } ... on MutationError { message } } }'
const POST_QUERY = 'query Post($input: PostInput!) { post(input: $input) { id status dueAt sentAt externalLink error { message } } }'
const DELETE_POST_MUTATION = 'mutation DeletePost($input: DeletePostInput!) { deletePost(input: $input) { ... on DeletePostSuccess { id } ... on MutationError { message } } }'

// Every thrown error carries `ambiguous`: true when Buffer may or may not have
// acted (network error, timeout, 5xx, unreadable response), false when Buffer
// definitely refused. Ambiguous post results must never be retried automatically.
// GraphQL errors that say the object does not exist also carry `notFound: true`.
export function createBufferClient({
  apiKey,
  fetchImpl = fetch,
  endpoint = BUFFER_ENDPOINT,
  timeoutMs = 30000,
} = {}) {
  const redact = (value) => {
    const message = cleanString(value).replace(/[.\s]+$/, '')
    return apiKey ? message.split(apiKey).join('[redacted]') : message
  }

  async function request(query, variables) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    let bodyText
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(variables ? { query, variables } : { query }),
        signal: controller.signal,
      })
      bodyText = await response.text()
    } catch (error) {
      throw bufferError(controller.signal.aborted
        ? `Buffer did not respond within ${Math.round(timeoutMs / 1000)} seconds.`
        : `Could not reach Buffer: ${redact(error?.message) || 'network error'}.`, true)
    } finally {
      clearTimeout(timer)
    }

    let payload = null
    try {
      payload = bodyText ? JSON.parse(bodyText) : null
    } catch {
      payload = null
    }
    const graphqlErrors = Array.isArray(payload?.errors) ? payload.errors : []
    const detail = redact(graphqlErrors.map((entry) => entry?.message).filter(Boolean).join('; ') ||
      payload?.message || payload?.error || '')
    const notFound = graphqlErrors.some(isNotFoundGraphqlError) ? { notFound: true } : {}

    if (response.status === 429) {
      const retryAfter = cleanString(response.headers?.get?.('retry-after'))
      const wait = retryAfter
        ? `Retry after ${retryAfter}${/^\d+$/.test(retryAfter) ? ' seconds' : ''}.`
        : 'Try again later.'
      throw bufferError(`Buffer rate limit reached (HTTP 429). ${wait}`, false)
    }
    if (response.status >= 400 && response.status < 500) {
      throw bufferError(`Buffer rejected the request (HTTP ${response.status})${detail ? `: ${detail}` : ''}.`, false, notFound)
    }
    if (!response.ok) {
      throw bufferError(`Buffer returned HTTP ${response.status}${detail ? `: ${detail}` : ''}.`, true)
    }
    if (!payload || typeof payload !== 'object') {
      throw bufferError('Buffer returned a response that could not be read.', true)
    }
    if (graphqlErrors.length) {
      throw bufferError(`Buffer returned an error: ${detail || 'unknown error'}.`, false, notFound)
    }
    return payload.data || {}
  }

  return {
    async listChannels() {
      const data = await request(ORGANIZATIONS_QUERY)
      const channels = []
      for (const organization of data?.account?.organizations || []) {
        const result = await request(CHANNELS_QUERY, { input: { organizationId: organization.id } })
        for (const channel of result?.channels || []) {
          channels.push({ ...channel, organizationId: organization.id, organizationName: organization.name })
        }
      }
      return channels
    },

    async queuePost({ channelId, text }) {
      const data = await request(CREATE_POST_MUTATION, {
        input: { text, channelId, schedulingType: 'automatic', mode: 'addToQueue' },
      })
      const result = data?.createPost
      if (result?.post?.id) return { id: String(result.post.id), dueAt: result.post.dueAt || null }
      if (result?.message) throw bufferError(`Buffer did not accept the post: ${redact(result.message)}.`, false)
      throw bufferError('Buffer did not return a post id.', false)
    },

    // Buffer post statuses: draft, error, needs_approval, scheduled, sending, sent.
    async getPost(id) {
      const data = await request(POST_QUERY, { input: { id } })
      if (data?.post && typeof data.post === 'object') return data.post
      throw bufferError('Buffer has no post with this id.', false, { notFound: true })
    },

    async deletePost(id) {
      const data = await request(DELETE_POST_MUTATION, { input: { id } })
      const result = data?.deletePost
      if (result?.id) return { id: String(result.id) }
      if (result?.message) throw bufferError(`Buffer did not delete the post: ${redact(result.message)}.`, false)
      throw bufferError('Buffer did not confirm that the post was deleted.', false)
    },
  }
}

export function resolveXChannel(channels = [], preferredChannelId) {
  const xChannels = (channels || []).filter((channel) => String(channel?.service || '').toLowerCase() === 'twitter')
  const preferred = cleanString(preferredChannelId)
  if (preferred) {
    const match = xChannels.find((channel) => String(channel.id) === preferred)
    if (!match) throw new Error('BUFFER_X_CHANNEL_ID does not match an X channel connected in Buffer.')
    return match
  }
  if (xChannels.length === 1) return xChannels[0]
  if (!xChannels.length) throw new Error('No X channel is connected in Buffer.')
  const names = xChannels.map((channel) => cleanString(channel.name) || String(channel.id)).join(', ')
  throw new Error(`More than one X channel is connected in Buffer (${names}). Set the BUFFER_X_CHANNEL_ID environment variable to choose one.`)
}

// --- Status transitions -----------------------------------------------------
//
// Every approver action reads the record, checks its status, and writes with
// store.transition(id, rev, fields), which is revision-guarded
// (patch(id).ifRevisionId(rev)) and throws error.conflict on a 409. Queue and
// undo first lock the record in `sending` or `removing` that way; while it is
// locked no other action accepts it, so the writes that record Buffer's answer
// use store.update(id, fields). In `fields`, null unsets a field.

async function loadPost(store, id) {
  const post = await store.get(id)
  if (!post) return { refused: socialPostRefusal(404, 'Social media post not found.') }
  return { post, status: normalizeSocialPostStatus(post.status) }
}

async function commitTransition(store, id, rev, fields) {
  try {
    await store.transition(id, rev, fields)
    return null
  } catch (error) {
    if (error?.conflict) return socialPostRefusal(409, CONFLICT_MESSAGE)
    throw error
  }
}

// available -> draft ("Create post") and draft -> draft ("Regenerate").
// `compose(post)` returns { text, generatedBy }; see socialPostDrafting.js.
export async function draftSocialPost({
  id,
  regenerate = false,
  actorEmail,
  enabled,
  store,
  compose,
  now = new Date(),
} = {}) {
  if (enabled !== true) return socialPostRefusal(409, `${POSTING_OFF_MESSAGE} Posts cannot be drafted.`)
  const { post, status, refused } = await loadPost(store, id)
  if (refused) return refused
  if (status !== (regenerate ? 'draft' : 'available')) return wrongStatus(status, regenerate ? 'regenerated' : 'drafted')

  const draft = await compose(post)
  const fields = {
    status: 'draft',
    text: draft.text,
    proposedText: draft.text,
    generatedBy: draft.generatedBy,
    draftedBy: normalizeEmail(actorEmail),
    draftedAt: toIso(now),
    ...unsetAll(ERROR_FIELDS),
  }
  // Guarded by the revision read before drafting, so a change made while the
  // text was being written is not overwritten.
  const conflict = await commitTransition(store, id, post._rev, fields)
  if (conflict) return conflict
  const source = draft.generatedBy === 'template'
    ? 'The AI draft was not available, so this uses the standard template.'
    : 'This is an AI draft.'
  return success(
    `${regenerate ? 'New draft written' : 'Draft created'}. ${source} Check and edit it before queueing it in Buffer.`,
    { _id: id, status: 'draft', text: draft.text, generatedBy: draft.generatedBy }
  )
}

// draft -> draft ("Save").
export async function saveSocialPostDraft({ id, text, store } = {}) {
  const { post, status, refused } = await loadPost(store, id)
  if (refused) return refused
  if (status !== 'draft') return wrongStatus(status, 'saved')
  const value = String(text ?? '').trim()
  const validation = validateXPostText(value)
  if (!validation.ok) return socialPostRefusal(400, validation.error)
  const conflict = await commitTransition(store, id, post._rev, { text: value })
  if (conflict) return conflict
  return success('Draft saved.', { _id: id, status: 'draft', text: value })
}

// draft -> available ("Discard draft").
export async function discardSocialPostDraft({ id, store } = {}) {
  const { post, status, refused } = await loadPost(store, id)
  if (refused) return refused
  if (status !== 'draft') return wrongStatus(status, 'discarded')
  const conflict = await commitTransition(store, id, post._rev, {
    status: 'available',
    ...unsetAll([...DRAFT_FIELDS, ...ERROR_FIELDS]),
  })
  if (conflict) return conflict
  return success('Draft discarded. The paper is back in new publications.', { _id: id, status: 'available' })
}

// available or draft -> dismissed ("Not posting"). A draft is discarded in the same write.
export async function dismissSocialPost({ id, actorEmail, store, now = new Date() } = {}) {
  const { post, status, refused } = await loadPost(store, id)
  if (refused) return refused
  if (status !== 'available' && status !== 'draft') return wrongStatus(status, 'marked as not posting')
  const conflict = await commitTransition(store, id, post._rev, {
    status: 'dismissed',
    dismissedBy: normalizeEmail(actorEmail),
    dismissedAt: toIso(now),
    ...unsetAll([...DRAFT_FIELDS, ...ERROR_FIELDS]),
  })
  if (conflict) return conflict
  return success(
    status === 'draft' ? 'Draft discarded and the paper marked as not posting.' : 'Marked as not posting.',
    { _id: id, status: 'dismissed' }
  )
}

// dismissed -> available ("Restore").
export async function restoreSocialPost({ id, store } = {}) {
  const { post, status, refused } = await loadPost(store, id)
  if (refused) return refused
  if (status !== 'dismissed') return wrongStatus(status, 'restored')
  const conflict = await commitTransition(store, id, post._rev, {
    status: 'available',
    // Legacy `skipped` records still carry their suggested text and skip audit.
    ...unsetAll(['dismissedBy', 'dismissedAt', 'skippedBy', 'skippedAt', ...DRAFT_FIELDS, ...ERROR_FIELDS]),
  })
  if (conflict) return conflict
  return success('Restored to new publications.', { _id: id, status: 'available' })
}

// draft -> sending -> queued ("Queue in Buffer").
export async function queueSocialPost({
  id,
  text,
  actorEmail,
  enabled,
  store,
  buffer,
  preferredChannelId,
  now = new Date(),
} = {}) {
  if (enabled !== true) return socialPostRefusal(409, `${POSTING_OFF_MESSAGE} Posts cannot be queued.`)
  const { post, status, refused } = await loadPost(store, id)
  if (refused) return refused
  if (status !== 'draft') return wrongStatus(status, 'queued')
  const finalText = String(text ?? post.text ?? '').trim()
  const validation = validateXPostText(finalText)
  if (!validation.ok) return socialPostRefusal(400, validation.error)

  const timestamp = toIso(now)
  const queuedBy = normalizeEmail(actorEmail)
  // The revision-guarded move to `sending` is what makes each paper post at most once.
  const conflict = await commitTransition(store, id, post._rev, {
    status: 'sending',
    text: finalText,
    queuedBy,
    ...unsetAll(ERROR_FIELDS),
  })
  if (conflict) return conflict

  const backToDraft = (lastError) => store.update(id, { status: 'draft', queuedBy: null, lastError, lastErrorAt: timestamp })

  let channel
  try {
    channel = resolveXChannel(await buffer.listChannels(), preferredChannelId)
  } catch (error) {
    const lastError = errorMessage(error)
    await backToDraft(lastError)
    return socialPostRefusal(502, `Could not find the X channel in Buffer: ${lastError} The post is back in your drafts.`)
  }

  let queued
  try {
    queued = await buffer.queuePost({ channelId: channel.id, text: finalText })
  } catch (error) {
    const lastError = errorMessage(error)
    if (error?.ambiguous === false) {
      await backToDraft(lastError)
      return socialPostRefusal(502, `${lastError} The post is back in your drafts so you can edit it or try again.`)
    }
    // Buffer may have the post, so it stays `sending` and is never retried automatically.
    await store.update(id, { lastError, lastErrorAt: timestamp })
    return socialPostRefusal(502, `${BUFFER_UNKNOWN_MESSAGE} before doing anything else. (${lastError})`)
  }

  const fields = {
    status: 'queued',
    bufferPostId: queued.id,
    bufferChannelId: channel.id,
    dueAt: queued.dueAt || null,
    queuedAt: timestamp,
  }
  try {
    await store.update(id, fields)
  } catch (error) {
    // Buffer has the post, so the record must stay in `sending`.
    const lastError = `Buffer queued the post (${queued.id}), but the website could not record it: ${errorMessage(error)}`
    try {
      await store.update(id, { lastError, lastErrorAt: timestamp })
    } catch {
      // The record still reads `sending`, which is the safe state.
    }
    return socialPostRefusal(500, `${lastError} Do not queue it again.`)
  }
  return success(
    'Queued in Buffer. It will be published at the X channel\'s next posting slot, and you can undo it until then.',
    { _id: id, ...fields, text: finalText, queuedBy }
  )
}

// queued -> removing -> draft, published or queued ("Undo").
export async function undoSocialPost({ id, actorEmail, store, buffer, now = new Date() } = {}) {
  const { post, status, refused } = await loadPost(store, id)
  if (refused) return refused
  if (status !== 'queued') return wrongStatus(status, 'undone')
  const bufferPostId = cleanString(post.bufferPostId)
  if (!bufferPostId) {
    return socialPostRefusal(409, 'This post has no Buffer post id, so it cannot be undone here. Check the Buffer queue.')
  }

  const timestamp = toIso(now)
  const conflict = await commitTransition(store, id, post._rev, { status: 'removing', ...unsetAll(ERROR_FIELDS) })
  if (conflict) return conflict

  const draftFields = {
    status: 'draft',
    unqueuedBy: normalizeEmail(actorEmail),
    unqueuedAt: timestamp,
    ...unsetAll([...BUFFER_FIELDS, ...ERROR_FIELDS]),
  }
  const backToQueued = (lastError) => store.update(id, {
    status: 'queued',
    lastError: lastError || null,
    lastErrorAt: lastError ? timestamp : null,
  })

  let remote
  try {
    remote = await buffer.getPost(bufferPostId)
  } catch (error) {
    if (error?.notFound) {
      await store.update(id, draftFields)
      return success('Moved back to your drafts. It was no longer in Buffer.', { _id: id, status: 'draft' })
    }
    // Reading a post changes nothing in Buffer, so even an unclear answer leaves it safely queued.
    const lastError = errorMessage(error)
    await backToQueued(lastError)
    return socialPostRefusal(502, `Could not check the post in Buffer, so it is still queued: ${lastError}`)
  }

  const remoteStatus = cleanString(remote?.status).toLowerCase()
  if (remoteStatus === 'sent') {
    const externalLink = cleanString(remote.externalLink)
    const fields = { status: 'published', sentAt: remote.sentAt || null, externalLink: externalLink || null }
    await store.update(id, fields)
    return socialPostRefusal(
      409,
      `Already published on X, so it can't be undone here. Delete it on X if needed${externalLink ? `: ${externalLink}` : '.'}`,
      { _id: id, ...fields }
    )
  }
  if (remoteStatus === 'sending') {
    await backToQueued(null)
    return socialPostRefusal(409, 'Buffer is publishing it right now; check again in a minute.')
  }

  // scheduled, draft, needs_approval or error: remove it from Buffer.
  try {
    await buffer.deletePost(bufferPostId)
  } catch (error) {
    const lastError = errorMessage(error)
    if (error?.ambiguous === false) {
      await backToQueued(lastError)
      return socialPostRefusal(502, `Buffer did not remove the post, so it is still queued: ${lastError}`)
    }
    // Buffer may have deleted it, so it stays `removing` until someone checks.
    await store.update(id, { lastError, lastErrorAt: timestamp })
    return socialPostRefusal(502, `${BUFFER_UNKNOWN_MESSAGE} to see whether the post was removed. (${lastError})`)
  }

  try {
    await store.update(id, draftFields)
  } catch (error) {
    const lastError = `Buffer removed the post, but the website could not record it: ${errorMessage(error)}`
    try {
      await store.update(id, { lastError, lastErrorAt: timestamp })
    } catch {
      // The record still reads `removing`, which shows it needs checking.
    }
    return socialPostRefusal(500, lastError)
  }
  return success('Removed from the Buffer queue. The post is back in your drafts.', { _id: id, status: 'draft' })
}

function applyToRecord(record, fields) {
  const next = { ...record }
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) delete next[key]
    else next[key] = value
  }
  return next
}

// Checks up to `limit` queued posts in Buffer before the portal responds:
// sent -> published, error -> lastError, missing -> lastError. Failures never
// throw; they come back as `warning` so the page still loads.
export async function refreshQueuedSocialPosts({
  records = [],
  store,
  buffer,
  limit = SOCIAL_POST_REFRESH_LIMIT,
  now = new Date(),
} = {}) {
  const queued = (records || [])
    .filter((record) => normalizeSocialPostStatus(record?.status) === 'queued' && cleanString(record?.bufferPostId))
    .sort(byDueAt)
    .slice(0, limit)
  const timestamp = toIso(now)
  const updated = new Map()
  let warning = null
  let checked = 0

  for (const record of queued) {
    let fields = null
    try {
      const remote = await buffer.getPost(cleanString(record.bufferPostId))
      checked += 1
      const remoteStatus = cleanString(remote?.status).toLowerCase()
      if (remoteStatus === 'sent') {
        fields = {
          status: 'published',
          sentAt: remote.sentAt || null,
          externalLink: cleanString(remote.externalLink) || null,
          ...unsetAll(ERROR_FIELDS),
        }
      } else if (remoteStatus === 'error') {
        const lastError = cleanString(remote.error?.message) || 'Buffer reported an error publishing this post.'
        if (lastError !== record.lastError) fields = { lastError, lastErrorAt: timestamp }
      } else {
        const dueAt = remote?.dueAt || null
        const changed = {}
        if (dueAt && dueAt !== record.dueAt) changed.dueAt = dueAt
        if (record.lastError) Object.assign(changed, unsetAll(ERROR_FIELDS))
        if (Object.keys(changed).length) fields = changed
      }
    } catch (error) {
      if (!error?.notFound) {
        warning = `Could not check Buffer for the latest status of queued posts: ${errorMessage(error)}`
        break
      }
      checked += 1
      if (record.lastError !== NOT_IN_BUFFER_MESSAGE) fields = { lastError: NOT_IN_BUFFER_MESSAGE, lastErrorAt: timestamp }
    }
    if (!fields) continue

    try {
      await store.transition(record._id, record._rev, fields)
      updated.set(record._id, applyToRecord(record, fields))
    } catch (error) {
      // Someone else changed the post meanwhile; the next load checks it again.
      if (error?.conflict) continue
      warning = `Could not save the latest Buffer status: ${errorMessage(error)}`
      break
    }
  }

  return {
    records: (records || []).map((record) => updated.get(record?._id) || record),
    checked,
    updated: updated.size,
    warning,
  }
}
