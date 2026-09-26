import assert from 'node:assert/strict'
import test from 'node:test'

import { X_MAX_WEIGHTED_LENGTH, buildXPostText, xWeightedLength } from '../lib/socialPosting.js'
import {
  SOCIAL_POST_BODY_MAX_LENGTH,
  SOCIAL_POST_SHORTER_BODY_MAX_LENGTH,
  checkSocialPostBody,
  composeSocialPostDraft,
} from '../lib/socialPostDrafting.js'
import {
  REASONING_TOKEN_HEADROOM,
  SOCIAL_POST_REASONING,
  SOCIAL_POST_SYSTEM_PROMPT,
  buildSocialPostPrompt,
  cleanSocialPostText,
  createSocialPostGenerateFn,
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

test('a successful AI draft naming every investigator is the generated text plus the paper link', async () => {
  const body = 'London Kidney investigators Jane Smith and Raj Patel found how kidney function changes after major surgery.'
  const { calls, generate } = fakeGenerate(`  ${body}  `)
  const draft = await composeSocialPostDraft({ post: POST, teamLabel: 'KCRU', generate, llmLabel: 'llm:test-model' })
  assert.deepEqual(draft, { text: `${body} ${LINK}`, generatedBy: 'llm:test-model' })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], {
    title: POST.title,
    laySummary: POST.laySummary,
    teamMembers: ['Jane Smith', 'Raj Patel'],
    teamLabel: 'KCRU',
    hasOtherAuthors: null,
    maxLength: SOCIAL_POST_BODY_MAX_LENGTH,
  })
  assert.equal('journal' in calls[0], false)
  assert.equal('siteTitle' in calls[0], false)
})

test('a profile link given to composeSocialPostDraft replaces the paper link in the AI draft and the template', async () => {
  const profileLink = 'https://kcru.example.test/team/jane-smith#paper-doi-10-1000-xyz'
  const body = 'London Kidney investigators Jane Smith and Raj Patel found how kidney function changes after major surgery.'
  const { generate } = fakeGenerate(body)
  const draft = await composeSocialPostDraft({ post: POST, link: profileLink, generate, llmLabel: 'llm:test-model' })
  assert.deepEqual(draft, { text: `${body} ${profileLink}`, generatedBy: 'llm:test-model' })

  const template = await composeSocialPostDraft({ post: POST, link: profileLink, teamLabel: 'KCRU', generate: null })
  assert.deepEqual(template, {
    text: buildXPostText({ title: POST.title, link: profileLink, teamMembers: POST.teamMembers, teamLabel: 'KCRU' }),
    generatedBy: 'template',
  })
  assert.ok(template.text.endsWith(profileLink))
  assert.equal(template.text.includes(LINK), false)

  const { generate: failing } = fakeGenerate(null)
  const fallback = await composeSocialPostDraft({ post: POST, link: profileLink, generate: failing })
  assert.ok(fallback.text.endsWith(profileLink))

  // Without a link, or with a blank one, the paper link is used as before.
  const { generate: plain } = fakeGenerate(body)
  assert.equal((await composeSocialPostDraft({ post: POST, link: '  ', generate: plain })).text, `${body} ${LINK}`)
})

test('composeSocialPostDraft passes hasOtherAuthors from the record to generate on the first call and the retry', async () => {
  const withOthers = { ...POST, hasOtherAuthors: true }
  const { calls: firstCalls, generate: firstGenerate } = fakeGenerate('London Kidney investigators Jane Smith and Raj Patel and colleagues found something.')
  await composeSocialPostDraft({ post: withOthers, generate: firstGenerate, llmLabel: 'llm:test-model' })
  assert.equal(firstCalls[0].hasOtherAuthors, true)

  const withoutOthers = { ...POST, hasOtherAuthors: false }
  const { calls: falseCalls, generate: falseGenerate } = fakeGenerate('London Kidney investigators Jane Smith and Raj Patel found something.')
  await composeSocialPostDraft({ post: withoutOthers, generate: falseGenerate, llmLabel: 'llm:test-model' })
  assert.equal(falseCalls[0].hasOtherAuthors, false)

  const missingFlag = { ...POST }
  delete missingFlag.hasOtherAuthors
  const { calls: unsetCalls, generate: unsetGenerate } = fakeGenerate('London Kidney investigators Jane Smith and Raj Patel found something.')
  await composeSocialPostDraft({ post: missingFlag, generate: unsetGenerate, llmLabel: 'llm:test-model' })
  assert.equal(unsetCalls[0].hasOtherAuthors, null)

  const tooLong = `London Kidney investigators Jane Smith and Raj Patel found that ${'word '.repeat(50).trim()}`
  const short = 'London Kidney investigators Jane Smith and Raj Patel found a shorter post about kidney function after surgery.'
  const { calls: retryCalls, generate: retryGenerate } = fakeGenerate(tooLong, short)
  await composeSocialPostDraft({ post: withOthers, generate: retryGenerate, llmLabel: 'llm:test-model' })
  assert.equal(retryCalls.length, 2)
  assert.equal(retryCalls[0].hasOtherAuthors, true)
  assert.equal(retryCalls[1].hasOtherAuthors, true)
})

test('the template is used when the LLM returns nothing, fails, or is unavailable', async () => {
  const template = buildXPostText({ title: POST.title, link: LINK, teamMembers: POST.teamMembers })
  for (const response of [null, '', '   ', new Error('provider down')]) {
    const { calls, generate } = fakeGenerate(response)
    const draft = await composeSocialPostDraft({ post: POST, generate, llmLabel: 'llm:test-model' })
    assert.deepEqual(draft, { text: template, generatedBy: 'template' })
    assert.equal(calls.length, 1)
  }
  assert.deepEqual(await composeSocialPostDraft({ post: POST, teamLabel: 'KCRU', generate: null }), {
    text: buildXPostText({ title: POST.title, link: LINK, teamMembers: POST.teamMembers, teamLabel: 'KCRU' }),
    generatedBy: 'template',
  })
})

test('a draft that is too long once the link is added is retried once with a shorter limit', async () => {
  const tooLong = `London Kidney investigators Jane Smith and Raj Patel found that ${'word '.repeat(50).trim()}`
  const short = 'London Kidney investigators Jane Smith and Raj Patel found a shorter post about kidney function after surgery.'
  const { calls, generate } = fakeGenerate(tooLong, short)
  const draft = await composeSocialPostDraft({ post: POST, generate, llmLabel: 'llm:test-model' })
  assert.equal(draft.text, `${short} ${LINK}`)
  assert.equal(draft.generatedBy, 'llm:test-model')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].maxLength, SOCIAL_POST_SHORTER_BODY_MAX_LENGTH)
  assert.equal(calls[1].previousText, tooLong)
  assert.ok(calls[1].feedback.some((problem) => /too long/i.test(problem)))
})

test('a draft that is still too long after the retry falls back to the template', async () => {
  const tooLong = `London Kidney investigators Jane Smith and Raj Patel found that ${'word '.repeat(50).trim()}`
  const { calls, generate } = fakeGenerate(tooLong, tooLong)
  const draft = await composeSocialPostDraft({ post: POST, generate, llmLabel: 'llm:test-model' })
  assert.equal(draft.generatedBy, 'template')
  assert.equal(draft.text, buildXPostText({ title: POST.title, link: LINK, teamMembers: POST.teamMembers }))
  assert.ok(xWeightedLength(draft.text) <= X_MAX_WEIGHTED_LENGTH)
  assert.equal(calls.length, 2)
})

test('a retry that names the missing investigator is used, without shortening the length', async () => {
  const missingName = 'London Kidney investigators Jane Smith found a new result about kidney function.'
  const fixed = 'London Kidney investigators Jane Smith and Raj Patel found a new result about kidney function.'
  const { calls, generate } = fakeGenerate(missingName, fixed)
  const draft = await composeSocialPostDraft({ post: POST, generate, llmLabel: 'llm:test-model' })
  assert.equal(draft.generatedBy, 'llm:test-model')
  assert.equal(draft.text, `${fixed} ${LINK}`)
  assert.equal(calls.length, 2)
  assert.ok(calls[1].feedback.some((problem) => /Raj Patel/.test(problem)))
  assert.equal(calls[1].maxLength, SOCIAL_POST_BODY_MAX_LENGTH)
})

test('a retry that still has a problem falls back to the template', async () => {
  const missingName = 'London Kidney investigators Jane Smith found a new result about kidney function.'
  const { calls, generate } = fakeGenerate(missingName, missingName)
  const draft = await composeSocialPostDraft({ post: POST, generate, llmLabel: 'llm:test-model' })
  assert.equal(draft.generatedBy, 'template')
  assert.equal(calls.length, 2)
})

// --- checkSocialPostBody -----------------------------------------------------

test('checkSocialPostBody flags a missing investigator', () => {
  const problems = checkSocialPostBody('Jane Smith found something interesting.', {
    teamMembers: ['Jane Smith', 'Raj Patel'],
    journal: '',
    link: LINK,
  })
  assert.deepEqual(problems, ['The post must name Raj Patel.'])
})

test('checkSocialPostBody flags first-person wording', () => {
  const problems = checkSocialPostBody('Our team found something interesting.', {
    teamMembers: [],
    journal: '',
    link: LINK,
  })
  assert.ok(problems.some((problem) => /first person/i.test(problem)))
})

test('checkSocialPostBody flags the journal when it is at least 4 characters and ignores a shorter one', () => {
  const withJournal = checkSocialPostBody('Published in Kidney Journal this week.', {
    teamMembers: [],
    journal: 'Kidney Journal',
    link: LINK,
  })
  assert.ok(withJournal.some((problem) => /journal/i.test(problem)))

  const shortJournal = checkSocialPostBody('A short post about JBC findings.', {
    teamMembers: [],
    journal: 'JBC',
    link: LINK,
  })
  assert.deepEqual(shortJournal, [])
})

test('checkSocialPostBody flags the body plus link exceeding 280 weighted characters', () => {
  const longBody = 'word '.repeat(60).trim()
  const problems = checkSocialPostBody(longBody, { teamMembers: [], journal: '', link: LINK })
  assert.ok(problems.some((problem) => /too long/i.test(problem)))
})

test('checkSocialPostBody returns no problems for a compliant body', () => {
  const problems = checkSocialPostBody('Jane Smith and Raj Patel found something interesting.', {
    teamMembers: ['Jane Smith', 'Raj Patel'],
    journal: '',
    link: LINK,
  })
  assert.deepEqual(problems, [])
})

// --- buildSocialPostPrompt ----------------------------------------------------

test('buildSocialPostPrompt names the investigators with the team label and never mentions the journal', () => {
  const prompt = buildSocialPostPrompt({
    title: POST.title,
    laySummary: POST.laySummary,
    teamMembers: POST.teamMembers,
    teamLabel: 'KCRU',
    maxLength: 200,
  })
  assert.match(prompt, /KCRU investigators on this paper: Jane Smith and Raj Patel/)
  assert.match(prompt, /followed people after surgery/)
  assert.match(prompt, /at most 200 characters/)
  assert.doesNotMatch(prompt, /journal/i)
})

test('buildSocialPostPrompt says "none listed" with no investigators, and asks for a correction with feedback', () => {
  const prompt = buildSocialPostPrompt({
    title: POST.title,
    laySummary: POST.laySummary,
    teamMembers: [],
    teamLabel: 'KCRU',
    maxLength: 200,
    previousText: 'An earlier draft that was too long.',
    feedback: ['The post must name Jane Smith.'],
  })
  assert.match(prompt, /KCRU investigators on this paper: none listed/)
  assert.match(prompt, /Your previous draft was:\nAn earlier draft that was too long\./)
  assert.match(prompt, /The post must name Jane Smith\./)
  assert.match(prompt, /corrected version in at most 200 characters/)
})

test('buildSocialPostPrompt states whether there are other authors as yes, no or unknown, and never a count', () => {
  const base = { title: POST.title, laySummary: POST.laySummary, teamMembers: POST.teamMembers, teamLabel: 'KCRU', maxLength: 200 }
  const withOthers = buildSocialPostPrompt({ ...base, hasOtherAuthors: true })
  assert.match(withOthers, /Other authors on this paper besides these KCRU investigators: yes/)

  const withoutOthers = buildSocialPostPrompt({ ...base, hasOtherAuthors: false })
  assert.match(withoutOthers, /Other authors on this paper besides these KCRU investigators: no/)

  const unknownExplicit = buildSocialPostPrompt({ ...base, hasOtherAuthors: null })
  assert.match(unknownExplicit, /Other authors on this paper besides these KCRU investigators: unknown/)

  const unknownOmitted = buildSocialPostPrompt(base)
  assert.match(unknownOmitted, /Other authors on this paper besides these KCRU investigators: unknown/)

  for (const prompt of [withOthers, withoutOthers, unknownExplicit, unknownOmitted]) {
    assert.doesNotMatch(prompt, /\d+\s+(other\s+)?authors?/i)
  }
})

test('the default SOCIAL_POST_SYSTEM_PROMPT tells the model to add "and colleagues" when there are other authors', () => {
  assert.match(SOCIAL_POST_SYSTEM_PROMPT, /add "and colleagues" after the names/)
  assert.match(SOCIAL_POST_SYSTEM_PROMPT, /If there are none or it is unknown, do not add it\./)
})

test('cleanSocialPostText strips links, labels, fences and wrapping quotes', () => {
  assert.equal(cleanSocialPostText(`"Jane Smith looked at kidney health. ${LINK}"`), 'Jane Smith looked at kidney health.')
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
    return openRouterResponse(`London Kidney investigators Jane Smith and Raj Patel found how kidney function changes after surgery. ${LINK}`)
  }
  try {
    const text = await generateSocialPostText(
      {
        title: POST.title,
        laySummary: POST.laySummary,
        teamMembers: POST.teamMembers,
        teamLabel: 'KCRU',
        maxLength: 200,
        previousText: 'An earlier draft that was too long.',
        feedback: ['The post must name Raj Patel.'],
      },
      { provider: 'openrouter', model: 'openai/gpt-5.6-luna', apiKey: 'test-key', debug: false }
    )
    assert.equal(text, 'London Kidney investigators Jane Smith and Raj Patel found how kidney function changes after surgery.')
    assert.equal(requests.length, 1)
    const { body } = requests[0]
    assert.equal(requests[0].url, 'https://openrouter.ai/api/v1/chat/completions')
    assert.deepEqual(body.reasoning, SOCIAL_POST_REASONING)
    assert.ok(body.max_tokens >= 800 + REASONING_TOKEN_HEADROOM)
    assert.equal(body.temperature, 0.4)
    const system = body.messages[0].content
    assert.match(system, /kidney clinical research team/)
    assert.match(system, /investigators/)
    assert.match(system, /first person/)
    assert.match(system, /hashtags/)
    const prompt = body.messages[1].content
    assert.match(prompt, /KCRU investigators on this paper: Jane Smith and Raj Patel/)
    assert.match(prompt, /followed people after surgery/)
    assert.match(prompt, /Your previous draft was:\nAn earlier draft that was too long\./)
    assert.match(prompt, /The post must name Raj Patel\./)
    assert.match(prompt, /corrected version in at most 200 characters/)
    assert.doesNotMatch(prompt, /journal/i)
    assert.doesNotMatch(prompt, /Kidney Journal/)
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

test('generateSocialPostText sends a custom options.systemPrompt instead of the default', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  const customPrompt = 'Custom drafting instructions from the approver.'
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    return openRouterResponse('London Kidney investigators Jane Smith and Raj Patel found something.')
  }
  try {
    await generateSocialPostText(POST, { provider: 'openrouter', model: 'openai/gpt-5.6-luna', apiKey: 'k', systemPrompt: customPrompt })
    assert.equal(requests[0].body.messages[0].content, customPrompt)

    await generateSocialPostText(POST, { provider: 'openrouter', model: 'openai/gpt-5.6-luna', apiKey: 'k' })
    assert.equal(requests[1].body.messages[0].content, SOCIAL_POST_SYSTEM_PROMPT)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('createSocialPostGenerateFn threads the resolved system prompt through to the model call', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    return openRouterResponse('London Kidney investigators Jane Smith and Raj Patel found something.')
  }
  try {
    const customPrompt = "London Kidney's approver-edited drafting instructions."
    const generate = createSocialPostGenerateFn({ provider: 'openrouter', model: 'openai/gpt-5.6-luna', systemPrompt: customPrompt })
    const originalApiKey = process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_API_KEY = 'k'
    try {
      const draft = await composeSocialPostDraft({ post: POST, generate, llmLabel: 'llm:test-model' })
      assert.equal(draft.generatedBy, 'llm:test-model')
    } finally {
      if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY
      else process.env.OPENROUTER_API_KEY = originalApiKey
    }
    assert.equal(requests[0].body.messages[0].content, customPrompt)
  } finally {
    globalThis.fetch = originalFetch
  }
})
