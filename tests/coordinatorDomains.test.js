import assert from 'node:assert/strict'
import test from 'node:test'

import {
  emailMatchesCoordinatorDomain,
  formatCoordinatorDomains,
  normalizeCoordinatorDomains,
  resolveCoordinatorDomains,
} from '../lib/coordinatorDomains.js'

test('normalizes comma and newline separated domains', () => {
  assert.deepEqual(
    normalizeCoordinatorDomains(' LHSC.ON.CA,\nsjhc.london.on.ca ; @example.org '),
    ['lhsc.on.ca', 'sjhc.london.on.ca', 'example.org']
  )
})

test('falls back to LHSC and St. Josephs domains when setting is empty', () => {
  assert.deepEqual(resolveCoordinatorDomains(''), ['lhsc.on.ca', 'sjhc.london.on.ca'])
})

test('keeps legacy single-domain settings backward compatible', () => {
  assert.deepEqual(resolveCoordinatorDomains('lhsc.on.ca'), ['lhsc.on.ca', 'sjhc.london.on.ca'])
  assert.deepEqual(resolveCoordinatorDomains('sjhc.london.on.ca'), ['lhsc.on.ca', 'sjhc.london.on.ca'])
})

test('preserves custom non-default domains exactly as configured', () => {
  assert.deepEqual(resolveCoordinatorDomains('example.org'), ['example.org'])
  assert.deepEqual(
    resolveCoordinatorDomains('example.org,partners.example.org'),
    ['example.org', 'partners.example.org']
  )
})

test('matches either supported hospital domain for allowlisted emails', () => {
  assert.equal(emailMatchesCoordinatorDomain('person@lhsc.on.ca', 'lhsc.on.ca'), true)
  assert.equal(emailMatchesCoordinatorDomain('person@sjhc.london.on.ca', 'lhsc.on.ca'), true)
  assert.equal(emailMatchesCoordinatorDomain('person@example.org', 'lhsc.on.ca'), false)
})

test('formats the allowed domains for user-facing error messages', () => {
  assert.equal(
    formatCoordinatorDomains('lhsc.on.ca'),
    '@lhsc.on.ca, @sjhc.london.on.ca'
  )
})
