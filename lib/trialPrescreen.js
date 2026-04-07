const asLabelMap = (options) =>
  Object.fromEntries(options.map((option) => [option.value, option.label]))

function normalizeArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function uniqueArray(values) {
  return Array.from(new Set(values))
}

function normalizeNumberFieldValue(value) {
  if (value === 0) return '0'
  if (value === null || value === undefined || value === '') return ''
  const number = Number(value)
  return Number.isFinite(number) ? String(number) : ''
}

export const TRIAL_PRESCREEN_SEX_OPTIONS = [
  { value: 'all', label: 'All sexes' },
  { value: 'female', label: 'Female only' },
  { value: 'male', label: 'Male only' },
]

export const TRIAL_PRESCREEN_POPULATION_OPTIONS = [
  { value: 'chronic_kidney_disease', label: 'Chronic kidney disease' },
  { value: 'dialysis', label: 'Dialysis' },
  { value: 'kidney_transplant', label: 'Kidney transplant' },
  { value: 'acute_kidney_injury', label: 'Acute kidney injury' },
  { value: 'glomerular_disease', label: 'Glomerular disease' },
  { value: 'iga_nephropathy', label: 'IgA nephropathy' },
  { value: 'fsgs_or_mcd', label: 'FSGS or minimal change disease' },
  { value: 'adpkd', label: 'ADPKD' },
  { value: 'alport_syndrome', label: 'Alport syndrome' },
  { value: 'hypertension', label: 'Hypertension' },
  { value: 'diabetes', label: 'Diabetes' },
  { value: 'healthy_volunteer', label: 'Healthy volunteer' },
]

export const TRIAL_PRESCREEN_CKD_STAGE_OPTIONS = [
  { value: 'stage1', label: 'CKD stage 1' },
  { value: 'stage2', label: 'CKD stage 2' },
  { value: 'stage3', label: 'CKD stage 3' },
  { value: 'stage4', label: 'CKD stage 4' },
  { value: 'stage5', label: 'CKD stage 5' },
]

export const TRIAL_PRESCREEN_DIALYSIS_STATUS_OPTIONS = [
  { value: 'not_applicable', label: 'Not used for this study' },
  { value: 'not_on_dialysis', label: 'Not on dialysis' },
  { value: 'any_dialysis', label: 'Any dialysis' },
  { value: 'hemodialysis', label: 'Hemodialysis' },
  { value: 'peritoneal_dialysis', label: 'Peritoneal dialysis' },
]

export const TRIAL_PRESCREEN_TRANSPLANT_STATUS_OPTIONS = [
  { value: 'not_applicable', label: 'Not used for this study' },
  { value: 'no_transplant', label: 'No transplant' },
  { value: 'kidney_transplant_recipient', label: 'Kidney transplant recipient' },
  { value: 'transplant_candidate', label: 'Transplant candidate' },
]

export const TRIAL_PRESCREEN_DIABETES_OPTIONS = [
  { value: 'not_applicable', label: 'Not used for this study' },
  { value: 'required', label: 'Diabetes required' },
  { value: 'excluded', label: 'Diabetes excluded' },
]

export const TRIAL_PRESCREEN_EXCLUSION_OPTIONS = [
  { value: 'pregnancy', label: 'Pregnancy' },
  { value: 'active_infection', label: 'Active infection' },
  { value: 'recent_hospitalization', label: 'Recent hospitalization' },
  { value: 'active_malignancy', label: 'Active malignancy' },
  { value: 'immunosuppression', label: 'Immunosuppression' },
  { value: 'unstable_cardiovascular_disease', label: 'Unstable cardiovascular disease' },
]

export const TRIAL_PRESCREEN_MUST_ASK_OPTIONS = [
  { value: 'ageYears', label: 'Age' },
  { value: 'sex', label: 'Sex at birth' },
  { value: 'populationTags', label: 'Kidney condition or study population' },
  { value: 'ckdStage', label: 'CKD stage' },
  { value: 'dialysisStatus', label: 'Dialysis status' },
  { value: 'transplantStatus', label: 'Transplant status' },
  { value: 'hasDiabetes', label: 'Diabetes status' },
  { value: 'egfr', label: 'eGFR' },
  { value: 'hasAlbuminuria', label: 'Albuminuria' },
  { value: 'hasProteinuria', label: 'Proteinuria' },
  { value: 'exclusionTags', label: 'Major exclusion factors' },
]

export const TRIAL_PRESCREEN_SEX_LABELS = asLabelMap(TRIAL_PRESCREEN_SEX_OPTIONS)
export const TRIAL_PRESCREEN_POPULATION_LABELS = asLabelMap(TRIAL_PRESCREEN_POPULATION_OPTIONS)
export const TRIAL_PRESCREEN_CKD_STAGE_LABELS = asLabelMap(TRIAL_PRESCREEN_CKD_STAGE_OPTIONS)
export const TRIAL_PRESCREEN_DIALYSIS_STATUS_LABELS = asLabelMap(TRIAL_PRESCREEN_DIALYSIS_STATUS_OPTIONS)
export const TRIAL_PRESCREEN_TRANSPLANT_STATUS_LABELS = asLabelMap(TRIAL_PRESCREEN_TRANSPLANT_STATUS_OPTIONS)
export const TRIAL_PRESCREEN_DIABETES_LABELS = asLabelMap(TRIAL_PRESCREEN_DIABETES_OPTIONS)
export const TRIAL_PRESCREEN_EXCLUSION_LABELS = asLabelMap(TRIAL_PRESCREEN_EXCLUSION_OPTIONS)
export const TRIAL_PRESCREEN_MUST_ASK_LABELS = asLabelMap(TRIAL_PRESCREEN_MUST_ASK_OPTIONS)

export function createEmptyTrialPrescreen() {
  return {
    screeningSummary: '',
    sexAllowed: 'all',
    minimumAgeYears: '',
    maximumAgeYears: '',
    populationTags: [],
    ckdStages: [],
    dialysisStatus: 'not_applicable',
    transplantStatus: 'not_applicable',
    diabetesRequirement: 'not_applicable',
    egfrMin: '',
    egfrMax: '',
    requiresAlbuminuria: false,
    requiresProteinuria: false,
    exclusionTags: [],
    mustAsk: [],
    optionalQuestions: [],
  }
}

export function mergeTrialPrescreenFormValue(value) {
  const source = value && typeof value === 'object' ? value : {}
  const { enabled: _ignoredEnabled, ...payload } = source
  return {
    ...createEmptyTrialPrescreen(),
    ...payload,
    minimumAgeYears: normalizeNumberFieldValue(payload.minimumAgeYears),
    maximumAgeYears: normalizeNumberFieldValue(payload.maximumAgeYears),
    egfrMin: normalizeNumberFieldValue(payload.egfrMin),
    egfrMax: normalizeNumberFieldValue(payload.egfrMax),
    populationTags: uniqueArray(normalizeArray(payload.populationTags)),
    ckdStages: uniqueArray(normalizeArray(payload.ckdStages)),
    exclusionTags: uniqueArray(normalizeArray(payload.exclusionTags)),
    mustAsk: uniqueArray(normalizeArray(payload.mustAsk)),
    optionalQuestions: normalizeArray(payload.optionalQuestions),
  }
}

export function getOptionLabel(optionMap, value, fallback = 'Not specified') {
  return optionMap[value] || fallback
}
