import assert from 'node:assert/strict'
import test from 'node:test'

import { readFileSync } from 'node:fs'

import {
  DEFAULT_LLM_MODEL,
  OPENROUTER_REASONING,
  REASONING_TOKEN_HEADROOM,
  TRIAL_MATCH_CHAT_MAX_TOKENS,
  TRIAL_MATCH_CHAT_REASONING,
  TRIAL_MATCH_CHAT_TEMPERATURE,
  buildOpenRouterReasoningOptions,
  cleanTrialMatchAssistantReply,
  resolveCompletionBudget,
} from '../lib/summaries.js'

test('the patient-facing chat turn asks for the lowest reasoning effort', () => {
  assert.deepEqual(TRIAL_MATCH_CHAT_REASONING, { effort: 'minimal', exclude: true })
  assert.deepEqual(
    buildOpenRouterReasoningOptions(DEFAULT_LLM_MODEL, TRIAL_MATCH_CHAT_REASONING),
    TRIAL_MATCH_CHAT_REASONING
  )
})

test('only the conversation turn is downgraded, not study ranking', () => {
  // Ranking runs once and is the clinical matching judgement, so it keeps full effort.
  const src = readFileSync(new URL('../lib/summaries.js', import.meta.url), 'utf8')
  const conversation = src.slice(src.indexOf('export async function generateTrialMatchConversation'))
  const ranking = src.slice(src.indexOf('export async function generateTrialMatchStudyRanking'))

  assert.match(conversation.slice(0, ranking.length ? conversation.length - ranking.length : undefined),
    /buildOpenRouterReasoningOptions\(model, TRIAL_MATCH_CHAT_REASONING\)/)
  assert.match(ranking, /buildOpenRouterReasoningOptions\(model\)/)
  assert.ok(!/TRIAL_MATCH_CHAT_REASONING/.test(ranking), 'ranking must not use the chat effort')
})

test('reasoning gets its own token budget so it cannot starve the answer', () => {
  // Measured: gpt-5.6-luna at max effort spent all 1000 tokens of a 1000-token budget on
  // reasoning and returned an empty body, which the parser reported as invalid JSON and
  // the caller turned into a dropped summary.
  assert.equal(resolveCompletionBudget(1000, OPENROUTER_REASONING), 1000 + REASONING_TOKEN_HEADROOM)
  assert.ok(REASONING_TOKEN_HEADROOM >= 2000)
})

test('models without reasoning keep their original content budget', () => {
  assert.equal(resolveCompletionBudget(1000, undefined), 1000)
  assert.equal(resolveCompletionBudget(400, null), 400)
})

test('drops partial structured output instead of showing raw json in the assistant bubble', () => {
  assert.equal(cleanTrialMatchAssistantReply('{"assistant'), null)
  assert.equal(
    cleanTrialMatchAssistantReply('{"assistant_reply":"What is the eGFR?","ready_for_matching":false}'),
    null
  )
})

test('keeps normal conversational replies intact', () => {
  assert.equal(
    cleanTrialMatchAssistantReply('What is the eGFR, if known?'),
    'What is the eGFR, if known?'
  )
})

test('keeps enough output budget for full trial match profile JSON', () => {
  assert.ok(TRIAL_MATCH_CHAT_MAX_TOKENS >= 2400)
})

test('keeps the trial match extraction turn deterministic', () => {
  assert.equal(TRIAL_MATCH_CHAT_TEMPERATURE, 0)
})

test('requests maximum reasoning effort and keeps the trace out of the response', () => {
  assert.deepEqual(OPENROUTER_REASONING, {
    effort: 'max',
    exclude: true,
  })
})

test('the default model actually receives the reasoning parameter', () => {
  // The guard that matters: a model change must not silently drop reasoning. If this
  // fails, the new default is not on the reasoning allowlist and every task would quietly
  // fall back to the provider's own effort level.
  assert.deepEqual(buildOpenRouterReasoningOptions(DEFAULT_LLM_MODEL), OPENROUTER_REASONING)
})

test('reasoning follows a model family forward across versions', () => {
  for (const model of [
    'openai/gpt-5.6-luna',
    'openai/gpt-5.6-luna-pro',
    'openai/gpt-5',
    'openai/gpt-6',
    'google/gemini-3.6-flash',
    'google/gemini-4-flash',
    'google/gemini-10-flash',
  ]) {
    assert.deepEqual(buildOpenRouterReasoningOptions(model), OPENROUTER_REASONING, model)
  }
})

test('models that do not take a reasoning parameter are left alone', () => {
  for (const model of [
    'google/gemma-3-27b-it:free',
    'google/gemini-2.5-flash',
    'openai/gpt-4o-mini',
    'meta-llama/llama-3.1-8b-instruct:free',
  ]) {
    assert.equal(buildOpenRouterReasoningOptions(model), undefined, model)
  }
})
