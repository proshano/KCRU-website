import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveProviderApiKey } from '../lib/summaries.js'

test('provider API keys are selected from the matching environment variable', () => {
  const original = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    TOGETHER_API_KEY: process.env.TOGETHER_API_KEY,
  }
  process.env.OPENROUTER_API_KEY = 'openrouter-secret'
  process.env.OPENAI_API_KEY = 'openai-secret'
  process.env.TOGETHER_API_KEY = 'together-secret'
  try {
    assert.equal(resolveProviderApiKey('openrouter'), 'openrouter-secret')
    assert.equal(resolveProviderApiKey('openai'), 'openai-secret')
    assert.equal(resolveProviderApiKey('together'), 'together-secret')
    assert.equal(resolveProviderApiKey('ollama'), null)
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('an explicit key stays paired with the explicitly selected provider', () => {
  assert.equal(resolveProviderApiKey('anthropic', 'configured-anthropic-key'), 'configured-anthropic-key')
  assert.throws(() => resolveProviderApiKey('unsupported'), /Unknown LLM provider/)
})
