import { hasMeaningfulPatientProfile, sanitizePatientProfile } from './patientProfileSchema.js'
import { hasQuantitativeUrineProteinData } from './urineProtein.js'

const URINE_PROTEIN_MISSING_REASON_PATTERNS = [
  /\bquantitative urine protein value\b/i,
  /\burine protein criterion\b/i,
]

function isUrineProteinMissingReason(reason) {
  const text = String(reason || '').trim()
  if (!text) return false
  return URINE_PROTEIN_MISSING_REASON_PATTERNS.some((pattern) => pattern.test(text))
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
  minUserTurns = 2,
  wantsImmediateRanking = false,
  shouldDelayForUrineProteinFollowUp = false,
} = {}) {
  const current = sanitizePatientProfile(profile)

  if (wantsImmediateRanking) return true

  if (shouldDelayForUrineProteinFollowUp && userTurns < minUserTurns) {
    return false
  }

  if (userTurns >= minUserTurns) {
    return Boolean(readyForMatching || hasMeaningfulPatientProfile(current))
  }

  if (userTurns !== 1) return false

  return hasSingleTurnMatchReadyProfile(current)
}

export function shouldAskUrineProteinFollowUp({ profile = {}, rankedResults = [], maxTopStudies = 3 } = {}) {
  const current = sanitizePatientProfile(profile)

  if (hasQuantitativeUrineProteinData(current.urineProtein)) return false

  const topCandidates = (Array.isArray(rankedResults) ? rankedResults : [])
    .filter((result) => result?.decision === 'match' || result?.decision === 'possible')
    .slice(0, maxTopStudies)

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
