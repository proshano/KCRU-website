import assert from 'node:assert/strict'
import test from 'node:test'

import { matchTrialToPatient, rankTrialMatches } from '../lib/trialMatcher.js'
import { parseUrineProteinProfileFromText } from '../lib/urineProtein.js'

const baseTrial = {
  _id: 'trial-1',
  title: 'Stage 4 CKD Diabetes Study',
  slug: 'stage-4-ckd-diabetes-study',
  status: 'recruiting',
  laySummary: 'Study for adults with stage 4 chronic kidney disease and diabetes.',
  inclusionCriteria: [
    'Adults with chronic kidney disease stage 4',
    'Type 2 diabetes',
    'eGFR 15 to 30 mL/min/1.73 m2',
    'Not receiving dialysis',
  ],
}

test('returns a match when study text aligns with the reported population', () => {
  const result = matchTrialToPatient(baseTrial, {
    populationTags: ['chronic_kidney_disease', 'diabetes'],
    hasDiabetes: true,
    egfr: 24,
  })

  assert.equal(result.decision, 'match')
  assert.equal(result.mismatchReasons.length, 0)
  assert.ok(result.matchedReasons.some((reason) => reason.includes('chronic kidney disease')))
})

test('returns possible when patient context exists but the study text is generic', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-generic',
      title: 'General Kidney Study',
      slug: 'general-kidney-study',
      status: 'recruiting',
      laySummary: 'General kidney outcomes study for adults.',
      inclusionCriteria: ['Adults with kidney disease'],
    },
    {
      ageYears: 54,
      egfr: 28,
    }
  )

  assert.equal(result.decision, 'possible')
  assert.equal(result.mismatchReasons.length, 0)
})

test('returns insufficient_info when the patient profile is still empty', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-blank',
      title: 'General Kidney Study',
      slug: 'general-kidney-study',
      status: 'recruiting',
      laySummary: 'Broad kidney study.',
      inclusionCriteria: ['Adults with kidney disease'],
    },
    {}
  )

  assert.equal(result.decision, 'insufficient_info')
  assert.equal(result.matchedReasons.length, 0)
})

test('returns unlikely from study text when the diagnosis clearly targets a different disease', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-result',
      title:
        'A Study to Evaluate Frexalimab in Participants With Primary Focal Segmental Glomerulosclerosis or Minimal Change Disease (RESULT)',
      slug: 'result',
      status: 'recruiting',
      laySummary: 'Umbrella study in primary FSGS or MCD.',
      inclusionCriteria: ['Participants with primary focal segmental glomerulosclerosis or minimal change disease'],
    },
    {
      ageYears: 25,
      sex: 'female',
      populationTags: ['iga_nephropathy', 'chronic_kidney_disease', 'glomerular_disease'],
      dialysisStatus: 'not_on_dialysis',
      transplantStatus: 'no_transplant',
      egfr: 35,
      hasProteinuria: true,
    }
  )

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((reason) => reason.includes('different kidney disease')))
})

test('returns unlikely for dialysis-focused study when the patient is predialysis', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-levil',
      title: 'An Extension to Assess the Effect of Expanded Dialysis on Patient Reported Symptoms Using LEVIL',
      slug: 'levil',
      status: 'recruiting',
      inclusionCriteria: ['Adults receiving dialysis'],
    },
    {
      ageYears: 29,
      sex: 'female',
      populationTags: ['iga_nephropathy'],
      dialysisStatus: 'not_on_dialysis',
      transplantStatus: 'no_transplant',
      egfr: 45,
    }
  )

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((reason) => reason.includes('dialysis')))
})

test('returns unlikely for transplant-only study when the patient is not a transplant recipient', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-shamrock',
      title: 'Efgartigimod in Kidney Transplant Recipients With Antibody-Mediated Rejection (AMR) (Shamrock)',
      slug: 'shamrock',
      status: 'recruiting',
      inclusionCriteria: ['Kidney transplant recipients with antibody-mediated rejection'],
    },
    {
      ageYears: 25,
      populationTags: ['iga_nephropathy'],
      transplantStatus: 'no_transplant',
    }
  )

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((reason) => reason.includes('transplant')))
})

test('returns unlikely when eGFR text criteria conflict with the reported eGFR', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-lupus-egfr',
      title: 'Lupus Nephritis eGFR Study',
      slug: 'lupus-egfr-study',
      status: 'recruiting',
      laySummary: 'Study in active lupus nephritis.',
      inclusionCriteria: [
        'Female participants with active lupus nephritis',
        'eGFR 20 to 60 mL/min/1.73 m2',
      ],
    },
    {
      ageYears: 34,
      sex: 'female',
      diagnosis: 'Lupus nephritis',
      egfr: 90,
    }
  )

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((reason) => reason.includes('eGFR')))
})

test('returns possible when diagnosis aligns but a required eGFR value is missing', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-lupus-missing-egfr',
      title: 'Lupus Nephritis eGFR Study',
      slug: 'lupus-missing-egfr-study',
      status: 'recruiting',
      laySummary: 'Study in active lupus nephritis.',
      inclusionCriteria: [
        'Female participants with active lupus nephritis',
        'eGFR 20 to 60 mL/min/1.73 m2',
      ],
    },
    {
      ageYears: 34,
      sex: 'female',
      diagnosis: 'Lupus nephritis',
    }
  )

  assert.equal(result.decision, 'possible')
  assert.ok(result.missingReasons.some((reason) => reason.includes('eGFR')))
})

test('keeps a study possible when reported ACR is near the trial threshold', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-acr-near',
      title: 'CKD Albuminuria Study',
      slug: 'ckd-albuminuria-study',
      status: 'recruiting',
      laySummary: 'Study in chronic kidney disease with albuminuria.',
      inclusionCriteria: [
        'Adults with chronic kidney disease',
        'UACR at least 30 mg/mmol',
        'eGFR 20 to 60 mL/min/1.73 m2',
      ],
    },
    {
      ageYears: 58,
      populationTags: ['chronic_kidney_disease'],
      egfr: 32,
      urineProtein: parseUrineProteinProfileFromText('ACR 28 mg/mmol', {
        defaultUnit: 'mg_per_mmol',
      }),
    }
  )

  assert.equal(result.decision, 'possible')
  assert.equal(result.mismatchReasons.length, 0)
  assert.ok(result.missingReasons.some((reason) => reason.includes('study threshold')))
})

test('returns unlikely when reported urine protein is clearly below a required threshold', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-acr-low',
      title: 'CKD Albuminuria Study',
      slug: 'ckd-albuminuria-study',
      status: 'recruiting',
      laySummary: 'Study in chronic kidney disease with albuminuria.',
      inclusionCriteria: [
        'Adults with chronic kidney disease',
        'UACR at least 30 mg/mmol',
        'eGFR 20 to 60 mL/min/1.73 m2',
      ],
    },
    {
      ageYears: 58,
      populationTags: ['chronic_kidney_disease'],
      egfr: 32,
      urineProtein: parseUrineProteinProfileFromText('ACR 1 mg/mmol', {
        defaultUnit: 'mg_per_mmol',
      }),
    }
  )

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((reason) => reason.includes('urine protein threshold')))
})

test('supports timed proteinuria study thresholds conservatively', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-protein-day-near',
      title: 'Glomerular Disease Proteinuria Study',
      slug: 'glomerular-proteinuria-study',
      status: 'recruiting',
      laySummary: 'Study in glomerular disease with persistent proteinuria.',
      inclusionCriteria: [
        'Adults with glomerular disease',
        'Proteinuria greater than or equal to 1 g/day',
      ],
    },
    {
      ageYears: 42,
      populationTags: ['glomerular_disease'],
      urineProtein: parseUrineProteinProfileFromText('proteinuria 0.92 g/day', {
        defaultUnit: 'mg_per_mmol',
      }),
    }
  )

  assert.equal(result.decision, 'possible')
  assert.equal(result.mismatchReasons.length, 0)
  assert.ok(result.missingReasons.some((reason) => reason.includes('study threshold')))
})

test('can compare a timed protein threshold against an estimated value from ACR', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-protein-day-estimated',
      title: 'Glomerular Disease Proteinuria Study',
      slug: 'glomerular-proteinuria-study',
      status: 'recruiting',
      laySummary: 'Study in glomerular disease with persistent proteinuria.',
      inclusionCriteria: [
        'Adults with glomerular disease',
        'Proteinuria greater than or equal to 1 g/day',
      ],
    },
    {
      ageYears: 42,
      populationTags: ['glomerular_disease'],
      urineProtein: parseUrineProteinProfileFromText('ACR 120 mg/mmol', {
        defaultUnit: 'mg_per_mmol',
      }),
    }
  )

  assert.notEqual(result.decision, 'unlikely')
})

test('keeps a thresholded study possible when proteinuria is only reported qualitatively', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-protein-qualitative',
      title: 'Glomerular Disease Proteinuria Study',
      slug: 'glomerular-proteinuria-study',
      status: 'recruiting',
      laySummary: 'Study in glomerular disease with persistent proteinuria.',
      inclusionCriteria: [
        'Adults with glomerular disease',
        'Proteinuria greater than or equal to 1 g/day',
      ],
    },
    {
      ageYears: 42,
      populationTags: ['glomerular_disease'],
      hasProteinuria: true,
      urineProtein: parseUrineProteinProfileFromText('proteinuria present'),
    }
  )

  assert.equal(result.decision, 'possible')
  assert.equal(result.mismatchReasons.length, 0)
  assert.ok(result.missingReasons.some((reason) => reason.includes('quantitative urine protein value')))
})

test('returns unlikely when a study requires proteinuria but the user reports none', () => {
  const result = matchTrialToPatient(
    {
      _id: 'trial-protein-none',
      title: 'Glomerular Disease Proteinuria Study',
      slug: 'glomerular-proteinuria-study',
      status: 'recruiting',
      laySummary: 'Study in glomerular disease with persistent proteinuria.',
      inclusionCriteria: [
        'Adults with glomerular disease',
        'Proteinuria greater than or equal to 1 g/day',
      ],
    },
    {
      ageYears: 42,
      populationTags: ['glomerular_disease'],
      hasProteinuria: false,
      urineProtein: parseUrineProteinProfileFromText('no proteinuria'),
    }
  )

  assert.equal(result.decision, 'unlikely')
  assert.ok(result.mismatchReasons.some((reason) => reason.includes('no albuminuria/proteinuria')))
})

test('ranks stronger text matches ahead of broader studies', () => {
  const strongerTrial = {
    _id: 'trial-iga',
    title: 'Study of Ravulizumab in Immunoglobulin A Nephropathy (IgAN)',
    slug: 'iga-study',
    status: 'recruiting',
    laySummary: 'Study in participants with IgA nephropathy.',
    inclusionCriteria: ['Adults with biopsy-proven IgA nephropathy'],
  }

  const broaderTrial = {
    ...baseTrial,
    _id: 'trial-2',
    title: 'General CKD Registry',
    slug: 'general-ckd-registry',
    status: 'coming_soon',
    laySummary: 'Registry for adults with chronic kidney disease.',
    inclusionCriteria: ['Adults with chronic kidney disease'],
  }

  const ranked = rankTrialMatches([broaderTrial, strongerTrial], {
    ageYears: 29,
    sex: 'female',
    populationTags: ['iga_nephropathy', 'chronic_kidney_disease'],
    diagnosis: 'IgA nephropathy',
    dialysisStatus: 'not_on_dialysis',
    egfr: 29,
  })

  assert.equal(ranked[0]._id, 'trial-iga')
  assert.equal(ranked[0].decision, 'match')
})
