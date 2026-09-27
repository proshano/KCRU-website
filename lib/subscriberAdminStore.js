// Sanity reads and writes for the mailing list at /admin/people.
//
// Only published records are emailed. Subscribers edited in Studio can have an unpublished
// draft (drafts.<id>) next to the published record; edits and deletes here cover both copies,
// so publishing an old draft cannot undo them. A record created in Studio but never published
// exists only as a draft: it is listed as "unpublished" so staff can review and publish it
// (or delete it), because until then that person gets no emails.

import { randomUUID } from 'node:crypto'

import {
  UNPUBLISHED_STATUS,
  buildNewSubscriberDocument,
  buildSubscriberPatch,
  getSubscriberStatus,
} from './subscriberAdmin.js'
import { normalizeEmailAddress } from './peopleSettings.js'
import { pickPublishedSubscriber } from './updateSubscriberStatus.js'

const SUBSCRIBER_TYPE = 'updateSubscriber'
const DRAFT_PREFIX = 'drafts.'
const CONFLICT_MESSAGE = 'This subscriber was changed since you opened the list. Reload, then try again.'
// Send tracking an unpublished record picked up while drafts were still being emailed.
const SEND_TRACKING_FIELDS = [
  'lastStudyUpdateSentAt',
  'lastPublicationNewsletterSentAt',
  'lastResearchDigestSentAt',
  'lastNewsletterSentAt',
]

const LIST_PROJECTION = `
  _id,
  _rev,
  name,
  email,
  role,
  specialty,
  correspondencePreferences,
  subscriptionStatus,
  deliveryStatus,
  allTherapeuticAreas,
  "legacyAllAreas": "all" in interestAreas,
  "interestAreaIds": interestAreas[]._ref,
  "practiceSiteIds": practiceSites[]._ref,
  notes,
  source,
  addedBy,
  createdAt,
  updatedAt,
  unsubscribedAt,
  lastStudyUpdateSentAt,
  lastPublicationNewsletterSentAt,
  lastResearchDigestSentAt,
  lastNewsletterSentAt
`

export class SubscriberAdminError extends Error {
  constructor(message, statusCode = 400, details = {}) {
    super(message)
    this.name = 'SubscriberAdminError'
    this.statusCode = statusCode
    Object.assign(this, details)
  }
}

function isRevisionConflict(error) {
  const statusCode = error?.statusCode || error?.response?.statusCode
  return statusCode === 409 || /revision/i.test(String(error?.message || ''))
}

function publishedIdOf(id) {
  return id.startsWith(DRAFT_PREFIX) ? id.slice(DRAFT_PREFIX.length) : id
}

function compact(values) {
  return Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value) : []
}

export function toSubscriberListItem(row) {
  return {
    _id: row._id,
    _rev: row._rev,
    name: row.name || '',
    email: row.email || '',
    role: row.role || '',
    specialty: row.specialty || '',
    correspondencePreferences: compact(row.correspondencePreferences),
    status: row.draftOnly ? UNPUBLISHED_STATUS : getSubscriberStatus(row),
    allTherapeuticAreas: Boolean(row.allTherapeuticAreas || row.legacyAllAreas),
    interestAreaIds: compact(row.interestAreaIds),
    practiceSiteIds: compact(row.practiceSiteIds),
    notes: row.notes || '',
    source: row.source || '',
    addedBy: row.addedBy || '',
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
    unsubscribedAt: row.unsubscribedAt || null,
    lastStudyUpdateSentAt: row.lastStudyUpdateSentAt || null,
    lastPublicationNewsletterSentAt: row.lastPublicationNewsletterSentAt || null,
    lastResearchDigestSentAt: row.lastResearchDigestSentAt || null,
    lastNewsletterSentAt: row.lastNewsletterSentAt || null,
    draftOnly: Boolean(row.draftOnly),
  }
}

/** One row per person: the published record, else its draft. Newest changes first. */
export function mergeSubscriberRows(rows = []) {
  const byId = new Map()
  for (const row of rows || []) {
    if (typeof row?._id !== 'string' || !row._id) continue
    const baseId = publishedIdOf(row._id)
    const entry = byId.get(baseId) || {}
    if (row._id.startsWith(DRAFT_PREFIX)) entry.draft = row
    else entry.published = row
    byId.set(baseId, entry)
  }
  const merged = Array.from(byId.values(), ({ published, draft }) =>
    toSubscriberListItem(published || { ...draft, draftOnly: true })
  )
  const time = (value) => (value ? Date.parse(value) || 0 : 0)
  return merged.sort(
    (a, b) =>
      time(b.updatedAt) - time(a.updatedAt) ||
      time(b.createdAt) - time(a.createdAt) ||
      a.email.localeCompare(b.email)
  )
}

export async function listSubscribers(client) {
  const rows = await client.fetch(
    `*[_type == "${SUBSCRIBER_TYPE}" && !(_id in path("versions.**"))]{ ${LIST_PROJECTION} }`
  )
  return mergeSubscriberRows(rows)
}

async function publishedExists(client, id) {
  return Boolean(await client.fetch('count(*[_id == $id]) > 0', { id }))
}

// The published record with this address when there is one, else an unpublished draft.
async function findByEmail(client, email, excludeIds = []) {
  const { subscriber } = pickPublishedSubscriber(
    await client.fetch(
      `*[_type == "${SUBSCRIBER_TYPE}" && lower(email) == $email && !(_id in $excludeIds) && !(_id in path("versions.**"))]{
        _id, email, subscriptionStatus, deliveryStatus
      }`,
      { email: normalizeEmailAddress(email), excludeIds }
    )
  )
  return subscriber
}

async function duplicateError(client, existing) {
  const details = { code: 'duplicate', existingId: existing._id }
  if (!existing._id.startsWith(DRAFT_PREFIX)) {
    return new SubscriberAdminError(
      `${existing.email} is already on the mailing list (${getSubscriberStatus(existing)}). Search for them in the list to change their details.`,
      409,
      details
    )
  }
  if (await publishedExists(client, publishedIdOf(existing._id))) {
    return new SubscriberAdminError(
      `${existing.email} is in an unpublished change to another subscriber in Sanity Studio. Publish or discard that change in Studio first.`,
      409,
      details
    )
  }
  return new SubscriberAdminError(
    `${existing.email} was added in Sanity Studio but never published, so they get no emails. Open their record in the list to publish it.`,
    409,
    details
  )
}

export async function createSubscriber(
  client,
  { input, consentConfirmed, areaIds, siteIds, adminEmail, now = new Date(), createToken = randomUUID } = {}
) {
  const built = buildNewSubscriberDocument(input, {
    areaIds,
    siteIds,
    consentConfirmed,
    now,
    manageToken: createToken(),
    addedBy: adminEmail,
  })
  if (!built.ok) throw new SubscriberAdminError(built.error, 400, { code: built.code })

  const existing = await findByEmail(client, built.document.email)
  if (existing?._id) throw await duplicateError(client, existing)

  const created = await client.create(built.document)
  const { subscriber } = await fetchSubscriberWithDraft(client, created._id)
  return toSubscriberListItem(subscriber)
}

async function fetchSubscriberWithDraft(client, id) {
  const doc = await client.fetch(
    `*[_id == $id][0]{
      _type,
      ${LIST_PROJECTION},
      "draft": *[_id == "${DRAFT_PREFIX}" + ^._id][0]{ _id, _rev }
    }`,
    { id }
  )
  if (!doc?._id) throw new SubscriberAdminError('Subscriber not found. Reload the list.', 404)
  if (doc._type !== SUBSCRIBER_TYPE) {
    throw new SubscriberAdminError('That id does not belong to a mailing list subscriber.', 400)
  }
  const { draft, ...subscriber } = doc
  return { subscriber, draft: draft?._id ? draft : null }
}

function cleanId(value) {
  const id = String(value ?? '').trim()
  if (!id || id.length > 200 || !/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new SubscriberAdminError('Invalid subscriber id.', 400)
  }
  return id
}

export async function updateSubscriber(
  client,
  { id: rawId, rev, changes, consentConfirmed, areaIds, siteIds, now = new Date() } = {}
) {
  const id = cleanId(rawId)
  if (!rev) throw new SubscriberAdminError('Missing revision. Reload the list, then try again.', 400)

  const { subscriber, draft } = await fetchSubscriberWithDraft(client, id)
  if (subscriber._rev !== rev) throw new SubscriberAdminError(CONFLICT_MESSAGE, 409)
  if (subscriber._id.startsWith(DRAFT_PREFIX)) {
    throw new SubscriberAdminError('This record was never published. Publish it or delete it.', 400)
  }

  const current = toSubscriberListItem(subscriber)
  const patch = buildSubscriberPatch(changes, current, { areaIds, siteIds, consentConfirmed, now })
  if (!patch.ok) throw new SubscriberAdminError(patch.error, 400, { code: patch.code })

  if (patch.set.email && patch.set.email !== normalizeEmailAddress(current.email)) {
    const baseId = publishedIdOf(id)
    const existing = await findByEmail(client, patch.set.email, [baseId, `${DRAFT_PREFIX}${baseId}`])
    if (existing?._id && !existing._id.startsWith(DRAFT_PREFIX)) throw await duplicateError(client, existing)
  }

  const operations = { set: patch.set, ...(patch.unset.length ? { unset: patch.unset } : {}) }
  const mutations = [{ patch: { id: subscriber._id, ifRevisionID: subscriber._rev, ...operations } }]
  if (draft) mutations.push({ patch: { id: draft._id, ifRevisionID: draft._rev, ...operations } })
  try {
    await client.mutate(mutations, { returnDocuments: false, visibility: 'sync' })
  } catch (error) {
    if (isRevisionConflict(error)) throw new SubscriberAdminError(CONFLICT_MESSAGE, 409)
    throw error
  }

  const { subscriber: saved } = await fetchSubscriberWithDraft(client, id)
  return { subscriber: toSubscriberListItem(saved), before: current, draftUpdated: Boolean(draft) }
}

/**
 * Publishes a record that was created in Studio but never published, the way Studio's Publish
 * does: the published record takes the draft's id, and the draft is removed in the same
 * transaction. The admin's reviewed form is validated like a new subscriber, and it needs the
 * same confirmation that the person asked for the emails. The draft's token, creation date,
 * consent record and send history carry over, so links already sent keep working.
 */
export async function publishSubscriber(
  client,
  { id: rawId, rev, input, consentConfirmed, areaIds, siteIds, adminEmail, now = new Date(), createToken = randomUUID } = {}
) {
  const id = cleanId(rawId)
  if (!id.startsWith(DRAFT_PREFIX)) throw new SubscriberAdminError('This subscriber is already published.', 400)
  const draft = await client.fetch('*[_id == $id][0]', { id })
  if (!draft?._id) throw new SubscriberAdminError('Subscriber not found. Reload the list.', 404)
  if (draft._type !== SUBSCRIBER_TYPE) {
    throw new SubscriberAdminError('That id does not belong to a mailing list subscriber.', 400)
  }
  if (draft._rev !== rev) throw new SubscriberAdminError(CONFLICT_MESSAGE, 409)
  const baseId = publishedIdOf(id)
  if (await publishedExists(client, baseId)) throw new SubscriberAdminError(CONFLICT_MESSAGE, 409)

  // Publishing always makes someone an active subscriber; the list's "unpublished" is not a status.
  const { status: _status, ...fields } = input && typeof input === 'object' ? input : {}
  const built = buildNewSubscriberDocument(fields, {
    areaIds,
    siteIds,
    consentConfirmed,
    now,
    manageToken: draft.manageToken || createToken(),
    addedBy: draft.addedBy || adminEmail,
  })
  if (!built.ok) throw new SubscriberAdminError(built.error, 400, { code: built.code })

  const existing = await findByEmail(client, built.document.email, [baseId, id])
  if (existing?._id && !existing._id.startsWith(DRAFT_PREFIX)) throw await duplicateError(client, existing)

  const tracking = Object.fromEntries(SEND_TRACKING_FIELDS.filter((key) => draft[key]).map((key) => [key, draft[key]]))
  const document = {
    ...built.document,
    ...tracking,
    _id: baseId,
    source: draft.source || built.document.source,
    createdAt: draft.createdAt || built.document.createdAt,
    consent: draft.consent || built.document.consent,
  }
  try {
    await client.mutate([{ create: document }, { delete: { id } }], { returnDocuments: false, visibility: 'sync' })
  } catch (error) {
    if (isRevisionConflict(error)) throw new SubscriberAdminError(CONFLICT_MESSAGE, 409)
    throw error
  }

  const { subscriber } = await fetchSubscriberWithDraft(client, baseId)
  return toSubscriberListItem(subscriber)
}

export async function deleteSubscriber(client, { id: rawId } = {}) {
  const id = cleanId(rawId)
  const { subscriber, draft } = await fetchSubscriberWithDraft(client, id)
  const ids = [subscriber._id, draft?._id].filter(Boolean)
  await client.mutate(ids.map((docId) => ({ delete: { id: docId } })), { returnDocuments: false, visibility: 'sync' })
  return toSubscriberListItem(subscriber)
}
