import {
  TRIAL_PRESCREEN_CKD_STAGE_OPTIONS,
  TRIAL_PRESCREEN_DIABETES_OPTIONS,
  TRIAL_PRESCREEN_DIALYSIS_STATUS_OPTIONS,
  TRIAL_PRESCREEN_EXCLUSION_OPTIONS,
  TRIAL_PRESCREEN_MUST_ASK_OPTIONS,
  TRIAL_PRESCREEN_POPULATION_OPTIONS,
  TRIAL_PRESCREEN_SEX_OPTIONS,
  TRIAL_PRESCREEN_TRANSPLANT_STATUS_OPTIONS,
} from './trialPrescreen.js'

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

const PRESCREEN_SEX_OPTIONS = new Set(TRIAL_PRESCREEN_SEX_OPTIONS.map((option) => option.value))
const PRESCREEN_POPULATION_OPTIONS = new Set(TRIAL_PRESCREEN_POPULATION_OPTIONS.map((option) => option.value))
const PRESCREEN_CKD_STAGE_OPTIONS = new Set(TRIAL_PRESCREEN_CKD_STAGE_OPTIONS.map((option) => option.value))
const PRESCREEN_DIALYSIS_OPTIONS = new Set(TRIAL_PRESCREEN_DIALYSIS_STATUS_OPTIONS.map((option) => option.value))
const PRESCREEN_TRANSPLANT_OPTIONS = new Set(TRIAL_PRESCREEN_TRANSPLANT_STATUS_OPTIONS.map((option) => option.value))
const PRESCREEN_DIABETES_OPTIONS = new Set(TRIAL_PRESCREEN_DIABETES_OPTIONS.map((option) => option.value))
const PRESCREEN_EXCLUSION_OPTIONS = new Set(TRIAL_PRESCREEN_EXCLUSION_OPTIONS.map((option) => option.value))
const PRESCREEN_MUST_ASK_OPTIONS = new Set(TRIAL_PRESCREEN_MUST_ASK_OPTIONS.map((option) => option.value))

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

function normalizeNumber(value, { min = 0, max = 999 } = {}) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (number < min || number > max) return null
  return number
}

function normalizeOptionList(value, allowed) {
  return uniqueArray(normalizeList(value).filter((item) => allowed.has(item)))
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

function normalizePrescreen(value) {
  const payload = value && typeof value === 'object' ? value : {}
  const minimumAgeYears = normalizeNumber(payload.minimumAgeYears, { min: 0, max: 120 })
  const maximumAgeYears = normalizeNumber(payload.maximumAgeYears, { min: 0, max: 120 })

  const prescreen = {
    screeningSummary: sanitizeString(payload.screeningSummary),
    sexAllowed: normalizeEnum(payload.sexAllowed, PRESCREEN_SEX_OPTIONS) || 'all',
    minimumAgeYears,
    maximumAgeYears,
    populationTags: normalizeOptionList(payload.populationTags, PRESCREEN_POPULATION_OPTIONS),
    ckdStages: normalizeOptionList(payload.ckdStages, PRESCREEN_CKD_STAGE_OPTIONS),
    dialysisStatus: normalizeEnum(payload.dialysisStatus, PRESCREEN_DIALYSIS_OPTIONS) || 'not_applicable',
    transplantStatus: normalizeEnum(payload.transplantStatus, PRESCREEN_TRANSPLANT_OPTIONS) || 'not_applicable',
    diabetesRequirement: normalizeEnum(payload.diabetesRequirement, PRESCREEN_DIABETES_OPTIONS) || 'not_applicable',
    egfrMin: normalizeNumber(payload.egfrMin, { min: 0, max: 200 }),
    egfrMax: normalizeNumber(payload.egfrMax, { min: 0, max: 200 }),
    requiresAlbuminuria: Boolean(payload.requiresAlbuminuria),
    requiresProteinuria: Boolean(payload.requiresProteinuria),
    exclusionTags: normalizeOptionList(payload.exclusionTags, PRESCREEN_EXCLUSION_OPTIONS),
    mustAsk: normalizeOptionList(payload.mustAsk, PRESCREEN_MUST_ASK_OPTIONS),
    optionalQuestions: normalizeCriteriaList(payload.optionalQuestions).slice(0, 8),
  }

  if (
    prescreen.minimumAgeYears !== null &&
    prescreen.maximumAgeYears !== null &&
    prescreen.minimumAgeYears > prescreen.maximumAgeYears
  ) {
    prescreen.minimumAgeYears = maximumAgeYears
    prescreen.maximumAgeYears = minimumAgeYears
  }

  if (prescreen.egfrMin !== null && prescreen.egfrMax !== null && prescreen.egfrMin > prescreen.egfrMax) {
    const egfrMin = prescreen.egfrMin
    prescreen.egfrMin = prescreen.egfrMax
    prescreen.egfrMax = egfrMin
  }

  const hasContent =
    prescreen.screeningSummary ||
    prescreen.sexAllowed !== 'all' ||
    prescreen.minimumAgeYears !== null ||
    prescreen.maximumAgeYears !== null ||
    prescreen.populationTags.length ||
    prescreen.ckdStages.length ||
    prescreen.dialysisStatus !== 'not_applicable' ||
    prescreen.transplantStatus !== 'not_applicable' ||
    prescreen.diabetesRequirement !== 'not_applicable' ||
    prescreen.egfrMin !== null ||
    prescreen.egfrMax !== null ||
    prescreen.requiresAlbuminuria ||
    prescreen.requiresProteinuria ||
    prescreen.exclusionTags.length ||
    prescreen.mustAsk.length ||
    prescreen.optionalQuestions.length

  return hasContent ? prescreen : null
}

export function normalizeStudyPayload(body) {
  const payload = body && typeof body === 'object' ? body : {}
  const title = sanitizeString(payload.title)
  const slug = sanitizeString(payload.slug)
  const nctId = sanitizeString(payload.nctId).toUpperCase()
  const status = normalizeEnum(payload.status, STATUS_OPTIONS) || 'recruiting'
  const studyType = normalizeEnum(payload.studyType, STUDY_TYPE_OPTIONS)
  const phase = normalizeEnum(payload.phase, PHASE_OPTIONS)
  const principalInvestigatorId = sanitizeString(payload.principalInvestigatorId)
  let principalInvestigatorName = sanitizeString(payload.principalInvestigatorName)
  if (principalInvestigatorId) {
    principalInvestigatorName = ''
  }

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
    acceptsReferrals: Boolean(payload.acceptsReferrals),
    localContact: normalizeLocalContact(payload.localContact),
    therapeuticAreaIds: uniqueArray(normalizeList(payload.therapeuticAreaIds)),
    principalInvestigatorId,
    principalInvestigatorName,
    ctGovData: pickCtGovData(payload.ctGovData),
    prescreen: normalizePrescreen(payload.prescreen),
  }
}

export function buildReferences(ids) {
  const cleaned = uniqueArray(normalizeList(ids))
  return cleaned.map((id) => ({ _type: 'reference', _ref: id, _key: id }))
}

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

  if (normalized.principalInvestigatorName) {
    fields.principalInvestigatorName = normalized.principalInvestigatorName
  }

  if (normalized.ctGovData) {
    fields.ctGovData = normalized.ctGovData
  }

  if (normalized.prescreen) {
    fields.prescreen = normalized.prescreen
  }

  return fields
}

export function buildUnsetFields(normalized) {
  const unset = []
  if (!normalized.localContact) unset.push('localContact')
  if (!normalized.principalInvestigatorId) unset.push('principalInvestigator')
  if (!normalized.principalInvestigatorName || normalized.principalInvestigatorId) {
    unset.push('principalInvestigatorName')
  }
  if (!normalized.prescreen) unset.push('prescreen')
  unset.push('ageRange', 'conditions', 'eligibilityOverview')
  return unset
}
