import assert from 'node:assert/strict'
import test from 'node:test'

import { cleanTrialMatchAssistantReply } from '../lib/summaries.js'

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
