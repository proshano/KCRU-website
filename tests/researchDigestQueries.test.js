import assert from 'node:assert/strict'
import test from 'node:test'

process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ||= 'abc123'
process.env.NEXT_PUBLIC_SANITY_DATASET ||= 'test'

const { parse, evaluate } = await import('groq-js')
const { buildDigestSelectionPoolQuery } = await import('../lib/researchDigest.js')
const { buildResearchDigestAdminQuery } = await import('../lib/researchDigestAdminView.js')
const { queries } = await import('../lib/sanity.js')

const POOL_QUERY = buildDigestSelectionPoolQuery()
const ADMIN_QUERY = buildResearchDigestAdminQuery()

// GROQ syntax errors only surface at runtime against a live dataset, so parse them here.
test('research digest GROQ queries parse', () => {
  assert.doesNotThrow(() => parse(POOL_QUERY), 'selection pool query')
  assert.doesNotThrow(() => parse(buildDigestSelectionPoolQuery({ includeAdminFields: true })), 'admin pool query')
  assert.doesNotThrow(() => parse(ADMIN_QUERY), 'admin console payload query')
  assert.doesNotThrow(() => parse(queries.researchDigestIssues), 'archive list query')
  assert.doesNotThrow(() => parse(queries.researchDigestIssueBySlug), 'archive issue query')
})

// The admin query embeds the selection-pool sub-query, which reads $issueDate. Introducing a
// separate $date param for the outer sections leaves the pool comparing against undefined, which
// quietly drops every already-selected paper instead of erroring.
test('the admin query and its embedded pool sub-query share one date parameter', () => {
  assert.match(POOL_QUERY, /\$issueDate/)
  assert.match(ADMIN_QUERY, /\$issueDate/)
  assert.doesNotMatch(ADMIN_QUERY, /\$date\b/)
})

test('the admin console query returns every section the page reads', async () => {
  const dataset = [
    { _id: 'issue-today', _type: 'researchDigestIssue', date: '2026-07-24', status: 'approved', selectedPaperCount: 1, carriedOverPaperCount: 1, slug: { current: '2026-07-24' } },
    { _id: 'issue-old', _type: 'researchDigestIssue', date: '2026-07-23', status: 'sent', selectedPaperCount: 1, slug: { current: '2026-07-23' } },
    // Discovered on the 21st, shipped on the 24th: it must count as imported on the day it was
    // found, not the day it went out, or the history row would double-count it.
    { _id: 'paper-carried', _type: 'researchDigestPaper', issueDate: '2026-07-24', discoveredDate: '2026-07-21', carriedOverFrom: '2026-07-21', approvalStatus: 'approved', autoSelectionStatus: 'selected', priorityScore: 92, title: 'Carried paper', journal: 'Kidney International' },
    { _id: 'paper-today', _type: 'researchDigestPaper', issueDate: '2026-07-24', discoveredDate: '2026-07-24', approvalStatus: 'rejected', autoSelectionStatus: 'deferred', priorityScore: 81, title: 'Today paper', journal: 'JASN' },
    { _id: 'paper-pending', _type: 'researchDigestPaper', issueDate: '2026-07-24', discoveredDate: '2026-07-24', approvalStatus: 'pending', priorityScore: 50, title: 'Pending paper', journal: 'CJASN' },
    { _id: 'sub-active', _type: 'updateSubscriber', email: 'a@example.com', correspondencePreferences: ['research_digest'], subscriptionStatus: 'subscribed', deliveryStatus: 'active' },
    { _id: 'sub-other', _type: 'updateSubscriber', email: 'b@example.com', correspondencePreferences: ['study_updates'], subscriptionStatus: 'subscribed', deliveryStatus: 'active' },
    { _id: 'opp-open', _type: 'researchOpportunity', approvalStatus: 'pending', status: 'open', title: 'A grant' },
  ]

  const tree = parse(ADMIN_QUERY)
  const value = await evaluate(tree, { dataset, params: { issueDate: '2026-07-24', carryoverFrom: '2026-07-17' } })
  const result = await value.get()

  assert.equal(result.issue._id, 'issue-today')
  assert.equal(result.history.length, 2)
  assert.equal(result.history[0].date, '2026-07-24', 'history is newest first')
  assert.equal(result.papers.length, 3)
  assert.equal(result.pool.length, 3)
  assert.equal(result.pool[0]._id, 'paper-carried', 'the pool is ordered by score')
  assert.ok('title' in result.pool[0], 'the admin pool carries display fields')
  assert.deepEqual(result.subscribers.map((row) => row.email), ['a@example.com'])
  assert.equal(result.opportunities.length, 1)
  assert.equal(result.stats.totalPapers, 3)
  assert.equal(result.stats.deferredPapers, 1)
  assert.equal(result.stats.pendingPapers, 1)

  const carriedDay = result.history.find((issue) => issue.date === '2026-07-21')
  assert.equal(carriedDay, undefined, 'no issue document exists for the discovery day')
  assert.equal(result.history[0].importedPapers, 2, 'the carried paper counts against the day it was found')
})

test('the archive queries cap papers at the hard daily ceiling', () => {
  assert.match(queries.researchDigestIssueBySlug, /\[0\.\.\.3\]/)
  assert.match(queries.researchDigestIssues, /\[0\.\.\.3\]/)
  assert.match(queries.researchDigestIssueBySlug, /order\(priorityScore desc/)
})

async function runPool(dataset, params) {
  const tree = parse(POOL_QUERY)
  const value = await evaluate(tree, { dataset, params })
  return (await value.get()).map((paper) => paper._id)
}

test('the selection pool carries deferred papers forward and locks shipped ones', async () => {
  const dataset = [
    // Imported today - always in the pool, whatever its current status.
    { _id: 'today-new', _type: 'researchDigestPaper', issueDate: '2026-07-24', discoveredDate: '2026-07-24', autoSelectionStatus: 'not_selected', approvalStatus: 'rejected' },
    // Already approved into today's issue - still re-evaluated so a rerun is idempotent.
    { _id: 'today-approved', _type: 'researchDigestPaper', issueDate: '2026-07-24', discoveredDate: '2026-07-24', autoSelectionStatus: 'selected', approvalStatus: 'approved' },
    // Qualified earlier in the window but lost its slot - the case that used to be lost forever.
    { _id: 'deferred-in-window', _type: 'researchDigestPaper', issueDate: '2026-07-21', discoveredDate: '2026-07-21', autoSelectionStatus: 'deferred', approvalStatus: 'rejected' },
    // Deferred but now stale.
    { _id: 'deferred-too-old', _type: 'researchDigestPaper', issueDate: '2026-07-10', discoveredDate: '2026-07-10', autoSelectionStatus: 'deferred', approvalStatus: 'rejected' },
    // Already shipped in an earlier issue - must never come back.
    { _id: 'already-sent', _type: 'researchDigestPaper', issueDate: '2026-07-22', discoveredDate: '2026-07-22', autoSelectionStatus: 'selected', approvalStatus: 'approved' },
    // Legacy row with no discoveredDate - falls back to issueDate.
    { _id: 'legacy-in-window', _type: 'researchDigestPaper', issueDate: '2026-07-20', autoSelectionStatus: 'not_selected', approvalStatus: 'rejected' },
    { _id: 'other-type', _type: 'researchOpportunity', issueDate: '2026-07-24' },
  ]

  const ids = await runPool(dataset, { carryoverFrom: '2026-07-17', issueDate: '2026-07-24' })

  assert.deepEqual(
    ids.sort(),
    ['deferred-in-window', 'legacy-in-window', 'today-approved', 'today-new']
  )
})

// The carryover filter leans on `field != "value"` matching documents where the field is
// absent entirely. Pin that behaviour rather than assume it.
test('the pool includes older papers whose selection fields were never written', async () => {
  const dataset = [
    { _id: 'no-selection-fields', _type: 'researchDigestPaper', issueDate: '2026-07-20', discoveredDate: '2026-07-20' },
    { _id: 'null-selection-fields', _type: 'researchDigestPaper', issueDate: '2026-07-19', discoveredDate: '2026-07-19', autoSelectionStatus: null, approvalStatus: null },
  ]

  const ids = await runPool(dataset, { carryoverFrom: '2026-07-17', issueDate: '2026-07-24' })
  assert.deepEqual(ids.sort(), ['no-selection-fields', 'null-selection-fields'])
})

test('a zero-day carryover window collapses the pool to today', async () => {
  const dataset = [
    { _id: 'today', _type: 'researchDigestPaper', issueDate: '2026-07-24', discoveredDate: '2026-07-24', autoSelectionStatus: 'not_selected', approvalStatus: 'rejected' },
    { _id: 'yesterday-deferred', _type: 'researchDigestPaper', issueDate: '2026-07-23', discoveredDate: '2026-07-23', autoSelectionStatus: 'deferred', approvalStatus: 'rejected' },
  ]

  const ids = await runPool(dataset, { carryoverFrom: '2026-07-24', issueDate: '2026-07-24' })
  assert.deepEqual(ids, ['today'])
})
