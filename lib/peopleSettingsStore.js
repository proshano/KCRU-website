// Sanity reads and writes behind /admin/people.
//
// Every write is guarded twice. The caller sends the value it started from (`previous`), which
// must still match what is stored, so two admins editing the same list get a conflict instead
// of silently overwriting each other. The patch then carries ifRevisionID, so nothing can
// change between that check and the write.
//
// Writes go to the published document and, when Studio holds an unpublished draft of it, to
// that draft too. Otherwise publishing the older draft later would quietly undo the change,
// which for an access list could restore the sign-in access of someone just removed.

import { resolveCoordinatorDomains } from './coordinatorDomains.js'
import {
  PEOPLE_SCOPE_LABELS,
  canEditPeopleField,
  describeEmailListChange,
  findEditorLockout,
  getPeopleField,
  normalizeEmailAddress,
  normalizeStoredEmailList,
  sameEmailList,
  validateEmailList,
  validateOptionalEmail,
  validateRoutingEmails,
} from './peopleSettings.js'

const PUBLISHED_FILTER = '!(_id in path("drafts.**")) && !(_id in path("versions.**"))'
const CONFLICT_MESSAGE = 'Someone else changed this since you opened the page. Reload to see the latest version, then try again.'

// Whole parent objects are read so a write can merge into them (see buildFieldPatch).
const SETTINGS_WRITE_PROJECTION = '_id, _rev, studyApprovals, studyUpdates, socialPosting, contactEmail, replyToEmail'
const ROUTING_WRITE_PROJECTION = '_id, _rev, options'

export class PeopleSettingsError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'PeopleSettingsError'
    this.statusCode = statusCode
  }
}

function isRevisionConflict(error) {
  const statusCode = error?.statusCode || error?.response?.statusCode
  return statusCode === 409 || /revision/i.test(String(error?.message || ''))
}

export async function fetchPeopleSettings(client) {
  const result = await client.fetch(`{
    "settings": *[_type == "siteSettings" && ${PUBLISHED_FILTER}][0]{
      _id,
      "coordinatorDomain": studyApprovals.coordinatorDomain,
      "approvalAdmins": studyApprovals.admins,
      "coordinators": studyApprovals.coordinatorEmails,
      "updateAdmins": studyUpdates.admins,
      "socialApprovers": socialPosting.approverEmails,
      contactEmail,
      replyToEmail,
      "testing": updateEmailTesting{ enabled, recipients },
      "digestPilot": researchDigest{ pilotMode, pilotRecipients }
    },
    "routing": *[_type == "contactRouting" && ${PUBLISHED_FILTER}][0]{
      _id,
      "options": options[]{ key, label, email }
    }
  }`)
  return { settings: result?.settings || null, routing: result?.routing || null }
}

function readRoutingOptions(routing) {
  const options = Array.isArray(routing?.options) ? routing.options : []
  const seen = new Set()
  return options
    .filter((option) => {
      const key = String(option?.key || '').trim()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .map((option) => ({
      key: String(option.key).trim(),
      label: String(option.label || option.key).trim(),
      email: normalizeEmailAddress(option.email),
    }))
}

/**
 * The page's read model. `canEdit` flags come from the same rules the PATCH enforces, so
 * the page only offers edits the server will accept.
 */
export function buildPeopleView({ settings, routing } = {}, { access = {}, serverPilotRecipients = [] } = {}) {
  const list = (key, raw) => ({
    emails: normalizeStoredEmailList(raw),
    canEdit: canEditPeopleField(access, key),
  })
  const single = (key, raw) => ({
    email: normalizeEmailAddress(raw),
    canEdit: canEditPeopleField(access, key),
  })

  return {
    settingsExists: Boolean(settings?._id),
    signInDomains: resolveCoordinatorDomains(settings?.coordinatorDomain),
    lists: {
      approvalAdmins: list('approvalAdmins', settings?.approvalAdmins),
      updateAdmins: list('updateAdmins', settings?.updateAdmins),
      coordinators: list('coordinators', settings?.coordinators),
      socialApprovers: list('socialApprovers', settings?.socialApprovers),
    },
    contactEmail: single('contactEmail', settings?.contactEmail),
    replyToEmail: single('replyToEmail', settings?.replyToEmail),
    contactRouting: {
      exists: Boolean(routing?._id),
      options: readRoutingOptions(routing),
      canEdit: canEditPeopleField(access, 'contactRouting'),
    },
    // Shown for reference only; each is edited on the page that owns its on/off switch.
    testing: {
      enabled: Boolean(settings?.testing?.enabled),
      recipients: normalizeStoredEmailList(settings?.testing?.recipients),
    },
    digestPilot: {
      enabled: Boolean(settings?.digestPilot?.pilotMode),
      recipients: normalizeStoredEmailList(settings?.digestPilot?.pilotRecipients),
      serverRecipientCount: normalizeStoredEmailList(serverPilotRecipients).length,
    },
  }
}

async function fetchWithDraft(client, type, projection) {
  const published = await client.fetch(
    `*[_type == $type && ${PUBLISHED_FILTER}][0]{
      ${projection},
      "draft": *[_id == "drafts." + ^._id][0]{ ${projection} }
    }`,
    { type }
  )
  if (!published?._id) return { published: null, draft: null }
  const { draft, ...rest } = published
  return { published: rest, draft: draft?._id ? draft : null }
}

function readFieldValue(doc, field) {
  const container = field.parent ? doc?.[field.parent] : doc
  const raw = container && typeof container === 'object' ? container[field.child] : undefined
  return field.kind === 'emailList' ? normalizeStoredEmailList(raw) : normalizeEmailAddress(raw)
}

function sameFieldValue(field, a, b) {
  if (field.kind === 'emailList') return sameEmailList(a, b)
  return normalizeEmailAddress(a) === normalizeEmailAddress(b)
}

// Nested lists are written by replacing their parent object with a merged copy of that same
// document's parent (the draft's own copy for the draft), so sibling fields such as the
// coordinator domain survive, without relying on how Sanity creates missing parents for a
// dotted path. The revision guard makes the read-merge-write safe.
function buildFieldPatch(doc, field, value) {
  if (!field.parent) {
    return value ? { set: { [field.child]: value } } : { unset: [field.child] }
  }
  const current = doc?.[field.parent]
  const container = current && typeof current === 'object' && !Array.isArray(current) ? current : {}
  return { set: { [field.parent]: { ...container, [field.child]: value } } }
}

async function commitGuarded(client, docs, buildPatch) {
  const mutations = [docs.published, docs.draft]
    .filter(Boolean)
    .map((doc) => ({ patch: { id: doc._id, ifRevisionID: doc._rev, ...buildPatch(doc) } }))
  try {
    await client.mutate(mutations, { returnDocuments: false, visibility: 'sync' })
  } catch (error) {
    if (isRevisionConflict(error)) throw new PeopleSettingsError(CONFLICT_MESSAGE, 409)
    throw error
  }
  return { draftUpdated: Boolean(docs.draft) }
}

function validateNextValue(field, value) {
  if (field.kind === 'emailList') {
    const result = validateEmailList(value)
    if (!result.ok) throw new PeopleSettingsError(result.error, 400)
    return result.emails
  }
  const result = validateOptionalEmail(value)
  if (!result.ok) throw new PeopleSettingsError(result.error, 400)
  return result.email
}

function describeChange(field, before, after) {
  if (field.kind === 'emailList') return describeEmailListChange(before, after)
  return { from: before || null, to: after || null }
}

async function updateSettingsField(client, key, field, { value, previous, editorEmail }) {
  const next = validateNextValue(field, value)
  const lockout = field.kind === 'emailList' ? findEditorLockout(key, next, editorEmail) : null
  if (lockout) throw new PeopleSettingsError(lockout, 400)

  const docs = await fetchWithDraft(client, 'siteSettings', SETTINGS_WRITE_PROJECTION)
  if (!docs.published) {
    throw new PeopleSettingsError('Site Settings has not been created yet. Create it in Sanity Studio first.', 500)
  }

  const current = readFieldValue(docs.published, field)
  if (!sameFieldValue(field, current, previous)) throw new PeopleSettingsError(CONFLICT_MESSAGE, 409)

  // Skip the write only when neither the published document nor a draft would change.
  if (sameFieldValue(field, current, next) && (!docs.draft || sameFieldValue(field, readFieldValue(docs.draft, field), next))) {
    return { key, value: current, changed: false, change: describeChange(field, current, current) }
  }

  const { draftUpdated } = await commitGuarded(client, docs, (doc) => buildFieldPatch(doc, field, next))
  return { key, value: next, changed: true, draftUpdated, change: describeChange(field, current, next) }
}

function readRoutingEmails(doc) {
  return Object.fromEntries(readRoutingOptions(doc).map((option) => [option.key, option.email]))
}

async function updateContactRouting(client, { value, previous }) {
  const parsed = validateRoutingEmails(value)
  if (!parsed.ok) throw new PeopleSettingsError(parsed.error, 400)

  const docs = await fetchWithDraft(client, 'contactRouting', ROUTING_WRITE_PROJECTION)
  if (!docs.published) {
    throw new PeopleSettingsError('The contact form reasons have not been set up yet. Add them in Sanity Studio first.', 404)
  }

  const current = readRoutingEmails(docs.published)
  const previousEmails = previous && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}
  for (const key of Object.keys(parsed.emails)) {
    const unchangedSinceLoad = Object.prototype.hasOwnProperty.call(current, key)
      && normalizeEmailAddress(previousEmails[key]) === current[key]
    if (!unchangedSinceLoad) throw new PeopleSettingsError(CONFLICT_MESSAGE, 409)
  }

  // Only the reasons whose address actually changed are rewritten.
  const changes = Object.fromEntries(
    Object.entries(parsed.emails).filter(([key, email]) => email !== current[key])
  )
  if (!Object.keys(changes).length) {
    return { key: 'contactRouting', value: current, changed: false, change: { changed: [] } }
  }

  const { draftUpdated } = await commitGuarded(client, docs, (doc) => ({
    set: {
      options: (Array.isArray(doc.options) ? doc.options : []).map((option) => {
        const optionKey = String(option?.key || '').trim()
        return Object.prototype.hasOwnProperty.call(changes, optionKey) ? { ...option, email: changes[optionKey] } : option
      }),
    },
  }))

  return {
    key: 'contactRouting',
    value: { ...current, ...changes },
    changed: true,
    draftUpdated,
    change: { changed: Object.entries(changes).map(([key, email]) => ({ key, from: current[key] || null, to: email })) },
  }
}

/**
 * Applies one edit from /admin/people. `access` and `editorEmail` come from the signed-in
 * session; callers must not take them from the request body.
 */
export async function updatePeopleField(client, { key, value, previous, access, editorEmail } = {}) {
  const field = getPeopleField(key)
  if (!field) throw new PeopleSettingsError('Unknown setting.', 400)
  if (!canEditPeopleField(access, key)) {
    throw new PeopleSettingsError(`Only ${PEOPLE_SCOPE_LABELS[field.scope]} can change this.`, 403)
  }
  if (field.kind === 'routing') return updateContactRouting(client, { value, previous })
  return updateSettingsField(client, key, field, { value, previous, editorEmail })
}
