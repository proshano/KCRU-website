import { hasMeaningfulPatientProfile, sanitizePatientProfile } from './patientProfileSchema.js'

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
