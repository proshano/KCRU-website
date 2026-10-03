import {
  normalizeRecruitmentSiteIds,
  payloadTeamsToSanity,
  resolvePayloadTeams,
} from './studyTeams.js'

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
  'acronym',
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

function normalizeCriteriaText(value) {
  return sanitizeString(value)
    .replace(/\\+([<>^\[\]])/g, '$1')
    .replace(/&gt;/gi, '>')
    .replace(/&lt;/gi, '<')
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

function normalizeCriteriaList(value) {
  return normalizeList(value).map((item) => normalizeCriteriaText(item)).filter(Boolean)
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

/**
 * Cleans a study payload from the Study Manager, the approval editor, a stored
 * submission or a draft. Teams come back in payload shape (see
 * lib/studyTeams.js); a payload that predates teams gets one team built from its
 * single PI and contact, so the legacy fields never need to be read again.
 */
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
    emailTitle: sanitizeString(payload.emailTitle),
    emailEligibilitySummary: sanitizeString(payload.emailEligibilitySummary),
    inclusionCriteria: normalizeCriteriaList(payload.inclusionCriteria),
    exclusionCriteria: normalizeCriteriaList(payload.exclusionCriteria),
    sponsorWebsite: sanitizeString(payload.sponsorWebsite),
    featured: Boolean(payload.featured),
    therapeuticAreaIds: uniqueArray(normalizeList(payload.therapeuticAreaIds)),
    siteTeams: resolvePayloadTeams({ ...payload, status }),
    recruitmentSiteIds: normalizeRecruitmentSiteIds(payload.recruitmentSiteIds),
    ctGovData: pickCtGovData(payload.ctGovData),
  }
}

export function buildReferences(ids) {
  const cleaned = uniqueArray(normalizeList(ids))
  return cleaned.map((id) => ({ _type: 'reference', _ref: id, _key: id }))
}

// Fields every write path sets on a trialSummary. The legacy single PI and
// contact fields are never written again; buildUnsetFields removes them.
export function buildPatchFields(normalized, slugValue) {
  const fields = {
    title: normalized.title || undefined,
    nctId: normalized.nctId || undefined,
    status: normalized.status || undefined,
    studyType: normalized.studyType,
    phase: normalized.phase,
    laySummary: normalized.laySummary || null,
    emailTitle: normalized.emailTitle || null,
    emailEligibilitySummary: normalized.emailEligibilitySummary || null,
    inclusionCriteria: normalized.inclusionCriteria || [],
    exclusionCriteria: normalized.exclusionCriteria || [],
    sponsorWebsite: normalized.sponsorWebsite || null,
    featured: normalized.featured,
    therapeuticAreas: buildReferences(normalized.therapeuticAreaIds),
    siteTeams: payloadTeamsToSanity(normalized.siteTeams),
    recruitmentSites: buildReferences(normalized.recruitmentSiteIds),
  }

  if (slugValue) {
    fields.slug = { _type: 'slug', current: slugValue }
  }

  if (normalized.ctGovData) {
    fields.ctGovData = normalized.ctGovData
  }

  return fields
}

export const LEGACY_STUDY_FIELDS = ['localContact', 'principalInvestigator', 'principalInvestigatorName', 'acceptsReferrals']

export function buildUnsetFields() {
  return [...LEGACY_STUDY_FIELDS, 'prescreen', 'ageRange', 'conditions', 'eligibilityOverview']
}

// The document both create paths (approval and admin direct publish) write.
export function buildTrialSummaryDoc(normalized, slugValue) {
  const fields = buildPatchFields(normalized, slugValue)
  const doc = { _type: 'trialSummary' }
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) doc[key] = value
  }
  return doc
}
