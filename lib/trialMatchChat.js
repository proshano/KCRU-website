import { hasMeaningfulPatientProfile, sanitizePatientProfile } from './patientProfileSchema.js'
import { hasQuantitativeUrineProteinData } from './urineProtein.js'

const EGFR_MISSING_REASON_PATTERNS = [/\begfr criterion\b/i]
const DIALYSIS_MISSING_REASON_PATTERNS = [/\bdialysis status is not yet known\b/i]
const URINE_PROTEIN_MISSING_REASON_PATTERNS = [
  /\bquantitative urine protein value\b/i,
  /\burine protein criterion\b/i,
]

function matchesMissingReason(reason, patterns) {
  const text = String(reason || '').trim()
  if (!text) return false
  return patterns.some((pattern) => pattern.test(text))
}

function isEgfrMissingReason(reason) {
  return matchesMissingReason(reason, EGFR_MISSING_REASON_PATTERNS)
}

function isDialysisMissingReason(reason) {
  return matchesMissingReason(reason, DIALYSIS_MISSING_REASON_PATTERNS)
}

function isUrineProteinMissingReason(reason) {
  return matchesMissingReason(reason, URINE_PROTEIN_MISSING_REASON_PATTERNS)
}

function getTopCandidateResults(rankedResults, maxTopStudies) {
  return (Array.isArray(rankedResults) ? rankedResults : [])
    .filter((result) => result?.decision === 'match' || result?.decision === 'possible')
    .slice(0, maxTopStudies)
}

export function hasSingleTurnMatchReadyProfile(profile = {}) {
  const current = sanitizePatientProfile(profile)
  const hasStudyContext =
    Boolean(current.diagnosis) ||
    current.populationTags.length > 0 ||
    Boolean(current.dialysisStatus) ||
    Boolean(current.transplantStatus)
  const hasRenalStatus =
    current.egfr !== null ||
    Boolean(current.ckdStage) ||
    Boolean(current.dialysisStatus) ||
    Boolean(current.transplantStatus)

  return hasStudyContext && hasRenalStatus
}

export function shouldRankTrialMatches({
  readyForMatching = false,
  profile = {},
  userTurns = 0,
  maxUserTurns = 5,
  wantsImmediateRanking = false,
} = {}) {
  const current = sanitizePatientProfile(profile)

  if (wantsImmediateRanking) return true

  if (userTurns >= maxUserTurns) return hasMeaningfulPatientProfile(current)

  if (userTurns < 1) return false

  return Boolean(readyForMatching)
}

export function shouldAskUrineProteinFollowUp({ profile = {}, rankedResults = [], maxTopStudies = 3 } = {}) {
  const current = sanitizePatientProfile(profile)

  if (hasQuantitativeUrineProteinData(current.urineProtein)) return false

  const topCandidates = getTopCandidateResults(rankedResults, maxTopStudies)
  if (!topCandidates.length) return false

  return topCandidates.some((result) => {
    const missingReasons = Array.isArray(result?.missingReasons) ? result.missingReasons : []
    const urineProteinMissingReasons = missingReasons.filter(isUrineProteinMissingReason)
    if (!urineProteinMissingReasons.length) return false

    if (current.hasAlbuminuria === true || current.hasProteinuria === true) return true

    const nonUrineProteinMissingCount = missingReasons.length - urineProteinMissingReasons.length
    return nonUrineProteinMissingCount <= 1
  })
}

export function selectTrialMatchFollowUp({
  profile = {},
  rankedResults = [],
  exhaustedFollowUps = new Set(),
  maxTopStudies = 3,
} = {}) {
  const current = sanitizePatientProfile(profile)
  const exhausted = exhaustedFollowUps instanceof Set ? exhaustedFollowUps : new Set(exhaustedFollowUps || [])
  const topCandidates = getTopCandidateResults(rankedResults, maxTopStudies)

  if (!topCandidates.length) return null

  const needsEgfrFollowUp =
    current.egfr === null &&
    topCandidates.some((result) => (Array.isArray(result?.missingReasons) ? result.missingReasons : []).some(isEgfrMissingReason))
  const needsDialysisFollowUp =
    current.dialysisStatus === null &&
    topCandidates.some((result) =>
      (Array.isArray(result?.missingReasons) ? result.missingReasons : []).some(isDialysisMissingReason)
    )

  if ((needsEgfrFollowUp || needsDialysisFollowUp) && !exhausted.has('renal_status')) {
    return 'renal_status'
  }

  if (
    shouldAskUrineProteinFollowUp({
      profile: current,
      rankedResults: topCandidates,
      maxTopStudies,
    }) &&
    !exhausted.has('urine_protein')
  ) {
    return 'urine_protein'
  }

  return null
}
