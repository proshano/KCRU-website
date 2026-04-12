import assert from 'node:assert/strict'
import test from 'node:test'

import { hasSingleTurnMatchReadyProfile, shouldAskUrineProteinFollowUp, shouldRankTrialMatches } from '../lib/trialMatchChat.js'
import { parseUrineProteinProfileFromText } from '../lib/urineProtein.js'

test('treats diagnosis plus eGFR as enough for a first-turn ranking', () => {
  assert.equal(
    hasSingleTurnMatchReadyProfile({
      diagnosis: 'IgA nephropathy',
      egfr: 30,
    }),
    true
  )

  assert.equal(
    shouldRankTrialMatches({
      profile: {
        diagnosis: 'IgA nephropathy',
        egfr: 30,
      },
      userTurns: 1,
      minUserTurns: 2,
    }),
    true
  )
})

test('treats dialysis status as enough for a first-turn ranking', () => {
  assert.equal(
    shouldRankTrialMatches({
      profile: {
        dialysisStatus: 'any_dialysis',
      },
      userTurns: 1,
      minUserTurns: 2,
    }),
    true
  )
})

test('does not rank on the first turn from lab details alone', () => {
  assert.equal(
    hasSingleTurnMatchReadyProfile({
      egfr: 30,
      hasAlbuminuria: true,
    }),
    false
  )

  assert.equal(
    shouldRankTrialMatches({
      readyForMatching: true,
      profile: {
        egfr: 30,
        hasAlbuminuria: true,
      },
      userTurns: 1,
      minUserTurns: 2,
    }),
    false
  )
})

test('keeps the urine-protein follow-up delay in place before the minimum turn count', () => {
  assert.equal(
    shouldRankTrialMatches({
      readyForMatching: true,
      profile: {
        diagnosis: 'IgA nephropathy',
        egfr: 30,
      },
      userTurns: 1,
      minUserTurns: 3,
      shouldDelayForUrineProteinFollowUp: true,
    }),
    false
  )
})

test('still ranks on later turns with a meaningful profile', () => {
  assert.equal(
    shouldRankTrialMatches({
      profile: {
        egfr: 30,
        hasAlbuminuria: true,
      },
      userTurns: 2,
      minUserTurns: 2,
    }),
    true
  )
})

test('asks for urine protein when a top likely study mainly needs that threshold value', () => {
  assert.equal(
    shouldAskUrineProteinFollowUp({
      profile: {
        diagnosis: 'IgA nephropathy',
        egfr: 30,
      },
      rankedResults: [
        {
          decision: 'possible',
          missingReasons: ['Study text includes a urine protein criterion, but a comparable value is not yet known.'],
        },
      ],
    }),
    true
  )
})

test('does not ask for urine protein when several other core facts are still missing', () => {
  assert.equal(
    shouldAskUrineProteinFollowUp({
      profile: {
        diagnosis: 'IgA nephropathy',
        egfr: 30,
      },
      rankedResults: [
        {
          decision: 'possible',
          missingReasons: [
            'Study text includes a urine protein criterion, but a comparable value is not yet known.',
            'Study text includes an age range, but age is not yet known.',
            'Study text targets transplant recipients, but transplant status is not yet known.',
          ],
        },
      ],
    }),
    false
  )
})

test('does not ask for urine protein when a quantitative value is already available', () => {
  assert.equal(
    shouldAskUrineProteinFollowUp({
      profile: {
        diagnosis: 'IgA nephropathy',
        egfr: 30,
        urineProtein: parseUrineProteinProfileFromText('ACR 65 mg/mmol', {
          defaultUnit: 'mg_per_mmol',
        }),
      },
      rankedResults: [
        {
          decision: 'possible',
          missingReasons: ['Study text includes a urine protein criterion, but a comparable value is not yet known.'],
        },
      ],
    }),
    false
  )
})
