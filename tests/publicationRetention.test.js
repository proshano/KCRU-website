import assert from 'node:assert/strict'
import test from 'node:test'

import { isDiscoveryCollapsed, retainPublications } from '../lib/publicationRetention.js'

const NOW = new Date('2026-08-02T09:00:00Z')

function publication(overrides = {}) {
  return {
    doi: '10.1000/kept',
    title: 'A kept paper',
    source: 'crossref',
    laySummary: 'Plain language summary.',
    ...overrides,
  }
}

test('a paper missing from a degraded run is kept without advancing its miss counter', () => {
  const cached = publication({ missingRuns: 1 })
  const result = retainPublications({
    cachedPublications: [cached],
    fetchedPublications: [],
    cachedProvenance: { 'doi:10.1000/kept': ['researcher-1'] },
    degradedResearcherIds: ['researcher-1'],
    now: NOW,
  })

  assert.equal(result.removed.length, 0)
  assert.equal(result.publications.length, 1)
  assert.equal(result.publications[0].missingRuns, 1)
  assert.equal(result.retained[0].reason, 'degraded-discovery')
  // The paper keeps its researcher attribution so the page still renders its chips.
  assert.deepEqual(result.provenance['doi:10.1000/kept'], ['researcher-1'])
})

test('a paper missing from a clean run is kept until the prune threshold is reached', () => {
  const keyed = 'doi:10.1000/kept'
  let cached = publication({ missingRuns: 0 })

  for (const expected of [1, 2]) {
    const result = retainPublications({
      cachedPublications: [cached],
      fetchedPublications: [],
      cachedProvenance: { [keyed]: ['researcher-1'] },
      degradedResearcherIds: [],
      pruneAfterMissingRuns: 3,
      now: NOW,
    })
    assert.equal(result.removed.length, 0, `run ${expected} should not prune`)
    assert.equal(result.publications[0].missingRuns, expected)
    cached = result.publications[0]
  }

  const final = retainPublications({
    cachedPublications: [cached],
    fetchedPublications: [],
    cachedProvenance: { [keyed]: ['researcher-1'] },
    degradedResearcherIds: [],
    pruneAfterMissingRuns: 3,
    now: NOW,
  })
  assert.equal(final.publications.length, 0)
  assert.equal(final.removed.length, 1)
  assert.equal(final.removed[0].reason, 'absent')
  assert.equal(final.removed[0].missingRuns, 3)
})

test('one researcher failing does not freeze pruning for another researcher', () => {
  const result = retainPublications({
    cachedPublications: [
      publication({ doi: '10.1000/degraded', missingRuns: 2 }),
      publication({ doi: '10.1000/clean', missingRuns: 2 }),
    ],
    fetchedPublications: [],
    cachedProvenance: {
      'doi:10.1000/degraded': ['researcher-1'],
      'doi:10.1000/clean': ['researcher-2'],
    },
    degradedResearcherIds: ['researcher-1'],
    pruneAfterMissingRuns: 3,
    now: NOW,
  })

  assert.deepEqual(result.publications.map((pub) => pub.doi), ['10.1000/degraded'])
  assert.deepEqual(result.removed.map((entry) => entry.publicationKey), ['doi:10.1000/clean'])
})

test('a rediscovered paper resets its miss counter and records when it was seen', () => {
  const result = retainPublications({
    cachedPublications: [publication({ missingRuns: 2 })],
    fetchedPublications: [publication()],
    fetchedProvenance: { 'doi:10.1000/kept': ['researcher-1'] },
    now: NOW,
  })

  assert.equal(result.publications.length, 1)
  assert.equal(result.publications[0].missingRuns, 0)
  assert.equal(result.publications[0].lastSeenAt, NOW.toISOString())
  assert.equal(result.retained.length, 0)
  assert.equal(result.removed.length, 0)
})

test('records held back for lacking any usable text are not resurrected from cache', () => {
  const result = retainPublications({
    cachedPublications: [publication({ doi: '10.1000/no-text', abstract: null })],
    fetchedPublications: [],
    degradedResearcherIds: [],
    isRetainable: (pub) => Boolean(pub.pmid) || pub.source === 'pubmed' || Boolean(pub.abstract),
    now: NOW,
  })

  assert.equal(result.publications.length, 0)
  assert.equal(result.removed[0].reason, 'not-retainable')
})

test('unattributed papers are protected while any researcher discovery is degraded', () => {
  const result = retainPublications({
    cachedPublications: [publication({ missingRuns: 5 })],
    fetchedPublications: [],
    cachedProvenance: {},
    degradedResearcherIds: ['researcher-1'],
    pruneAfterMissingRuns: 3,
    now: NOW,
  })

  assert.equal(result.publications.length, 1)
  assert.equal(result.retained[0].reason, 'degraded-discovery')
})

test('a collapsed result set is treated as degraded rather than as mass deletion', () => {
  assert.equal(isDiscoveryCollapsed({ cachedCount: 400, fetchedCount: 120 }), true)
  assert.equal(isDiscoveryCollapsed({ cachedCount: 400, fetchedCount: 392 }), false)
  assert.equal(isDiscoveryCollapsed({ cachedCount: 0, fetchedCount: 0 }), false)

  const result = retainPublications({
    cachedPublications: [publication({ missingRuns: 9 })],
    fetchedPublications: [],
    discoveryDegraded: true,
    pruneAfterMissingRuns: 3,
    now: NOW,
  })
  assert.equal(result.publications.length, 1)
  assert.equal(result.removed.length, 0)
})
