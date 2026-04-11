const MG_PER_G_TO_MG_PER_MMOL = 0.113
const MG_PER_MMOL_TO_MG_PER_G = 8.84
const G_PER_G_TO_MG_PER_MMOL = 113
const G_PER_DAY_TO_MG_PER_DAY = 1000
const MG_PER_DAY_TO_G_PER_DAY = 0.001
const MG_PER_DAY_PER_PCR_MG_PER_MMOL = 10
const ACR_ALBUMINURIA_THRESHOLD_MG_PER_MMOL = 3
const PCR_PROTEINURIA_THRESHOLD_MG_PER_MMOL = 15
const PROTEINURIA_24H_THRESHOLD_MG_PER_DAY = 150
const SAME_ASSAY_MARGIN_RATIO = 0.15
const ESTIMATED_ASSAY_MARGIN_RATIO = 0.3
const CHAINED_ESTIMATE_MARGIN_RATIO = 0.45

const URINE_PROTEIN_KINDS = new Set(['acr', 'pcr', 'protein24h'])
const URINE_PROTEIN_UNITS = new Set(['mg_per_mmol', 'mg_per_g', 'g_per_g'])
const URINE_PROTEIN_24H_UNITS = new Set(['mg_per_day', 'g_per_day'])
const URINE_PROTEIN_SOURCES = new Set([
  'reported',
  'estimated_from_acr',
  'estimated_from_pcr',
  'estimated_from_protein_24h',
  'estimated_from_acr_via_pcr',
  'estimated_from_protein_24h_via_pcr',
])

const KIND_KEYWORD_PATTERNS = {
  acr: /\b(?:uacr|acr|albumin(?:\s*|-)?to(?:\s*|-)?creatinine ratio)\b/i,
  pcr: /\b(?:upcr|pcr|protein(?:\s*|-)?to(?:\s*|-)?creatinine ratio|urine protein(?:\s*|-)?creatinine ratio)\b/i,
  protein24h:
    /\b(?:24(?:\s*|-)?hour\s+urine\s+protein|24(?:\s*|-)?h(?:our)?\s+urine\s+protein|urinary\s+protein\s+excretion|24(?:\s*|-)?hour\s+protein(?:uria)?|proteinuria)\b/i,
}

const NUMBER_PATTERN = '(\\d+(?:\\.\\d+)?)'
const UNIT_PATTERN_SOURCE = '(mg\\s*\\/\\s*mmol|mg\\s*\\/\\s*g|g\\s*\\/\\s*g)'
const UNIT_PATTERN_24H_SOURCE = '(mg\\s*(?:\\/|per\\s+)\\s*(?:day|d|24\\s*h(?:ours?)?)|g\\s*(?:\\/|per\\s+)\\s*(?:day|d|24\\s*h(?:ours?)?))'

// Weaver RG et al. JASN 2020;31:369-376. These piecewise equations estimate median
// ACR from PCR using same-day measurements in a large Alberta cohort.
const WEAVER_PCR_TO_ACR_SPLINES = [
  { maxPcrMgPerG: 40, intercept: 0.9518, slope: 0.1264 },
  { maxPcrMgPerG: 60, intercept: -1.2568, slope: 0.7251 },
  { maxPcrMgPerG: 250, intercept: -6.7837, slope: 2.0751 },
  { maxPcrMgPerG: 1000, intercept: -2.9649, slope: 1.3834 },
  { maxPcrMgPerG: Infinity, intercept: -0.0239, slope: 0.9577 },
]

const QUALITATIVE_PATTERNS = {
  albuminuriaPositive: /\b(?:microalbuminuria|macroalbuminuria|albuminuric|albuminuria)\b/i,
  albuminuriaNegative: /\b(?:no|without|non[-\s])\s+albuminuria\b|\bnon[-\s]albuminuric\b/i,
  proteinuriaPositive: /\b(?:proteinuric|proteinuria|nephrotic(?:-|\s)?range|nephrotic syndrome)\b/i,
  proteinuriaNegative: /\b(?:no|without|non[-\s])\s+proteinuria\b|\bnon[-\s]proteinuric\b/i,
}
const UNAVAILABLE_VALUE_PATTERNS = [
  /\b(?:do\s+not|don't|dont|cannot|can't|cant|unable to|not sure|unsure|unknown)\b[^.]{0,80}\b(?:uacr|acr|upcr|pcr|albumin(?:\s*|-)?to(?:\s*|-)?creatinine(?:\s+ratio)?|protein(?:\s*|-)?to(?:\s*|-)?creatinine(?:\s+ratio)?|24(?:\s*|-)?hour(?:\s+urine)?\s+protein|24(?:\s*|-)?h(?:our)?(?:\s+urine)?\s+protein|urine protein|proteinuria value)\b/i,
  /\b(?:uacr|acr|upcr|pcr|albumin(?:\s*|-)?to(?:\s*|-)?creatinine(?:\s+ratio)?|protein(?:\s*|-)?to(?:\s*|-)?creatinine(?:\s+ratio)?|24(?:\s*|-)?hour(?:\s+urine)?\s+protein|24(?:\s*|-)?h(?:our)?(?:\s+urine)?\s+protein|urine protein|proteinuria value)\b[^.]{0,80}\b(?:not available|unavailable|unknown|not sure|unsure)\b/i,
]

function normalizeString(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function normalizeNumber(value, { min = 0, max = 1000000 } = {}) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  if (!Number.isFinite(number)) return null
  if (number < min || number > max) return null
  return number
}

function normalizeUnit(value) {
  if (!value) return null
  const text = normalizeString(value).toLowerCase()
  if (!text) return null
  if (URINE_PROTEIN_UNITS.has(text)) return text
  if (/^mg\s*\/\s*mmol$/.test(text)) return 'mg_per_mmol'
  if (/^mg\s*\/\s*g$/.test(text)) return 'mg_per_g'
  if (/^g\s*\/\s*g$/.test(text)) return 'g_per_g'
  return null
}

function normalizeProtein24hUnit(value) {
  if (!value) return null
  const text = normalizeString(value).toLowerCase()
  if (!text) return null
  if (URINE_PROTEIN_24H_UNITS.has(text)) return text
  if (/^mg\s*(?:\/|per\s+)\s*(?:day|d|24\s*h(?:ours?)?)$/.test(text)) return 'mg_per_day'
  if (/^g\s*(?:\/|per\s+)\s*(?:day|d|24\s*h(?:ours?)?)$/.test(text)) return 'g_per_day'
  return null
}

function normalizeSource(value) {
  if (!value) return null
  const text = normalizeString(value)
  return URINE_PROTEIN_SOURCES.has(text) ? text : null
}

function uniqueList(values = []) {
  return Array.from(new Set(values.filter(Boolean)))
}

function createEmptyMeasurement() {
  return {
    valueMgPerMmol: null,
    reportedValue: null,
    reportedUnit: null,
    source: null,
  }
}

export function createEmptyUrineProteinProfile() {
  return {
    acr: createEmptyMeasurement(),
    pcr: createEmptyMeasurement(),
    protein24h: {
      valueMgPerDay: null,
      reportedValue: null,
      reportedUnit: null,
      source: null,
    },
    assumptions: [],
  }
}

function roundValue(value, digits = 1) {
  if (!Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function formatValue(value, digits = 1) {
  if (!Number.isFinite(value)) return null
  return roundValue(value, digits).toFixed(digits)
}

function formatUnitLabel(unit) {
  if (unit === 'mg_per_mmol') return 'mg/mmol'
  if (unit === 'mg_per_g') return 'mg/g'
  if (unit === 'g_per_g') return 'g/g'
  if (unit === 'mg_per_day') return 'mg/day'
  if (unit === 'g_per_day') return 'g/day'
  return unit
}

export function convertUrineProteinRatio(value, fromUnit, toUnit) {
  const number = normalizeNumber(value)
  const sourceUnit = normalizeUnit(fromUnit)
  const targetUnit = normalizeUnit(toUnit)
  if (number === null || !sourceUnit || !targetUnit) return null
  if (sourceUnit === targetUnit) return number

  let valueMgPerMmol = null
  if (sourceUnit === 'mg_per_mmol') valueMgPerMmol = number
  if (sourceUnit === 'mg_per_g') valueMgPerMmol = number * MG_PER_G_TO_MG_PER_MMOL
  if (sourceUnit === 'g_per_g') valueMgPerMmol = number * G_PER_G_TO_MG_PER_MMOL
  if (!Number.isFinite(valueMgPerMmol)) return null

  if (targetUnit === 'mg_per_mmol') return valueMgPerMmol
  if (targetUnit === 'mg_per_g') return valueMgPerMmol * MG_PER_MMOL_TO_MG_PER_G
  if (targetUnit === 'g_per_g') return valueMgPerMmol / G_PER_G_TO_MG_PER_MMOL
  return null
}

export function convertTimedProteinExcretion(value, fromUnit, toUnit) {
  const number = normalizeNumber(value)
  const sourceUnit = normalizeProtein24hUnit(fromUnit)
  const targetUnit = normalizeProtein24hUnit(toUnit)
  if (number === null || !sourceUnit || !targetUnit) return null
  if (sourceUnit === targetUnit) return number

  let valueMgPerDay = null
  if (sourceUnit === 'mg_per_day') valueMgPerDay = number
  if (sourceUnit === 'g_per_day') valueMgPerDay = number * G_PER_DAY_TO_MG_PER_DAY
  if (!Number.isFinite(valueMgPerDay)) return null

  if (targetUnit === 'mg_per_day') return valueMgPerDay
  if (targetUnit === 'g_per_day') return valueMgPerDay * MG_PER_DAY_TO_G_PER_DAY
  return null
}

function estimateMedianAcrMgPerGFromPcrMgPerG(pcrMgPerG) {
  const pcr = normalizeNumber(pcrMgPerG, { min: 0.000001 })
  if (pcr === null) return null
  const segment = WEAVER_PCR_TO_ACR_SPLINES.find((item) => pcr < item.maxPcrMgPerG) || WEAVER_PCR_TO_ACR_SPLINES.at(-1)
  const logAcr = segment.intercept + segment.slope * Math.log(pcr)
  const acr = Math.exp(logAcr)
  return Number.isFinite(acr) ? acr : null
}

export function estimateMedianAcrMgPerMmolFromPcrMgPerMmol(pcrMgPerMmol) {
  const pcrMgPerG = convertUrineProteinRatio(pcrMgPerMmol, 'mg_per_mmol', 'mg_per_g')
  const acrMgPerG = estimateMedianAcrMgPerGFromPcrMgPerG(pcrMgPerG)
  return convertUrineProteinRatio(acrMgPerG, 'mg_per_g', 'mg_per_mmol')
}

export function estimateMedianPcrMgPerMmolFromAcrMgPerMmol(acrMgPerMmol) {
  const targetAcrMgPerG = convertUrineProteinRatio(acrMgPerMmol, 'mg_per_mmol', 'mg_per_g')
  if (targetAcrMgPerG === null || targetAcrMgPerG <= 0) return null

  let low = 0.000001
  let high = Math.max(10, targetAcrMgPerG * 20)
  let guard = 0
  while (guard < 40) {
    const estimatedAcrAtHigh = estimateMedianAcrMgPerGFromPcrMgPerG(high)
    if (estimatedAcrAtHigh !== null && estimatedAcrAtHigh >= targetAcrMgPerG) break
    high *= 2
    guard += 1
  }

  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2
    const estimatedAcr = estimateMedianAcrMgPerGFromPcrMgPerG(mid)
    if (estimatedAcr === null) return null
    if (estimatedAcr >= targetAcrMgPerG) {
      high = mid
    } else {
      low = mid
    }
  }

  return convertUrineProteinRatio(high, 'mg_per_g', 'mg_per_mmol')
}

export function estimateProtein24hMgPerDayFromPcrMgPerMmol(pcrMgPerMmol) {
  const pcr = normalizeNumber(pcrMgPerMmol, { min: 0 })
  if (pcr === null) return null
  return pcr * MG_PER_DAY_PER_PCR_MG_PER_MMOL
}

export function estimatePcrMgPerMmolFromProtein24hMgPerDay(protein24hMgPerDay) {
  const protein = normalizeNumber(protein24hMgPerDay, { min: 0 })
  if (protein === null) return null
  return protein / MG_PER_DAY_PER_PCR_MG_PER_MMOL
}

function normalizeMeasurement(value) {
  const payload = value && typeof value === 'object' ? value : {}
  const reportedUnit = normalizeUnit(payload.reportedUnit)
  const source = normalizeSource(payload.source)
  let valueMgPerMmol = normalizeNumber(payload.valueMgPerMmol)
  const reportedValue = normalizeNumber(payload.reportedValue)

  if (valueMgPerMmol === null && reportedValue !== null && reportedUnit) {
    valueMgPerMmol = convertUrineProteinRatio(reportedValue, reportedUnit, 'mg_per_mmol')
  }

  if (valueMgPerMmol === null) {
    return createEmptyMeasurement()
  }

  return {
    valueMgPerMmol,
    reportedValue,
    reportedUnit,
    source: source || (reportedValue !== null ? 'reported' : null),
  }
}

function normalizeProtein24hMeasurement(value) {
  const payload = value && typeof value === 'object' ? value : {}
  const reportedUnit = normalizeProtein24hUnit(payload.reportedUnit)
  const source = normalizeSource(payload.source)
  let valueMgPerDay = normalizeNumber(payload.valueMgPerDay)
  const reportedValue = normalizeNumber(payload.reportedValue)

  if (valueMgPerDay === null && reportedValue !== null && reportedUnit) {
    valueMgPerDay = convertTimedProteinExcretion(reportedValue, reportedUnit, 'mg_per_day')
  }

  if (valueMgPerDay === null) {
    return {
      valueMgPerDay: null,
      reportedValue: null,
      reportedUnit: null,
      source: null,
    }
  }

  return {
    valueMgPerDay,
    reportedValue,
    reportedUnit,
    source: source || (reportedValue !== null ? 'reported' : null),
  }
}

function applyDerivedEstimates(profile) {
  const current = {
    acr: { ...profile.acr },
    pcr: { ...profile.pcr },
    protein24h: { ...profile.protein24h },
    assumptions: uniqueList(profile.assumptions),
  }

  if (current.pcr.source === 'reported' && current.acr.source !== 'reported') {
    const estimatedAcr = estimateMedianAcrMgPerMmolFromPcrMgPerMmol(current.pcr.valueMgPerMmol)
    if (estimatedAcr !== null) {
      current.acr = {
        valueMgPerMmol: estimatedAcr,
        reportedValue: null,
        reportedUnit: null,
        source: 'estimated_from_pcr',
      }
    }
  }

  if (current.acr.source === 'reported' && current.pcr.source !== 'reported') {
    const estimatedPcr = estimateMedianPcrMgPerMmolFromAcrMgPerMmol(current.acr.valueMgPerMmol)
    if (estimatedPcr !== null) {
      current.pcr = {
        valueMgPerMmol: estimatedPcr,
        reportedValue: null,
        reportedUnit: null,
        source: 'estimated_from_acr',
      }
    }
  }

  if (current.pcr.source === 'reported' && current.protein24h.source !== 'reported') {
    const estimatedProtein24h = estimateProtein24hMgPerDayFromPcrMgPerMmol(current.pcr.valueMgPerMmol)
    if (estimatedProtein24h !== null) {
      current.protein24h = {
        valueMgPerDay: estimatedProtein24h,
        reportedValue: null,
        reportedUnit: null,
        source: 'estimated_from_pcr',
      }
    }
  }

  if (current.protein24h.source === 'reported' && current.pcr.source !== 'reported') {
    const estimatedPcr = estimatePcrMgPerMmolFromProtein24hMgPerDay(current.protein24h.valueMgPerDay)
    if (estimatedPcr !== null) {
      current.pcr = {
        valueMgPerMmol: estimatedPcr,
        reportedValue: null,
        reportedUnit: null,
        source: 'estimated_from_protein_24h',
      }
    }
  }

  if (current.acr.source === 'reported' && current.protein24h.source !== 'reported') {
    const estimatedProtein24h = estimateProtein24hMgPerDayFromPcrMgPerMmol(current.pcr.valueMgPerMmol)
    if (estimatedProtein24h !== null) {
      current.protein24h = {
        valueMgPerDay: estimatedProtein24h,
        reportedValue: null,
        reportedUnit: null,
        source: 'estimated_from_acr_via_pcr',
      }
    }
  }

  if (current.protein24h.source === 'reported' && current.acr.source !== 'reported') {
    const estimatedAcr = estimateMedianAcrMgPerMmolFromPcrMgPerMmol(current.pcr.valueMgPerMmol)
    if (estimatedAcr !== null) {
      current.acr = {
        valueMgPerMmol: estimatedAcr,
        reportedValue: null,
        reportedUnit: null,
        source: 'estimated_from_protein_24h_via_pcr',
      }
    }
  }

  return current
}

export function sanitizeUrineProteinProfile(value) {
  const payload = value && typeof value === 'object' ? value : {}
  return applyDerivedEstimates({
    acr: normalizeMeasurement(payload.acr),
    pcr: normalizeMeasurement(payload.pcr),
    protein24h: normalizeProtein24hMeasurement(payload.protein24h),
    assumptions: uniqueList(Array.isArray(payload.assumptions) ? payload.assumptions.map(normalizeString) : []),
  })
}

function shouldReplaceMeasurement(current, next) {
  if (next.valueMgPerMmol === null) return false
  if (next.source === 'reported') return true
  if (current.valueMgPerMmol === null) return true
  if (current.source !== 'reported') return true
  return false
}

export function mergeUrineProteinProfiles(...profiles) {
  let merged = createEmptyUrineProteinProfile()

  for (const rawProfile of profiles) {
    const profile = sanitizeUrineProteinProfile(rawProfile)
    if (shouldReplaceMeasurement(merged.acr, profile.acr)) merged.acr = { ...profile.acr }
    if (shouldReplaceMeasurement(merged.pcr, profile.pcr)) merged.pcr = { ...profile.pcr }
    if (profile.protein24h.valueMgPerDay !== null) {
      if (
        profile.protein24h.source === 'reported' ||
        merged.protein24h.valueMgPerDay === null ||
        merged.protein24h.source !== 'reported'
      ) {
        merged.protein24h = { ...profile.protein24h }
      }
    }
    merged.assumptions = uniqueList([...merged.assumptions, ...profile.assumptions])
  }

  return sanitizeUrineProteinProfile(merged)
}

function kindLabel(kind) {
  if (kind === 'acr') return 'ACR'
  if (kind === 'pcr') return 'PCR'
  return '24-hour protein'
}

function normalizeKeywordPattern(kind) {
  return KIND_KEYWORD_PATTERNS[kind] || null
}

function isRatioKind(kind) {
  return kind === 'acr' || kind === 'pcr'
}

function normalizeReportedUnitForKind(kind, value) {
  return isRatioKind(kind) ? normalizeUnit(value) : normalizeProtein24hUnit(value)
}

function getUnitPatternSourceForKind(kind) {
  return isRatioKind(kind) ? UNIT_PATTERN_SOURCE : UNIT_PATTERN_24H_SOURCE
}

function splitTextIntoClauses(text) {
  return String(text || '')
    .split(/(?:\r?\n)+|;+/g)
    .map((item) => normalizeString(item))
    .filter(Boolean)
}

function getClosestExplicitMeasurement(clause, kind) {
  const keywordPattern = normalizeKeywordPattern(kind)
  if (!keywordPattern || !keywordPattern.test(clause)) return null

  const keywordIndexes = Array.from(clause.matchAll(new RegExp(keywordPattern.source, 'ig'))).map((match) => match.index ?? 0)
  const unitPatternSource = getUnitPatternSourceForKind(kind)
  const matches = Array.from(clause.matchAll(new RegExp(`${NUMBER_PATTERN}\\s*${unitPatternSource}`, 'ig')))
  if (!matches.length || !keywordIndexes.length) return null

  let best = null
  for (const match of matches) {
    const reportedValue = normalizeNumber(match[1])
    const reportedUnit = normalizeReportedUnitForKind(kind, match[2])
    if (reportedValue === null || !reportedUnit) continue
    const index = match.index ?? 0
    const distance = Math.min(...keywordIndexes.map((keywordIndex) => Math.abs(keywordIndex - index)))
    if (!best || distance < best.distance) {
      best = { reportedValue, reportedUnit, distance, index }
    }
  }

  return best
}

function getImplicitMeasurement(clause, kind) {
  const keywordPattern = normalizeKeywordPattern(kind)
  if (!keywordPattern) return null

  const trailing = clause.match(new RegExp(`${keywordPattern.source}[^\\d]{0,20}${NUMBER_PATTERN}\\b`, 'i'))
  if (trailing) {
    return normalizeNumber(trailing[1])
  }

  const leading = clause.match(new RegExp(`${NUMBER_PATTERN}[^\\d]{0,10}${keywordPattern.source}`, 'i'))
  if (leading) {
    return normalizeNumber(leading[1])
  }

  return null
}

function buildReportedMeasurement(kind, reportedValue, reportedUnit) {
  if (kind === 'protein24h') {
    const valueMgPerDay = convertTimedProteinExcretion(reportedValue, reportedUnit, 'mg_per_day')
    if (valueMgPerDay === null) return null
    return {
      protein24h: {
        valueMgPerDay,
        reportedValue,
        reportedUnit,
        source: 'reported',
      },
    }
  }

  const valueMgPerMmol = convertUrineProteinRatio(reportedValue, reportedUnit, 'mg_per_mmol')
  if (valueMgPerMmol === null) return null
  return {
    [kind]: {
      valueMgPerMmol,
      reportedValue,
      reportedUnit,
      source: 'reported',
    },
  }
}

export function parseUrineProteinProfileFromText(text, options = {}) {
  const defaultUnit = normalizeUnit(options.defaultUnit)
  const defaultProtein24hUnit = normalizeProtein24hUnit(options.defaultProtein24hUnit || 'mg_per_day')
  const clauses = splitTextIntoClauses(text)
  let parsed = createEmptyUrineProteinProfile()

  for (const kind of URINE_PROTEIN_KINDS) {
    const keywordPattern = normalizeKeywordPattern(kind)
    if (!keywordPattern) continue

    for (const clause of clauses) {
      if (!keywordPattern.test(clause)) continue
      keywordPattern.lastIndex = 0

      const explicit = getClosestExplicitMeasurement(clause, kind)
      if (explicit) {
        parsed = mergeUrineProteinProfiles(parsed, buildReportedMeasurement(kind, explicit.reportedValue, explicit.reportedUnit))
        continue
      }

      const implicitValue = getImplicitMeasurement(clause, kind)
      if (implicitValue === null) continue
      const assumedUnit = kind === 'protein24h' ? defaultProtein24hUnit : defaultUnit
      if (!assumedUnit) continue

      parsed = mergeUrineProteinProfiles(parsed, buildReportedMeasurement(kind, implicitValue, assumedUnit))
      parsed.assumptions = uniqueList([
        ...parsed.assumptions,
        `Assumed ${kindLabel(kind)} units were ${formatUnitLabel(assumedUnit)} because the user did not specify units.`,
      ])
    }
  }

  return parsed
}

export function parseUrineProteinSignalsFromText(text) {
  const normalized = normalizeString(text)
  if (!normalized) {
    return {
      hasAlbuminuria: null,
      hasProteinuria: null,
    }
  }

  let hasAlbuminuria = null
  let hasProteinuria = null

  if (QUALITATIVE_PATTERNS.albuminuriaNegative.test(normalized)) hasAlbuminuria = false
  else if (QUALITATIVE_PATTERNS.albuminuriaPositive.test(normalized)) hasAlbuminuria = true

  if (QUALITATIVE_PATTERNS.proteinuriaNegative.test(normalized)) hasProteinuria = false
  else if (QUALITATIVE_PATTERNS.proteinuriaPositive.test(normalized)) hasProteinuria = true

  return {
    hasAlbuminuria,
    hasProteinuria,
  }
}

export function isQuantitativeUrineProteinUnavailable(text) {
  const normalized = normalizeString(text)
  if (!normalized) return false
  return UNAVAILABLE_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))
}

function createConstraint(kind, minValue, maxValue, originalText) {
  if (minValue === null && maxValue === null) return null
  return {
    kind,
    minValue,
    maxValue,
    canonicalUnit: kind === 'protein24h' ? 'mg/day' : 'mg/mmol',
    originalText: normalizeString(originalText),
  }
}

function buildConstraintPatterns(kind) {
  const keywordPattern = normalizeKeywordPattern(kind)
  const keywordSource = keywordPattern?.source
  if (!keywordSource) return []
  const unitPatternSource = getUnitPatternSourceForKind(kind)
  const convertValue =
    kind === 'protein24h'
      ? (value, unit) => convertTimedProteinExcretion(value, unit, 'mg_per_day')
      : (value, unit) => convertUrineProteinRatio(value, unit, 'mg_per_mmol')

  return [
    {
      regex: new RegExp(
        `${keywordSource}[^.;\\n]{0,80}?${NUMBER_PATTERN}\\s*(?:to|-|–|and)\\s*${NUMBER_PATTERN}\\s*${unitPatternSource}`,
        'i'
      ),
      build: (match, text) =>
        createConstraint(
          kind,
          convertValue(match[1], match[3]),
          convertValue(match[2], match[3]),
          text
        ),
    },
    {
      regex: new RegExp(
        `${keywordSource}[^.;\\n]{0,80}?(?:>=|≥|at\\s+least|greater\\s+than\\s+or\\s+equal\\s+to|more\\s+than|over|above)\\s*${NUMBER_PATTERN}\\s*${unitPatternSource}`,
        'i'
      ),
      build: (match, text) => createConstraint(kind, convertValue(match[1], match[2]), null, text),
    },
    {
      regex: new RegExp(
        `${keywordSource}[^.;\\n]{0,80}?(?:<=|≤|at\\s+most|less\\s+than\\s+or\\s+equal\\s+to|less\\s+than|under|below)\\s*${NUMBER_PATTERN}\\s*${unitPatternSource}`,
        'i'
      ),
      build: (match, text) => createConstraint(kind, null, convertValue(match[1], match[2]), text),
    },
    {
      regex: new RegExp(
        `${keywordSource}[^.;\\n]{0,40}?(?:of\\s+)?${NUMBER_PATTERN}\\s*${unitPatternSource}\\s*(?:or\\s+higher|or\\s+more|or\\s+above|or\\s+greater)`,
        'i'
      ),
      build: (match, text) => createConstraint(kind, convertValue(match[1], match[2]), null, text),
    },
    {
      regex: new RegExp(
        `${keywordSource}[^.;\\n]{0,40}?(?:of\\s+)?${NUMBER_PATTERN}\\s*${unitPatternSource}\\s*(?:or\\s+lower|or\\s+less|or\\s+below)`,
        'i'
      ),
      build: (match, text) => createConstraint(kind, null, convertValue(match[1], match[2]), text),
    },
  ]
}

function inferConstraintFromExplicitMeasurement(kind, clause) {
  const explicit = getClosestExplicitMeasurement(clause, kind)
  if (!explicit) return null

  const normalized = clause.toLowerCase()
  const numericValue =
    kind === 'protein24h'
      ? convertTimedProteinExcretion(explicit.reportedValue, explicit.reportedUnit, 'mg_per_day')
      : convertUrineProteinRatio(explicit.reportedValue, explicit.reportedUnit, 'mg_per_mmol')
  if (numericValue === null) return null

  if (/\b(or higher|or more|or above|or greater|at least|greater than or equal to|>=|≥)\b/.test(normalized)) {
    return createConstraint(kind, numericValue, null, clause)
  }

  if (/\b(or lower|or less|or below|at most|less than or equal to|<=|≤)\b/.test(normalized)) {
    return createConstraint(kind, null, numericValue, clause)
  }

  return null
}

export function extractUrineProteinConstraintsFromTexts(texts = []) {
  const constraints = []
  const seen = new Set()
  const parts = Array.isArray(texts) ? texts.map(normalizeString).filter(Boolean) : []

  for (const text of parts) {
    for (const clause of splitTextIntoClauses(text)) {
      for (const kind of URINE_PROTEIN_KINDS) {
        const patterns = buildConstraintPatterns(kind)
        let matchedConstraint = null
        for (const pattern of patterns) {
          const match = clause.match(pattern.regex)
          if (!match) continue
          matchedConstraint = pattern.build(match, clause)
          if (matchedConstraint) break
        }

        const constraint = matchedConstraint || inferConstraintFromExplicitMeasurement(kind, clause)
        if (!constraint) continue

        const key = `${constraint.kind}:${constraint.minValue ?? ''}:${constraint.maxValue ?? ''}:${constraint.canonicalUnit}`
        if (seen.has(key)) continue
        seen.add(key)
        constraints.push(constraint)
      }
    }
  }

  return constraints
}

function getMeasurementForKind(profile, kind) {
  const current = sanitizeUrineProteinProfile(profile)
  if (kind === 'acr') return current.acr
  if (kind === 'pcr') return current.pcr
  return current.protein24h
}

function getQualitativeSignalForConstraint(profile, kind) {
  if (!profile || typeof profile !== 'object') return null
  if (kind === 'acr') return profile.hasAlbuminuria
  if (kind === 'pcr' || kind === 'protein24h') return profile.hasProteinuria
  return null
}

function getMeasurementValue(measurement, kind) {
  if (kind === 'protein24h') return measurement?.valueMgPerDay
  return measurement?.valueMgPerMmol
}

function getMarginRatioForSource(source) {
  if (source === 'reported') return SAME_ASSAY_MARGIN_RATIO
  if (source && source.includes('_via_')) return CHAINED_ESTIMATE_MARGIN_RATIO
  return ESTIMATED_ASSAY_MARGIN_RATIO
}

function compareMeasurementToConstraint(measurement, constraint) {
  const value = getMeasurementValue(measurement, constraint.kind)
  if (value === null || value === undefined) {
    return { state: 'missing', marginRatio: null }
  }
  const marginRatio = getMarginRatioForSource(measurement.source)
  const { minValue, maxValue } = constraint

  if (minValue !== null) {
    if (value < minValue * (1 - marginRatio)) return { state: 'clear_mismatch', marginRatio }
    if (value < minValue) return { state: 'near_threshold', marginRatio }
  }

  if (maxValue !== null) {
    if (value > maxValue * (1 + marginRatio)) return { state: 'clear_mismatch', marginRatio }
    if (value > maxValue) return { state: 'near_threshold', marginRatio }
  }

  return { state: 'match', marginRatio }
}

function getConstraintDescription(constraint) {
  const prefix = kindLabel(constraint.kind)
  const min = constraint.minValue
  const max = constraint.maxValue
  const unit = constraint.canonicalUnit
  if (min !== null && max !== null) return `${prefix} ${formatValue(min)} to ${formatValue(max)} ${unit}`
  if (min !== null) return `${prefix} at least ${formatValue(min)} ${unit}`
  if (max !== null) return `${prefix} at most ${formatValue(max)} ${unit}`
  return `${prefix} criterion`
}

export function evaluateUrineProteinConstraints(profile, constraints = []) {
  if (!Array.isArray(constraints) || !constraints.length) {
    return { matchedReasons: [], missingReasons: [], mismatchReasons: [], signalScore: 0 }
  }

  const evaluations = constraints.map((constraint) => {
    const measurement = getMeasurementForKind(profile?.urineProtein || profile, constraint.kind)
    return {
      constraint,
      measurement,
      qualitativeSignal: getQualitativeSignalForConstraint(profile, constraint.kind),
      ...compareMeasurementToConstraint(measurement, constraint),
    }
  })

  const matchedReasons = []
  const missingReasons = []
  const mismatchReasons = []
  let signalScore = 0

  const pass = evaluations.find((item) => item.state === 'match')
  const near = evaluations.find((item) => item.state === 'near_threshold')
  const missing = evaluations.some((item) => item.state === 'missing')
  const qualitativePositive = evaluations.find(
    (item) => item.state === 'missing' && item.qualitativeSignal === true && item.constraint.minValue !== null
  )
  const qualitativeNegativeMismatch = evaluations.find(
    (item) => item.state === 'missing' && item.qualitativeSignal === false && item.constraint.minValue !== null
  )
  const comparableCount = evaluations.filter((item) => item.state !== 'missing').length
  const allComparableClearMismatch =
    comparableCount === evaluations.length && evaluations.every((item) => item.state === 'clear_mismatch')

  if (pass) {
    const description = getConstraintDescription(pass.constraint)
    if (pass.measurement.source === 'reported') {
      matchedReasons.push(`Study text ${description.toLowerCase()} fits the available value.`)
      signalScore += 8
    } else {
      matchedReasons.push(`Study text ${description.toLowerCase()} may fit based on an estimated conversion.`)
      signalScore += 5
    }
  }

  if (near) {
    matchedReasons.push(`Study text ${getConstraintDescription(near.constraint).toLowerCase()} is close to the available value.`)
    missingReasons.push('Urine protein is close to a study threshold and should be confirmed with the coordinator.')
    signalScore += 3
  }

  if (!pass && !near && qualitativePositive) {
    matchedReasons.push(
      `Study text ${getConstraintDescription(qualitativePositive.constraint).toLowerCase()} may fit because urine protein is reported qualitatively.`
    )
    missingReasons.push('A quantitative urine protein value would help confirm the study threshold if available.')
    signalScore += 2
  }

  if (!pass && !near && qualitativeNegativeMismatch) {
    mismatchReasons.push('Study text requires urine protein, but the user reports no albuminuria/proteinuria.')
  } else if (!pass && !near && allComparableClearMismatch) {
    mismatchReasons.push('Study text urine protein threshold appears substantially outside the available value.')
  } else if (!pass && !near && missing && !qualitativePositive) {
    missingReasons.push('Study text includes a urine protein criterion, but a comparable value is not yet known.')
  }

  return {
    matchedReasons: uniqueList(matchedReasons),
    missingReasons: uniqueList(missingReasons),
    mismatchReasons: uniqueList(mismatchReasons),
    signalScore,
  }
}

export function deriveHasAlbuminuria(urineProtein) {
  const current = sanitizeUrineProteinProfile(urineProtein)
  if (current.acr.valueMgPerMmol === null) return null
  if (current.acr.valueMgPerMmol >= ACR_ALBUMINURIA_THRESHOLD_MG_PER_MMOL) return true
  return current.acr.source === 'reported' ? false : null
}

export function deriveHasProteinuria(urineProtein) {
  const current = sanitizeUrineProteinProfile(urineProtein)
  if (current.pcr.valueMgPerMmol !== null) {
    if (current.pcr.valueMgPerMmol >= PCR_PROTEINURIA_THRESHOLD_MG_PER_MMOL) return true
    if (current.pcr.source === 'reported') return false
  }
  if (current.protein24h.valueMgPerDay !== null) {
    if (current.protein24h.valueMgPerDay >= PROTEINURIA_24H_THRESHOLD_MG_PER_DAY) return true
    return current.protein24h.source === 'reported' ? false : null
  }
  return null
}

export function hasQuantitativeUrineProteinData(urineProtein) {
  const current = sanitizeUrineProteinProfile(urineProtein)
  return (
    current.acr.valueMgPerMmol !== null ||
    current.pcr.valueMgPerMmol !== null ||
    current.protein24h.valueMgPerDay !== null
  )
}

function formatMeasurementSummary(kind, measurement) {
  const value = kind === 'protein24h' ? measurement.valueMgPerDay : measurement.valueMgPerMmol
  if (value === null) return null
  const label = kindLabel(kind)
  let sourceLabel = 'estimated'
  if (measurement.source === 'reported') sourceLabel = 'reported'
  if (measurement.source === 'estimated_from_acr') sourceLabel = 'estimated from ACR'
  if (measurement.source === 'estimated_from_pcr') sourceLabel = 'estimated from PCR'
  if (measurement.source === 'estimated_from_protein_24h') sourceLabel = 'estimated from 24-hour protein'
  if (measurement.source === 'estimated_from_acr_via_pcr') sourceLabel = 'estimated from ACR via PCR'
  if (measurement.source === 'estimated_from_protein_24h_via_pcr') {
    sourceLabel = 'estimated from 24-hour protein via PCR'
  }
  const reported =
    measurement.reportedValue !== null && measurement.reportedUnit
      ? ` (${formatValue(measurement.reportedValue)} ${formatUnitLabel(measurement.reportedUnit)})`
      : ''
  const canonicalUnit = kind === 'protein24h' ? 'mg/day' : 'mg/mmol'
  return `${label} ${formatValue(value)} ${canonicalUnit}${reported} [${sourceLabel}]`
}

export function getUrineProteinSummaryItems(urineProtein) {
  const current = sanitizeUrineProteinProfile(urineProtein)
  return uniqueList([
    formatMeasurementSummary('acr', current.acr),
    formatMeasurementSummary('pcr', current.pcr),
    formatMeasurementSummary('protein24h', current.protein24h),
    ...current.assumptions,
  ])
}

export function formatUrineProteinContextForPrompt(urineProtein) {
  const items = getUrineProteinSummaryItems(urineProtein)
  if (!items.length) return ''
  return items.map((item) => `- ${item}`).join('\n')
}
