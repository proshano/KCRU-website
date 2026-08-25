import assert from 'node:assert/strict'
import test from 'node:test'

import {
  dispatchPublicationAttributionNotifications,
  selectDueAttributionReviews,
} from '../lib/publicationAttributionNotifications.js'

const NOW = new Date('2026-08-25T12:00:00Z')

function pending(overrides = {}) {
  return {
    _id: 'review-1',
    status: 'pending',
    researcherName: 'Jane Smith',
    title: 'Candidate publication',
    authors: ['Jane Smith'],
    journal: 'Kidney Journal',
    year: 2026,
    doi: '10.1000/candidate',
    publicationKey: 'doi:10.1000/candidate',
    discoverySources: ['crossref'],
    evidence: { recurringCoauthorCount: 0 },
    holdReason: 'Full name without independent corroboration.',
    notificationCount: 0,
    ...overrides,
  }
}

test('selects never-notified pending candidates for an initial email', () => {
  const due = selectDueAttributionReviews([pending()], { now: NOW })
  assert.equal(due.length, 1)
  assert.equal(due[0].notificationKind, 'new')
})

test('selects seven-day reminders without sending premature repeats', () => {
  const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString()
  const sevenDaysAgo = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  assert.equal(selectDueAttributionReviews([pending({ lastNotifiedAt: sixDaysAgo })], { now: NOW }).length, 0)
  const due = selectDueAttributionReviews([pending({ lastNotifiedAt: sevenDaysAgo })], { now: NOW })
  assert.equal(due.length, 1)
  assert.equal(due[0].notificationKind, 'reminder')
})

test('a failed email remains unnotified so the next run retries', async () => {
  let marked = false
  await assert.rejects(
    dispatchPublicationAttributionNotifications({
      reviews: [pending()],
      recipients: ['admin@example.test'],
      portalUrl: 'https://example.test/admin/publications',
      send: async () => { throw new Error('delivery failed') },
      markNotified: async () => { marked = true },
      now: NOW,
    }),
    /delivery failed/
  )
  assert.equal(marked, false)
})

test('successful delivery marks candidates only after the send succeeds', async () => {
  const events = []
  const result = await dispatchPublicationAttributionNotifications({
    reviews: [pending()],
    recipients: ['ADMIN@example.test', 'admin@example.test'],
    portalUrl: 'https://example.test/admin/publications',
    send: async ({ to }) => { events.push(`send:${to.length}`); return { id: 'email-1' } },
    markNotified: async () => { events.push('mark') },
    now: NOW,
  })
  assert.equal(result.sent, true)
  assert.deepEqual(events, ['send:1', 'mark'])
})

test('authenticated dry-run selection does not send or mark', async () => {
  let sent = false
  let marked = false
  const result = await dispatchPublicationAttributionNotifications({
    reviews: [pending()],
    recipients: ['admin@example.test'],
    portalUrl: 'https://example.test/admin/publications',
    send: async () => { sent = true },
    markNotified: async () => { marked = true },
    dryRun: true,
    now: NOW,
  })
  assert.equal(result.dryRun, true)
  assert.equal(sent, false)
  assert.equal(marked, false)
})

test('an empty dry run is still identified explicitly', async () => {
  const result = await dispatchPublicationAttributionNotifications({
    reviews: [],
    recipients: ['admin@example.test'],
    dryRun: true,
    now: NOW,
  })
  assert.equal(result.skipped, true)
  assert.equal(result.dryRun, true)
  assert.equal(result.due, 0)
})
