// Mailing list edits made by admins at /admin/people. Browser-safe: the portal shows the same
// statuses and the route applies the same rules.

import { CORRESPONDENCE_VALUES, ROLE_VALUES, SPECIALTY_VALUES } from './communicationOptions.js'
import { isValidEmailAddress, normalizeEmailAddress } from './peopleSettings.js'

const STUDY_UPDATES_PREF = 'study_updates'
const MAX_NAME_LENGTH = 200
const MAX_NOTES_LENGTH = 2000

// One status for staff, mapped onto the two stored fields. Only "subscribed" is ever
// delivered (the send routes filter on it), so anything else reads as unsubscribed.
export const SUBSCRIBER_STATUS_OPTIONS = Object.freeze([
  { value: 'active', title: 'Active', description: 'Gets the emails they chose.' },
  {
    value: 'suppressed',
    title: 'Suppressed',
    description: 'Stays on the list but is not emailed, for example while test sends are going out.',
  },
  {
    value: 'unsubscribed',
    title: 'Unsubscribed',
    description: 'Opted out. Keep the record so they are not added back by mistake.',
  },
])

const STATUS_VALUES = new Set(SUBSCRIBER_STATUS_OPTIONS.map((option) => option.value))

export const SUBSCRIBER_EDITABLE_FIELDS = Object.freeze([
  'name',
  'email',
  'role',
  'specialty',
  'correspondencePreferences',
  'allTherapeuticAreas',
  'interestAreas',
  'practiceSites',
  'notes',
  'status',
])

export function getSubscriberStatus(subscriber) {
  if (subscriber?.subscriptionStatus !== 'subscribed') return 'unsubscribed'
  return subscriber?.deliveryStatus === 'suppressed' ? 'suppressed' : 'active'
}

function fail(error, extra = {}) {
  return { ok: false, error, ...extra }
}

function cleanText(value, maxLength) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, maxLength)
}

function uniqueStrings(value) {
  if (!Array.isArray(value)) return null
  return Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean)))
}

export function buildReferences(ids = []) {
  return ids.map((id) => ({ _type: 'reference', _ref: id, _key: id }))
}

function has(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key)
}

/**
 * Normalizes the fields present in `input` (all of them when `required`). Unknown interest
 * areas and sites are dropped rather than refused: they only appear when one was switched
 * off in Studio after the page loaded.
 */
export function validateSubscriberFields(input = {}, { areaIds = [], siteIds = [], required = false } = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const fields = {}

  if (has(source, 'name')) fields.name = cleanText(source.name, MAX_NAME_LENGTH)

  if (required || has(source, 'email')) {
    const email = normalizeEmailAddress(source.email)
    if (!email) return fail('Enter an email address.')
    if (!isValidEmailAddress(email)) return fail(`"${String(source.email).trim()}" is not a valid email address.`)
    fields.email = email
  }

  if (required || has(source, 'role')) {
    const role = String(source.role ?? '').trim()
    if (!ROLE_VALUES.has(role)) return fail('Choose a role.')
    fields.role = role
  }

  if (has(source, 'specialty')) {
    const specialty = String(source.specialty ?? '').trim()
    if (specialty && !SPECIALTY_VALUES.has(specialty)) return fail('Choose a specialty from the list.')
    fields.specialty = specialty
  }

  if (required || has(source, 'correspondencePreferences')) {
    const preferences = uniqueStrings(source.correspondencePreferences)
    if (!preferences?.length) return fail('Choose at least one type of email.')
    if (preferences.some((value) => !CORRESPONDENCE_VALUES.has(value))) return fail('Choose email types from the list.')
    fields.correspondencePreferences = preferences
  }

  if (has(source, 'allTherapeuticAreas')) fields.allTherapeuticAreas = source.allTherapeuticAreas === true

  if (has(source, 'interestAreas')) {
    const allowed = new Set(areaIds)
    fields.interestAreas = (uniqueStrings(source.interestAreas) || []).filter((id) => allowed.has(id))
  }

  if (has(source, 'practiceSites')) {
    const allowed = new Set(siteIds)
    fields.practiceSites = (uniqueStrings(source.practiceSites) || []).filter((id) => allowed.has(id))
  }

  if (has(source, 'notes')) fields.notes = cleanText(source.notes, MAX_NOTES_LENGTH)

  if (has(source, 'status')) {
    if (!STATUS_VALUES.has(source.status)) return fail('Choose a status from the list.')
    fields.status = source.status
  }

  return { ok: true, fields }
}

// The same rule Studio enforces: study updates are sent by interest area, so someone who
// wants them needs at least one area (or all of them).
function checkStudyUpdateAreas({ correspondencePreferences = [], allTherapeuticAreas, interestAreas = [] }) {
  if (!correspondencePreferences.includes(STUDY_UPDATES_PREF)) return null
  if (allTherapeuticAreas || interestAreas.length) return null
  return 'Choose at least one interest area (or All areas) for study update emails.'
}

const CONSENT_MESSAGE = 'Confirm that this person agreed to receive these emails.'

export function buildNewSubscriberDocument(
  input,
  { areaIds = [], siteIds = [], consentConfirmed = false, now, manageToken, addedBy } = {}
) {
  if (consentConfirmed !== true) return fail(CONSENT_MESSAGE, { code: 'consent_required' })
  const result = validateSubscriberFields(input, { areaIds, siteIds, required: true })
  if (!result.ok) return result
  const { fields } = result

  const allTherapeuticAreas = fields.allTherapeuticAreas === true
  const interestAreas = allTherapeuticAreas ? [] : fields.interestAreas || []
  const areaError = checkStudyUpdateAreas({
    correspondencePreferences: fields.correspondencePreferences,
    allTherapeuticAreas,
    interestAreas,
  })
  if (areaError) return fail(areaError)

  const timestamp = new Date(now ?? Date.now()).toISOString()
  const document = {
    _type: 'updateSubscriber',
    email: fields.email,
    role: fields.role,
    correspondencePreferences: fields.correspondencePreferences,
    allTherapeuticAreas,
    interestAreas: buildReferences(interestAreas),
    practiceSites: buildReferences(fields.practiceSites || []),
    subscriptionStatus: 'subscribed',
    deliveryStatus: 'active',
    source: 'admin',
    manageToken,
    createdAt: timestamp,
    updatedAt: timestamp,
    consent: { source: 'admin', timestamp },
  }
  if (fields.name) document.name = fields.name
  if (fields.specialty) document.specialty = fields.specialty
  if (fields.notes) document.notes = fields.notes
  if (addedBy) document.addedBy = normalizeEmailAddress(addedBy)
  return { ok: true, document }
}

/**
 * Turns an admin edit into a Sanity set/unset. Only the fields sent are validated and written,
 * so an old record with a missing role can still be unsubscribed. `current` is the stored
 * subscriber as listed (status, correspondencePreferences, allTherapeuticAreas, interestAreaIds).
 */
export function buildSubscriberPatch(
  changes,
  current = {},
  { areaIds = [], siteIds = [], consentConfirmed = false, now } = {}
) {
  const editable = Object.fromEntries(
    Object.entries(changes && typeof changes === 'object' ? changes : {}).filter(([key]) =>
      SUBSCRIBER_EDITABLE_FIELDS.includes(key)
    )
  )
  const result = validateSubscriberFields(editable, { areaIds, siteIds })
  if (!result.ok) return result
  const { fields } = result
  if (!Object.keys(fields).length) return fail('Nothing to change.')

  const timestamp = new Date(now ?? Date.now()).toISOString()
  const set = {}
  const unset = []
  const setOrUnset = (key, value) => (value ? (set[key] = value) : unset.push(key))

  if ('name' in fields) setOrUnset('name', fields.name)
  if ('notes' in fields) setOrUnset('notes', fields.notes)
  if ('specialty' in fields) setOrUnset('specialty', fields.specialty)
  if ('email' in fields) set.email = fields.email
  if ('role' in fields) set.role = fields.role
  if ('correspondencePreferences' in fields) set.correspondencePreferences = fields.correspondencePreferences
  if ('allTherapeuticAreas' in fields) set.allTherapeuticAreas = fields.allTherapeuticAreas
  if ('interestAreas' in fields) set.interestAreas = buildReferences(fields.interestAreas)
  if ('practiceSites' in fields) set.practiceSites = buildReferences(fields.practiceSites)

  const touchesAreas = ['correspondencePreferences', 'allTherapeuticAreas', 'interestAreas'].some((key) => key in fields)
  if (touchesAreas) {
    const areaError = checkStudyUpdateAreas({
      correspondencePreferences: fields.correspondencePreferences ?? current.correspondencePreferences ?? [],
      allTherapeuticAreas: fields.allTherapeuticAreas ?? Boolean(current.allTherapeuticAreas),
      interestAreas: fields.interestAreas ?? current.interestAreaIds ?? [],
    })
    if (areaError) return fail(areaError)
  }

  const before = STATUS_VALUES.has(current.status) ? current.status : getSubscriberStatus(current)
  if (fields.status && fields.status !== before) {
    if (fields.status === 'unsubscribed') {
      set.subscriptionStatus = 'unsubscribed'
      set.unsubscribedAt = timestamp
    } else {
      // Putting someone back on the list after they opted out needs their say-so.
      if (before === 'unsubscribed' && consentConfirmed !== true) {
        return fail('Only resubscribe someone who asked to receive emails again. Confirm that they did.', {
          code: 'consent_required',
        })
      }
      set.subscriptionStatus = 'subscribed'
      set.deliveryStatus = fields.status
      if (before === 'unsubscribed') unset.push('unsubscribedAt')
    }
  }

  set.updatedAt = timestamp
  return { ok: true, set, unset, fields }
}
