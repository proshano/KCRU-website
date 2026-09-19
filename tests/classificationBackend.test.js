import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyPublicationWithBackend } from '../lib/classificationBackend.js'

const publication = { title: 'T', abstract: 'A', laySummary: '' }
const chatResult = { topics: ['Hemodialysis'], studyDesign: ['Observational Study'], methodologicalFocus: [], exclude: false }
const jevResult = {
  topics: ['Peritoneal Dialysis'],
  studyDesign: [],
  methodologicalFocus: ['Survey Research'],
  exclude: false,
  transport: 'openrouter',
  model: 'typesafe/jev-1.13',
  probabilities: [{ axis: 'topics', tag: 'Peritoneal Dialysis', p: 0.9 }],
  thresholds: { topics: 0.5, studyDesign: 0.5, methodologicalFocus: 0.5, exclude: 0.5 },
}

test('chat backend delegates to the chat classifier and labels the result', async () => {
  const calls = []
  const result = await classifyPublicationWithBackend(publication, {
    backend: 'chat',
    provider: 'openrouter',
    chatClassify: async (pub, options) => {
      calls.push({ pub, options })
      return chatResult
    },
    jevClassify: async () => {
      throw new Error('should not run')
    },
  })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.provider, 'openrouter')
  assert.deepEqual(result, { ...chatResult, backend: 'chat' })
})

test('jev backend returns Jev tags with provider, model and probabilities', async () => {
  const seen = []
  const result = await classifyPublicationWithBackend(publication, {
    backend: 'jev',
    thresholds: { topics: 0.7 },
    classificationPrompt: 'prompt',
    chatClassify: async () => {
      throw new Error('should not run')
    },
    jevClassify: async (pub, options) => {
      seen.push(options)
      return jevResult
    },
  })
  assert.equal(seen[0].thresholds.topics, 0.7)
  assert.equal(seen[0].thresholds.studyDesign, 0.5)
  assert.equal(seen[0].classificationPrompt, 'prompt')
  assert.equal(result.backend, 'jev')
  assert.equal(result.provider, 'openrouter')
  assert.equal(result.model, 'typesafe/jev-1.13')
  assert.deepEqual(result.topics, ['Peritoneal Dialysis'])
  assert.equal(result.probabilities.length, 1)
})

test('jev backend falls back to the chat classifier and records why', async () => {
  const originalWarn = console.warn
  const warnings = []
  console.warn = (...args) => warnings.push(args)
  try {
    const result = await classifyPublicationWithBackend(publication, {
      backend: 'jev',
      meta: { pmid: '42' },
      chatClassify: async () => chatResult,
      jevClassify: async () => {
        throw new Error('endpoint down')
      },
    })
    assert.equal(result.backend, 'chat')
    assert.equal(result.fallbackFrom, 'jev')
    assert.equal(result.fallbackError, 'endpoint down')
    assert.deepEqual(result.topics, ['Hemodialysis'])
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0][1].pmid, '42')
  } finally {
    console.warn = originalWarn
  }
})

test('jev backend rethrows when fallback is disabled', async () => {
  await assert.rejects(
    classifyPublicationWithBackend(publication, {
      backend: 'jev',
      fallbackToChat: false,
      chatClassify: async () => chatResult,
      jevClassify: async () => {
        throw new Error('endpoint down')
      },
    }),
    /endpoint down/
  )
})
