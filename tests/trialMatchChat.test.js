import assert from 'node:assert/strict'
import test from 'node:test'

import {
  hasSingleTurnMatchReadyProfile,
  selectTrialMatchFollowUp,
  shouldAskUrineProteinFollowUp,
  shouldRankTrialMatches,
} from '../lib/trialMatchChat.js'
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
      readyForMatching: true,
      profile: {
        diagnosis: 'IgA nephropathy',
        egfr: 30,
      },
      userTurns: 1,
    }),
    true
  )
})

test('treats dialysis status as enough for a first-turn ranking', () => {
  assert.equal(
    shouldRankTrialMatches({
      readyForMatching: true,
      profile: {
        dialysisStatus: 'any_dialysis',
      },
      userTurns: 1,
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
      readyForMatching: false,
      profile: {
        egfr: 30,
        hasAlbuminuria: true,
      },
      userTurns: 1,
    }),
    false
  )
})

test('does not wait for the LLM ready flag when diagnosis and eGFR are already captured', () => {
  assert.equal(
    shouldRankTrialMatches({
      readyForMatching: false,
      profile: {
        diagnosis: 'IgA nephropathy',
        egfr: 30,
      },
      userTurns: 2,
    }),
    true
  )
})

test('still ranks on later turns with a meaningful profile', () => {
  assert.equal(
    shouldRankTrialMatches({
      readyForMatching: true,
      profile: {
        egfr: 30,
        hasAlbuminuria: true,
      },
      userTurns: 2,
    }),
    true
  )
})

test('forces ranking by the fifth user turn with a meaningful profile', () => {
  assert.equal(
    shouldRankTrialMatches({
      readyForMatching: false,
      profile: {
        diagnosis: 'IgA nephropathy',
        egfr: 30,
      },
      userTurns: 5,
      maxUserTurns: 5,
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

test('prioritizes renal status before urine protein when both are unresolved', () => {
  assert.equal(
    selectTrialMatchFollowUp({
      profile: {
        diagnosis: 'IgA nephropathy',
      },
      rankedResults: [
        {
          decision: 'possible',
          missingReasons: [
            'Study text includes an eGFR criterion, but eGFR is not yet known.',
            'Study text includes a urine protein criterion, but a comparable value is not yet known.',
          ],
        },
      ],
    }),
    'renal_status'
  )
})

test('can ask for urine protein after renal status was already asked once', () => {
  assert.equal(
    selectTrialMatchFollowUp({
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
      exhaustedFollowUps: new Set(['renal_status']),
    }),
    'urine_protein'
  )
})
