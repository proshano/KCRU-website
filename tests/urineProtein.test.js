import assert from 'node:assert/strict'
import test from 'node:test'

import {
  convertUrineProteinRatio,
  convertTimedProteinExcretion,
  estimateMedianAcrMgPerMmolFromPcrMgPerMmol,
  estimateMedianPcrMgPerMmolFromAcrMgPerMmol,
  evaluateUrineProteinConstraints,
  extractUrineProteinConstraintsFromTexts,
  hasQuantitativeUrineProteinData,
  estimateProtein24hMgPerDayFromPcrMgPerMmol,
  estimatePcrMgPerMmolFromProtein24hMgPerDay,
  isQuantitativeUrineProteinUnavailable,
  parseUrineProteinProfileFromText,
  parseUrineProteinSignalsFromText,
} from '../lib/urineProtein.js'

test('parses unitless user ACR as Canadian mg/mmol and derives an estimated PCR', () => {
  const parsed = parseUrineProteinProfileFromText('IgAN, eGFR 42, ACR 20', {
    defaultUnit: 'mg_per_mmol',
  })

  assert.equal(parsed.acr.reportedValue, 20)
  assert.equal(parsed.acr.reportedUnit, 'mg_per_mmol')
  assert.equal(parsed.acr.source, 'reported')
  assert.equal(parsed.acr.valueMgPerMmol, 20)
  assert.equal(parsed.pcr.source, 'estimated_from_acr')
  assert.ok(parsed.pcr.valueMgPerMmol !== null)
  assert.ok(parsed.assumptions.some((item) => item.includes('Assumed ACR units were mg/mmol')))
})

test('converts common same-assay urine protein units exactly enough for matching', () => {
  assert.equal(convertUrineProteinRatio(200, 'mg_per_g', 'mg_per_mmol'), 22.6)
  assert.equal(convertUrineProteinRatio(1, 'g_per_g', 'mg_per_mmol'), 113)
  assert.equal(convertUrineProteinRatio(30, 'mg_per_mmol', 'mg_per_g'), 265.2)
  assert.equal(convertTimedProteinExcretion(1, 'g_per_day', 'mg_per_day'), 1000)
  assert.equal(convertTimedProteinExcretion(500, 'mg_per_day', 'g_per_day'), 0.5)
})

test('cross-assay estimation round-trips through the inverse helper', () => {
  const estimatedAcr = estimateMedianAcrMgPerMmolFromPcrMgPerMmol(113)
  const estimatedPcr = estimateMedianPcrMgPerMmolFromAcrMgPerMmol(estimatedAcr)

  assert.ok(estimatedAcr > 0)
  assert.ok(Math.abs(estimatedPcr - 113) < 0.5)
})

test('extracts ACR and PCR study thresholds from inclusion text', () => {
  const constraints = extractUrineProteinConstraintsFromTexts([
    'UACR at least 30 mg/mmol on screening.',
    'UPCR of 1.0 g/g or higher despite background RAAS blockade.',
  ])

  assert.equal(constraints.length, 2)
  assert.deepEqual(
    constraints.map((item) => item.kind).sort(),
    ['acr', 'pcr']
  )
  assert.equal(constraints.find((item) => item.kind === 'acr')?.minValue, 30)
  assert.equal(constraints.find((item) => item.kind === 'pcr')?.minValue, 113)
})

test('parses 24-hour urine protein and derives an estimated PCR', () => {
  const parsed = parseUrineProteinProfileFromText('Proteinuria 1.2 g/day', {
    defaultUnit: 'mg_per_mmol',
  })

  assert.equal(parsed.protein24h.reportedValue, 1.2)
  assert.equal(parsed.protein24h.reportedUnit, 'g_per_day')
  assert.equal(parsed.protein24h.valueMgPerDay, 1200)
  assert.equal(parsed.pcr.source, 'estimated_from_protein_24h')
  assert.equal(parsed.pcr.valueMgPerMmol, 120)
})

test('parses qualitative urine protein signals from text', () => {
  assert.deepEqual(parseUrineProteinSignalsFromText('The patient has nephrotic-range proteinuria.'), {
    hasAlbuminuria: null,
    hasProteinuria: true,
  })
  assert.deepEqual(parseUrineProteinSignalsFromText('There is no albuminuria.'), {
    hasAlbuminuria: false,
    hasProteinuria: null,
  })
})

test('extracts 24-hour protein thresholds from study text', () => {
  const constraints = extractUrineProteinConstraintsFromTexts([
    'Proteinuria greater than or equal to 1 g/day despite supportive care.',
    '24-hour urine protein less than or equal to 500 mg/day.',
  ])

  assert.equal(constraints.length, 2)
  assert.deepEqual(
    constraints.map((item) => item.kind),
    ['protein24h', 'protein24h']
  )
  assert.equal(constraints[0].minValue, 1000)
  assert.equal(constraints[0].canonicalUnit, 'mg/day')
  assert.equal(constraints[1].maxValue, 500)
})

test('timed protein and PCR approximations round-trip through the helper pair', () => {
  const estimatedProtein24h = estimateProtein24hMgPerDayFromPcrMgPerMmol(100)
  const estimatedPcr = estimatePcrMgPerMmolFromProtein24hMgPerDay(estimatedProtein24h)

  assert.equal(estimatedProtein24h, 1000)
  assert.equal(estimatedPcr, 100)
})

test('reports whether structured urine protein includes a quantitative value', () => {
  assert.equal(hasQuantitativeUrineProteinData(parseUrineProteinProfileFromText('proteinuria 1.2 g/day')), true)
  assert.equal(hasQuantitativeUrineProteinData(parseUrineProteinProfileFromText('proteinuria present')), false)
})

test('detects when a user says a quantitative urine protein value is unavailable', () => {
  assert.equal(isQuantitativeUrineProteinUnavailable("I don't know the ACR."), true)
  assert.equal(isQuantitativeUrineProteinUnavailable('UPCR not available right now.'), true)
  assert.equal(isQuantitativeUrineProteinUnavailable("I don't have the kidney biopsy report."), false)
})

test('near-threshold urine protein stays possible instead of becoming a hard mismatch', () => {
  const constraints = extractUrineProteinConstraintsFromTexts(['UACR at least 30 mg/mmol.'])
  const evaluation = evaluateUrineProteinConstraints(
    {
      urineProtein: parseUrineProteinProfileFromText('ACR 28 mg/mmol', {
        defaultUnit: 'mg_per_mmol',
      }),
    },
    constraints
  )

  assert.equal(evaluation.mismatchReasons.length, 0)
  assert.ok(evaluation.matchedReasons.some((reason) => reason.includes('close to the available value')))
  assert.ok(evaluation.missingReasons.some((reason) => reason.includes('close to a study threshold')))
})

test('clearly out-of-range urine protein can still drive a mismatch', () => {
  const constraints = extractUrineProteinConstraintsFromTexts(['UACR at least 30 mg/mmol.'])
  const evaluation = evaluateUrineProteinConstraints(
    {
      urineProtein: parseUrineProteinProfileFromText('ACR 1 mg/mmol', {
        defaultUnit: 'mg_per_mmol',
      }),
    },
    constraints
  )

  assert.ok(evaluation.mismatchReasons.some((reason) => reason.includes('substantially outside')))
  assert.equal(evaluation.missingReasons.length, 0)
})

test('near-threshold 24-hour protein also stays conservative', () => {
  const constraints = extractUrineProteinConstraintsFromTexts(['Proteinuria at least 1 g/day.'])
  const evaluation = evaluateUrineProteinConstraints(
    {
      urineProtein: parseUrineProteinProfileFromText('proteinuria 0.92 g/day', {
        defaultUnit: 'mg_per_mmol',
      }),
    },
    constraints
  )

  assert.equal(evaluation.mismatchReasons.length, 0)
  assert.ok(evaluation.missingReasons.some((reason) => reason.includes('study threshold')))
})

test('qualitative proteinuria keeps a thresholded study possible until a number is available', () => {
  const constraints = extractUrineProteinConstraintsFromTexts(['Proteinuria at least 1 g/day.'])
  const evaluation = evaluateUrineProteinConstraints(
    {
      hasProteinuria: true,
      urineProtein: parseUrineProteinProfileFromText('proteinuria present'),
    },
    constraints
  )

  assert.equal(evaluation.mismatchReasons.length, 0)
  assert.ok(evaluation.matchedReasons.some((reason) => reason.includes('reported qualitatively')))
  assert.ok(evaluation.missingReasons.some((reason) => reason.includes('quantitative urine protein value')))
})
