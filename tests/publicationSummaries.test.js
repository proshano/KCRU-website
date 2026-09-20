import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOpenRouterAttributionHeaders,
  createPublicationPageTranscriber,
  generateLaySummary,
  normalizePublicationLaySummary,
  normalizePublicationSummaryPayload,
  transcribePublicationPageImage,
} from '../lib/summaries.js'

test('OpenRouter usage is attributed to the configured site', () => {
  const headers = buildOpenRouterAttributionHeaders('https://londonkidney.ca')
  assert.equal(headers['HTTP-Referer'], 'https://londonkidney.ca')
  assert.equal(headers['X-Title'], 'Research Unit Publications')
})

test('an unset site URL leaves usage unattributed rather than claiming localhost', () => {
  for (const value of [undefined, null, '', '   ']) {
    const headers = buildOpenRouterAttributionHeaders(value)
    assert.equal('HTTP-Referer' in headers, false, `expected no referer for ${JSON.stringify(value)}`)
    assert.equal(headers['X-Title'], 'Research Unit Publications')
  }
})

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

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
}

test('transcribePublicationPageImage sends the page image to the chat model and returns its text', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    return jsonResponse({
      choices: [{
        message: {
          content: '```\nAn impressive start.\n\nThis edition of the journal includes a position statement.\n```',
        },
      }],
    })
  }

  try {
    const text = await transcribePublicationPageImage(
      { image: imageBytes, mimeType: 'image/jpeg', title: 'An impressive start' },
      { provider: 'openrouter', model: 'openai/gpt-5.6-luna', apiKey: 'test-key', debug: false, retryAttempts: 0 }
    )

    assert.equal(text, 'An impressive start. This edition of the journal includes a position statement.')
    assert.equal(requests.length, 1)
    assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/chat/completions')

    const { body } = requests[0]
    assert.equal(body.model, 'openai/gpt-5.6-luna')
    assert.deepEqual(body.reasoning, { effort: 'minimal', exclude: true })
    assert.equal(body.temperature, 0)

    const user = body.messages.find((message) => message.role === 'user')
    assert.ok(Array.isArray(user.content))
    const image = user.content.find((part) => part.type === 'image_url')
    assert.equal(image.image_url.url, `data:image/jpeg;base64,${imageBytes.toString('base64')}`)
    assert.match(user.content.find((part) => part.type === 'text').text, /An impressive start/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('transcribePublicationPageImage treats NO_TEXT and unsupported input as no transcription', async () => {
  const originalFetch = globalThis.fetch
  let requests = 0
  globalThis.fetch = async () => {
    requests += 1
    return jsonResponse({ choices: [{ message: { content: 'NO_TEXT' } }] })
  }

  try {
    const options = { provider: 'openrouter', apiKey: 'test-key', retryAttempts: 0, debug: false }
    assert.equal(await transcribePublicationPageImage({ image: Buffer.from([1]), mimeType: 'image/png' }, options), null)
    assert.equal(requests, 1)

    assert.equal(await transcribePublicationPageImage({ image: Buffer.from([1]), mimeType: 'application/pdf' }, options), null)
    assert.equal(await transcribePublicationPageImage({ image: null, mimeType: 'image/png' }, options), null)
    assert.equal(await transcribePublicationPageImage({ image: Buffer.from([1]), mimeType: 'image/png' }, { ...options, provider: 'ollama' }), null)
    assert.equal(requests, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createPublicationPageTranscriber requires a credential for the configured provider', () => {
  const original = process.env.OPENROUTER_API_KEY
  delete process.env.OPENROUTER_API_KEY
  try {
    assert.equal(createPublicationPageTranscriber({ provider: 'openrouter' }), null)
    assert.equal(typeof createPublicationPageTranscriber({ provider: 'openrouter', apiKey: 'test-key' }), 'function')
    assert.equal(createPublicationPageTranscriber({ provider: 'ollama' }), null)
    assert.equal(createPublicationPageTranscriber({ provider: 'not-a-provider' }), null)
  } finally {
    if (original !== undefined) process.env.OPENROUTER_API_KEY = original
  }
})

test('generateLaySummary tells the model when its source text is only the first page', async () => {
  const originalFetch = globalThis.fetch
  const bodies = []
  globalThis.fetch = async (url, init) => {
    bodies.push(JSON.parse(init.body))
    return jsonResponse({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: 'This editorial welcomes a new position statement on measuring transfers from peritoneal dialysis to hemodialysis. It argues that shared definitions will let programs compare their performance.',
            topics: [],
            study_design: [],
            methodological_focus: [],
            exclude: false,
          }),
        },
      }],
    })
  }

  const readInput = (body) => {
    const prompt = body.messages.find((message) => message.role === 'user').content
    return JSON.parse(prompt.slice(prompt.indexOf('Input:') + 'Input:'.length).trim())
  }

  try {
    const pageText = 'This edition includes a position statement on tracking loss from peritoneal dialysis therapy. '.repeat(3)
    const baseOptions = { provider: 'openrouter', apiKey: 'test-key', retryAttempts: 0, debug: false, sourceTextType: 'article_body' }

    const result = await generateLaySummary('An impressive start', pageText, {
      ...baseOptions,
      sourceTextSource: 'publisher first page image',
    })
    assert.ok(result?.summary)
    const firstPageInput = readInput(bodies[0])
    assert.equal(firstPageInput.article_body, pageText)
    assert.match(firstPageInput.source_note, /first-page preview image/)

    await generateLaySummary('An impressive start', pageText, { ...baseOptions, sourceTextSource: 'publisher browser' })
    assert.equal(readInput(bodies[1]).source_note, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})
