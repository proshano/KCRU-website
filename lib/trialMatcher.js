import { sanitizePatientProfile } from './patientProfileSchema.js'
import {
  evaluateUrineProteinConstraints,
  extractUrineProteinConstraintsFromTexts,
} from './urineProtein.js'

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

const DISEASE_TAGS_FOR_TEXT_INFERENCE = new Set([
  'iga_nephropathy',
  'fsgs_or_mcd',
  'adpkd',
  'alport_syndrome',
])

function normalizeString(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeList(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => normalizeString(item)).filter(Boolean)
}

function uniqueList(values) {
  return Array.from(new Set(values.filter(Boolean)))
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

function getTrialTextParts(trial) {
  return uniqueList([
    normalizeString(trial?.title),
    normalizeString(trial?.laySummary),
    ...normalizeList(trial?.inclusionCriteria),
  ])
}

function buildTrialHaystack(trial) {
  return getTrialTextParts(trial).join('\n')
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

function collectDiseaseFocusesFromText(text) {
  const normalized = normalizeString(text)
  const focuses = new Set()
  if (!normalized) return focuses

  if (studyTextIndicatesIgANephropathy(normalized)) focuses.add('iga_nephropathy')
  if (/\bfocal\s+segmental\s+glomerulosclerosis\b|\bfsgs\b/i.test(normalized)) focuses.add('fsgs_or_mcd')
  if (/\bminimal\s+change\s+disease\b/i.test(normalized)) focuses.add('fsgs_or_mcd')
  if (/\bmcd\b/i.test(normalized) && /\bglomerul|nephrotic|proteinuria/i.test(normalized)) {
    focuses.add('fsgs_or_mcd')
  }
  if (/\bc3\s+glomerulopathy\b|\bc3g\b/i.test(normalized)) focuses.add('c3_glomerulopathy')
  if (/\blupus\s+nephritis\b|\bactive\s+lupus\s+nephritis\b/i.test(normalized)) focuses.add('lupus_nephritis')
  if (/\bdiabetic\s+nephropathy\b|\bdiabetic\s+kidney\s+disease\b|\bdkd\b/i.test(normalized)) {
    focuses.add('diabetic_nephropathy')
  }
  if (/\badpkd\b|\bautosomal\s+dominant\s+polycystic\b/i.test(normalized)) focuses.add('adpkd')
  if (/\bpolycystic\s+kidney\s+disease\b/i.test(normalized)) focuses.add('adpkd')
  if (/\balport\b/i.test(normalized)) focuses.add('alport_syndrome')

  return focuses
}

function getProfileDiseaseFocuses(profile) {
  const focuses = new Set()
  for (const tag of profile?.populationTags || []) {
    if (DISEASE_TAGS_FOR_TEXT_INFERENCE.has(tag)) focuses.add(tag)
  }
  for (const focus of collectDiseaseFocusesFromText(profile?.diagnosis)) {
    focuses.add(focus)
  }
  return focuses
}

function setsOverlap(left, right) {
  for (const item of left) {
    if (right.has(item)) return true
  }
  return false
}

function studyTextIndicatesTransplantRecipientPopulation(text) {
  const value = text.toLowerCase()
  if (/\bkidney\s+transplant\s+recipients?\b/.test(value)) return true
  if (/\borgan\s+and\s+stem\s+cell\s+transplant\s+recipients?\b/.test(value)) return true
  if (/\btransplant\s+recipients?\s+with\b/.test(value)) return true
  if (/\bin\s+(?:child\s+and\s+adult\s+)?transplant\s+recipients?\b/.test(value)) return true
  if (/\btransplant\s+recipients?\b/.test(value) && /\b(covid|covid-19|sars)/i.test(value)) return true
  if (
    /\btransplant\s+recipients?\b/.test(value) &&
    /\b(amr|antibody[-\s]?mediated|antibody\s+mediated)\b/i.test(value)
  ) {
    return true
  }
  return false
}

function studyTextIndicatesDialysisPopulation(text) {
  const value = text.toLowerCase()
  if (/\b(non[- ]dialysis|not\s+on\s+dialysis|without\s+dialysis|pre[- ]dialysis)\s+(ckd|cohort|patients?)\b/i.test(value)) {
    return false
  }
  if (/\bexpanded\s+dialysis\b/.test(value)) return true
  if (/\bhemodialysis\b|\bhaemodialysis\b|\bperitoneal\s+dialysis\b/.test(value)) return true
  if (/\bpatients?\s+(on|receiving)\s+(dialysis|hemodialysis)\b/.test(value)) return true
  if (/\bdialysis\s+patients?\b/.test(value)) return true
  if (/\bon\s+(hemo|haemo)?dialysis\b/.test(value)) return true
  if (/\bdialysis\s+unit\b|\bin[- ]center\s+dialysis\b/.test(value)) return true
  return false
}

function studyTextIndicatesChronicKidneyDisease(text) {
  return /\bckd\b|\bchronic\s+kidney\s+disease\b/i.test(text)
}

function studyTextIndicatesAcuteKidneyInjury(text) {
  return /\baki\b|\bacute\s+kidney\s+injury\b/i.test(text)
}

function studyTextIndicatesGlomerularDisease(text) {
  return /\bglomerul\w+|\bnephropathy\b|\bnephritis\b|\bnephrotic\b/i.test(text)
}

function studyTextIndicatesHypertension(text) {
  return /\bhypertension\b|\bhypertensive\b/i.test(text)
}

function studyTextIndicatesDiabetes(text) {
  return /\bdiabetes\b|\bdiabetic\b/i.test(text)
}

function studyTextIndicatesHealthyVolunteers(text) {
  return /\bhealthy\s+volunteers?\b/i.test(text)
}

function mergeMin(current, candidate) {
  if (!Number.isFinite(candidate)) return current
  if (!Number.isFinite(current)) return candidate
  return Math.max(current, candidate)
}

function mergeMax(current, candidate) {
  if (!Number.isFinite(candidate)) return current
  if (!Number.isFinite(current)) return candidate
  return Math.min(current, candidate)
}

function extractAgeConstraintFromText(text) {
  const value = normalizeString(text)
  if (!value) {
    return { minAgeYears: null, maxAgeYears: null, requiresKnownAge: false }
  }

  let minAgeYears = null
  let maxAgeYears = null
  let requiresKnownAge = false

  const rangePatterns = [
    /\b(?:age|aged)\s*(\d{1,3})\s*(?:to|-|–|and)\s*(\d{1,3})\b/i,
    /\b(\d{1,3})\s*(?:to|-|–)\s*(\d{1,3})\s*(?:years?|yrs?)\s+of\s+age\b/i,
  ]
  for (const pattern of rangePatterns) {
    const match = value.match(pattern)
    if (!match) continue
    const first = Number(match[1])
    const second = Number(match[2])
    minAgeYears = mergeMin(minAgeYears, Math.min(first, second))
    maxAgeYears = mergeMax(maxAgeYears, Math.max(first, second))
    requiresKnownAge = true
  }

  const minPatterns = [
    /\b(?:age|aged)\s*(?:>=|at least|over)\s*(\d{1,3})\b/i,
    /\b(\d{1,3})\s*(?:years?|yrs?)\s*(?:and older|or older|\+)\b/i,
  ]
  for (const pattern of minPatterns) {
    const match = value.match(pattern)
    if (!match) continue
    minAgeYears = mergeMin(minAgeYears, Number(match[1]))
    requiresKnownAge = true
  }

  const maxPatterns = [
    /\b(?:age|aged)\s*(?:<=|at most|under|younger than|up to)\s*(\d{1,3})\b/i,
    /\b(\d{1,3})\s*(?:years?|yrs?)\s*(?:and younger|or younger)\b/i,
  ]
  for (const pattern of maxPatterns) {
    const match = value.match(pattern)
    if (!match) continue
    maxAgeYears = mergeMax(maxAgeYears, Number(match[1]))
    requiresKnownAge = true
  }

  if (/\badults?\b/i.test(value)) {
    minAgeYears = mergeMin(minAgeYears, 18)
  }

  if (/\b(pediatric|children|child|adolescents?|teens?)\b/i.test(value) && !/\badults?\b/i.test(value)) {
    maxAgeYears = mergeMax(maxAgeYears, 17)
  }

  return { minAgeYears, maxAgeYears, requiresKnownAge }
}

function extractEgfrConstraintFromText(text) {
  const value = normalizeString(text)
  if (!/\b(?:egfr|estimated glomerular filtration rate)\b/i.test(value)) {
    return { minEgfr: null, maxEgfr: null }
  }

  let minEgfr = null
  let maxEgfr = null

  const rangePatterns = [
    /(?:\begfr\b|estimated glomerular filtration rate)[^.;,\n]{0,120}?\bbetween\s*(\d{1,3})\s*(?:and|to|-|–)\s*(\d{1,3})\b/i,
    /(?:\begfr\b|estimated glomerular filtration rate)[^.;,\n]{0,120}?\b(\d{1,3})\s*(?:to|-|–)\s*(\d{1,3})\b/i,
  ]
  for (const pattern of rangePatterns) {
    const match = value.match(pattern)
    if (!match) continue
    const first = Number(match[1])
    const second = Number(match[2])
    minEgfr = mergeMin(minEgfr, Math.min(first, second))
    maxEgfr = mergeMax(maxEgfr, Math.max(first, second))
  }

  const minPatterns = [
    /(?:\begfr\b|estimated glomerular filtration rate)[^.;,\n]{0,120}?(?:>=|at least|greater than or equal to|more than|above)\s*(\d{1,3})\b/i,
  ]
  for (const pattern of minPatterns) {
    const match = value.match(pattern)
    if (!match) continue
    minEgfr = mergeMin(minEgfr, Number(match[1]))
  }

  const maxPatterns = [
    /(?:\begfr\b|estimated glomerular filtration rate)[^.;,\n]{0,120}?(?:<=|at most|less than or equal to|up to|under|below)\s*(\d{1,3})\b/i,
  ]
  for (const pattern of maxPatterns) {
    const match = value.match(pattern)
    if (!match) continue
    maxEgfr = mergeMax(maxEgfr, Number(match[1]))
  }

  return { minEgfr, maxEgfr }
}

function extractStudyConstraints(rawTrial) {
  const parts = getTrialTextParts(rawTrial)
  const haystack = parts.join('\n')

  let minAgeYears = null
  let maxAgeYears = null
  let requiresKnownAge = false
  let minEgfr = null
  let maxEgfr = null

  for (const part of parts) {
    const age = extractAgeConstraintFromText(part)
    minAgeYears = mergeMin(minAgeYears, age.minAgeYears)
    maxAgeYears = mergeMax(maxAgeYears, age.maxAgeYears)
    requiresKnownAge ||= age.requiresKnownAge

    const egfr = extractEgfrConstraintFromText(part)
    minEgfr = mergeMin(minEgfr, egfr.minEgfr)
    maxEgfr = mergeMax(maxEgfr, egfr.maxEgfr)
  }

  return {
    minAgeYears,
    maxAgeYears,
    requiresKnownAge,
    minEgfr,
    maxEgfr,
    urineProteinConstraints: extractUrineProteinConstraintsFromTexts(parts),
    requiresDialysis: studyTextIndicatesDialysisPopulation(haystack),
    requiresTransplant: studyTextIndicatesTransplantRecipientPopulation(haystack),
  }
}

function ageFitsConstraint(ageYears, constraints) {
  if (ageYears === null) return false
  if (constraints.minAgeYears !== null && ageYears < constraints.minAgeYears) return false
  if (constraints.maxAgeYears !== null && ageYears > constraints.maxAgeYears) return false
  return constraints.minAgeYears !== null || constraints.maxAgeYears !== null
}

function egfrFitsConstraint(egfr, constraints) {
  if (egfr === null) return false
  if (constraints.minEgfr !== null && egfr < constraints.minEgfr) return false
  if (constraints.maxEgfr !== null && egfr > constraints.maxEgfr) return false
  return constraints.minEgfr !== null || constraints.maxEgfr !== null
}

function profileImpliesNotOnDialysis(profile) {
  const { dialysisStatus, egfr } = profile
  if (dialysisStatus === 'hemodialysis' || dialysisStatus === 'peritoneal_dialysis' || dialysisStatus === 'any_dialysis') {
    return false
  }
  if (dialysisStatus === 'not_on_dialysis') return true
  if (dialysisStatus === null && egfr !== null && egfr >= 15) return true
  return false
}

function profileIsOnDialysis(profile) {
  return (
    profile.dialysisStatus === 'hemodialysis' ||
    profile.dialysisStatus === 'peritoneal_dialysis' ||
    profile.dialysisStatus === 'any_dialysis' ||
    profile.populationTags.includes('dialysis')
  )
}

function profileIsTransplantRecipient(profile) {
  return (
    profile.transplantStatus === 'kidney_transplant_recipient' ||
    profile.populationTags.includes('kidney_transplant')
  )
}

export function getProfileTextMismatchReasons(profile, rawTrial) {
  const reasons = []
  const haystack = buildTrialHaystack(rawTrial)
  const constraints = extractStudyConstraints(rawTrial)
  if (!haystack) return reasons
  const urineProtein = evaluateUrineProteinConstraints(profile, constraints.urineProteinConstraints)

  const profileDiseaseFocuses = getProfileDiseaseFocuses(profile)
  const studyDiseaseFocuses = collectDiseaseFocusesFromText(haystack)

  if (profile.transplantStatus === 'no_transplant' && constraints.requiresTransplant) {
    reasons.push('Study text indicates kidney or organ transplant recipients; patient is not a transplant recipient.')
  }

  if (profileDiseaseFocuses.size && studyDiseaseFocuses.size && !setsOverlap(profileDiseaseFocuses, studyDiseaseFocuses)) {
    reasons.push('Study text targets a different kidney disease population than the reported diagnosis.')
  }

  if (profileImpliesNotOnDialysis(profile) && constraints.requiresDialysis) {
    reasons.push('Study text targets patients on dialysis; this patient is not described as on dialysis.')
  }

  if (profile.ageYears !== null && !ageFitsConstraint(profile.ageYears, constraints)) {
    if (constraints.minAgeYears !== null || constraints.maxAgeYears !== null) {
      reasons.push('Study text age criteria do not fit the reported age.')
    }
  }

  if (profile.egfr !== null && !egfrFitsConstraint(profile.egfr, constraints)) {
    if (constraints.minEgfr !== null || constraints.maxEgfr !== null) {
      reasons.push('Study text eGFR criteria do not fit the reported eGFR.')
    }
  }

  reasons.push(...urineProtein.mismatchReasons)

  return reasons
}

function collectMatchSignals(profile, rawTrial) {
  const reasons = []
  let score = 0
  const haystack = buildTrialHaystack(rawTrial)
  const constraints = extractStudyConstraints(rawTrial)
  if (!haystack) return { matchedReasons: reasons, signalScore: score }
  const urineProtein = evaluateUrineProteinConstraints(profile, constraints.urineProteinConstraints)

  const profileDiseaseFocuses = getProfileDiseaseFocuses(profile)
  const studyDiseaseFocuses = collectDiseaseFocusesFromText(haystack)

  if (profileDiseaseFocuses.size && studyDiseaseFocuses.size && setsOverlap(profileDiseaseFocuses, studyDiseaseFocuses)) {
    reasons.push('Study text aligns with the reported kidney diagnosis.')
    score += 15
  }

  if (profileIsOnDialysis(profile) && constraints.requiresDialysis) {
    reasons.push('Study text targets patients on dialysis.')
    score += 20
  }

  if (profileIsTransplantRecipient(profile) && constraints.requiresTransplant) {
    reasons.push('Study text targets kidney transplant recipients.')
    score += 20
  }

  if (ageFitsConstraint(profile.ageYears, constraints)) {
    reasons.push('Study text age criteria fit the reported age.')
    score += 5
  }

  if (egfrFitsConstraint(profile.egfr, constraints)) {
    reasons.push('Study text eGFR criteria fit the reported eGFR.')
    score += 8
  }

  if (profile.populationTags.includes('chronic_kidney_disease') && studyTextIndicatesChronicKidneyDisease(haystack)) {
    reasons.push('Study text includes chronic kidney disease.')
    score += 10
  }

  if (profile.populationTags.includes('acute_kidney_injury') && studyTextIndicatesAcuteKidneyInjury(haystack)) {
    reasons.push('Study text includes acute kidney injury.')
    score += 10
  }

  if (profile.populationTags.includes('glomerular_disease') && studyTextIndicatesGlomerularDisease(haystack)) {
    reasons.push('Study text includes glomerular disease.')
    score += 10
  }

  if (profile.populationTags.includes('hypertension') && studyTextIndicatesHypertension(haystack)) {
    reasons.push('Study text includes hypertension.')
    score += 10
  }

  if ((profile.populationTags.includes('diabetes') || profile.hasDiabetes === true) && studyTextIndicatesDiabetes(haystack)) {
    reasons.push('Study text includes diabetes.')
    score += 10
  }

  if (profile.populationTags.includes('healthy_volunteer') && studyTextIndicatesHealthyVolunteers(haystack)) {
    reasons.push('Study text includes healthy volunteers.')
    score += 10
  }

  reasons.push(...urineProtein.matchedReasons)
  score += urineProtein.signalScore

  return {
    matchedReasons: uniqueList(reasons),
    signalScore: score,
  }
}

function collectMissingReasons(profile, rawTrial) {
  const reasons = []
  const constraints = extractStudyConstraints(rawTrial)
  const urineProtein = evaluateUrineProteinConstraints(profile, constraints.urineProteinConstraints)

  if (constraints.requiresKnownAge && profile.ageYears === null) {
    reasons.push('Study text includes an age range, but age is not yet known.')
  }

  if ((constraints.minEgfr !== null || constraints.maxEgfr !== null) && profile.egfr === null) {
    reasons.push('Study text includes an eGFR criterion, but eGFR is not yet known.')
  }

  if (constraints.requiresDialysis && !profileIsOnDialysis(profile) && !profileImpliesNotOnDialysis(profile)) {
    reasons.push('Study text targets patients on dialysis, but dialysis status is not yet known.')
  }

  if (
    constraints.requiresTransplant &&
    !profileIsTransplantRecipient(profile) &&
    profile.transplantStatus === null &&
    !profile.populationTags.includes('kidney_transplant')
  ) {
    reasons.push('Study text targets transplant recipients, but transplant status is not yet known.')
  }

  reasons.push(...urineProtein.missingReasons)

  return uniqueList(reasons)
}

function hasProfileContext(profile) {
  return (
    Boolean(profile.diagnosis) ||
    profile.populationTags.length > 0 ||
    profile.ckdStage !== null ||
    profile.dialysisStatus !== null ||
    profile.transplantStatus !== null ||
    profile.hasDiabetes !== null ||
    profile.egfr !== null ||
    profile.hasAlbuminuria !== null ||
    profile.hasProteinuria !== null ||
    profile.ageYears !== null ||
    profile.sex !== null
  )
}

function buildResult(rawTrial, { decision, matchedReasons = [], missingReasons = [], mismatchReasons = [], score = 0 }) {
  return {
    _id: rawTrial?._id,
    title: rawTrial?.title || 'Untitled study',
    slug: rawTrial?.slug || '',
    status: rawTrial?.status || 'recruiting',
    statusLabel: statusLabel(rawTrial?.status),
    decision,
    screeningSummary: normalizeString(rawTrial?.laySummary),
    matchedReasons,
    missingReasons,
    mismatchReasons,
    score,
  }
}

export function matchTrialToPatient(rawTrial, rawProfile) {
  const profile = sanitizePatientProfile(rawProfile)
  const mismatchReasons = getProfileTextMismatchReasons(profile, rawTrial)
  if (mismatchReasons.length) {
    return buildResult(rawTrial, {
      decision: 'unlikely',
      mismatchReasons,
      score: -250,
    })
  }

  const { matchedReasons, signalScore } = collectMatchSignals(profile, rawTrial)
  const missingReasons = collectMissingReasons(profile, rawTrial)
  const profileHasContext = hasProfileContext(profile)
  const decision = signalScore >= 20 && missingReasons.length === 0 ? 'match' : profileHasContext ? 'possible' : 'insufficient_info'

  return buildResult(rawTrial, {
    decision,
    matchedReasons,
    missingReasons,
    score: signalScore + buildSortScore({ matchedReasons, missingReasons, mismatchReasons: [] }),
  })
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

function buildCatalogSummary(trial) {
  const parts = []
  const summary = normalizeString(trial?.laySummary)
  if (summary) {
    parts.push(`Summary: ${JSON.stringify(summary)}`)
  }

  const inclusionHighlights = normalizeList(trial?.inclusionCriteria).slice(0, 2)
  if (inclusionHighlights.length) {
    parts.push(`Inclusion highlights: ${JSON.stringify(inclusionHighlights.join(' | '))}`)
  }

  return parts
}

export function buildTrialCatalogForPrompt(trials = []) {
  return trials
    .map((trial) => {
      const parts = [`${trial.title} (${statusLabel(trial.status)})`, ...buildCatalogSummary(trial)].filter(Boolean)
      return parts.length ? `- ${parts.join(' | ')}` : null
    })
    .filter(Boolean)
    .join('\n')
}
