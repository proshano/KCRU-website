import assert from 'node:assert/strict'
import test from 'node:test'

import {
  TRIAL_MATCH_CHAT_MAX_TOKENS,
  TRIAL_MATCH_CHAT_TEMPERATURE,
  TRIAL_MATCH_OPENROUTER_REASONING,
  cleanTrialMatchAssistantReply,
} from '../lib/summaries.js'

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

test('keeps Gemini 3 trial matching on minimal reasoning', () => {
  assert.deepEqual(TRIAL_MATCH_OPENROUTER_REASONING, {
    effort: 'minimal',
    exclude: true,
  })
})
