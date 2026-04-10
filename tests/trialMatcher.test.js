import assert from 'node:assert/strict'
import test from 'node:test'

import { matchTrialToPatient, rankTrialMatches } from '../lib/trialMatcher.js'

const baseTrial = {
  _id: 'trial-1',
  title: 'Stage 4 CKD Diabetes Study',
  slug: 'stage-4-ckd-diabetes-study',
  status: 'recruiting',
  prescreen: {
    enabled: true,
    screeningSummary: 'Adults with stage 4 CKD, diabetes, and reduced eGFR.',
    sexAllowed: 'all',
    minimumAgeYears: 18,
    maximumAgeYears: 80,
    populationTags: ['chronic_kidney_disease'],
    ckdStages: ['stage4'],
    dialysisStatus: 'not_on_dialysis',
    transplantStatus: 'not_applicable',
    diabetesRequirement: 'required',
    egfrMin: 15,
    egfrMax: 30,
    requiresAlbuminuria: false,
    requiresProteinuria: false,
    exclusionTags: [],
    mustAsk: ['ageYears', 'ckdStage', 'dialysisStatus', 'hasDiabetes', 'egfr'],
    optionalQuestions: [],
  },
}

test('returns a strong match when hard requirements align', () => {
  const result = matchTrialToPatient(baseTrial, {
    ageYears: 58,
    populationTags: ['chronic_kidney_disease'],
    ckdStage: 'stage4',
    dialysisStatus: 'not_on_dialysis',
    hasDiabetes: true,
    egfr: 24,
  })

  assert.equal(result.decision, 'match')
  assert.equal(result.mismatchReasons.length, 0)
  assert.ok(result.matchedReasons.length >= 4)
})

test('returns unlikely when a hard mismatch is present', () => {
  const result = matchTrialToPatient(baseTrial, {
    ageYears: 58,
    populationTags: ['chronic_kidney_disease'],
    ckdStage: 'stage4',
    dialysisStatus: 'hemodialysis',
    hasDiabetes: true,
    egfr: 24,
  })

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((reason) => reason.includes('Dialysis')))
})

test('returns insufficient_info when must-ask fields are missing', () => {
  const result = matchTrialToPatient(baseTrial, {
    populationTags: ['chronic_kidney_disease'],
    ckdStage: 'stage4',
  })

  assert.equal(result.decision, 'insufficient_info')
  assert.ok(result.missingReasons.some((reason) => reason.includes('Age')))
  assert.ok(result.missingReasons.some((reason) => reason.includes('eGFR')))
})

test('requires exclusion screening when exclusion tags are marked must-ask', () => {
  const result = matchTrialToPatient(
    {
      ...baseTrial,
      prescreen: {
        ...baseTrial.prescreen,
        minimumAgeYears: null,
        maximumAgeYears: null,
        ckdStages: [],
        dialysisStatus: 'not_applicable',
        diabetesRequirement: 'not_applicable',
        egfrMin: null,
        egfrMax: null,
        mustAsk: ['populationTags', 'exclusionTags'],
        exclusionTags: ['pregnancy'],
      },
    },
    {
      populationTags: ['chronic_kidney_disease'],
    }
  )

  assert.equal(result.decision, 'insufficient_info')
  assert.ok(result.missingReasons.some((reason) => reason.includes('Major exclusion factors')))
})

test('keeps studies in the assistant even when structured criteria are still blank', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-blank',
      title: 'General Kidney Study',
      slug: 'general-kidney-study',
      status: 'recruiting',
      prescreen: {
        screeningSummary: 'Broad kidney study with matching details still under review.',
      },
    },
    {
      ageYears: 54,
      populationTags: ['chronic_kidney_disease'],
    }
  )

  assert.equal(result.decision, 'insufficient_info')
  assert.equal(result.missingReasons.length, 0)
})

test('returns unlikely from title text when prescreen is blank but study clearly targets FSGS/MCD (IgA patient)', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-result',
      title:
        'A Study to Evaluate Frexalimab in Participants With Primary Focal Segmental Glomerulosclerosis or Minimal Change Disease (RESULT)',
      slug: 'result',
      status: 'recruiting',
      laySummary: 'Umbrella study in primary FSGS or MCD.',
      prescreen: {
        screeningSummary: '',
      },
    },
    {
      ageYears: 25,
      sex: 'female',
      populationTags: ['iga_nephropathy', 'chronic_kidney_disease', 'glomerular_disease'],
      ckdStage: 'stage3',
      dialysisStatus: 'not_on_dialysis',
      transplantStatus: 'no_transplant',
      hasDiabetes: false,
      egfr: 35,
      hasAlbuminuria: true,
      hasProteinuria: true,
    }
  )

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((r) => r.includes('different kidney disease')))
})

test('returns unlikely from title text for IgA-specific study when diagnosis text says diabetic nephropathy', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-ican',
      title: 'Study of Ravulizumab in Immunoglobulin A Nephropathy (IgAN) (ICAN)',
      slug: 'ican',
      status: 'recruiting',
      laySummary: 'Study in participants with IgA nephropathy.',
      prescreen: {},
    },
    {
      ageYears: 62,
      diagnosis: 'diabetic nephropathy',
      hasDiabetes: true,
      egfr: 26,
    }
  )

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((r) => r.includes('different kidney disease')))
})

test('returns unlikely from title text for dialysis-focused study when patient is predialysis (eGFR, not on dialysis)', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-levil',
      title: 'An Extension to Assess the Effect of Expanded Dialysis on Patient Reported Symptoms Using LEVIL',
      slug: 'levil',
      status: 'recruiting',
      prescreen: {},
    },
    {
      ageYears: 29,
      sex: 'female',
      populationTags: ['iga_nephropathy', 'chronic_kidney_disease'],
      dialysisStatus: 'not_on_dialysis',
      transplantStatus: 'no_transplant',
      egfr: 45,
      hasAlbuminuria: true,
    }
  )

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((r) => r.includes('dialysis')))
})

test('returns unlikely from title text for dialysis-focused study when eGFR implies predialysis but dialysisStatus unset', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-levil-2',
      title: 'An Extension to Assess the Effect of Expanded Dialysis on Patient Reported Symptoms Using LEVIL',
      slug: 'levil',
      status: 'recruiting',
      prescreen: {},
    },
    {
      ageYears: 29,
      sex: 'female',
      populationTags: ['iga_nephropathy'],
      egfr: 45,
    }
  )

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((r) => r.includes('dialysis')))
})

test('returns unlikely from title text for transplant-only study when patient is not a transplant recipient', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-shamrock',
      title:
        'Efgartigimod in Kidney Transplant Recipients With Antibody-Mediated Rejection (AMR) (Shamrock)',
      slug: 'shamrock',
      status: 'recruiting',
      prescreen: {},
    },
    {
      ageYears: 25,
      populationTags: ['iga_nephropathy'],
      transplantStatus: 'no_transplant',
    }
  )

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((r) => r.includes('transplant')))
})

test('returns unlikely when disease-specific population tags do not overlap (IgA vs FSGS)', () => {
  const fsgsTrial = {
    _id: 'trial-fsgs',
    title: 'FSGS study',
    slug: 'fsgs-study',
    status: 'recruiting',
    prescreen: {
      screeningSummary: 'Primary FSGS or MCD.',
      sexAllowed: 'all',
      minimumAgeYears: 16,
      maximumAgeYears: 75,
      populationTags: ['fsgs_or_mcd'],
      ckdStages: [],
      dialysisStatus: 'not_applicable',
      transplantStatus: 'not_applicable',
      diabetesRequirement: 'not_applicable',
      egfrMin: null,
      egfrMax: null,
      requiresAlbuminuria: false,
      requiresProteinuria: false,
      exclusionTags: [],
      mustAsk: [],
      optionalQuestions: [],
    },
  }

  const result = matchTrialToPatient(fsgsTrial, {
    ageYears: 29,
    sex: 'female',
    populationTags: ['iga_nephropathy', 'glomerular_disease'],
    ckdStage: 'stage4',
    dialysisStatus: 'not_on_dialysis',
    transplantStatus: 'no_transplant',
    hasDiabetes: false,
    egfr: 29,
    hasProteinuria: true,
  })

  assert.equal(result.decision, 'unlikely')
  assert.ok(
    result.mismatchReasons.some(
      (reason) => reason.includes('Study population') || reason.includes('different kidney disease')
    )
  )
})

test('matches when patient and trial share a disease-specific population tag', () => {
  const igaTrial = {
    _id: 'trial-iga',
    title: 'IgA study',
    slug: 'iga-study',
    status: 'recruiting',
    prescreen: {
      screeningSummary: 'Primary IgAN.',
      sexAllowed: 'all',
      minimumAgeYears: 18,
      maximumAgeYears: 80,
      populationTags: ['iga_nephropathy', 'chronic_kidney_disease'],
      ckdStages: [],
      dialysisStatus: 'not_on_dialysis',
      transplantStatus: 'not_applicable',
      diabetesRequirement: 'excluded',
      egfrMin: 15,
      egfrMax: 45,
      requiresAlbuminuria: false,
      requiresProteinuria: false,
      exclusionTags: [],
      mustAsk: [],
      optionalQuestions: [],
    },
  }

  const result = matchTrialToPatient(igaTrial, {
    ageYears: 29,
    sex: 'female',
    populationTags: ['iga_nephropathy', 'chronic_kidney_disease'],
    ckdStage: 'stage4',
    dialysisStatus: 'not_on_dialysis',
    transplantStatus: 'no_transplant',
    hasDiabetes: false,
    egfr: 29,
    hasProteinuria: true,
  })

  assert.equal(result.decision, 'match')
  assert.ok(result.matchedReasons.some((r) => String(r).includes('IgA') || String(r).includes('iga')))
})

test('ranks stronger matches ahead of weaker ones', () => {
  const weakerTrial = {
    ...baseTrial,
    _id: 'trial-2',
    title: 'General CKD Registry',
    slug: 'general-ckd-registry',
    status: 'coming_soon',
    prescreen: {
      ...baseTrial.prescreen,
      ckdStages: [],
      dialysisStatus: 'not_applicable',
      diabetesRequirement: 'not_applicable',
      egfrMin: null,
      egfrMax: null,
      mustAsk: ['ageYears'],
    },
  }

  const ranked = rankTrialMatches([weakerTrial, baseTrial], {
    ageYears: 58,
    populationTags: ['chronic_kidney_disease'],
    ckdStage: 'stage4',
    dialysisStatus: 'not_on_dialysis',
    hasDiabetes: true,
    egfr: 24,
  })

  assert.equal(ranked[0]._id, 'trial-1')
  assert.equal(ranked[0].decision, 'match')
})
