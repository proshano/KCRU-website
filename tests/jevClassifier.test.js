import assert from 'node:assert/strict'
import test from 'node:test'

import { CLASSIFICATION_AXES } from '../lib/classificationTaxonomy.js'
import {
  buildJevQuestions,
  buildJevState,
  classifyPublicationWithJev,
  parseTaxonomyCriteria,
  probabilitiesFromAnswers,
} from '../lib/jevClassifier.js'
import { callJevSystemOne, describeJevConfig, resolveJevTransport } from '../lib/jevClient.js'

const ALL_TAGS = CLASSIFICATION_AXES.flatMap((axis) => axis.tags)

function withEnv(overrides, fn) {
  const saved = {}
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  try {
    const result = fn()
    if (result && typeof result.then === 'function') return result.finally(restore)
    restore()
    return result
  } catch (error) {
    restore()
    throw error
  }
}

const CLEAN_ENV = {
  TYPESAFE_API_KEY: undefined,
  OPENROUTER_API_KEY: undefined,
  JEV_TRANSPORT: undefined,
  JEV_MODEL: undefined,
  JEV_THRESHOLD_TOPICS: undefined,
  JEV_THRESHOLD_STUDY_DESIGN: undefined,
  JEV_THRESHOLD_METHODOLOGICAL_FOCUS: undefined,
  JEV_THRESHOLD_EXCLUDE: undefined,
}

test('the classification prompt yields criteria text for every canonical tag', () => {
  const criteria = parseTaxonomyCriteria()
  for (const tag of ALL_TAGS) {
    assert.ok(criteria.get(tag), `missing criteria for ${tag}`)
    assert.doesNotMatch(criteria.get(tag), /\*\*/, `markdown emphasis left in ${tag}`)
  }
  assert.match(criteria.get('Chronic Kidney Disease'), /Do NOT use if the study focuses on a specific cause/)
})

test('buildJevQuestions asks one noul question per tag plus the exclude question', () => {
  const { questions, index, missingCriteria } = buildJevQuestions()
  assert.deepEqual(missingCriteria, [])
  assert.equal(Object.keys(questions).length, ALL_TAGS.length + 1)
  for (const [name, question] of Object.entries(questions)) {
    assert.equal(question.type, 'noul')
    assert.ok(question.instructions.length > 20, `${name} has no instructions`)
    assert.ok(question.criteria.true && question.criteria.false, `${name} lacks criteria`)
    assert.ok(index[name], `${name} has no index entry`)
  }
  assert.deepEqual(index.exclude, { axis: 'exclude', tag: 'exclude' })
  assert.deepEqual(index.m_machine_learning_ai, { axis: 'methodologicalFocus', tag: 'Machine Learning / AI' })
  assert.match(questions.t_chronic_kidney_disease.criteria.true, /Do NOT use if the study focuses on a specific cause/)
})

test('buildJevState trims the abstract to the configured limit', () => {
  const { state, abstractTruncated, abstractLength } = buildJevState(
    { title: ' Title ', abstract: 'x'.repeat(120), laySummary: '' },
    { maxAbstractChars: 100 }
  )
  assert.equal(state.title, 'Title')
  assert.equal(state.lay_summary, null)
  assert.equal(abstractTruncated, true)
  assert.equal(abstractLength, 120)
  assert.equal(state.abstract.length, 101)
})

test('probabilitiesFromAnswers keeps question order and clamps values', () => {
  const rows = probabilitiesFromAnswers(
    { a: { type: 'noul', noul: 1.4 }, b: { type: 'noul', noul: 'nope' }, c: { type: 'noul', noul: 0.2 } },
    { a: { axis: 'topics', tag: 'A' }, b: { axis: 'topics', tag: 'B' }, c: { axis: 'exclude', tag: 'exclude' } }
  )
  assert.deepEqual(rows, [
    { axis: 'topics', tag: 'A', p: 1 },
    { axis: 'exclude', tag: 'exclude', p: 0.2 },
  ])
})

test('transport resolution prefers the TypeSafe key, then OpenRouter, and honours overrides', () => {
  withEnv({ ...CLEAN_ENV, TYPESAFE_API_KEY: 'ts', OPENROUTER_API_KEY: 'or' }, () => {
    assert.equal(resolveJevTransport(), 'typesafe')
    assert.equal(describeJevConfig().model, 'jev-latest')
  })
  withEnv({ ...CLEAN_ENV, OPENROUTER_API_KEY: 'or' }, () => {
    const config = describeJevConfig()
    assert.equal(config.transport, 'openrouter')
    assert.equal(config.model, 'typesafe/jev-1.13')
    assert.equal(config.hasApiKey, true)
  })
  withEnv({ ...CLEAN_ENV }, () => {
    assert.equal(describeJevConfig().hasApiKey, false)
    assert.throws(() => resolveJevTransport('bogus'), /Unknown Jev transport/)
  })
})

test('callJevSystemOne posts the SDK wire format and parses answers', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return new Response(
      JSON.stringify({ model: 'jev-1.13', answers: { q: { type: 'noul', noul: 0.91 } }, usage: { input_tokens: 12, output_tokens: 0 } }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )
  }
  await withEnv({ ...CLEAN_ENV, TYPESAFE_API_KEY: 'secret' }, async () => {
    const result = await callJevSystemOne(
      { state: { title: 'T' }, questions: { q: { type: 'noul', instructions: 'Q?' } } },
      { fetch: fetchImpl }
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.typesafe.ai/v1/systemone')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer secret')
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      model: 'jev-latest',
      state: { title: 'T' },
      questions: { q: { type: 'noul', instructions: 'Q?' } },
    })
    assert.equal(result.answers.q.noul, 0.91)
    assert.equal(result.usage.inputTokens, 12)
    assert.equal(result.model, 'jev-1.13')
    assert.equal(result.transport, 'typesafe')
  })
})

test('callJevSystemOne routes through OpenRouter decisions endpoint when selected', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ answers: { q: { type: 'noul', noul: 0.1 } } }), { status: 200 })
  }
  await withEnv({ ...CLEAN_ENV, OPENROUTER_API_KEY: 'or-key' }, async () => {
    const result = await callJevSystemOne({ state: 'x', questions: { q: { type: 'noul' } } }, { fetch: fetchImpl })
    assert.equal(calls[0].url, 'https://openrouter.ai/api/alpha/decisions')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer or-key')
    assert.equal(calls[0].init.headers['X-Title'], 'Research Unit Publications')
    assert.equal(JSON.parse(calls[0].init.body).model, 'typesafe/jev-1.13')
    assert.equal(result.transport, 'openrouter')
  })
})

test('callJevSystemOne fails clearly without a credential and does not retry client errors', async () => {
  await withEnv({ ...CLEAN_ENV }, async () => {
    await assert.rejects(
      callJevSystemOne({ state: 'x', questions: { q: { type: 'noul' } } }, { fetch: async () => new Response('{}') }),
      /Missing TYPESAFE_API_KEY/
    )
  })
  let attempts = 0
  await withEnv({ ...CLEAN_ENV, TYPESAFE_API_KEY: 'k' }, async () => {
    await assert.rejects(
      callJevSystemOne(
        { state: 'x', questions: { q: { type: 'noul' } } },
        {
          fetch: async () => {
            attempts += 1
            return new Response(JSON.stringify({ error: { message: 'bad question' } }), { status: 422 })
          },
        }
      ),
      /Jev request failed 422: bad question/
    )
  })
  assert.equal(attempts, 1)
})

test('classifyPublicationWithJev cuts probabilities at thresholds and applies precedence', async () => {
  const { index } = buildJevQuestions()
  const highTags = new Set(['Chronic Kidney Disease', 'Glomerular Disease', 'Observational Study', 'Survey Research'])
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body)
    const answers = {}
    for (const name of Object.keys(body.questions)) {
      const meta = index[name]
      answers[name] = { type: 'noul', noul: highTags.has(meta.tag) ? 0.9 : meta.tag === 'Administrative Data' ? 0.55 : 0.05 }
    }
    return new Response(JSON.stringify({ model: 'jev-1.13', answers, usage: { input_tokens: 5000, output_tokens: 0 } }), { status: 200 })
  }
  await withEnv({ ...CLEAN_ENV, TYPESAFE_API_KEY: 'k' }, async () => {
    const result = await classifyPublicationWithJev(
      { title: 'IgA nephropathy cohort', abstract: 'A survey of patients.', laySummary: '' },
      { fetch: fetchImpl, thresholds: { methodologicalFocus: 0.6 } }
    )
    assert.deepEqual(result.topics, ['Glomerular Disease'])
    assert.deepEqual(result.studyDesign, ['Observational Study'])
    // Survey Research clears 0.6; Administrative Data at 0.55 does not.
    assert.deepEqual(result.methodologicalFocus, ['Survey Research'])
    assert.equal(result.exclude, false)
    assert.equal(result.probabilities.length, Object.keys(index).length)
    assert.equal(result.thresholds.methodologicalFocus, 0.6)
    assert.equal(result.thresholds.topics, 0.5)
    assert.equal(result.usage.inputTokens, 5000)
    assert.equal(result.model, 'jev-1.13')
  })
})

test('classifyPublicationWithJev rejects an incomplete answer set', async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ answers: { exclude: { type: 'noul', noul: 0.01 } } }), { status: 200 })
  await withEnv({ ...CLEAN_ENV, TYPESAFE_API_KEY: 'k' }, async () => {
    await assert.rejects(
      classifyPublicationWithJev({ title: 'T', abstract: 'A' }, { fetch: fetchImpl, retries: 0 }),
      /Jev answered 1 of/
    )
  })
})
