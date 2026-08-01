import assert from 'node:assert/strict'
import test from 'node:test'

import {
  TRIAL_RANK_SYSTEM_PROMPT,
  buildTrialEligibilityCatalogForPrompt,
  buildTrialRankingCatalogForPrompt,
} from '../lib/summaries.js'

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
