import { selectFeedPublications } from './publicationFeed.js'
import { getProvenanceIds } from './publicationIdentity.js'
import {
  DEFAULT_TEAM_LABEL,
  SOCIAL_NETWORK_X,
  SOCIAL_POST_PROMPT_TYPE,
  SOCIAL_POST_TYPE,
  planSocialPostSync,
} from './socialPosting.js'
import { buildSocialPostRecord } from './socialPostingServer.js'

// Server-only Sanity access for social posting. Pass a non-CDN client
// (writeClient) so approver actions always see the latest revision.

// Loaded lazily so tests can import this module without Sanity credentials.
async function readPublicationCache() {
  const { readCache } = await import('./pubmedCache.js')
  return readCache()
}

const SOCIAL_POST_FIELDS = `
  _id,
  _rev,
  network,
  guid,
  link,
  title,
  journal,
  publishedAt,
  teamMembers,
  laySummary,
  proposedText,
  text,
  generatedBy,
  draftedBy,
  draftedAt,
  status,
  createdAt,
  lastNotifiedAt,
  notificationCount,
  approvedBy,
  approvedAt,
  skippedBy,
  skippedAt,
  dismissedBy,
  dismissedAt,
  bufferPostId,
  bufferChannelId,
  dueAt,
  queuedAt,
  queuedBy,
  unqueuedBy,
  unqueuedAt,
  sentAt,
  externalLink,
  lastError,
  lastErrorAt
`

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeEmails(values) {
  return Array.from(new Set((Array.isArray(values) ? values : [])
    .map((email) => cleanString(email).toLowerCase())
    .filter(Boolean)))
}

export async function fetchSocialPostingSettings(client) {
  // Published settings only, so an unpublished Studio draft cannot switch posting on.
  const settings = await client.fetch(`
    *[_type == "siteSettings" && !(_id in path("drafts.**"))][0] {
      "postToX": socialPosting.postToX,
      "teamLabel": socialPosting.teamLabel,
      "approverEmails": socialPosting.approverEmails,
      "admins": studyApprovals.admins,
      llmProvider,
      llmModel
    }
  `)
  const approvers = normalizeEmails(settings?.approverEmails)
  return {
    postToX: settings?.postToX === true,
    teamLabel: cleanString(settings?.teamLabel) || DEFAULT_TEAM_LABEL,
    recipients: approvers.length ? approvers : normalizeEmails(settings?.admins),
    llmProvider: cleanString(settings?.llmProvider),
    llmModel: cleanString(settings?.llmModel),
  }
}

export async function fetchSocialPostRecords(client, network = SOCIAL_NETWORK_X) {
  return client.fetch(`
    *[_type == "${SOCIAL_POST_TYPE}" && network == $network] | order(createdAt desc) {${SOCIAL_POST_FIELDS}}
  `, { network })
}

function markConflict(error) {
  const statusCode = error?.statusCode || error?.response?.statusCode
  if (statusCode === 409 || /revision/i.test(String(error?.message || ''))) error.conflict = true
  return error
}

// Sets non-null fields and unsets null ones, so `lastError: null` clears the field.
function applyFields(patch, fields = {}) {
  const set = {}
  const unset = []
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) unset.push(key)
    else set[key] = value
  }
  let next = Object.keys(set).length ? patch.set(set) : patch
  if (unset.length) next = next.unset(Array.from(new Set(unset)))
  return next
}

async function commitGuarded(writeClient, id, rev, fields) {
  try {
    return await applyFields(writeClient.patch(id).ifRevisionId(rev), fields).commit()
  } catch (error) {
    throw markConflict(error)
  }
}

// Fixed doc id, same string as the type (mirrors the pubmedCache singleton convention).
const SOCIAL_POST_PROMPT_ID = SOCIAL_POST_PROMPT_TYPE

// The approver's custom drafting prompt, edited at /admin/social. Published only, like
// fetchSocialPostingSettings, so an unpublished Studio draft cannot change what approvers
// see or what gets sent to the model.
export async function fetchSocialPostPrompt(client, { id = SOCIAL_POST_PROMPT_ID } = {}) {
  const doc = await client.fetch(
    '*[_id == $id && !(_id in path("drafts.**"))][0] { systemPrompt, updatedBy, updatedAt, _rev }',
    { id }
  )
  return {
    custom: String(doc?.systemPrompt ?? '').trim() || null,
    updatedBy: cleanString(doc?.updatedBy) || null,
    updatedAt: doc?.updatedAt || null,
    rev: doc?._rev || null,
  }
}

// Creates the singleton doc on first use, else patches it, guarded with ifRevisionId(rev)
// when a revision is given. Without one, a document that already exists is *also* treated
// as a conflict: that only happens when the editor was opened before anyone had customized
// the prompt, so writing without a guard would silently overwrite someone else's edit made
// meanwhile.
//
// Sanity's createIfNotExists bumps _rev even when the document already exists, so it must
// never run before an ifRevisionId-guarded patch on the same document (confirmed live: a
// no-op createIfNotExists changes _rev, so a patch guarded with the caller's earlier rev
// then fails with a spurious 409). So the create and patch paths below are mutually
// exclusive, decided by a getDocument read, instead of always calling createIfNotExists first.
async function writeSocialPostPrompt(writeClient, fields, rev, id = SOCIAL_POST_PROMPT_ID) {
  const existing = await writeClient.getDocument(id)
  if (!existing) {
    // create(), not createIfNotExists(): a concurrent creation loses this race with a 409,
    // which markConflict maps to error.conflict, same as a patch conflict below.
    const nonNullFields = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== null && value !== undefined)
    )
    try {
      return await writeClient.create({ _id: id, _type: SOCIAL_POST_PROMPT_TYPE, ...nonNullFields })
    } catch (error) {
      throw markConflict(error)
    }
  }
  if (!rev) {
    const error = new Error('The social post drafting prompt was already changed.')
    error.conflict = true
    throw error
  }
  try {
    return await applyFields(writeClient.patch(id).ifRevisionId(rev), fields).commit()
  } catch (error) {
    throw markConflict(error)
  }
}

function promptWriteFields(actorEmail, now) {
  return {
    updatedBy: cleanString(actorEmail).toLowerCase() || null,
    updatedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
  }
}

export async function saveSocialPostPrompt(writeClient, { text, actorEmail, rev, now = new Date(), id = SOCIAL_POST_PROMPT_ID } = {}) {
  return writeSocialPostPrompt(writeClient, {
    systemPrompt: String(text ?? '').trim(),
    ...promptWriteFields(actorEmail, now),
  }, rev, id)
}

export async function resetSocialPostPrompt(writeClient, { actorEmail, rev, now = new Date(), id = SOCIAL_POST_PROMPT_ID } = {}) {
  return writeSocialPostPrompt(writeClient, {
    systemPrompt: null,
    ...promptWriteFields(actorEmail, now),
  }, rev, id)
}

async function createAll(writeClient, records = []) {
  if (!records.length) return 0
  const transaction = writeClient.transaction()
  for (const record of records) transaction.createIfNotExists(record)
  await transaction.commit()
  return records.length
}

export function createSanitySocialPostStore(writeClient) {
  return {
    async get(id) {
      const document = await writeClient.getDocument(id)
      return document?._type === SOCIAL_POST_TYPE ? document : null
    },
    // Revision-guarded status change; a 409 becomes error.conflict.
    transition(id, rev, fields) {
      return commitGuarded(writeClient, id, rev, fields)
    },
    // Records Buffer's answer while the post is locked in `sending` or `removing`.
    update(id, fields) {
      return applyFields(writeClient.patch(id), fields).commit()
    },
    seed(records) {
      return createAll(writeClient, records)
    },
    createAvailable(records) {
      return createAll(writeClient, records)
    },
    async markNotified(posts = [], now = new Date()) {
      if (!posts.length) return
      const notifiedAt = (now instanceof Date ? now : new Date(now)).toISOString()
      const transaction = writeClient.transaction()
      for (const post of posts) {
        transaction.patch(post._id, (patch) => patch.set({
          lastNotifiedAt: notifiedAt,
          notificationCount: (Number(post.notificationCount) || 0) + 1,
        }))
      }
      await transaction.commit()
    },
  }
}

async function fetchResearcherNames(client, ids = []) {
  if (!ids.length) return new Map()
  const researchers = await client.fetch(
    '*[_type == "researcher" && _id in $ids] { _id, name }',
    { ids }
  )
  return new Map((researchers || []).filter((researcher) => researcher?._id).map((researcher) => [researcher._id, researcher.name]))
}

// Offers each new feed paper as an `available` record with no post text, or
// with `seed` marks the unrecorded papers `seeded` so they are never offered.
export async function syncSocialPosts({
  client,
  writeClient,
  seed = false,
  dryRun = false,
  now = new Date(),
  loadCache = readPublicationCache,
} = {}) {
  const cache = await loadCache()
  if (!cache) throw new Error('The publication cache could not be read, so no social posts were created.')
  // The same selection as /publications/feed.xml, so X and the RSS feed always agree.
  const items = selectFeedPublications(cache.publications || [], { now: new Date(now) })
  const provenance = cache.provenance || {}
  const records = await fetchSocialPostRecords(client, SOCIAL_NETWORK_X)

  const plan = planSocialPostSync({ items, records, seed })
  const summary = { mode: plan.mode, dryRun, feedItems: items.length, existingRecords: records.length }

  const toWrite = plan.mode === 'seed' ? plan.toSeed : plan.toCreate
  const researcherIds = Array.from(new Set(toWrite.flatMap((item) => getProvenanceIds(item.publication, provenance))))
  const namesById = await fetchResearcherNames(client, researcherIds)
  const status = plan.mode === 'seed' ? 'seeded' : 'available'
  const built = toWrite.map((item) => buildSocialPostRecord({
    item,
    network: SOCIAL_NETWORK_X,
    teamMembers: getProvenanceIds(item.publication, provenance).map((id) => namesById.get(id)).filter(Boolean),
    status,
    now,
  }))

  if (!dryRun && built.length) {
    const store = createSanitySocialPostStore(writeClient)
    if (plan.mode === 'seed') await store.seed(built)
    else await store.createAvailable(built)
  }

  return {
    ...summary,
    seeded: plan.mode === 'seed' ? built.length : 0,
    created: plan.mode === 'create' ? built.length : 0,
    // The expected record list after this sync, used to preview the email on dry runs.
    records: [...records, ...built],
  }
}
