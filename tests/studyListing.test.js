import assert from 'node:assert/strict'
import test from 'node:test'

import { formatStudyAddedDate } from '../lib/studyListing.js'

test('formatStudyAddedDate names the day in the team time zone', () => {
  // 03:30 UTC on 4 October is still the evening of 3 October in Toronto.
  assert.equal(formatStudyAddedDate('2026-10-04T03:30:00.000Z'), '3 Oct 2026')
  assert.equal(formatStudyAddedDate('2026-01-15T12:00:00.000Z'), '15 Jan 2026')
})

test('formatStudyAddedDate uses fixed month names, not locale data', () => {
  for (const [iso, expected] of [
    ['2026-02-01T12:00:00.000Z', '1 Feb 2026'],
    ['2026-05-20T12:00:00.000Z', '20 May 2026'],
    ['2026-09-09T12:00:00.000Z', '9 Sep 2026'],
    ['2025-12-31T12:00:00.000Z', '31 Dec 2025'],
  ]) {
    assert.equal(formatStudyAddedDate(iso), expected)
  }
})

test('formatStudyAddedDate is empty for a missing or invalid timestamp', () => {
  assert.equal(formatStudyAddedDate(undefined), '')
  assert.equal(formatStudyAddedDate(null), '')
  assert.equal(formatStudyAddedDate(''), '')
  assert.equal(formatStudyAddedDate('not a date'), '')
})
