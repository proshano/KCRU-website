import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeAllowedAudienceFilter } from '../lib/newsletterAudienceFilters.js'

const allowed = new Set(['physician', 'nurse'])

test('keeps valid audience filters', () => {
  assert.deepEqual(normalizeAllowedAudienceFilter(['physician'], allowed), {
    values: ['physician'],
    invalidValues: [],
  })
})

test('reports invalid filters instead of silently widening the audience', () => {
  assert.deepEqual(normalizeAllowedAudienceFilter(['not-a-role'], allowed), {
    values: [],
    invalidValues: ['not-a-role'],
  })
})

test('does not hide an invalid value alongside a valid value', () => {
  assert.deepEqual(normalizeAllowedAudienceFilter(['physician', 'not-a-role'], allowed), {
    values: ['physician'],
    invalidValues: ['not-a-role'],
  })
})
