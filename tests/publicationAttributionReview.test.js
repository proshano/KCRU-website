import assert from 'node:assert/strict'
import test from 'node:test'

import { retainPublications } from '../lib/publicationRetention.js'
import {
  buildPublicationAttributionReviewDocument,
  canManagePublicationAttributionReviews,
  decidePublicationAttributionReview,
  filterRejectedProvenance,
  mergeApprovedReviewSnapshots,
  resolveAutomaticallyConfirmedAttributionReviews,
  upsertPublicationAttributionCandidates,
} from '../lib/publicationAttributionReview.js'

function researcher(overrides = {}) {
  return { _id: 'researcher-1', name: 'Jane Smith', publicationExclusions: [], ...overrides }
}

function publication(overrides = {}) {
  return {
    doi: '10.1000/candidate',
    source: 'crossref',
    sources: ['crossref'],
    title: 'Candidate publication',
    authors: ['Jane Smith'],
    attributionAuthors: [{ given: 'Jane', family: 'Smith' }],
    abstract: 'A sufficiently detailed abstract for publication.',
    ...overrides,
  }
}

function review(status, overrides = {}) {
  return buildPublicationAttributionReviewDocument({
    researcher: researcher(),
    publication: publication(),
    evaluation: { reason: 'Needs review.', evidence: { nameKind: 'full' } },
    status,
    reviewedBy: status === 'pending' ? null : 'reviewer@example.test',
    now: new Date('2026-08-25T10:00:00Z'),
    ...overrides,
  })
}

test('pending candidates remain outside publication provenance', () => {
  const merged = mergeApprovedReviewSnapshots({
    publications: [],
    provenance: {},
    reviews: [review('pending')],
    researchers: [researcher()],
  })
  assert.deepEqual(merged.publications, [])
  assert.deepEqual(merged.provenance, {})
})

test('approved candidates publish from their stored snapshot on the next refresh', () => {
  const merged = mergeApprovedReviewSnapshots({
    publications: [],
    provenance: {},
    reviews: [review('approved')],
    researchers: [researcher()],
  })
  assert.equal(merged.publications.length, 1)
  assert.deepEqual(merged.provenance['doi:10.1000/candidate'], ['researcher-1'])
})

test('rejected provenance cannot return through retention', () => {
  const rejected = review('rejected')
  const filtered = filterRejectedProvenance({
    provenance: { 'doi:10.1000/candidate': ['researcher-1'] },
    researchers: [researcher()],
    reviews: [rejected],
  })
  const retained = retainPublications({
    cachedPublications: [publication()],
    fetchedPublications: [],
    cachedProvenance: filtered,
    fetchedProvenance: {},
    discoveryDegraded: true,
    requireAttribution: true,
  })
  assert.deepEqual(filtered, {})
  assert.equal(retained.publications.length, 0)
  assert.equal(retained.removed[0].reason, 'no-valid-attribution')
})

test('a multi-researcher publication keeps its valid attribution', () => {
  const rejected = review('rejected')
  const other = researcher({ _id: 'researcher-2', name: 'Alex Brown' })
  const filtered = filterRejectedProvenance({
    provenance: { 'doi:10.1000/candidate': ['researcher-1', 'researcher-2'] },
    researchers: [researcher(), other],
    reviews: [rejected],
  })
  const retained = retainPublications({
    cachedPublications: [publication()],
    fetchedPublications: [],
    cachedProvenance: filtered,
    fetchedProvenance: {},
    discoveryDegraded: true,
    requireAttribution: true,
  })
  assert.deepEqual(filtered['doi:10.1000/candidate'], ['researcher-2'])
  assert.equal(retained.publications.length, 1)
})

test('candidate upserts deduplicate and do not overwrite an existing decision', async () => {
  const operations = []
  const transaction = {
    createIfNotExists(document) { operations.push({ type: 'create', document }); return this },
    patch(id, builder) {
      const patchData = {}
      builder({ set(value) { Object.assign(patchData, value); return this } })
      operations.push({ type: 'patch', id, patchData })
      return this
    },
    async commit() {},
  }
  const writeClient = {
    config: () => ({ token: 'configured' }),
    transaction: () => transaction,
  }
  const candidate = {
    researcher: researcher(),
    publication: publication(),
    evaluation: { reason: 'Needs review.', evidence: {} },
  }
  const result = await upsertPublicationAttributionCandidates({
    writeClient,
    candidates: [candidate, candidate],
  })

  assert.equal(result.upserted, 1)
  assert.equal(operations.filter((operation) => operation.type === 'create').length, 1)
  const refreshPatch = operations.find((operation) => operation.type === 'patch').patchData
  assert.equal(Object.hasOwn(refreshPatch, 'status'), false)
  assert.equal(Object.hasOwn(refreshPatch, 'reviewedAt'), false)
})

test('a pending review that gains decisive evidence is resolved before publication', async () => {
  const operations = []
  const transaction = {
    patch(id, builder) {
      const operation = { id, revision: null, patchData: {} }
      const patch = {
        ifRevisionId(revision) { operation.revision = revision; return this },
        set(value) { Object.assign(operation.patchData, value); return this },
      }
      builder(patch)
      operations.push(operation)
      return this
    },
    async commit() {},
  }
  const result = await resolveAutomaticallyConfirmedAttributionReviews({
    writeClient: {
      config: () => ({ token: 'configured' }),
      transaction: () => transaction,
    },
    resolutions: [{
      review: { _id: 'review-1', _rev: 'revision-1', status: 'pending' },
      reason: 'researcher-specific PubMed query',
    }],
    now: new Date('2026-08-25T12:00:00Z'),
  })
  assert.equal(result.resolved, 1)
  assert.equal(operations[0].revision, 'revision-1')
  assert.equal(operations[0].patchData.status, 'approved')
  assert.match(operations[0].patchData.reviewedBy, /^automatic:/)
})

function decisionClient(existingReview) {
  const operations = []
  const transaction = {
    patch(id, builder) {
      const patchData = {}
      builder({ set(value) { Object.assign(patchData, value); return this } })
      operations.push({ id, patchData })
      return this
    },
    async commit() {},
  }
  return {
    operations,
    client: {
      config: () => ({ token: 'configured' }),
      fetch: async () => existingReview,
      transaction: () => transaction,
    },
  }
}

test('approval admins are authorized and decisions are reversible', async () => {
  assert.equal(canManagePublicationAttributionReviews({ approvals: true }), true)
  assert.equal(canManagePublicationAttributionReviews({ updates: true }), false)

  const existingReview = {
    _id: 'review-1',
    publicationKey: 'doi:10.1000/candidate',
    doi: '10.1000/candidate',
    researcher: { _ref: 'researcher-1' },
    researcherDetails: {
      _id: 'researcher-1',
      publicationExclusions: ['doi:10.1000/candidate', 'pmid:123'],
    },
  }
  const approved = decisionClient(existingReview)
  const approvalResult = await decidePublicationAttributionReview({
    writeClient: approved.client,
    reviewId: 'review-1',
    decision: 'approved',
    reviewerEmail: 'ADMIN@EXAMPLE.TEST',
    now: new Date('2026-08-25T12:00:00Z'),
  })
  assert.equal(approvalResult.ok, true)
  assert.deepEqual(approved.operations[1].patchData.publicationExclusions, ['pmid:123'])

  const rejected = decisionClient({
    ...existingReview,
    researcherDetails: { _id: 'researcher-1', publicationExclusions: ['pmid:123'] },
  })
  const rejectionResult = await decidePublicationAttributionReview({
    writeClient: rejected.client,
    reviewId: 'review-1',
    decision: 'rejected',
    reviewerEmail: 'admin@example.test',
  })
  assert.equal(rejectionResult.ok, true)
  assert.deepEqual(rejected.operations[1].patchData.publicationExclusions, [
    'pmid:123',
    'doi:10.1000/candidate',
  ])
})
