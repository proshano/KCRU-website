import assert from 'node:assert/strict'
import test from 'node:test'

import { CORRESPONDENCE_OPTIONS, CORRESPONDENCE_VALUES } from '../lib/communicationOptions.js'

test('keeps existing correspondence preference values stable', () => {
  assert.equal(CORRESPONDENCE_VALUES.has('newsletter'), true)
  assert.equal(CORRESPONDENCE_VALUES.has('study_updates'), true)
})

test('adds research digest as an additive correspondence preference', () => {
  const values = CORRESPONDENCE_OPTIONS.map((option) => option.value)

  assert.equal(CORRESPONDENCE_VALUES.has('research_digest'), true)
  assert.equal(new Set(values).size, values.length)
  assert.deepEqual(values, ['newsletter', 'research_digest', 'study_updates'])
})
