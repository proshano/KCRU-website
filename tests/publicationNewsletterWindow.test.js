import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  getWindowStart,
  hasWindowElapsed,
  parseLastGlobalSentAt,
} from '../lib/publicationNewsletterWindow.js'
import { isTodayNthWeekday } from '../lib/cronUtils.js'

const DAY = 24 * 60 * 60 * 1000
const TZ = 'America/New_York'

test('parseLastGlobalSentAt reads a stored timestamp and rejects junk', () => {
  assert.equal(parseLastGlobalSentAt(undefined), null)
  assert.equal(parseLastGlobalSentAt({}), null)
  assert.equal(parseLastGlobalSentAt({ lastGlobalSentAt: null }), null)
  assert.equal(parseLastGlobalSentAt({ lastGlobalSentAt: 'not a date' }), null)

  const parsed = parseLastGlobalSentAt({ lastGlobalSentAt: '2026-06-15T16:19:34.738Z' })
  assert.equal(parsed.toISOString(), '2026-06-15T16:19:34.738Z')
})

test('the first ever send is never blocked by the window', () => {
  assert.equal(hasWindowElapsed({ lastGlobalSentAt: null, now: new Date(), windowDays: 55 }), true)
})

test('the window blocks a send inside it and admits one past it', () => {
  const lastGlobalSentAt = new Date('2026-06-15T12:00:00Z')
  const at = (days) => new Date(lastGlobalSentAt.getTime() + days * DAY)

  assert.equal(hasWindowElapsed({ lastGlobalSentAt, now: at(35), windowDays: 55 }), false)
  assert.equal(hasWindowElapsed({ lastGlobalSentAt, now: at(55), windowDays: 55 }), false)
  assert.equal(hasWindowElapsed({ lastGlobalSentAt, now: at(56), windowDays: 55 }), true)
  assert.equal(hasWindowElapsed({ lastGlobalSentAt, now: at(63), windowDays: 55 }), true)
})

// The property the cadence rests on: consecutive 3rd Mondays are 28 or 35 days apart and
// skipping one is always 56 or 63, so 35-55 lands on every second one. If this ever fails,
// the calendar assumption behind the recommended setting is wrong.
test('3rd Mondays are 28 or 35 days apart, and 56 or 63 when one is skipped', () => {
  const mondays = []
  for (let i = 0; i < 365 * 12; i += 1) {
    const day = new Date(Date.UTC(2026, 0, 1, 12) + i * DAY)
    if (isTodayNthWeekday({ timeZone: TZ, occurrence: '3rd', dayOfWeek: 'monday', date: day })) {
      mondays.push(day)
    }
  }
  assert.ok(mondays.length > 100, 'expected a long run of 3rd Mondays to test against')

  const singles = new Set()
  const doubles = new Set()
  for (let i = 1; i < mondays.length; i += 1) {
    singles.add(Math.round((mondays[i] - mondays[i - 1]) / DAY))
  }
  for (let i = 2; i < mondays.length; i += 1) {
    doubles.add(Math.round((mondays[i] - mondays[i - 2]) / DAY))
  }

  assert.deepEqual([...singles].sort((a, b) => a - b), [28, 35])
  assert.deepEqual([...doubles].sort((a, b) => a - b), [56, 63])
})

test('windowDays of 35 to 55 sends on exactly every second 3rd Monday', () => {
  const runCadence = (windowDays) => {
    let lastGlobalSentAt = new Date('2026-06-15T16:19:34.738Z')
    const gaps = []
    for (let i = 1; i < 365 * 6; i += 1) {
      const day = new Date(Date.UTC(2026, 5, 15, 12) + i * DAY)
      if (!isTodayNthWeekday({ timeZone: TZ, occurrence: '3rd', dayOfWeek: 'monday', date: day })) continue
      if (!hasWindowElapsed({ lastGlobalSentAt, now: day, windowDays })) continue
      gaps.push(Math.round((day - lastGlobalSentAt) / DAY))
      lastGlobalSentAt = day
    }
    return gaps
  }

  for (const windowDays of [35, 45, 55]) {
    const gaps = runCadence(windowDays)
    assert.ok(gaps.length > 20, `expected many sends at windowDays=${windowDays}`)
    for (const gap of gaps) {
      assert.ok(gap >= 56 && gap <= 63, `windowDays=${windowDays} produced a ${gap}-day gap`)
    }
  }

  // 62, the setting that produced the irregular cadence: a double interval of 56 days is
  // still inside the window, so some months slip to a third 3rd Monday.
  assert.ok(runCadence(62).some((gap) => gap > 63))
})

test('an issue covers everything since the last send, with no gap between issues', () => {
  const lastGlobalSentAt = new Date('2026-06-15T16:19:34.738Z')
  const now = new Date('2026-08-17T12:00:00Z')

  const start = getWindowStart({ lastGlobalSentAt, now, windowDays: 55 })
  assert.equal(start.getTime(), lastGlobalSentAt.getTime())

  // The gap this replaces: a rolling window shorter than the send interval leaves the days
  // just after the previous issue in no issue at all.
  const rollingStart = new Date(now.getTime() - 55 * DAY)
  assert.ok(rollingStart > lastGlobalSentAt)
})

test('with no send on record the window falls back to windowDays, not the back catalogue', () => {
  const now = new Date('2026-08-17T12:00:00Z')
  const start = getWindowStart({ lastGlobalSentAt: null, now, windowDays: 55 })
  assert.equal(start.getTime(), now.getTime() - 55 * DAY)

  assert.equal(getWindowStart({ lastGlobalSentAt: null, now, windowDays: 0 }), null)
})
