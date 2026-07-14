import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isTrialMatchingAssistantEnabled,
  resolveTrialMatchingLlmOptions,
} from '../lib/trialMatchingSettings.js'

test('requires an explicit trial matching assistant enable flag', () => {
  assert.equal(isTrialMatchingAssistantEnabled({}), false)
  assert.equal(isTrialMatchingAssistantEnabled({ trialMatchingAssistant: null }), false)
  assert.equal(isTrialMatchingAssistantEnabled({ trialMatchingAssistant: { enabled: true } }), true)
})

test('prefers trial matching assistant LLM settings over trial summary settings', () => {
  assert.deepEqual(
    resolveTrialMatchingLlmOptions({
      llmProvider: 'openrouter',
      llmModel: 'google/gemini-3.5-flash',
      trialSummaryLlmProvider: 'openrouter',
      trialSummaryLlmModel: 'google/gemini-3.5-flash',
      trialMatchingAssistant: {
        enabled: true,
        llmProvider: 'openrouter',
        llmModel: 'google/gemini-3-flash-preview',
      },
    }),
    {
      provider: 'openrouter',
      model: 'google/gemini-3-flash-preview',
    }
  )
})

test('falls back to trial summary LLM settings for older datasets', () => {
  assert.deepEqual(
    resolveTrialMatchingLlmOptions({
      llmProvider: 'openrouter',
      llmModel: 'google/gemini-3.5-flash',
      trialSummaryLlmProvider: 'openrouter',
      trialSummaryLlmModel: 'google/gemini-3-flash-preview',
      trialMatchingAssistant: {
        enabled: true,
      },
    }),
    {
      provider: 'openrouter',
      model: 'google/gemini-3-flash-preview',
    }
  )
})

test('falls back to summary LLM settings when no task-specific assistant settings exist', () => {
  assert.deepEqual(
    resolveTrialMatchingLlmOptions({
      llmProvider: 'openrouter',
      llmModel: 'google/gemini-3.5-flash',
    }),
    {
      provider: 'openrouter',
      model: 'google/gemini-3.5-flash',
    }
  )
})
