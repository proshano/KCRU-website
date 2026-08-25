import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DANIELLE_FALSE_DOI,
  DANIELLE_FALSE_KEY,
  planPublicationAttributionMigration,
  REVIEWED_ACTIVE_LINK_COUNT,
  REVIEWED_APPROVAL_COUNT,
  REVIEWED_CACHE_TIMESTAMP,
  REVIEWED_PUBMED_LINK_COUNT,
  REVIEWED_REJECTION_COUNT,
} from '../scripts/migrate-publication-attribution-reviews.js'

function reviewedFixture() {
  const publications = []
  const provenance = []

  for (let index = 0; index < 392; index += 1) {
    const doi = `10.1000/pubmed-${index}`
    publications.push({
      _key: `pubmed-${index}`,
      publicationKey: `doi:${doi}`,
      doi,
      source: 'pubmed',
      sources: ['pubmed'],
      title: `PubMed publication ${index}`,
      authors: ['Smith J', 'Brown A'],
      year: 2026,
      abstract: 'A complete PubMed abstract.',
    })
    provenance.push({
      _key: `pubmed-${index}`,
      publicationKey: `doi:${doi}`,
      researcherIds: index < 190 ? ['researcher-1', 'researcher-2'] : ['researcher-1'],
    })
  }

  for (let index = 0; index < 54; index += 1) {
    const isFalse = index === 53
    const doi = isFalse ? DANIELLE_FALSE_DOI : `10.1000/secondary-${index}`
    publications.push({
      _key: `secondary-${index}`,
      publicationKey: `doi:${doi}`,
      doi,
      source: 'crossref',
      sources: ['crossref'],
      title: `Secondary publication ${index}`,
      authors: [isFalse ? 'Danielle Nash' : 'Jane Smith'],
      year: 2026,
      abstract: 'A complete secondary-source abstract.',
    })
    provenance.push({
      _key: `secondary-${index}`,
      publicationKey: `doi:${doi}`,
      researcherIds: [isFalse ? 'danielle' : 'researcher-1'],
    })
  }
  provenance.push({
    _key: 'stale-entry',
    publicationKey: 'doi:10.1000/stale',
    researcherIds: ['researcher-1'],
  })

  return {
    cache: {
      _id: 'pubmedCache',
      _type: 'pubmedCache',
      lastRefreshedAt: REVIEWED_CACHE_TIMESTAMP,
      publications,
      provenance,
      stats: { totalPublications: publications.length },
    },
    researchers: [
      { _id: 'researcher-1', name: 'Jane Smith', publicationExclusions: [] },
      { _id: 'researcher-2', name: 'Alex Brown', publicationExclusions: [] },
      { _id: 'danielle', name: 'Danielle Nash', publicationExclusions: [] },
    ],
    settings: { _id: 'siteSettings', _type: 'siteSettings' },
    existingReviews: [],
  }
}

test('migration dry-run reproduces 53 approvals, one rejection, and Danielle exclusion', () => {
  const plan = planPublicationAttributionMigration({
    ...reviewedFixture(),
    now: new Date('2026-08-25T12:00:00Z'),
  })
  assert.equal(plan.counts.activeLinks, REVIEWED_ACTIVE_LINK_COUNT)
  assert.equal(plan.counts.pubmedConfirmedLinks, REVIEWED_PUBMED_LINK_COUNT)
  assert.equal(plan.counts.approvedReviews, REVIEWED_APPROVAL_COUNT)
  assert.equal(plan.counts.rejectedReviews, REVIEWED_REJECTION_COUNT)
  assert.equal(plan.reviewDocuments.filter((document) => document.status === 'approved').length, 53)
  assert.equal(plan.reviewDocuments.filter((document) => document.status === 'rejected').length, 1)
  assert.ok(plan.danielleExclusions.includes(DANIELLE_FALSE_KEY))
  assert.equal(plan.correctedCache.publications.some((publication) => publication.doi === DANIELLE_FALSE_DOI), false)
  assert.equal(plan.counts.correctedActiveLinks, 635)
  assert.ok(plan.correctedCache.provenance.some((entry) => entry.publicationKey === 'doi:10.1000/stale'))
})

test('migration refuses a changed cache snapshot', () => {
  const fixture = reviewedFixture()
  fixture.cache.lastRefreshedAt = '2026-08-25T10:00:00.000Z'
  assert.throws(() => planPublicationAttributionMigration(fixture), /snapshot mismatch/)
})
