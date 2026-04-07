import {
  TRIAL_PRESCREEN_CKD_STAGE_LABELS,
  TRIAL_PRESCREEN_CKD_STAGE_OPTIONS,
  TRIAL_PRESCREEN_DIALYSIS_STATUS_LABELS,
  TRIAL_PRESCREEN_DIALYSIS_STATUS_OPTIONS,
  TRIAL_PRESCREEN_EXCLUSION_LABELS,
  TRIAL_PRESCREEN_EXCLUSION_OPTIONS,
  TRIAL_PRESCREEN_POPULATION_LABELS,
  TRIAL_PRESCREEN_POPULATION_OPTIONS,
  TRIAL_PRESCREEN_TRANSPLANT_STATUS_LABELS,
  TRIAL_PRESCREEN_TRANSPLANT_STATUS_OPTIONS,
} from './trialPrescreen.js'

const SEX_VALUES = new Set(['female', 'male'])
const POPULATION_VALUES = new Set(TRIAL_PRESCREEN_POPULATION_OPTIONS.map((option) => option.value))
const CKD_STAGE_VALUES = new Set(TRIAL_PRESCREEN_CKD_STAGE_OPTIONS.map((option) => option.value))
const DIALYSIS_VALUES = new Set(
  TRIAL_PRESCREEN_DIALYSIS_STATUS_OPTIONS.map((option) => option.value).filter((value) => value !== 'not_applicable')
)
const TRANSPLANT_VALUES = new Set(
  TRIAL_PRESCREEN_TRANSPLANT_STATUS_OPTIONS.map((option) => option.value).filter((value) => value !== 'not_applicable')
)
const EXCLUSION_VALUES = new Set(TRIAL_PRESCREEN_EXCLUSION_OPTIONS.map((option) => option.value))

function normalizeText(value, { max = 120 } = {}) {
  if (value === null || value === undefined) return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  if (!text) return null
  const clipped = text.length > max ? text.slice(0, max).trim() : text
  return clipped || null
}

function normalizeNumber(value, { min = 0, max = 999 } = {}) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (number < min || number > max) return null
  return number
}

function normalizeBoolean(value) {
  if (value === true || value === false) return value
  if (typeof value === 'string') {
    const cleaned = value.trim().toLowerCase()
    if (['yes', 'true', 'positive', 'present'].includes(cleaned)) return true
    if (['no', 'false', 'negative', 'absent'].includes(cleaned)) return false
  }
  return null
}

function normalizeEnum(value, allowedValues) {
  if (!value) return null
  const cleaned = String(value).trim()
  return allowedValues.has(cleaned) ? cleaned : null
}

function normalizeList(value, allowedValues) {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .map((item) => String(item || '').trim())
        .filter((item) => allowedValues.has(item))
    )
  )
}

export function createEmptyPatientProfile() {
  return {
    ageYears: null,
    sex: null,
    populationTags: [],
    diagnosis: null,
    ckdStage: null,
    dialysisStatus: null,
    transplantStatus: null,
    hasDiabetes: null,
    egfr: null,
    hasAlbuminuria: null,
    hasProteinuria: null,
    exclusionScreeningComplete: null,
    exclusionTags: [],
  }
}

export function sanitizePatientProfile(value) {
  const payload = value && typeof value === 'object' ? value : {}
  return {
    ageYears: normalizeNumber(payload.ageYears, { min: 0, max: 120 }),
    sex: normalizeEnum(payload.sex, SEX_VALUES),
    populationTags: normalizeList(payload.populationTags, POPULATION_VALUES),
    diagnosis: normalizeText(payload.diagnosis, { max: 120 }),
    ckdStage: normalizeEnum(payload.ckdStage, CKD_STAGE_VALUES),
    dialysisStatus: normalizeEnum(payload.dialysisStatus, DIALYSIS_VALUES),
    transplantStatus: normalizeEnum(payload.transplantStatus, TRANSPLANT_VALUES),
    hasDiabetes: normalizeBoolean(payload.hasDiabetes),
    egfr: normalizeNumber(payload.egfr, { min: 0, max: 200 }),
    hasAlbuminuria: normalizeBoolean(payload.hasAlbuminuria),
    hasProteinuria: normalizeBoolean(payload.hasProteinuria),
    exclusionScreeningComplete: normalizeBoolean(payload.exclusionScreeningComplete),
    exclusionTags: normalizeList(payload.exclusionTags, EXCLUSION_VALUES),
  }
}

export function getAnsweredProfileFieldCount(profile) {
  const current = sanitizePatientProfile(profile)
  let count = 0
  if (current.ageYears !== null) count += 1
  if (current.sex) count += 1
  if (current.populationTags.length) count += 1
  if (current.diagnosis) count += 1
  if (current.ckdStage) count += 1
  if (current.dialysisStatus) count += 1
  if (current.transplantStatus) count += 1
  if (current.hasDiabetes !== null) count += 1
  if (current.egfr !== null) count += 1
  if (current.hasAlbuminuria !== null) count += 1
  if (current.hasProteinuria !== null) count += 1
  if (current.exclusionScreeningComplete !== null) count += 1
  if (current.exclusionTags.length) count += 1
  return count
}

export function hasMeaningfulPatientProfile(profile) {
  return getAnsweredProfileFieldCount(profile) >= 2
}

function yesNoUnknown(value) {
  if (value === true) return 'Yes'
  if (value === false) return 'No'
  return null
}

export function getPatientProfileSummary(profile) {
  const current = sanitizePatientProfile(profile)
  const items = []

  if (current.ageYears !== null) items.push(`Age ${current.ageYears}`)
  if (current.sex) items.push(current.sex === 'female' ? 'Female' : 'Male')
  if (current.diagnosis) items.push(current.diagnosis)
  if (current.populationTags.length) {
    items.push(
      ...current.populationTags.map((value) => TRIAL_PRESCREEN_POPULATION_LABELS[value] || value)
    )
  }
  if (current.ckdStage) items.push(TRIAL_PRESCREEN_CKD_STAGE_LABELS[current.ckdStage] || current.ckdStage)
  if (current.dialysisStatus) {
    items.push(TRIAL_PRESCREEN_DIALYSIS_STATUS_LABELS[current.dialysisStatus] || current.dialysisStatus)
  }
  if (current.transplantStatus) {
    items.push(TRIAL_PRESCREEN_TRANSPLANT_STATUS_LABELS[current.transplantStatus] || current.transplantStatus)
  }
  if (current.hasDiabetes !== null) items.push(`Diabetes: ${current.hasDiabetes ? 'Yes' : 'No'}`)
  if (current.egfr !== null) items.push(`eGFR ${current.egfr}`)
  const albuminuria = yesNoUnknown(current.hasAlbuminuria)
  if (albuminuria) items.push(`Albuminuria: ${albuminuria}`)
  const proteinuria = yesNoUnknown(current.hasProteinuria)
  if (proteinuria) items.push(`Proteinuria: ${proteinuria}`)
  if (current.exclusionTags.length) {
    items.push(
      ...current.exclusionTags.map((value) => TRIAL_PRESCREEN_EXCLUSION_LABELS[value] || value)
    )
  }

  return items
}

export const PATIENT_PROFILE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ageYears: { type: ['number', 'null'], minimum: 0, maximum: 120 },
    sex: { type: ['string', 'null'], enum: ['female', 'male', null] },
    populationTags: {
      type: 'array',
      items: { type: 'string', enum: Array.from(POPULATION_VALUES) },
    },
    diagnosis: { type: ['string', 'null'] },
    ckdStage: { type: ['string', 'null'], enum: [...Array.from(CKD_STAGE_VALUES), null] },
    dialysisStatus: { type: ['string', 'null'], enum: [...Array.from(DIALYSIS_VALUES), null] },
    transplantStatus: { type: ['string', 'null'], enum: [...Array.from(TRANSPLANT_VALUES), null] },
    hasDiabetes: { type: ['boolean', 'null'] },
    egfr: { type: ['number', 'null'], minimum: 0, maximum: 200 },
    hasAlbuminuria: { type: ['boolean', 'null'] },
    hasProteinuria: { type: ['boolean', 'null'] },
    exclusionScreeningComplete: { type: ['boolean', 'null'] },
    exclusionTags: {
      type: 'array',
      items: { type: 'string', enum: Array.from(EXCLUSION_VALUES) },
    },
  },
  required: [
    'ageYears',
    'sex',
    'populationTags',
    'diagnosis',
    'ckdStage',
    'dialysisStatus',
    'transplantStatus',
    'hasDiabetes',
    'egfr',
    'hasAlbuminuria',
    'hasProteinuria',
    'exclusionScreeningComplete',
    'exclusionTags',
  ],
  additionalProperties: false,
}
