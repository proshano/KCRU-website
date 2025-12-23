const STATUS_OPTIONS = new Set([
  'recruiting',
  'coming_soon',
  'active_not_recruiting',
  'completed',
])

const STUDY_TYPE_OPTIONS = new Set(['interventional', 'observational'])
const PHASE_OPTIONS = new Set([
  'phase1',
  'phase1_2',
  'phase2',
  'phase2_3',
  'phase3',
  'phase4',
  'na',
])

const CT_GOV_FIELDS = new Set([
  'briefTitle',
  'officialTitle',
  'briefSummary',
  'detailedDescription',
  'overallStatus',
  'phase',
  'studyType',
  'sponsor',
  'enrollmentCount',
  'startDate',
  'completionDate',
  'interventions',
  'eligibilityCriteriaRaw',
  'lastSyncedAt',
  'url',
])

export function sanitizeString(value) {
  if (!value) return ''
  return String(value).trim()
}

export function sanitizeArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => sanitizeString(item)).filter(Boolean)
}

function normalizeList(value) {
  if (Array.isArray(value)) return sanitizeArray(value)
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function uniqueArray(list) {
  return Array.from(new Set(list))
}

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

export async function ensureUniqueSlug({ baseSlug, excludeId, sanityFetch }) {
  if (!baseSlug) return ''
  let slug = baseSlug
  let suffix = 1
  while (suffix < 25) {
    const existing = await sanityFetch(
      `count(*[_type == "trialSummary" && slug.current == $slug && _id != $excludeId])`,
      { slug, excludeId: excludeId || '' }
    )
    if (!existing) return slug
    slug = `${baseSlug}-${suffix}`
    suffix += 1
  }
  return slug
}

function normalizeEnum(value, allowed) {
  const cleaned = sanitizeString(value)
  if (!cleaned) return null
  return allowed.has(cleaned) ? cleaned : null
}

function normalizeLocalContact(value) {
  const payload = value && typeof value === 'object' ? value : {}
  const contact = {
    name: sanitizeString(payload.name),
    role: sanitizeString(payload.role),
    email: sanitizeString(payload.email),
    phone: sanitizeString(payload.phone),
    displayPublicly: Boolean(payload.displayPublicly),
  }

  const hasDetails = contact.name || contact.role || contact.email || contact.phone || contact.displayPublicly
  return hasDetails ? contact : null
}

function pickCtGovData(value) {
  if (!value || typeof value !== 'object') return undefined
  const filtered = {}
  for (const [key, val] of Object.entries(value)) {
    if (!CT_GOV_FIELDS.has(key)) continue
    if (Array.isArray(val)) {
      filtered[key] = sanitizeArray(val)
    } else if (val === null || typeof val === 'string' || typeof val === 'number') {
      filtered[key] = typeof val === 'string' ? val.trim() : val
    }
  }
  return Object.keys(filtered).length ? filtered : undefined
}

export function normalizeStudyPayload(body) {
  const payload = body && typeof body === 'object' ? body : {}
  const title = sanitizeString(payload.title)
  const slug = sanitizeString(payload.slug)
  const nctId = sanitizeString(payload.nctId).toUpperCase()
  const status = normalizeEnum(payload.status, STATUS_OPTIONS) || 'recruiting'
  const studyType = normalizeEnum(payload.studyType, STUDY_TYPE_OPTIONS)
  const phase = normalizeEnum(payload.phase, PHASE_OPTIONS)

  return {
    title,
    slug,
    nctId: nctId || '',
    status,
    studyType,
    phase,
    laySummary: sanitizeString(payload.laySummary),
    eligibilityOverview: sanitizeString(payload.eligibilityOverview),
    inclusionCriteria: normalizeList(payload.inclusionCriteria),
    exclusionCriteria: normalizeList(payload.exclusionCriteria),
    sponsorWebsite: sanitizeString(payload.sponsorWebsite),
    featured: Boolean(payload.featured),
    acceptsReferrals: Boolean(payload.acceptsReferrals),
    localContact: normalizeLocalContact(payload.localContact),
    therapeuticAreaIds: uniqueArray(normalizeList(payload.therapeuticAreaIds)),
    principalInvestigatorId: sanitizeString(payload.principalInvestigatorId),
    ctGovData: pickCtGovData(payload.ctGovData),
  }
}

export function buildReferences(ids) {
  const cleaned = uniqueArray(normalizeList(ids))
  return cleaned.map((id) => ({ _type: 'reference', _ref: id }))
}

export function buildPatchFields(normalized, slugValue) {
  const fields = {
    title: normalized.title || undefined,
    nctId: normalized.nctId || undefined,
    status: normalized.status || undefined,
    studyType: normalized.studyType,
    phase: normalized.phase,
    laySummary: normalized.laySummary || null,
    eligibilityOverview: normalized.eligibilityOverview || null,
    inclusionCriteria: normalized.inclusionCriteria || [],
    exclusionCriteria: normalized.exclusionCriteria || [],
    sponsorWebsite: normalized.sponsorWebsite || null,
    featured: normalized.featured,
    acceptsReferrals: normalized.acceptsReferrals,
    therapeuticAreas: buildReferences(normalized.therapeuticAreaIds),
  }

  if (slugValue) {
    fields.slug = { _type: 'slug', current: slugValue }
  }

  if (normalized.localContact) {
    fields.localContact = normalized.localContact
  }

  if (normalized.principalInvestigatorId) {
    fields.principalInvestigator = {
      _type: 'reference',
      _ref: normalized.principalInvestigatorId,
    }
  }

  if (normalized.ctGovData) {
    fields.ctGovData = normalized.ctGovData
  }

  return fields
}

export function buildUnsetFields(normalized) {
  const unset = []
  if (!normalized.localContact) unset.push('localContact')
  if (!normalized.principalInvestigatorId) unset.push('principalInvestigator')
  return unset
}
