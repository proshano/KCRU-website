import { sanitizePatientProfile } from './patientProfileSchema.js'
import {
  TRIAL_PRESCREEN_CKD_STAGE_LABELS,
  TRIAL_PRESCREEN_DIABETES_LABELS,
  TRIAL_PRESCREEN_DIALYSIS_STATUS_LABELS,
  TRIAL_PRESCREEN_EXCLUSION_LABELS,
  TRIAL_PRESCREEN_MUST_ASK_LABELS,
  TRIAL_PRESCREEN_POPULATION_LABELS,
  TRIAL_PRESCREEN_TRANSPLANT_STATUS_LABELS,
} from './trialPrescreen.js'

const DECISION_RANK = {
  match: 0,
  possible: 1,
  insufficient_info: 2,
  unlikely: 3,
}

const STATUS_RANK = {
  recruiting: 0,
  coming_soon: 1,
  active_not_recruiting: 2,
  completed: 3,
}

function normalizeString(value) {
  return String(value || '').trim()
}

function normalizeList(value) {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((item) => normalizeString(item)).filter(Boolean)))
}

function normalizeBoolean(value) {
  return value === true
}

function normalizeNumber(value, { min = 0, max = 999 } = {}) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (number < min || number > max) return null
  return number
}

function humanizeSex(value) {
  if (value === 'female') return 'female'
  if (value === 'male') return 'male'
  return 'all sexes'
}

function sanitizeTrialPrescreen(value) {
  const payload = value && typeof value === 'object' ? value : {}
  return {
    screeningSummary: normalizeString(payload.screeningSummary),
    sexAllowed: normalizeString(payload.sexAllowed) || 'all',
    minimumAgeYears: normalizeNumber(payload.minimumAgeYears, { min: 0, max: 120 }),
    maximumAgeYears: normalizeNumber(payload.maximumAgeYears, { min: 0, max: 120 }),
    populationTags: normalizeList(payload.populationTags),
    ckdStages: normalizeList(payload.ckdStages),
    dialysisStatus: normalizeString(payload.dialysisStatus) || 'not_applicable',
    transplantStatus: normalizeString(payload.transplantStatus) || 'not_applicable',
    diabetesRequirement: normalizeString(payload.diabetesRequirement) || 'not_applicable',
    egfrMin: normalizeNumber(payload.egfrMin, { min: 0, max: 200 }),
    egfrMax: normalizeNumber(payload.egfrMax, { min: 0, max: 200 }),
    requiresAlbuminuria: normalizeBoolean(payload.requiresAlbuminuria),
    requiresProteinuria: normalizeBoolean(payload.requiresProteinuria),
    exclusionTags: normalizeList(payload.exclusionTags),
    mustAsk: normalizeList(payload.mustAsk),
    optionalQuestions: normalizeList(payload.optionalQuestions),
  }
}

function hasStructuredCriteria(prescreen) {
  return (
    prescreen.sexAllowed !== 'all' ||
    prescreen.minimumAgeYears !== null ||
    prescreen.maximumAgeYears !== null ||
    prescreen.populationTags.length > 0 ||
    prescreen.ckdStages.length > 0 ||
    prescreen.dialysisStatus !== 'not_applicable' ||
    prescreen.transplantStatus !== 'not_applicable' ||
    prescreen.diabetesRequirement !== 'not_applicable' ||
    prescreen.egfrMin !== null ||
    prescreen.egfrMax !== null ||
    prescreen.requiresAlbuminuria ||
    prescreen.requiresProteinuria ||
    prescreen.exclusionTags.length > 0
  )
}

function formatAgeRequirement(minimumAgeYears, maximumAgeYears) {
  if (minimumAgeYears !== null && maximumAgeYears !== null) {
    return `Age ${minimumAgeYears}-${maximumAgeYears}`
  }
  if (minimumAgeYears !== null) {
    return `Age ${minimumAgeYears}+`
  }
  if (maximumAgeYears !== null) {
    return `Age up to ${maximumAgeYears}`
  }
  return null
}

function isDialysisCompatible(required, actual) {
  if (!required || required === 'not_applicable') return true
  if (!actual) return null
  if (required === 'any_dialysis') {
    return actual === 'any_dialysis' || actual === 'hemodialysis' || actual === 'peritoneal_dialysis'
  }
  if (required === 'not_on_dialysis') {
    return actual === 'not_on_dialysis'
  }
  if (actual === 'any_dialysis') return null
  return actual === required
}

function isTransplantCompatible(required, actual) {
  if (!required || required === 'not_applicable') return true
  if (!actual) return null
  return actual === required
}

function isQuestionMissing(profile, questionId) {
  switch (questionId) {
    case 'ageYears':
      return profile.ageYears === null
    case 'sex':
      return !profile.sex
    case 'populationTags':
      return !profile.populationTags.length
    case 'ckdStage':
      return !profile.ckdStage
    case 'dialysisStatus':
      return !profile.dialysisStatus
    case 'transplantStatus':
      return !profile.transplantStatus
    case 'hasDiabetes':
      return profile.hasDiabetes === null
    case 'egfr':
      return profile.egfr === null
    case 'hasAlbuminuria':
      return profile.hasAlbuminuria === null
    case 'hasProteinuria':
      return profile.hasProteinuria === null
    case 'exclusionTags':
      return profile.exclusionScreeningComplete !== true
    default:
      return false
  }
}

function statusLabel(status) {
  if (status === 'recruiting') return 'Recruiting'
  if (status === 'coming_soon') return 'Coming soon'
  if (status === 'active_not_recruiting') return 'Active, not recruiting'
  return 'Completed'
}

function buildSortScore(result) {
  return result.matchedReasons.length * 10 - result.missingReasons.length * 3 - result.mismatchReasons.length * 20
}

/** When prescreen is blank or incomplete, infer obvious mismatches from public title/summary text. */
const DISEASE_TAGS_FOR_TEXT_INFERENCE = new Set([
  'iga_nephropathy',
  'fsgs_or_mcd',
  'adpkd',
  'alport_syndrome',
])

function buildTrialHaystack(rawTrial, prescreen) {
  return [rawTrial?.title, rawTrial?.laySummary, prescreen.screeningSummary]
    .map((s) => normalizeString(s))
    .filter(Boolean)
    .join('\n')
}

function studyTextIndicatesIgANephropathy(text) {
  return (
    /\biga\s+nephropathy\b/i.test(text) ||
    /\bigan\b/i.test(text) ||
    /\bimmunoglobulin\s+a\s+nephropathy\b/i.test(text) ||
    /\bprimary\s+immunoglobulin\s+a\b/i.test(text) ||
    /\bimmunoglobulin\s+a\s+\(iga\)\s+nephropathy\b/i.test(text)
  )
}

function studyTextIndicatesNonIgARenalFocus(text) {
  if (studyTextIndicatesIgANephropathy(text)) return false
  if (/\bfocal\s+segmental\s+glomerulosclerosis\b|\bfsgs\b/i.test(text)) return true
  if (/\bminimal\s+change\s+disease\b/i.test(text)) return true
  if (/\bprimary\s+focal\s+segmental\b/i.test(text)) return true
  if (/\bmcd\b/i.test(text) && /\bglomerul|nephrotic|proteinuria/i.test(text)) return true
  if (/\badpkd\b|\bautosomal\s+dominant\s+polycystic\b/i.test(text)) return true
  if (/\bpolycystic\s+kidney\s+disease\b/i.test(text)) return true
  if (/\balport\b/i.test(text)) return true
  return false
}

function studyTextIndicatesTransplantRecipientPopulation(text) {
  const t = text.toLowerCase()
  if (/\bkidney\s+transplant\s+recipients?\b/.test(t)) return true
  if (/\borgan\s+and\s+stem\s+cell\s+transplant\s+recipients?\b/.test(t)) return true
  if (/\btransplant\s+recipients?\s+with\b/.test(t)) return true
  if (/\bin\s+(?:child\s+and\s+adult\s+)?transplant\s+recipients?\b/.test(t)) return true
  if (/\btransplant\s+recipients?\b/.test(t) && /\b(covid|covid-19|sars)/i.test(t)) return true
  if (
    /\btransplant\s+recipients?\b/.test(t) &&
    /\b(amr|antibody[-\s]?mediated|antibody\s+mediated)\b/i.test(t)
  ) {
    return true
  }
  return false
}

/** Trial copy clearly centers on patients receiving dialysis (in-center, PD, or “expanded” dialysis services). */
function studyTextIndicatesDialysisPopulation(text) {
  const t = text.toLowerCase()
  if (/\b(non[- ]dialysis|not\s+on\s+dialysis|without\s+dialysis|pre[- ]dialysis)\s+(ckd|cohort|patients?)\b/i.test(t)) {
    return false
  }
  if (/\bexpanded\s+dialysis\b/.test(t)) return true
  if (/\bhemodialysis\b|\bhaemodialysis\b|\bperitoneal\s+dialysis\b/.test(t)) return true
  if (/\bpatients?\s+(on|receiving)\s+(dialysis|hemodialysis)\b/.test(t)) return true
  if (/\bdialysis\s+patients?\b/.test(t)) return true
  if (/\bon\s+(hemo|haemo)?dialysis\b/.test(t)) return true
  if (/\bdialysis\s+unit\b|\bin[- ]center\s+dialysis\b/.test(t)) return true
  return false
}

/** Predialysis / not treated with dialysis: explicit status or eGFR consistent with native CKD when modality unstated. */
function profileImpliesNotOnDialysis(profile) {
  const { dialysisStatus, egfr } = profile
  if (dialysisStatus === 'hemodialysis' || dialysisStatus === 'peritoneal_dialysis' || dialysisStatus === 'any_dialysis') {
    return false
  }
  if (dialysisStatus === 'not_on_dialysis') return true
  if (dialysisStatus === null && egfr !== null && egfr >= 15) return true
  return false
}

/**
 * When the profile encodes a specific diagnosis or no transplant, reject trials whose public copy
 * clearly targets another disease or transplant recipients (covers missing prescreen metadata).
 */
export function getProfileTextMismatchReasons(profile, rawTrial, prescreen) {
  const reasons = []
  const haystack = buildTrialHaystack(rawTrial, prescreen)
  if (!haystack) return reasons

  const tags = profile.populationTags || []

  if (profile.transplantStatus === 'no_transplant' && studyTextIndicatesTransplantRecipientPopulation(haystack)) {
    reasons.push('Study text indicates kidney or organ transplant recipients; patient is not a transplant recipient.')
  }

  if (tags.includes('iga_nephropathy') && studyTextIndicatesNonIgARenalFocus(haystack)) {
    reasons.push('Study text targets a different kidney disease population than IgA nephropathy.')
  }

  if (profileImpliesNotOnDialysis(profile) && studyTextIndicatesDialysisPopulation(haystack)) {
    reasons.push('Study text targets patients on dialysis; this patient is not described as on dialysis.')
  }

  return reasons
}

function buildTextMismatchResult(rawTrial, prescreen, mismatchReasons) {
  return {
    _id: rawTrial?._id,
    title: rawTrial?.title || 'Untitled study',
    slug: rawTrial?.slug || '',
    status: rawTrial?.status || 'recruiting',
    statusLabel: statusLabel(rawTrial?.status),
    decision: 'unlikely',
    screeningSummary: prescreen.screeningSummary || rawTrial?.laySummary || '',
    matchedReasons: [],
    missingReasons: [],
    mismatchReasons,
    score: -250,
  }
}

function buildPendingReviewResult(rawTrial, prescreen) {
  return {
    _id: rawTrial?._id,
    title: rawTrial?.title || 'Untitled study',
    slug: rawTrial?.slug || '',
    status: rawTrial?.status || 'recruiting',
    statusLabel: statusLabel(rawTrial?.status),
    decision: 'insufficient_info',
    screeningSummary: prescreen.screeningSummary || rawTrial?.laySummary || '',
    matchedReasons: [],
    missingReasons: [],
    mismatchReasons: [],
    score: -100,
  }
}

export function matchTrialToPatient(rawTrial, rawProfile) {
  const prescreen = sanitizeTrialPrescreen(rawTrial?.prescreen)
  const profile = sanitizePatientProfile(rawProfile)

  const hasSpecificContext =
    profile.transplantStatus === 'no_transplant' ||
    profile.populationTags.some((t) => DISEASE_TAGS_FOR_TEXT_INFERENCE.has(t)) ||
    profileImpliesNotOnDialysis(profile)

  if (hasSpecificContext) {
    const textMismatches = getProfileTextMismatchReasons(profile, rawTrial, prescreen)
    if (textMismatches.length) {
      return buildTextMismatchResult(rawTrial, prescreen, textMismatches)
    }
  }

  if (!hasStructuredCriteria(prescreen)) {
    return buildPendingReviewResult(rawTrial, prescreen)
  }

  const matchedReasons = []
  const missingReasons = []
  const mismatchReasons = []

  const ageRequirement = formatAgeRequirement(prescreen.minimumAgeYears, prescreen.maximumAgeYears)
  if (ageRequirement) {
    if (profile.ageYears === null) {
      missingReasons.push('Age is still needed.')
    } else if (
      (prescreen.minimumAgeYears !== null && profile.ageYears < prescreen.minimumAgeYears) ||
      (prescreen.maximumAgeYears !== null && profile.ageYears > prescreen.maximumAgeYears)
    ) {
      mismatchReasons.push(`${ageRequirement} is required.`)
    } else {
      matchedReasons.push(ageRequirement)
    }
  }

  if (prescreen.sexAllowed !== 'all') {
    if (!profile.sex) {
      missingReasons.push('Sex at birth is still needed.')
    } else if (profile.sex !== prescreen.sexAllowed) {
      mismatchReasons.push(`This study is limited to ${humanizeSex(prescreen.sexAllowed)} patients.`)
    } else {
      matchedReasons.push(`Matches ${humanizeSex(prescreen.sexAllowed)} requirement`)
    }
  }

  if (prescreen.populationTags.length) {
    if (!profile.populationTags.length) {
      missingReasons.push('The kidney condition or study population is still needed.')
    } else {
      const overlap = prescreen.populationTags.filter((value) => profile.populationTags.includes(value))
      if (!overlap.length) {
        mismatchReasons.push(
          `Study population: ${prescreen.populationTags
            .map((value) => TRIAL_PRESCREEN_POPULATION_LABELS[value] || value)
            .join(', ')}.`
        )
      } else {
        matchedReasons.push(
          overlap.map((value) => TRIAL_PRESCREEN_POPULATION_LABELS[value] || value).join(', ')
        )
      }
    }
  }

  if (prescreen.ckdStages.length) {
    if (!profile.ckdStage) {
      missingReasons.push('CKD stage is still needed.')
    } else if (!prescreen.ckdStages.includes(profile.ckdStage)) {
      mismatchReasons.push(
        `Study requires ${prescreen.ckdStages
          .map((value) => TRIAL_PRESCREEN_CKD_STAGE_LABELS[value] || value)
          .join(', ')}.`
      )
    } else {
      matchedReasons.push(TRIAL_PRESCREEN_CKD_STAGE_LABELS[profile.ckdStage] || profile.ckdStage)
    }
  }

  if (prescreen.dialysisStatus !== 'not_applicable') {
    const dialysisMatch = isDialysisCompatible(prescreen.dialysisStatus, profile.dialysisStatus)
    if (dialysisMatch === null) {
      missingReasons.push('Dialysis status is still needed.')
    } else if (!dialysisMatch) {
      mismatchReasons.push(
        `Dialysis requirement: ${TRIAL_PRESCREEN_DIALYSIS_STATUS_LABELS[prescreen.dialysisStatus] || prescreen.dialysisStatus}.`
      )
    } else {
      matchedReasons.push(
        TRIAL_PRESCREEN_DIALYSIS_STATUS_LABELS[prescreen.dialysisStatus] || prescreen.dialysisStatus
      )
    }
  }

  if (prescreen.transplantStatus !== 'not_applicable') {
    const transplantMatch = isTransplantCompatible(prescreen.transplantStatus, profile.transplantStatus)
    if (transplantMatch === null) {
      missingReasons.push('Transplant status is still needed.')
    } else if (!transplantMatch) {
      mismatchReasons.push(
        `Transplant requirement: ${TRIAL_PRESCREEN_TRANSPLANT_STATUS_LABELS[prescreen.transplantStatus] || prescreen.transplantStatus}.`
      )
    } else {
      matchedReasons.push(
        TRIAL_PRESCREEN_TRANSPLANT_STATUS_LABELS[prescreen.transplantStatus] || prescreen.transplantStatus
      )
    }
  }

  if (prescreen.diabetesRequirement === 'required') {
    if (profile.hasDiabetes === null) {
      missingReasons.push('Diabetes status is still needed.')
    } else if (!profile.hasDiabetes) {
      mismatchReasons.push('This study requires diabetes.')
    } else {
      matchedReasons.push(TRIAL_PRESCREEN_DIABETES_LABELS.required)
    }
  }

  if (prescreen.diabetesRequirement === 'excluded') {
    if (profile.hasDiabetes === null) {
      missingReasons.push('Diabetes status is still needed.')
    } else if (profile.hasDiabetes) {
      mismatchReasons.push('This study excludes diabetes.')
    } else {
      matchedReasons.push(TRIAL_PRESCREEN_DIABETES_LABELS.excluded)
    }
  }

  if (prescreen.egfrMin !== null || prescreen.egfrMax !== null) {
    if (profile.egfr === null) {
      missingReasons.push('eGFR is still needed.')
    } else if (
      (prescreen.egfrMin !== null && profile.egfr < prescreen.egfrMin) ||
      (prescreen.egfrMax !== null && profile.egfr > prescreen.egfrMax)
    ) {
      const range = [
        prescreen.egfrMin !== null ? `>= ${prescreen.egfrMin}` : null,
        prescreen.egfrMax !== null ? `<= ${prescreen.egfrMax}` : null,
      ]
        .filter(Boolean)
        .join(' and ')
      mismatchReasons.push(`Study requires eGFR ${range}.`)
    } else {
      matchedReasons.push('Within the study eGFR range')
    }
  }

  if (prescreen.requiresAlbuminuria) {
    if (profile.hasAlbuminuria === null) {
      missingReasons.push('Albuminuria status is still needed.')
    } else if (!profile.hasAlbuminuria) {
      mismatchReasons.push('This study requires albuminuria.')
    } else {
      matchedReasons.push('Albuminuria present')
    }
  }

  if (prescreen.requiresProteinuria) {
    if (profile.hasProteinuria === null) {
      missingReasons.push('Proteinuria status is still needed.')
    } else if (!profile.hasProteinuria) {
      mismatchReasons.push('This study requires proteinuria.')
    } else {
      matchedReasons.push('Proteinuria present')
    }
  }

  if (prescreen.exclusionTags.length) {
    const overlap = prescreen.exclusionTags.filter((value) => profile.exclusionTags.includes(value))
    if (overlap.length) {
      mismatchReasons.push(
        `Reported exclusion factor: ${overlap
          .map((value) => TRIAL_PRESCREEN_EXCLUSION_LABELS[value] || value)
          .join(', ')}.`
      )
    }
  }

  const missingMustAsk = prescreen.mustAsk
    .filter((questionId) => isQuestionMissing(profile, questionId))
    .map((questionId) => `${TRIAL_PRESCREEN_MUST_ASK_LABELS[questionId] || questionId} still needs clarification.`)

  const decision =
    mismatchReasons.length > 0
      ? 'unlikely'
      : missingMustAsk.length > 0
        ? 'insufficient_info'
        : missingReasons.length > 0
          ? 'possible'
          : 'match'

  return {
    _id: rawTrial?._id,
    title: rawTrial?.title || 'Untitled study',
    slug: rawTrial?.slug || '',
    status: rawTrial?.status || 'recruiting',
    statusLabel: statusLabel(rawTrial?.status),
    decision,
    screeningSummary: prescreen.screeningSummary || rawTrial?.laySummary || '',
    matchedReasons,
    missingReasons: Array.from(new Set([...missingMustAsk, ...missingReasons])),
    mismatchReasons,
    score: buildSortScore({ matchedReasons, missingReasons, mismatchReasons }),
  }
}

export function rankTrialMatches(trials = [], profile) {
  return trials
    .map((trial) => matchTrialToPatient(trial, profile))
    .filter(Boolean)
    .sort((left, right) => {
      const decisionDiff = DECISION_RANK[left.decision] - DECISION_RANK[right.decision]
      if (decisionDiff !== 0) return decisionDiff

      const scoreDiff = right.score - left.score
      if (scoreDiff !== 0) return scoreDiff

      const statusDiff = (STATUS_RANK[left.status] ?? 99) - (STATUS_RANK[right.status] ?? 99)
      if (statusDiff !== 0) return statusDiff

      return left.title.localeCompare(right.title)
    })
}

export function buildTrialCatalogForPrompt(trials = []) {
  return trials
    .map((trial) => {
      const prescreen = sanitizeTrialPrescreen(trial?.prescreen)
      if (!hasStructuredCriteria(prescreen)) {
        const parts = [
          `${trial.title} (${statusLabel(trial.status)})`,
          prescreen.screeningSummary ? `Summary: ${JSON.stringify(prescreen.screeningSummary)}` : null,
          'Structured matching criteria are still under review for this study.',
        ].filter(Boolean)

        return `- ${parts.join(' | ')}`
      }

      const parts = [
        `${trial.title} (${statusLabel(trial.status)})`,
        prescreen.screeningSummary ? `Summary: ${JSON.stringify(prescreen.screeningSummary)}` : null,
        prescreen.populationTags.length
          ? `Populations: ${prescreen.populationTags
              .map((value) => TRIAL_PRESCREEN_POPULATION_LABELS[value] || value)
              .join(', ')}`
          : null,
        formatAgeRequirement(prescreen.minimumAgeYears, prescreen.maximumAgeYears),
        prescreen.sexAllowed !== 'all' ? `Sex: ${humanizeSex(prescreen.sexAllowed)}` : null,
        prescreen.ckdStages.length
          ? `CKD stage: ${prescreen.ckdStages
              .map((value) => TRIAL_PRESCREEN_CKD_STAGE_LABELS[value] || value)
              .join(', ')}`
          : null,
        prescreen.dialysisStatus !== 'not_applicable'
          ? `Dialysis: ${TRIAL_PRESCREEN_DIALYSIS_STATUS_LABELS[prescreen.dialysisStatus] || prescreen.dialysisStatus}`
          : null,
        prescreen.transplantStatus !== 'not_applicable'
          ? `Transplant: ${TRIAL_PRESCREEN_TRANSPLANT_STATUS_LABELS[prescreen.transplantStatus] || prescreen.transplantStatus}`
          : null,
        prescreen.diabetesRequirement !== 'not_applicable'
          ? `Diabetes: ${TRIAL_PRESCREEN_DIABETES_LABELS[prescreen.diabetesRequirement] || prescreen.diabetesRequirement}`
          : null,
        prescreen.egfrMin !== null || prescreen.egfrMax !== null
          ? `eGFR: ${[
              prescreen.egfrMin !== null ? `>= ${prescreen.egfrMin}` : null,
              prescreen.egfrMax !== null ? `<= ${prescreen.egfrMax}` : null,
            ]
              .filter(Boolean)
              .join(' and ')}`
          : null,
        prescreen.requiresAlbuminuria ? 'Albuminuria required' : null,
        prescreen.requiresProteinuria ? 'Proteinuria required' : null,
        prescreen.mustAsk.length
          ? `Must ask: ${prescreen.mustAsk
              .map((value) => TRIAL_PRESCREEN_MUST_ASK_LABELS[value] || value)
              .join(', ')}`
          : null,
        prescreen.optionalQuestions.length
          ? `Optional follow-up: ${JSON.stringify(prescreen.optionalQuestions)}`
          : null,
      ].filter(Boolean)

      return `- ${parts.join(' | ')}`
    })
    .filter(Boolean)
    .join('\n')
}
