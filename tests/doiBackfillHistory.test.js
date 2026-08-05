import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DOI_BACKFILL_RETRY_INTERVAL_MS,
  backfillHistoryChanged,
  clearBackfillFailure,
  parseBackfillHistory,
  pruneBackfillHistory,
  recordBackfillFailure,
  serializeBackfillHistory,
  shouldAttemptBackfill,
  toSanityBackfillFailures,
} from '../lib/doiBackfillHistory.js'

const NOW = Date.parse('2026-08-05T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

test('attempts a DOI that has never failed', () => {
  const history = parseBackfillHistory([])
  assert.equal(shouldAttemptBackfill(history, '10.1016/j.ekir.2026.106680', { now: NOW }), true)
})

test('defers a DOI that failed inside the retry interval', () => {
  const history = recordBackfillFailure(parseBackfillHistory([]), '10.1016/j.ekir.2026.106680', { now: NOW })
  const oneDayLater = NOW + DAY_MS

  assert.equal(shouldAttemptBackfill(history, '10.1016/j.ekir.2026.106680', { now: oneDayLater }), false)
})

test('retries a DOI once the retry interval has elapsed', () => {
  const history = recordBackfillFailure(parseBackfillHistory([]), '10.1016/j.ekir.2026.106680', { now: NOW })
  const afterInterval = NOW + DOI_BACKFILL_RETRY_INTERVAL_MS

  assert.equal(shouldAttemptBackfill(history, '10.1016/j.ekir.2026.106680', { now: afterInterval }), true)
})

test('matches DOIs regardless of stored casing or URL prefix', () => {
  const history = recordBackfillFailure(parseBackfillHistory([]), '10.1016/S0140-6736(23)01509-X', { now: NOW })

  assert.equal(shouldAttemptBackfill(history, 'https://doi.org/10.1016/s0140-6736(23)01509-x', { now: NOW }), false)
})

test('counts consecutive failures for the same DOI', () => {
  let history = parseBackfillHistory([])
  history = recordBackfillFailure(history, '10.1000/repeat', { now: NOW })
  history = recordBackfillFailure(history, '10.1000/repeat', { now: NOW + DAY_MS })

  const [entry] = serializeBackfillHistory(history)
  assert.equal(entry.attempts, 2)
  assert.equal(entry.lastAttemptedAt, new Date(NOW + DAY_MS).toISOString())
})

test('clears history for a DOI that finally resolves', () => {
  const history = recordBackfillFailure(parseBackfillHistory([]), '10.1000/resolved', { now: NOW })
  clearBackfillFailure(history, '10.1000/resolved')

  assert.deepEqual(serializeBackfillHistory(history), [])
  assert.equal(shouldAttemptBackfill(history, '10.1000/resolved', { now: NOW }), true)
})

test('prunes entries for DOIs that are no longer backfill candidates', () => {
  let history = parseBackfillHistory([])
  history = recordBackfillFailure(history, '10.1000/still-missing', { now: NOW })
  history = recordBackfillFailure(history, '10.1000/gone', { now: NOW })

  pruneBackfillHistory(history, new Set(['10.1000/still-missing']))

  assert.deepEqual(serializeBackfillHistory(history).map((entry) => entry.doi), ['10.1000/still-missing'])
})

test('serializes deterministically so an unchanged history is not a document change', () => {
  const first = parseBackfillHistory([
    { doi: '10.1000/b', lastAttemptedAt: new Date(NOW).toISOString(), attempts: 1 },
    { doi: '10.1000/a', lastAttemptedAt: new Date(NOW).toISOString(), attempts: 3 },
  ])
  const second = parseBackfillHistory([
    { doi: '10.1000/a', lastAttemptedAt: new Date(NOW).toISOString(), attempts: 3 },
    { doi: '10.1000/b', lastAttemptedAt: new Date(NOW).toISOString(), attempts: 1 },
  ])

  assert.deepEqual(serializeBackfillHistory(first), serializeBackfillHistory(second))
  assert.equal(backfillHistoryChanged(serializeBackfillHistory(first), serializeBackfillHistory(second)), false)
})

test('detects a changed history', () => {
  const before = serializeBackfillHistory(recordBackfillFailure(parseBackfillHistory([]), '10.1000/a', { now: NOW }))
  const after = serializeBackfillHistory(recordBackfillFailure(parseBackfillHistory(before), '10.1000/a', { now: NOW + DAY_MS }))

  assert.equal(backfillHistoryChanged(before, after), true)
})

test('survives the round trip through the stored Sanity shape', () => {
  const doi = '10.1016/j.ekir.2026.106680'
  const stored = toSanityBackfillFailures(
    serializeBackfillHistory(recordBackfillFailure(parseBackfillHistory([]), doi, { now: NOW }))
  )

  assert.equal(stored.length, 1)
  assert.match(stored[0]._key, /^[A-Za-z0-9_-]+$/)

  // Mirrors how readCache() maps the stored array back onto cache metadata.
  const reloaded = parseBackfillHistory(stored.map((entry) => ({
    doi: entry.doi,
    lastAttemptedAt: entry.lastAttemptedAt,
    attempts: entry.attempts,
  })))

  assert.equal(shouldAttemptBackfill(reloaded, doi, { now: NOW + DAY_MS }), false)
  assert.equal(shouldAttemptBackfill(reloaded, doi, { now: NOW + DOI_BACKFILL_RETRY_INTERVAL_MS }), true)
})

test('ignores malformed stored entries', () => {
  const history = parseBackfillHistory([
    null,
    { doi: '', lastAttemptedAt: new Date(NOW).toISOString() },
    { doi: '10.1000/valid', lastAttemptedAt: 'not-a-date', attempts: 'oops' },
  ])

  assert.deepEqual(serializeBackfillHistory(history).map((entry) => entry.doi), ['10.1000/valid'])
  // An unparseable timestamp must not strand the DOI as permanently deferred.
  assert.equal(shouldAttemptBackfill(history, '10.1000/valid', { now: NOW }), true)
})
