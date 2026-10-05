import assert from 'node:assert/strict'
import test from 'node:test'

import { generateTrialMatchStudyRanking } from '../lib/summaries.js'
import {
  MAX_LLM_RANK_STUDIES,
  NO_RESULTS_REPLY,
  RESULTS_READY_REPLY,
  buildLlmRankingShortlist,
  buildRankingPendingReply,
  describeRankingOutcome,
  rankStudiesForProfile,
  sliceRankedTrialMatches,
} from '../lib/trialMatchRanking.js'

function buildStudy(index, overrides = {}) {
  return {
    _id: `study-${index}`,
    title: `Study ${index}`,
    slug: `study-${index}`,
    status: 'recruiting',
    laySummary: 'A kidney study.',
    inclusionCriteria: ['Adults with chronic kidney disease'],
    ...overrides,
  }
}

function openRouterResponse(rankings) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ rankings }) }, finish_reason: 'stop' }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

async function withStubbedFetch(stub, run) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = stub
  try {
    return await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

test('the interim reply lists what the profile holds, once each, reported values only', () => {
  const reply = buildRankingPendingReply({
    ageYears: 58,
    sex: 'male',
    diagnosis: 'IgA nephropathy',
    populationTags: ['iga_nephropathy'],
    egfr: 45,
    dialysisStatus: 'not_on_dialysis',
    hasAlbuminuria: true,
    urineProtein: {
      acr: { valueMgPerMmol: 90, reportedValue: 90, reportedUnit: 'mg_per_mmol', source: 'reported' },
      pcr: { valueMgPerMmol: 123.8, reportedValue: null, reportedUnit: null, source: 'estimated_from_acr' },
    },
  })

  assert.equal(
    reply,
    'Checking the recruiting studies for: Age 58, Male, IgA nephropathy, Not on dialysis, eGFR 45, ACR 90 mg/mmol.'
  )
})

test('the interim reply falls back to the qualitative urine protein flags', () => {
  const reply = buildRankingPendingReply({ diagnosis: 'lupus nephritis', egfr: 60, hasProteinuria: true })
  assert.equal(reply, 'Checking the recruiting studies for: lupus nephritis, eGFR 60, Proteinuria: Yes.')
})

test('an empty profile still gets a usable interim reply', () => {
  assert.equal(buildRankingPendingReply({}), 'Checking the recruiting studies now.')
})

test('the results reply and completion flag follow the result count', () => {
  assert.deepEqual(describeRankingOutcome([]), {
    results: [],
    reply: NO_RESULTS_REPLY,
    conversationComplete: false,
  })
  const results = [{ _id: 'study-1', decision: 'possible' }]
  assert.deepEqual(describeRankingOutcome(results), {
    results,
    reply: RESULTS_READY_REPLY,
    conversationComplete: true,
  })
})

test('insufficient_info rows are capped when stronger candidates exist', () => {
  const ranked = [
    { _id: 'a', decision: 'match' },
    { _id: 'b', decision: 'insufficient_info' },
    { _id: 'c', decision: 'insufficient_info' },
    { _id: 'd', decision: 'insufficient_info' },
    { _id: 'e', decision: 'possible' },
  ]
  assert.deepEqual(
    sliceRankedTrialMatches(ranked).map((row) => row._id),
    ['a', 'b', 'c', 'e']
  )
  const onlyInsufficient = ranked.filter((row) => row.decision === 'insufficient_info')
  assert.equal(sliceRankedTrialMatches(onlyInsufficient).length, 3)
})

test('the LLM shortlist is bounded and keeps every recruiting study eligible', () => {
  const studies = Array.from({ length: 20 }, (_, index) => buildStudy(index + 1))
  const shortlist = buildLlmRankingShortlist(studies, { diagnosis: 'IgA nephropathy', egfr: 45 }, [
    { role: 'user', content: 'IgA nephropathy, eGFR 45' },
  ])
  assert.equal(shortlist.length, MAX_LLM_RANK_STUDIES)
  assert.ok(shortlist.every((study) => studies.includes(study)))
})

test('the ranking prompt uses short aliases and maps them back, dropping repeats', async () => {
  const studies = [buildStudy(1), buildStudy(2), buildStudy(3)]
  let requestBody = null

  const results = await withStubbedFetch(
    async (url, init) => {
      requestBody = JSON.parse(init.body)
      return openRouterResponse([
        { study_id: 'S2', relevance: 'strong', one_line_reason: 'Targets the diagnosis.' },
        { study_id: 'S2', relevance: 'possible', one_line_reason: 'Listed again.' },
        { study_id: studies[0]._id, relevance: 'possible', one_line_reason: 'Real id still accepted.' },
        { study_id: 'S9', relevance: 'strong', one_line_reason: 'Unknown alias.' },
        { study_id: 'S3', relevance: 'weak', one_line_reason: 'Weak rows are hidden.' },
      ])
    },
    () =>
      generateTrialMatchStudyRanking(
        { profile: { diagnosis: 'IgA nephropathy', egfr: 45 }, studies },
        { provider: 'openrouter', model: 'openai/gpt-6-luna', apiKey: 'test-key' }
      )
  )

  const userPrompt = requestBody.messages.at(-1).content
  assert.match(userPrompt, /"_id":"S1"/)
  assert.match(userPrompt, /"_id":"S3"/)
  assert.equal(userPrompt.includes(studies[0]._id), false, 'the Sanity id is not sent to the model')
  assert.match(userPrompt, /under 20 words/)

  assert.deepEqual(
    results.map((row) => [row._id, row.decision, row.matchedReasons[0]]),
    [
      ['study-2', 'match', 'Targets the diagnosis.'],
      ['study-1', 'possible', 'Real id still accepted.'],
    ]
  )
})

test('ranking falls back to the rule-based list when the LLM call fails', async () => {
  const studies = [
    buildStudy(1, { title: 'IgA nephropathy study', inclusionCriteria: ['Biopsy-proven IgA nephropathy'] }),
    buildStudy(2, { title: 'Dialysis study', inclusionCriteria: ['Receiving maintenance hemodialysis'] }),
  ]

  const results = await withStubbedFetch(
    async () => {
      throw new Error('network down')
    },
    () =>
      rankStudiesForProfile({
        studies,
        profile: { diagnosis: 'IgA nephropathy', egfr: 45, dialysisStatus: 'not_on_dialysis' },
        messages: [{ role: 'user', content: 'IgA nephropathy, eGFR 45' }],
        llmOptions: { provider: 'openrouter', model: 'openai/gpt-6-luna', apiKey: 'test-key' },
      })
  )

  assert.ok(results.length >= 1)
  assert.equal(results[0]._id, 'study-1')
  assert.ok(results.every((row) => row.decision !== 'unlikely' || row._id !== 'study-1'))
})
