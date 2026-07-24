import assert from 'node:assert/strict'
import test from 'node:test'

process.env.NEXT_PUBLIC_SANITY_PROJECT_ID ||= 'abc123'
process.env.NEXT_PUBLIC_SANITY_DATASET ||= 'test'

const { parse, evaluate } = await import('groq-js')
const { buildDigestSelectionPoolQuery } = await import('../lib/researchDigest.js')
const { queries } = await import('../lib/sanity.js')

const POOL_QUERY = buildDigestSelectionPoolQuery()

// GROQ syntax errors only surface at runtime against a live dataset, so parse them here.
test('research digest GROQ queries parse', () => {
  assert.doesNotThrow(() => parse(POOL_QUERY), 'selection pool query')
  assert.doesNotThrow(() => parse(queries.researchDigestIssues), 'archive list query')
  assert.doesNotThrow(() => parse(queries.researchDigestIssueBySlug), 'archive issue query')
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
