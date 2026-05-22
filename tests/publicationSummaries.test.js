import assert from 'node:assert/strict'
import test from 'node:test'

import {
  generateLaySummary,
  normalizePublicationLaySummary,
  normalizePublicationSummaryPayload,
} from '../lib/summaries.js'

const TITLE = 'CRT-Estimands Framework'
const ABSTRACT = `${'This abstract describes a consensus framework for cluster randomized trials. '.repeat(8)}It reports recommendations for defining treatment effects.`

test('normalizes a full JSON publication summary before display', () => {
  const raw = JSON.stringify({
    summary: 'This paper introduces a framework for defining treatment effects in cluster randomized trials. It explains how researchers can describe those effects clearly for readers and trial teams.',
    topics: ['Research Ethics'],
    study_design: ['Narrative Review'],
    methodological_focus: ['Innovation in Study Design or Analysis'],
    exclude: false,
  })

  assert.equal(
    normalizePublicationLaySummary(TITLE, raw),
    'This paper introduces a framework for defining treatment effects in cluster randomized trials. It explains how researchers can describe those effects clearly for readers and trial teams.'
  )
})

test('unwraps a nested JSON object returned inside the summary field', () => {
  const nested = JSON.stringify({
    summary: 'This paper introduces a framework for defining treatment effects in cluster randomized trials. It aims to make trial results easier to interpret.',
    topics: [],
    study_design: [],
    methodological_focus: [],
    exclude: false,
  })
  const raw = JSON.stringify({
    summary: nested,
    topics: [],
    study_design: [],
    methodological_focus: [],
    exclude: false,
  })

  assert.equal(
    normalizePublicationLaySummary(TITLE, raw),
    'This paper introduces a framework for defining treatment effects in cluster randomized trials. It aims to make trial results easier to interpret.'
  )
})

test('recovers classification tags from JSON summary payloads', () => {
  const raw = JSON.stringify({
    summary: 'This paper introduces a framework for defining treatment effects in cluster randomized trials. It reports consensus guidance for trial teams.',
    topics: ['Research Ethics'],
    study_design: ['Clinical Practice Guideline'],
    methodological_focus: ['Consensus Methods', 'Innovation in Study Design or Analysis'],
    exclude: false,
  })

  const payload = normalizePublicationSummaryPayload(TITLE, raw)

  assert.equal(
    payload.summary,
    'This paper introduces a framework for defining treatment effects in cluster randomized trials. It reports consensus guidance for trial teams.'
  )
  assert.deepEqual(payload.topics, ['Research Ethics'])
  assert.deepEqual(payload.studyDesign, ['Clinical Practice Guideline'])
  assert.deepEqual(payload.methodologicalFocus, ['Consensus Methods', 'Innovation in Study Design or Analysis'])
})

test('does not treat incomplete JSON as summary prose', () => {
  assert.equal(
    normalizePublicationLaySummary(TITLE, '{"summary":"This paper introduces a framework'),
    null
  )
})

test('generateLaySummary unwraps Flash 3.5-style nested summary JSON', async () => {
  const originalFetch = globalThis.fetch
  const nested = JSON.stringify({
    summary: 'This paper introduces a framework for defining treatment effects in cluster randomized trials. It helps researchers describe results in a clearer way.',
    topics: ['Research Ethics'],
    study_design: ['Narrative Review'],
    methodological_focus: ['Innovation in Study Design or Analysis'],
    exclude: false,
  })

  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          summary: nested,
          topics: [],
          study_design: [],
          methodological_focus: [],
          exclude: false,
        }),
      },
    }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  try {
    const result = await generateLaySummary(TITLE, ABSTRACT, {
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
      apiKey: 'test-key',
      retryAttempts: 0,
      debug: false,
    })

    assert.equal(
      result.summary,
      'This paper introduces a framework for defining treatment effects in cluster randomized trials. It helps researchers describe results in a clearer way.'
    )
    assert.deepEqual(result.methodologicalFocus, ['Innovation in Study Design or Analysis'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
