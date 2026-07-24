import assert from 'node:assert/strict'
import test from 'node:test'

process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ||= 'abc123'
process.env.NEXT_PUBLIC_SANITY_DATASET ||= 'test'

const {
  DIGEST_DISPOSITION,
  buildDigestSettingsPatch,
  countDaysBetween,
  describePoolPaperDisposition,
  findDigestSettingsWarnings,
  summarizeDigestPoolDispositions,
  summarizeDigestSubscribers,
} = await import('../lib/researchDigestAdminView.js')

const { buildDigestSelectionPoolQuery, selectAutomatedDigestPapers } = await import('../lib/researchDigest.js')
const { RESEARCH_DIGEST_MAX_PAPERS_CEILING } = await import('../lib/researchDigestConfig.js')

const SETTINGS = { minPriorityScore: 75, maxPapers: 1 }

function paper(overrides = {}) {
  return {
    _id: 'paper-1',
    issueDate: '2026-07-24',
    discoveredDate: '2026-07-24',
    triageStatus: 'include',
    priorityScore: 88,
    summary: 'A summary.',
    whyItMatters: 'It matters.',
    publicationTypes: ['Journal Article'],
    ...overrides,
  }
}

test('a shipping paper reads as selected', () => {
  const result = describePoolPaperDisposition(
    paper({ autoSelectionStatus: 'selected', autoSelected: true }),
    SETTINGS,
    { issueDate: '2026-07-24' }
  )

  assert.equal(result.status, DIGEST_DISPOSITION.selected)
  assert.equal(result.qualifies, true)
  assert.equal(result.score, 88)
  assert.equal(result.carriedOver, false)
})

test('a qualifying paper that lost its slot reads as deferred', () => {
  const result = describePoolPaperDisposition(
    paper({ autoSelectionStatus: 'deferred', approvalStatus: 'rejected' }),
    SETTINGS,
    { issueDate: '2026-07-24' }
  )

  assert.equal(result.status, DIGEST_DISPOSITION.deferred)
  assert.equal(result.qualifies, true)
})

test('a deferred paper found on an earlier day reports how long it has waited', () => {
  const result = describePoolPaperDisposition(
    paper({ issueDate: '2026-07-20', discoveredDate: '2026-07-20', autoSelectionStatus: 'deferred' }),
    SETTINGS,
    { issueDate: '2026-07-24' }
  )

  assert.equal(result.carriedOver, true)
  assert.equal(result.daysWaiting, 4)
  assert.equal(result.discoveredDate, '2026-07-20')
})

test('a below-threshold paper names the score and the threshold', () => {
  const result = describePoolPaperDisposition(paper({ priorityScore: 71 }), SETTINGS, { issueDate: '2026-07-24' })

  assert.equal(result.status, DIGEST_DISPOSITION.belowThreshold)
  assert.equal(result.qualifies, false)
  assert.match(result.reason, /71/)
  assert.match(result.reason, /75/)
})

// The reported reason has to be the condition selection actually stopped at. A paper that both
// failed triage and scores low is a triage failure; calling it "below threshold" would send
// someone tuning the score instead of looking at the LLM.
test('the first blocking condition wins over later ones', () => {
  const result = describePoolPaperDisposition(
    paper({ triageError: 'rate limited', priorityScore: 10 }),
    SETTINGS,
    { issueDate: '2026-07-24' }
  )

  assert.equal(result.status, DIGEST_DISPOSITION.triageFailed)
  assert.match(result.reason, /rate limited/)
})

test('missing email copy blocks a high scorer', () => {
  const result = describePoolPaperDisposition(paper({ summary: '   ', priorityScore: 99 }), SETTINGS, {
    issueDate: '2026-07-24',
  })

  assert.equal(result.status, DIGEST_DISPOSITION.missingCopy)
  assert.match(result.reason, /summary/)
})

test('an excluded publication type is reported as such', () => {
  const result = describePoolPaperDisposition(
    paper({ publicationTypes: ['Case Reports'] }),
    SETTINGS,
    { issueDate: '2026-07-24' }
  )

  assert.equal(result.status, DIGEST_DISPOSITION.excludedType)
})

test('a hand-excluded paper is distinguished from an automatic rejection', () => {
  const result = describePoolPaperDisposition(
    paper({ autoSelectionExcluded: true }),
    SETTINGS,
    { issueDate: '2026-07-24' }
  )

  assert.equal(result.status, DIGEST_DISPOSITION.manuallyExcluded)
})

test('a tier-only legacy paper falls back to the tier score', () => {
  const result = describePoolPaperDisposition(
    paper({ priorityScore: null, tier: 'Tier 1' }),
    SETTINGS,
    { issueDate: '2026-07-24' }
  )

  assert.equal(result.score, 90)
  assert.equal(result.qualifies, true)
})

// The pipeline view is only trustworthy if "qualifies" means the same thing the selector means.
test('the qualifying set matches what the selector would pick from', () => {
  const pool = [
    paper({ _id: 'high', priorityScore: 95 }),
    paper({ _id: 'mid', priorityScore: 80 }),
    paper({ _id: 'low', priorityScore: 40 }),
    paper({ _id: 'broken', triageError: 'boom' }),
    paper({ _id: 'case-report', publicationTypes: ['Case Reports'] }),
  ]

  const qualifying = pool
    .map((item) => ({ id: item._id, ...describePoolPaperDisposition(item, SETTINGS, { issueDate: '2026-07-24' }) }))
    .filter((item) => item.qualifies)
    .map((item) => item.id)
    .sort()

  assert.deepEqual(qualifying, ['high', 'mid'])
  assert.deepEqual(selectAutomatedDigestPapers(pool, { ...SETTINGS, maxPapers: 2 }).map((item) => item._id), [
    'high',
    'mid',
  ])
})

test('pool dispositions summarize by status', () => {
  const summary = summarizeDigestPoolDispositions([
    { status: 'selected', qualifies: true, carriedOver: false },
    { status: 'deferred', qualifies: true, carriedOver: true },
    { status: 'below_threshold', qualifies: false, carriedOver: false },
  ])

  assert.equal(summary.total, 3)
  assert.equal(summary.qualifying, 2)
  assert.equal(summary.carriedOver, 1)
  assert.equal(summary.byStatus.deferred, 1)
})

test('countDaysBetween is inclusive of nothing and never negative', () => {
  assert.equal(countDaysBetween('2026-07-24', '2026-07-24'), 0)
  assert.equal(countDaysBetween('2026-07-24', '2026-07-20'), 0)
  assert.equal(countDaysBetween('', '2026-07-24'), 0)
})

test('subscriber counts separate deliverable from opted-in', () => {
  const counts = summarizeDigestSubscribers([
    { email: 'a@example.com', subscriptionStatus: 'subscribed', deliveryStatus: 'active', lastResearchDigestSentAt: '2026-07-23T13:00:00Z' },
    { email: 'b@example.com', subscriptionStatus: 'subscribed', deliveryStatus: 'active' },
    { email: 'c@example.com', subscriptionStatus: 'unsubscribed', deliveryStatus: 'active' },
    { email: 'd@example.com', subscriptionStatus: 'subscribed', deliveryStatus: 'suppressed' },
  ])

  assert.deepEqual(counts, {
    optedIn: 4,
    deliverable: 2,
    unsubscribed: 1,
    suppressed: 1,
    neverSent: 1,
  })
})

test('settings writes clamp the paper ceiling and the carryover cap', () => {
  const next = buildDigestSettingsPatch({ maxPapers: 25, carryoverDays: 400, minPriorityScore: 250 }, {})

  assert.equal(next.maxPapers, RESEARCH_DIGEST_MAX_PAPERS_CEILING)
  assert.equal(next.carryoverDays, 30)
  assert.equal(next.minPriorityScore, 100)
})

test('settings writes leave untouched keys and Studio-managed fields alone', () => {
  const current = {
    maxPapers: 2,
    minPriorityScore: 80,
    journalGroups: [{ title: 'Kidney', journals: ['Kidney International'] }],
    opportunitySources: [{ name: 'CIHR', url: 'https://example.org/feed' }],
  }
  const next = buildDigestSettingsPatch({ minPriorityScore: 70 }, current)

  assert.equal(next.minPriorityScore, 70)
  assert.equal(next.maxPapers, 2, 'a key absent from the request keeps its stored value')
  assert.deepEqual(next.journalGroups, current.journalGroups)
  assert.deepEqual(next.opportunitySources, current.opportunitySources)
})

test('pilot recipients are validated and deduplicated on write', () => {
  const next = buildDigestSettingsPatch(
    { pilotRecipients: ['One@Example.com', 'one@example.com', 'not-an-email', '  two@example.com  ', ''] },
    {}
  )

  assert.deepEqual(next.pilotRecipients, ['one@example.com', 'two@example.com'])
})

// normalizeResearchDigestSettings folds RESEARCH_DIGEST_PILOT_EMAILS into the value it returns.
// Persisting that would turn an env-only pilot recipient into a stored one nobody put there.
test('env pilot recipients never leak into the stored document', () => {
  const previous = process.env.RESEARCH_DIGEST_PILOT_EMAILS
  process.env.RESEARCH_DIGEST_PILOT_EMAILS = 'env-only@example.com'
  try {
    const next = buildDigestSettingsPatch({ pilotRecipients: ['real@example.com'] }, {})
    assert.deepEqual(next.pilotRecipients, ['real@example.com'])
  } finally {
    if (previous === undefined) delete process.env.RESEARCH_DIGEST_PILOT_EMAILS
    else process.env.RESEARCH_DIGEST_PILOT_EMAILS = previous
  }
})

test('booleans are coerced rather than passed through', () => {
  const next = buildDigestSettingsPatch(
    { publicEnabled: 'yes', automaticSelection: false, sendEmpty: 1, pilotMode: null },
    {}
  )

  assert.equal(next.publicEnabled, false, 'only a literal true enables public launch')
  assert.equal(next.automaticSelection, false)
  assert.equal(next.sendEmpty, false)
  assert.equal(next.pilotMode, false)
})

test('pilot mode with no recipients is flagged', () => {
  const warnings = findDigestSettingsWarnings({ pilotMode: true, pilotRecipients: [], publicEnabled: true })
  assert.ok(warnings.some((warning) => /pilot recipients/i.test(warning)))
})

test('a paused configuration explains that scheduled sends skip', () => {
  const warnings = findDigestSettingsWarnings(
    { publicEnabled: false, pilotMode: false, automaticSelection: true },
    { testing: { enabled: false, recipients: [] } }
  )
  assert.ok(warnings.some((warning) => /skip/i.test(warning)))
})

test('a healthy configuration produces no warnings', () => {
  const warnings = findDigestSettingsWarnings(
    { publicEnabled: true, pilotMode: false, automaticSelection: true, minPriorityScore: 75 },
    { subscriberCounts: { deliverable: 12 }, testing: { enabled: false, recipients: [] } }
  )
  assert.deepEqual(warnings, [])
})

test('the admin pool query adds display fields without changing the filter', () => {
  const selectionQuery = buildDigestSelectionPoolQuery()
  const adminQuery = buildDigestSelectionPoolQuery({ includeAdminFields: true })

  const filterOf = (query) => query.slice(0, query.indexOf(']{') + 1)
  assert.equal(filterOf(adminQuery), filterOf(selectionQuery))
  assert.doesNotMatch(selectionQuery, /\btitle\b/)
  assert.match(adminQuery, /\btitle\b/)
  assert.match(adminQuery, /carriedOverFrom/)
})
