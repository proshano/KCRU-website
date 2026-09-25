import { escapeHtml } from './escapeHtml.js'

// Admin-approved posting of new publications to X through Buffer.
//
// This module must stay browser-safe: /admin/social imports it for the live X
// character count. Keep node:crypto, Sanity and next imports out of it. The
// hash-based helpers (document ids, email idempotency) live in
// socialPostingServer.js, and Sanity access lives in socialPostingStore.js.

export const SOCIAL_POST_TYPE = 'socialPost'
export const SOCIAL_NETWORK_X = 'x'
export const X_MAX_WEIGHTED_LENGTH = 280
export const X_URL_WEIGHT = 23
export const DEFAULT_X_INTRO = 'New publication:'
export const MAX_NEW_POSTS_PER_SYNC = 10
export const SOCIAL_POST_STATUSES = ['seeded', 'pending', 'sending', 'queued', 'skipped']
// Slightly under a day so the daily workflow always sends, while a same-day
// re-run of the workflow does not email approvers twice.
export const SOCIAL_POST_NOTIFICATION_INTERVAL_HOURS = 20

const HOUR_MS = 60 * 60 * 1000
const URL_PATTERN = /https?:\/\/\S+/g
const ELLIPSIS = '…'
const BUFFER_ENDPOINT = 'https://api.buffer.com'
const PORTAL_ONLY_NOTE = 'Approve, edit or skip posts only in the portal. This email intentionally contains no decision links.'

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function toIso(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

function errorMessage(error) {
  return cleanString(error?.message) || 'Unknown error.'
}

function refusal(status, message) {
  return { ok: false, status, message }
}

export function canManageSocialPosts(access) {
  return Boolean(access?.approvals)
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
// { publication, date, identity: { guid, link } }.
export function planSocialPostSync({
  items = [],
  records = [],
  maxNew = MAX_NEW_POSTS_PER_SYNC,
  seed = false,
} = {}) {
  const recordedGuids = new Set((records || []).map((record) => record?.guid).filter(Boolean))
  const unrecorded = (items || [])
    .filter((item) => itemGuid(item) && !recordedGuids.has(itemGuid(item)))
    .sort((left, right) => (itemTime(left) - itemTime(right)) || itemGuid(left).localeCompare(itemGuid(right)))

  // The first run (or an explicit seed) marks everything already in the feed
  // as handled so switching posting on never floods X with old papers.
  if (!records?.length || seed) return { mode: 'seed', toSeed: unrecorded }
  if (unrecorded.length > maxNew) {
    return {
      mode: 'abort',
      newCount: unrecorded.length,
      reason: `Found ${unrecorded.length} new publications in the feed, more than the ${maxNew} allowed in one sync, so no social posts were created. ` +
        'If these papers are expected, call /api/social/dispatch with {"seed": true} to mark them as handled without posting them.',
    }
  }
  return { mode: 'create', toCreate: unrecorded }
}

export function selectSocialPostsToNotify(records = [], {
  now = new Date(),
  intervalHours = SOCIAL_POST_NOTIFICATION_INTERVAL_HOURS,
} = {}) {
  const nowMs = new Date(now).getTime()
  const pending = (records || [])
    .filter((record) => record?.status === 'pending')
    .map((record) => ({
      ...record,
      notificationKind: Number.isNaN(Date.parse(record.lastNotifiedAt || '')) ? 'new' : 'reminder',
    }))
  const isDue = pending.some((record) => {
    return record.notificationKind === 'new' || nowMs - Date.parse(record.lastNotifiedAt) >= intervalHours * HOUR_MS
  })
  return isDue ? pending : []
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

export function buildSocialPostApprovalEmail({ posts = [], portalUrl } = {}) {
  const newCount = posts.filter((post) => post.notificationKind === 'new').length
  const waitingCount = posts.length - newCount
  const subject = `${posts.length} social media post${posts.length === 1 ? '' : 's'} waiting for approval`
  const intro = `${newCount} new since the last email, ${waitingCount} still waiting`
  const label = (post) => (post.notificationKind === 'new' ? 'NEW' : 'Still waiting')

  const textItems = posts.map((post, index) => [
    `${index + 1}. [${label(post)}] ${cleanString(post.title)}`,
    'Post text:',
    String(post.text || ''),
    `Team members: ${formatTeamMembers(post)}`,
    `Published: ${formatSocialPostDate(post.publishedAt)}`,
    `Paper: ${cleanString(post.link) || 'Not available'}`,
  ].join('\n'))
  const text = [
    `Social media posts for X: ${intro}.`,
    '',
    ...textItems.flatMap((item) => [item, '']),
    `Open the approval portal: ${portalUrl}`,
    PORTAL_ONLY_NOTE,
  ].join('\n')

  const htmlItems = posts.map((post) => {
    const link = cleanString(post.link)
    const paperLink = /^https?:\/\//i.test(link)
      ? `<a href="${escapeHtml(link)}">${escapeHtml(link)}</a>`
      : escapeHtml(link || 'Not available')
    return `
      <li style="margin-bottom:20px">
        <strong>[${escapeHtml(label(post))}] ${escapeHtml(cleanString(post.title))}</strong>
        <div style="white-space:pre-wrap;border-left:3px solid #ccc;padding:8px 12px;margin:8px 0">${escapeHtml(post.text || '')}</div>
        Team members: ${escapeHtml(formatTeamMembers(post))}<br>
        Published: ${escapeHtml(formatSocialPostDate(post.publishedAt))}<br>
        Paper: ${paperLink}
      </li>
    `
  }).join('')
  const html = `
    <p>Social media posts for X: ${escapeHtml(intro)}.</p>
    <ol>${htmlItems}</ol>
    <p><a href="${escapeHtml(portalUrl)}">Open the social media approval portal</a></p>
    <p>${escapeHtml(PORTAL_ONLY_NOTE)}</p>
  `

  return { subject, text, html, newCount, waitingCount }
}

function bufferError(message, ambiguous) {
  const error = new Error(message)
  error.ambiguous = ambiguous
  return error
}

const ORGANIZATIONS_QUERY = 'query { account { organizations { id name } } }'
const CHANNELS_QUERY = 'query Channels($input: ChannelsInput!) { channels(input: $input) { id name service } }'
const CREATE_POST_MUTATION = 'mutation CreatePost($input: CreatePostInput!) { createPost(input: $input) { ... on PostActionSuccess { post { id dueAt } } ... on MutationError { message } } }'

// Every thrown error carries `ambiguous`: true when Buffer may or may not have
// acted (network error, timeout, 5xx, unreadable response), false when Buffer
// definitely refused. Ambiguous post results must never be retried automatically.
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

    if (response.status === 429) {
      const retryAfter = cleanString(response.headers?.get?.('retry-after'))
      const wait = retryAfter
        ? `Retry after ${retryAfter}${/^\d+$/.test(retryAfter) ? ' seconds' : ''}.`
        : 'Try again later.'
      throw bufferError(`Buffer rate limit reached (HTTP 429). ${wait}`, false)
    }
    if (response.status >= 400 && response.status < 500) {
      throw bufferError(`Buffer rejected the request (HTTP ${response.status})${detail ? `: ${detail}` : ''}.`, false)
    }
    if (!response.ok) {
      throw bufferError(`Buffer returned HTTP ${response.status}${detail ? `: ${detail}` : ''}.`, true)
    }
    if (!payload || typeof payload !== 'object') {
      throw bufferError('Buffer returned a response that could not be read.', true)
    }
    if (graphqlErrors.length) {
      throw bufferError(`Buffer returned an error: ${detail || 'unknown error'}.`, false)
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

const CONFLICT_MESSAGE = 'This post is already being processed by someone else. Reload the page to see its current state.'
const NOT_PENDING_MESSAGES = {
  sending: 'This post is already being sent to Buffer.',
  queued: 'This post is already in the Buffer queue.',
  skipped: 'This post was skipped. Restore it before approving.',
  seeded: 'This paper was marked as handled when posting started, so it cannot be posted.',
}

export async function approveSocialPost({
  id,
  text,
  approverEmail,
  enabled,
  store,
  buffer,
  preferredChannelId,
  now = new Date(),
} = {}) {
  if (enabled !== true) {
    return refusal(409, 'Posting to X is switched off in Site Settings, so posts cannot be approved.')
  }
  const post = await store.get(id)
  if (!post) return refusal(404, 'Social media post not found.')
  if (post.status !== 'pending') {
    return refusal(409, NOT_PENDING_MESSAGES[post.status] || `This post is ${post.status || 'not pending'}.`)
  }
  const finalText = String(text ?? post.text ?? '').trim()
  const validation = validateXPostText(finalText)
  if (!validation.ok) return refusal(400, validation.error)

  const timestamp = toIso(now)
  // The revision-guarded move to `sending` is what makes each paper post at most once.
  try {
    await store.markSending(id, post._rev, {
      text: finalText,
      approvedBy: cleanString(approverEmail).toLowerCase(),
      approvedAt: timestamp,
    })
  } catch (error) {
    if (error?.conflict) return refusal(409, CONFLICT_MESSAGE)
    throw error
  }

  let channel
  try {
    channel = resolveXChannel(await buffer.listChannels(), preferredChannelId)
  } catch (error) {
    const lastError = errorMessage(error)
    await store.returnToPending(id, { lastError, lastErrorAt: timestamp })
    return refusal(502, `Could not find the X channel in Buffer: ${lastError} The post is back in the pending list.`)
  }

  let queued
  try {
    queued = await buffer.queuePost({ channelId: channel.id, text: finalText })
  } catch (error) {
    const lastError = errorMessage(error)
    if (error?.ambiguous === false) {
      await store.returnToPending(id, { lastError, lastErrorAt: timestamp })
      return refusal(502, `${lastError} The post is back in the pending list so you can edit it or try again.`)
    }
    await store.markUnknown(id, { lastError, lastErrorAt: timestamp })
    return refusal(502, `Buffer result unknown; check the Buffer queue before retrying. (${lastError})`)
  }

  const fields = {
    bufferPostId: queued.id,
    bufferChannelId: channel.id,
    dueAt: queued.dueAt || null,
    queuedAt: timestamp,
    lastError: null,
  }
  try {
    await store.markQueued(id, fields)
  } catch (error) {
    // Buffer has the post, so the record must stay in `sending`.
    const lastError = `Buffer queued the post (${queued.id}), but the website could not record it: ${errorMessage(error)}`
    try {
      await store.markUnknown(id, { lastError, lastErrorAt: timestamp })
    } catch {
      // The record still reads `sending`, which is the safe state.
    }
    return refusal(500, `${lastError} Do not approve it again.`)
  }
  return {
    ok: true,
    status: 200,
    message: 'Queued in Buffer. It will be published at the X channel\'s next posting slot.',
    post: { _id: id, status: 'queued', ...fields },
  }
}

export async function skipSocialPost({ id, actorEmail, store, now = new Date() } = {}) {
  const post = await store.get(id)
  if (!post) return refusal(404, 'Social media post not found.')
  if (post.status !== 'pending') {
    return refusal(409, `Only pending posts can be skipped; this one is ${post.status || 'in an unknown state'}.`)
  }
  try {
    await store.skip(id, post._rev, {
      skippedBy: cleanString(actorEmail).toLowerCase(),
      skippedAt: toIso(now),
    })
  } catch (error) {
    if (error?.conflict) return refusal(409, CONFLICT_MESSAGE)
    throw error
  }
  return { ok: true, status: 200, message: 'Post skipped. It will not be sent to Buffer.', post: { _id: id, status: 'skipped' } }
}

export async function restoreSocialPost({ id, store } = {}) {
  const post = await store.get(id)
  if (!post) return refusal(404, 'Social media post not found.')
  if (post.status !== 'skipped') {
    return refusal(409, `Only skipped posts can be restored; this one is ${post.status || 'in an unknown state'}.`)
  }
  try {
    await store.restore(id, post._rev)
  } catch (error) {
    if (error?.conflict) return refusal(409, CONFLICT_MESSAGE)
    throw error
  }
  return { ok: true, status: 200, message: 'Post restored to the pending list.', post: { _id: id, status: 'pending' } }
}
