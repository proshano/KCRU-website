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
  sweepCoauthorAttributions,
  upsertPublicationAttributionCandidates,
  vetPubmedAttributions,
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

test('legacy DOI formatting cannot bypass a manual rejection or split an approved snapshot', () => {
  const legacy = review('rejected')
  legacy.publicationKey = 'doi:pii: 80. 10.1000/candidate'
  legacy.snapshot.doi = 'pii: 80. 10.1000/candidate'
  assert.deepEqual(filterRejectedProvenance({
    provenance: { 'doi:10.1000/candidate': ['researcher-1'] },
    researchers: [researcher()],
    reviews: [legacy],
  }), {})

  legacy.status = 'approved'
  const merged = mergeApprovedReviewSnapshots({
    publications: [publication()],
    provenance: {},
    researchers: [researcher()],
    reviews: [legacy],
  })
  assert.equal(merged.publications.length, 1)
  assert.deepEqual(merged.provenance, { 'doi:10.1000/candidate': ['researcher-1'] })
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

test('an explicit PubMed namesake is discarded before review while other researcher links survive', () => {
  const matt = researcher({ name: 'Matthew Weir', publicationAuthorName: 'Matthew A Weir' })
  const other = researcher({ _id: 'researcher-2', name: 'Jane Smith' })
  const paper = publication({ source: 'pubmed', attributionAuthors: [
    { given: 'William B', family: 'Weir' },
    { given: 'Jane', family: 'Smith' },
  ] })
  const result = vetPubmedAttributions({
    publications: [paper],
    provenance: { 'doi:10.1000/candidate': [matt._id, other._id] },
    researchers: [matt, other],
  })
  assert.deepEqual(result.provenance, { 'doi:10.1000/candidate': [other._id] })
  assert.equal(result.publications.length, 1)
  assert.deepEqual(result.candidates, [])
  assert.deepEqual(result.rejectedAttributions, [{ researcherId: matt._id, publicationKey: 'doi:10.1000/candidate' }])
  const filtered = filterRejectedProvenance({
    provenance: { 'doi:10.1000/candidate': [matt._id, other._id] },
    researchers: [matt, other],
    rejectedAttributions: result.rejectedAttributions,
  })
  assert.deepEqual(filtered, { 'doi:10.1000/candidate': [other._id] })
})

test('a cached namesake cannot return through retention without a stored review rejection', () => {
  const matt = researcher({ name: 'Matthew Weir', publicationAuthorName: 'Matthew A Weir' })
  const paper = publication({ attributionAuthors: [{ given: 'Christopher', family: 'Weir' }] })
  const provenance = { 'doi:10.1000/candidate': [matt._id] }
  const vetted = vetPubmedAttributions({ publications: [paper], provenance, researchers: [matt] })
  const filtered = filterRejectedProvenance({
    provenance,
    researchers: [matt],
    rejectedAttributions: vetted.rejectedAttributions,
  })
  const result = retainPublications({
    cachedPublications: [paper],
    fetchedPublications: vetted.publications,
    cachedProvenance: filtered,
    fetchedProvenance: vetted.provenance,
    discoveryDegraded: true,
    requireAttribution: true,
  })
  assert.deepEqual(vetted.candidates, [])
  assert.deepEqual(result.publications, [])
  assert.deepEqual(result.provenance, {})
  assert.equal(result.removed[0].reason, 'no-valid-attribution')
})

test('missing PubMed contributor metadata still creates a review candidate', () => {
  const result = vetPubmedAttributions({
    publications: [publication({ authors: [], attributionAuthors: [] })],
    provenance: { 'doi:10.1000/candidate': ['researcher-1'] },
    researchers: [researcher()],
  })
  assert.deepEqual(result.provenance, {})
  assert.deepEqual(result.rejectedAttributions, [])
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].evaluation.decision, 'hold')
})

test('PubMed collaborator evidence preserves genuine papers without a byline match', () => {
  const result = vetPubmedAttributions({
    publications: [publication({ attributionAuthors: [{ given: 'Jane', family: 'Smith', role: 'investigator' }] })],
    provenance: { 'doi:10.1000/candidate': ['researcher-1'] },
    researchers: [researcher()],
  })
  assert.deepEqual(result.provenance, { 'doi:10.1000/candidate': ['researcher-1'] })
  assert.equal(result.candidates.length, 0)
})

test('a pending PubMed namesake cannot be automatically approved or restored by retention', () => {
  const pending = review('pending')
  const result = vetPubmedAttributions({
    publications: [publication({ attributionAuthors: [{ given: 'John', family: 'Smith' }] })],
    provenance: { 'doi:10.1000/candidate': ['researcher-1'] },
    researchers: [researcher()],
    reviews: [pending],
  })
  assert.deepEqual(result.provenance, {})
  assert.deepEqual(result.resolutions, [])
  const filtered = filterRejectedProvenance({
    provenance: { 'doi:10.1000/candidate': ['researcher-1'] },
    researchers: [researcher()],
    reviews: [pending],
    excludePending: true,
  })
  const retained = retainPublications({
    cachedPublications: [publication()],
    cachedProvenance: filtered,
    discoveryDegraded: true,
    requireAttribution: true,
  })
  assert.deepEqual(retained.publications, [])
})

function coauthor(overrides = {}) {
  return { _id: 'researcher-2', name: 'John Doe', orcid: '0000-0002-1825-0097', publicationExclusions: [], ...overrides }
}

const decisiveCoauthor = { given: 'John', family: 'Doe', orcid: '0000-0002-1825-0097', orcidSource: 'crossref' }
const nameOnlyCoauthor = { given: 'John', family: 'Doe' }

function coauthorPaper(coauthorEntry, overrides = {}) {
  return publication({ attributionAuthors: [{ given: 'Jane', family: 'Smith' }, coauthorEntry], ...overrides })
}

function sweep(options = {}) {
  return sweepCoauthorAttributions({
    publications: [coauthorPaper(decisiveCoauthor)],
    provenance: { 'doi:10.1000/candidate': ['researcher-1'] },
    researchers: [researcher(), coauthor()],
    ...options,
  })
}

test('the coauthor sweep attributes a paper to a second researcher with decisive evidence', () => {
  const result = sweep()
  assert.deepEqual(result.additions, { 'doi:10.1000/candidate': ['researcher-2'] })
  assert.deepEqual(result.candidates, [])
  assert.equal(result.stats.evaluated, 1)
  assert.equal(result.stats.confirmed, 1)
  assert.equal(result.stats.carried, 0)
  assert.equal(result.decisions.length, 1)
  assert.equal(result.decisions[0].decision, 'confirmed')
})

test('the coauthor sweep holds a name-only coauthor for review instead of publishing it', () => {
  const result = sweep({ publications: [coauthorPaper(nameOnlyCoauthor)] })
  assert.deepEqual(result.additions, {})
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].researcher._id, 'researcher-2')
  assert.equal(result.candidates[0].evaluation.decision, 'hold')
  assert.equal(result.stats.held, 1)
})

test('the coauthor sweep never treats a coauthor as a PubMed-confirmed hit', () => {
  const result = sweep({
    publications: [coauthorPaper(nameOnlyCoauthor, { source: 'pubmed', sources: ['pubmed'] })],
  })
  assert.deepEqual(result.additions, {})
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].evaluation.decision, 'hold')
  assert.equal(result.candidates[0].evaluation.evidence.isPubmedConfirmed, false)
})

test('the coauthor sweep skips excluded, rejected and degraded researchers', () => {
  for (const options of [
    { researchers: [researcher(), coauthor({ publicationExclusions: ['doi:10.1000/candidate'] })] },
    { reviews: [review('rejected', { researcher: coauthor() })] },
    { skipResearcherIds: ['researcher-2'] },
  ]) {
    const result = sweep(options)
    const label = Object.keys(options).join()
    assert.deepEqual(result.additions, {}, label)
    assert.deepEqual(result.candidates, [], label)
  }
})

test('the coauthor sweep re-confirms a link it added in an earlier run', () => {
  const result = sweep({ existingProvenance: { 'doi:10.1000/candidate': ['researcher-2'] } })
  assert.deepEqual(result.additions, { 'doi:10.1000/candidate': ['researcher-2'] })
  assert.deepEqual(result.candidates, [])
  assert.equal(result.stats.confirmed, 1)
  assert.equal(result.stats.carried, 1)
})

test('a carried-forward pair without decisive evidence is neither re-added nor sent to review', () => {
  const result = sweep({
    publications: [coauthorPaper(nameOnlyCoauthor)],
    existingProvenance: { 'doi:10.1000/candidate': ['researcher-2'] },
  })
  assert.deepEqual(result.additions, {})
  assert.deepEqual(result.candidates, [])
  assert.equal(result.stats.held, 0)
  assert.equal(result.decisions.length, 1)
  assert.equal(result.decisions[0].decision, 'hold')
})

test('the coauthor sweep ignores researchers who are not on the byline', () => {
  const result = sweep({ publications: [coauthorPaper({ given: 'Jonathan', family: 'Doe' })] })
  assert.equal(result.stats.evaluated, 0)
  assert.deepEqual(result.candidates, [])
})

test('the coauthor sweep does not count an investigator-list appearance as coauthorship', () => {
  const result = sweep({ publications: [coauthorPaper({ ...decisiveCoauthor, role: 'investigator' })] })
  assert.equal(result.stats.evaluated, 0)
  assert.deepEqual(result.additions, {})
  assert.deepEqual(result.candidates, [])
})

test('the coauthor sweep resolves a pending review that gains decisive evidence', () => {
  const pending = review('pending', { researcher: coauthor() })
  const result = sweep({ reviews: [pending] })
  assert.deepEqual(result.additions, { 'doi:10.1000/candidate': ['researcher-2'] })
  assert.equal(result.resolutions.length, 1)
  assert.equal(result.resolutions[0].review, pending)
  assert.equal(result.candidates.length, 1)
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
    review: { _id: 'legacy-review-id', status: 'approved' },
  }
  const result = await upsertPublicationAttributionCandidates({
    writeClient,
    candidates: [candidate, candidate],
  })

  assert.equal(result.upserted, 1)
  assert.equal(operations.filter((operation) => operation.type === 'create').length, 1)
  const refreshPatch = operations.find((operation) => operation.type === 'patch').patchData
  assert.equal(operations.find((operation) => operation.type === 'patch').id, 'legacy-review-id')
  assert.equal(operations.find((operation) => operation.type === 'create').document._id, 'legacy-review-id')
  assert.equal(Object.hasOwn(refreshPatch, 'status'), false)
  assert.equal(Object.hasOwn(refreshPatch, 'reviewedAt'), false)
  assert.equal(Object.hasOwn(refreshPatch, 'lastNotifiedAt'), false)
})

test('candidate upserts commit in size-bounded batches', async () => {
  const candidates = ['10.1000/one', '10.1000/two', '10.1000/three'].map((doi) => ({
    researcher: researcher(),
    publication: publication({ doi }),
    evaluation: { reason: 'Needs review.', evidence: {} },
  }))
  function batchingClient() {
    const state = { commits: 0, creates: [] }
    const writeClient = {
      config: () => ({ token: 'configured' }),
      transaction: () => ({
        createIfNotExists(document) { state.creates.push(document._id); return this },
        patch() { return this },
        async commit() { state.commits += 1 },
      }),
    }
    return { state, writeClient }
  }

  const bounded = batchingClient()
  const boundedResult = await upsertPublicationAttributionCandidates({
    writeClient: bounded.writeClient,
    candidates,
    maxMutationBytes: 1,
  })
  assert.equal(boundedResult.upserted, 3)
  assert.equal(boundedResult.batches, 3)
  assert.equal(bounded.state.commits, 3)
  assert.equal(bounded.state.creates.length, 3)

  const single = batchingClient()
  const singleResult = await upsertPublicationAttributionCandidates({
    writeClient: single.writeClient,
    candidates,
  })
  assert.equal(singleResult.upserted, 3)
  assert.equal(singleResult.batches, 1)
  assert.equal(single.state.commits, 1)
  assert.equal(single.state.creates.length, 3)
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
