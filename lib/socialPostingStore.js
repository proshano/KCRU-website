import { readCache } from './pubmedCache.js'
import { selectFeedPublications } from './publicationFeed.js'
import { getProvenanceIds } from './publicationIdentity.js'
import {
  MAX_NEW_POSTS_PER_SYNC,
  SOCIAL_NETWORK_X,
  SOCIAL_POST_TYPE,
  planSocialPostSync,
} from './socialPosting.js'
import { buildSocialPostRecord } from './socialPostingServer.js'

// Server-only Sanity access for social posting. Pass a non-CDN client
// (writeClient) so approvals always see the latest revision.

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
  proposedText,
  text,
  status,
  createdAt,
  lastNotifiedAt,
  notificationCount,
  approvedBy,
  approvedAt,
  skippedBy,
  skippedAt,
  bufferPostId,
  bufferChannelId,
  dueAt,
  queuedAt,
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
      "xIntro": socialPosting.xIntro,
      "approverEmails": socialPosting.approverEmails,
      "admins": studyApprovals.admins
    }
  `)
  const approvers = normalizeEmails(settings?.approverEmails)
  return {
    postToX: settings?.postToX === true,
    xIntro: cleanString(settings?.xIntro),
    recipients: approvers.length ? approvers : normalizeEmails(settings?.admins),
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
function applyFields(patch, fields = {}, alwaysUnset = []) {
  const set = {}
  const unset = [...alwaysUnset]
  for (const [key, value] of Object.entries(fields)) {
    if (value === null || value === undefined) unset.push(key)
    else set[key] = value
  }
  let next = Object.keys(set).length ? patch.set(set) : patch
  if (unset.length) next = next.unset(Array.from(new Set(unset)))
  return next
}

async function commitGuarded(writeClient, id, rev, fields, alwaysUnset) {
  try {
    return await applyFields(writeClient.patch(id).ifRevisionId(rev), fields, alwaysUnset).commit()
  } catch (error) {
    throw markConflict(error)
  }
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
    markSending(id, rev, fields) {
      return commitGuarded(writeClient, id, rev, { ...fields, status: 'sending' }, ['lastError', 'lastErrorAt'])
    },
    markQueued(id, fields) {
      return applyFields(writeClient.patch(id), { ...fields, status: 'queued' }, ['lastError', 'lastErrorAt']).commit()
    },
    returnToPending(id, fields) {
      return applyFields(writeClient.patch(id), { ...fields, status: 'pending' }).commit()
    },
    markUnknown(id, fields) {
      // Status stays `sending`: the post may be in Buffer, so it must not be retried automatically.
      return applyFields(writeClient.patch(id), fields).commit()
    },
    skip(id, rev, fields) {
      return commitGuarded(writeClient, id, rev, { ...fields, status: 'skipped' })
    },
    restore(id, rev) {
      return commitGuarded(writeClient, id, rev, { status: 'pending' }, ['skippedBy', 'skippedAt'])
    },
    seed(records) {
      return createAll(writeClient, records)
    },
    createPending(records) {
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

export async function syncSocialPosts({
  client,
  writeClient,
  settings = {},
  seed = false,
  dryRun = false,
  now = new Date(),
} = {}) {
  const cache = await readCache()
  if (!cache) throw new Error('The publication cache could not be read, so no social posts were created.')
  // The same selection as /publications/feed.xml, so X and the RSS feed always agree.
  const items = selectFeedPublications(cache.publications || [])
  const provenance = cache.provenance || {}
  const records = await fetchSocialPostRecords(client, SOCIAL_NETWORK_X)

  const plan = planSocialPostSync({ items, records, maxNew: MAX_NEW_POSTS_PER_SYNC, seed })
  const summary = { mode: plan.mode, dryRun, feedItems: items.length, existingRecords: records.length }
  if (plan.mode === 'abort') {
    return { ...summary, newItems: plan.newCount, reason: plan.reason, seeded: 0, created: 0, records }
  }

  const toWrite = plan.mode === 'seed' ? plan.toSeed : plan.toCreate
  const researcherIds = Array.from(new Set(toWrite.flatMap((item) => getProvenanceIds(item.publication, provenance))))
  const namesById = await fetchResearcherNames(client, researcherIds)
  const status = plan.mode === 'seed' ? 'seeded' : 'pending'
  const built = toWrite.map((item) => buildSocialPostRecord({
    item,
    network: SOCIAL_NETWORK_X,
    intro: settings.xIntro,
    teamMembers: getProvenanceIds(item.publication, provenance).map((id) => namesById.get(id)).filter(Boolean),
    status,
    now,
  }))

  if (!dryRun && built.length) {
    const store = createSanitySocialPostStore(writeClient)
    if (plan.mode === 'seed') await store.seed(built)
    else await store.createPending(built)
  }

  return {
    ...summary,
    seeded: plan.mode === 'seed' ? built.length : 0,
    created: plan.mode === 'create' ? built.length : 0,
    // The expected record list after this sync, used to preview the email on dry runs.
    records: [...records, ...built],
  }
}
