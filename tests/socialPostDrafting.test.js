import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_X_INTRO, X_MAX_WEIGHTED_LENGTH, xWeightedLength } from '../lib/socialPosting.js'
import {
  SOCIAL_POST_BODY_MAX_LENGTH,
  SOCIAL_POST_SHORTER_BODY_MAX_LENGTH,
  composeSocialPostDraft,
} from '../lib/socialPostDrafting.js'
import {
  REASONING_TOKEN_HEADROOM,
  SOCIAL_POST_REASONING,
  cleanSocialPostText,
  generateSocialPostText,
} from '../lib/summaries.js'

const LINK = 'https://doi.org/10.1000/xyz'
const POST = {
  title: 'Kidney function after major surgery',
  link: LINK,
  journal: 'Kidney Journal',
  laySummary: 'This study followed people after surgery to see how their kidney function changed.',
  teamMembers: ['Jane Smith', 'Raj Patel'],
}

function fakeGenerate(...responses) {
  const calls = []
  const generate = async (input) => {
    calls.push(input)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next
  }
  return { calls, generate }
}

test('a successful AI draft is the generated text plus the paper link', async () => {
  const { calls, generate } = fakeGenerate('  New in Kidney Journal: how kidney function changes after surgery.  ')
  const draft = await composeSocialPostDraft({ post: POST, siteTitle: 'KCRU', generate, llmLabel: 'llm:test-model' })
  assert.deepEqual(draft, {
    text: `New in Kidney Journal: how kidney function changes after surgery. ${LINK}`,
    generatedBy: 'llm:test-model',
  })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    title: POST.title,
    laySummary: POST.laySummary,
    journal: 'Kidney Journal',
    teamMembers: ['Jane Smith', 'Raj Patel'],
    siteTitle: 'KCRU',
    maxLength: SOCIAL_POST_BODY_MAX_LENGTH,
  })
})

test('the template is used when the LLM returns nothing, fails, or is unavailable', async () => {
  const template = `${DEFAULT_X_INTRO} ${POST.title} ${LINK}`
  for (const response of [null, '', '   ', new Error('provider down')]) {
    const { calls, generate } = fakeGenerate(response)
    const draft = await composeSocialPostDraft({ post: POST, generate, llmLabel: 'llm:test-model' })
    assert.deepEqual(draft, { text: template, generatedBy: 'template' })
    assert.equal(calls.length, 1)
  }
  assert.deepEqual(await composeSocialPostDraft({ post: POST, intro: 'Fresh from KCRU:', generate: null }), {
    text: `Fresh from KCRU: ${POST.title} ${LINK}`,
    generatedBy: 'template',
  })
})

test('a draft that is too long is retried once with a shorter limit', async () => {
  const tooLong = 'word '.repeat(60).trim()
  const { calls, generate } = fakeGenerate(tooLong, 'A shorter post about kidney function after surgery.')
  const draft = await composeSocialPostDraft({ post: POST, generate, llmLabel: 'llm:test-model' })
  assert.equal(draft.text, `A shorter post about kidney function after surgery. ${LINK}`)
  assert.equal(draft.generatedBy, 'llm:test-model')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].maxLength, SOCIAL_POST_SHORTER_BODY_MAX_LENGTH)
  assert.equal(calls[1].previousText, tooLong)
})

test('a draft that is still too long after the retry falls back to the template', async () => {
  const tooLong = 'word '.repeat(60).trim()
  const { calls, generate } = fakeGenerate(tooLong, tooLong)
  const draft = await composeSocialPostDraft({ post: POST, generate, llmLabel: 'llm:test-model' })
  assert.equal(draft.generatedBy, 'template')
  assert.equal(draft.text, `${DEFAULT_X_INTRO} ${POST.title} ${LINK}`)
  assert.ok(xWeightedLength(draft.text) <= X_MAX_WEIGHTED_LENGTH)
  assert.equal(calls.length, 2)
})

test('cleanSocialPostText strips links, labels, fences and wrapping quotes', () => {
  assert.equal(cleanSocialPostText(`"Our new paper looks at kidney health. ${LINK}"`), 'Our new paper looks at kidney health.')
  assert.equal(cleanSocialPostText('Post: Kidney health\n after surgery'), 'Kidney health after surgery')
  assert.equal(cleanSocialPostText('```\nKidney health\n```'), 'Kidney health')
  assert.equal(cleanSocialPostText('   '), null)
  assert.equal(cleanSocialPostText(null), null)
})

function openRouterResponse(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

test('generateSocialPostText asks OpenRouter with low reasoning and room for it, and returns the body without a link', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    return openRouterResponse(`New in Kidney Journal: kidney function after surgery. ${LINK}`)
  }
  try {
    const text = await generateSocialPostText(
      { ...POST, siteTitle: 'KCRU', maxLength: 200, previousText: 'An earlier draft that was too long.' },
      { provider: 'openrouter', model: 'openai/gpt-5.6-luna', apiKey: 'test-key', debug: false }
    )
    assert.equal(text, 'New in Kidney Journal: kidney function after surgery.')
    assert.equal(requests.length, 1)
    const { body } = requests[0]
    assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.deepEqual(body.reasoning, SOCIAL_POST_REASONING)
    assert.ok(body.max_tokens >= 800 + REASONING_TOKEN_HEADROOM)
    assert.equal(body.temperature, 0.4)
    const system = body.messages[0].content
    assert.match(system, /kidney clinical research unit/)
    assert.match(system, /240 characters/)
    assert.match(system, /hashtags/)
    const prompt = body.messages[1].content
    assert.match(prompt, /Account: KCRU/)
    assert.match(prompt, /Journal: Kidney Journal/)
    assert.match(prompt, /Jane Smith, Raj Patel/)
    assert.match(prompt, /followed people after surgery/)
    assert.match(prompt, /An earlier draft that was too long/)
    assert.match(prompt, /at most 200 characters/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('generateSocialPostText returns null on a failed request, empty output or missing input', async () => {
  const originalFetch = globalThis.fetch
  const originalError = console.error
  console.error = () => {}
  try {
    globalThis.fetch = async () => new Response('upstream error', { status: 500 })
    assert.equal(await generateSocialPostText(POST, { provider: 'openrouter', model: 'openai/gpt-5.6-luna', apiKey: 'k' }), null)

    globalThis.fetch = async () => openRouterResponse('')
    assert.equal(await generateSocialPostText(POST, { provider: 'openrouter', model: 'openai/gpt-5.6-luna', apiKey: 'k' }), null)

    assert.equal(await generateSocialPostText({}, { provider: 'openrouter', apiKey: 'k' }), null)
    assert.equal(await generateSocialPostText(POST, { provider: 'not-a-provider', apiKey: 'k' }), null)
  } finally {
    globalThis.fetch = originalFetch
    console.error = originalError
  }
})
