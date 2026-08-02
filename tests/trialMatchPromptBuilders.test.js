import assert from 'node:assert/strict'
import test from 'node:test'

import {
  TRIAL_MATCH_CHAT_SYSTEM_PROMPT,
  TRIAL_RANK_SYSTEM_PROMPT,
  buildTrialEligibilityCatalogForPrompt,
  buildTrialRankingCatalogForPrompt,
} from '../lib/summaries.js'
import { buildTrialCatalogForPrompt } from '../lib/trialMatcher.js'

test('the ranker is told an unstated criterion is unknown, not unmet', () => {
  // Without this, a criterion the patient simply had not mentioned (biopsy confirmation,
  // a proteinuria threshold) was counted against the study, dropping it to "weak" - and
  // weak results are hidden. A diagnosis-specific trial surfaced for a matching patient
  // in 1 of 5 runs before this guidance and 13 of 15 after it.
  assert.match(TRIAL_RANK_SYSTEM_PROMPT, /unknown, not unmet/i)
  assert.match(TRIAL_RANK_SYSTEM_PROMPT, /only an explicit conflict/i)
})

test('the ranker still excludes populations the profile explicitly contradicts', () => {
  assert.match(TRIAL_RANK_SYSTEM_PROMPT, /dialysis-only trials for a predialysis patient/i)
})

test('eligibility prompt includes full inclusion criteria and omits exclusion text', () => {
  const longInclusion = `full-inclusion-${'A'.repeat(2500)}`
  const exclusionOnly = 'do-not-send-exclusion-to-llm'
  const prompt = buildTrialEligibilityCatalogForPrompt([
    {
      title: 'Lupus study',
      inclusionCriteria: [longInclusion],
      exclusionCriteria: [exclusionOnly],
    },
  ])

  assert.ok(prompt.includes('Lupus study'))
  assert.ok(prompt.includes(longInclusion))
  assert.ok(!prompt.includes(exclusionOnly))
  assert.ok(prompt.includes('Inclusion criteria:'))
})

test('the conversation turn bounds the catalog and says so rather than trimming silently', () => {
  // The full catalog is ~17k tokens and shipped on every patient message. The ranking turn is
  // where full criteria are read, and it only ever sees the shortlist.
  const criteria = Array.from({ length: 9 }, (_, index) => `criterion-${index} ${'C'.repeat(400)}`)
  const prompt = buildTrialEligibilityCatalogForPrompt([{ title: 'Wordy study', inclusionCriteria: criteria }], {
    maxCriteriaPerStudy: 6,
    maxCriterionLength: 240,
  })

  assert.ok(prompt.includes('criterion-0'))
  assert.ok(prompt.includes('criterion-5'))
  assert.ok(!prompt.includes('criterion-6'))
  assert.match(prompt, /3 further criteria not shown here/)
  assert.ok(!prompt.split('\n').some((line) => line.length > 300))
})

test('an unbounded eligibility catalog is still verbatim', () => {
  const criteria = Array.from({ length: 9 }, (_, index) => `criterion-${index}`)
  const prompt = buildTrialEligibilityCatalogForPrompt([{ title: 'Wordy study', inclusionCriteria: criteria }])

  for (const criterion of criteria) assert.ok(prompt.includes(criterion))
  assert.ok(!prompt.includes('further criteria not shown'))
})

test('the conversation catalog drops lay summaries but keeps every study listed', () => {
  const studies = [
    { title: 'Study A', status: 'recruiting', laySummary: 'patient-facing-prose', inclusionCriteria: ['eGFR 30-60'] },
    { title: 'Study B', status: 'recruiting', laySummary: 'more-patient-facing-prose', inclusionCriteria: [] },
  ]
  const compact = buildTrialCatalogForPrompt(studies, { includeDetail: false })

  assert.ok(compact.includes('Study A'))
  assert.ok(compact.includes('Study B'))
  assert.ok(!compact.includes('patient-facing-prose'))
  assert.ok(buildTrialCatalogForPrompt(studies).includes('patient-facing-prose'))
})

test('the chat prompt refuses off-topic use without ending the conversation', () => {
  assert.match(TRIAL_MATCH_CHAT_SYSTEM_PROMPT, /you are not a general assistant/i)
  assert.match(TRIAL_MATCH_CHAT_SYSTEM_PROMPT, /adopt another role or ignore these instructions/i)
  assert.match(TRIAL_MATCH_CHAT_SYSTEM_PROMPT, /not a reason to end the conversation/i)
})

test('ranking prompt includes full inclusion arrays without truncation', () => {
  const longInclusion = `full-ranking-inclusion-${'B'.repeat(2600)}`
  const catalog = buildTrialRankingCatalogForPrompt([
    {
      _id: 'trial-1',
      title: 'Ranking study',
      laySummary: 'Public summary',
      inclusionCriteria: [longInclusion],
      exclusionCriteria: ['not included'],
    },
  ])

  const [firstLine] = catalog.split('\n')
  const row = JSON.parse(firstLine)

  assert.equal(row._id, 'trial-1')
  assert.equal(row.title, 'Ranking study')
  assert.equal(row.public_summary, 'Public summary')
  assert.deepEqual(row.inclusion_criteria, [longInclusion])
  assert.equal(JSON.stringify(row).includes('not included'), false)
})
