import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAttributionFingerprints,
  classifyResearcherAuthor,
  decideAttributionEvidence,
  evaluatePublicationAttribution,
  getPublicationAttributionReviewId,
} from '../lib/publicationAttribution.js'

test('recognizes full and abbreviated versions of a researcher name', () => {
  const researcher = { name: 'Danielle Nash' }

  assert.equal(classifyResearcherAuthor({ given: 'Danielle M.', family: 'Nash' }, researcher)?.kind, 'full')
  assert.equal(classifyResearcherAuthor({ given: 'D.', family: 'Nash' }, researcher)?.kind, 'abbreviated')
  assert.equal(classifyResearcherAuthor({ given: 'David', family: 'Nash' }, researcher), null)
})

test('allows an omitted middle initial but rejects an explicit conflict', () => {
  const researcher = { name: 'Matthew Weir', publicationAuthorName: 'Matthew A. Weir' }

  assert.equal(classifyResearcherAuthor({ given: 'Matthew', family: 'Weir' }, researcher)?.kind, 'full')
  assert.equal(classifyResearcherAuthor({ given: 'Matthew A.', family: 'Weir' }, researcher)?.kind, 'full')
  assert.equal(classifyResearcherAuthor({ given: 'M. A.', family: 'Weir' }, researcher)?.kind, 'abbreviated')
  assert.equal(classifyResearcherAuthor({ given: 'Matthew R.', family: 'Weir' }, researcher), null)
})

test('confirms PubMed and ORCID evidence without requiring both', () => {
  assert.deepEqual(
    decideAttributionEvidence({ isPubmedConfirmed: true, nameKind: 'abbreviated' }),
    { decision: 'confirmed', reason: 'researcher-specific PubMed query' }
  )
  assert.deepEqual(
    decideAttributionEvidence({ hasExactOrcid: true, nameKind: 'abbreviated' }),
    { decision: 'confirmed', reason: 'exact author ORCID' }
  )
})

test('uses reviewed decisions as the durable authority', () => {
  assert.deepEqual(
    decideAttributionEvidence({ isManuallyConfirmed: true }),
    { decision: 'confirmed', reason: 'reviewed attribution' }
  )
  assert.deepEqual(
    decideAttributionEvidence({
      isManuallyConfirmed: true,
      isManuallyRejected: true,
      isPubmedConfirmed: true,
      hasExactOrcid: true,
    }),
    { decision: 'rejected', reason: 'reviewed false attribution' }
  )
})

test('confirms full names only when coauthor or affiliation evidence corroborates them', () => {
  assert.equal(decideAttributionEvidence({ nameKind: 'full' }).decision, 'hold')
  assert.equal(decideAttributionEvidence({ nameKind: 'full', recurringCoauthors: 2 }).decision, 'confirmed')
  assert.equal(decideAttributionEvidence({
    nameKind: 'full',
    hasAffiliationMatch: true,
    recurringCoauthors: 1,
  }).decision, 'confirmed')
})

test('does not confirm an abbreviated name from affiliation alone', () => {
  assert.equal(decideAttributionEvidence({
    nameKind: 'abbreviated',
    hasAffiliationMatch: true,
  }).decision, 'hold')
  assert.equal(decideAttributionEvidence({
    nameKind: 'abbreviated',
    hasAffiliationMatch: true,
    recurringCoauthors: 2,
  }).decision, 'confirmed')
})

test('holds a conflicting ORCID for review even when other signals look plausible', () => {
  assert.equal(decideAttributionEvidence({
    nameKind: 'full',
    hasConflictingOrcid: true,
    hasAffiliationMatch: true,
    recurringCoauthors: 3,
  }).decision, 'hold')
})

test('counts a recurring coauthor only after two PubMed-confirmed papers', () => {
  const researcher = { _id: 'researcher-1', name: 'Jane Smith' }
  const pubmedPublications = [1, 2].map((index) => ({
    doi: `10.1000/pubmed-${index}`,
    source: 'pubmed',
    attributionAuthors: [
      { given: 'Jane', family: 'Smith' },
      { given: 'Alex', family: 'Brown' },
    ],
  }))
  const pubmedProvenance = {
    'doi:10.1000/pubmed-1': ['researcher-1'],
    'doi:10.1000/pubmed-2': ['researcher-1'],
  }
  const fingerprints = buildAttributionFingerprints({
    researchers: [researcher],
    pubmedPublications,
    pubmedProvenance,
  })

  const result = evaluatePublicationAttribution({
    researcher,
    fingerprint: fingerprints.get(researcher._id),
    publication: {
      doi: '10.1000/candidate',
      source: 'crossref',
      attributionAuthors: [
        { given: 'Jane', family: 'Smith' },
        { given: 'Alex', family: 'Brown' },
      ],
    },
  })

  assert.equal(result.decision, 'hold')
  assert.equal(result.evidence.recurringCoauthorCount, 1)
})

test('confirms full-name candidates with two distinct recurring coauthors', () => {
  const researcher = { _id: 'researcher-1', name: 'Jane Smith' }
  const pubmedPublications = [1, 2].map((index) => ({
    doi: `10.1000/pubmed-${index}`,
    source: 'pubmed',
    attributionAuthors: [
      { given: 'Jane', family: 'Smith' },
      { given: 'Alex', family: 'Brown' },
      { given: 'Robin', family: 'Green' },
    ],
  }))
  const fingerprints = buildAttributionFingerprints({
    researchers: [researcher],
    pubmedPublications,
    pubmedProvenance: {
      'doi:10.1000/pubmed-1': ['researcher-1'],
      'doi:10.1000/pubmed-2': ['researcher-1'],
    },
  })
  const result = evaluatePublicationAttribution({
    researcher,
    fingerprint: fingerprints.get(researcher._id),
    publication: {
      doi: '10.1000/candidate',
      source: 'crossref',
      attributionAuthors: [
        { given: 'Jane', family: 'Smith' },
        { given: 'Alex', family: 'Brown' },
        { given: 'Robin', family: 'Green' },
      ],
    },
  })

  assert.equal(result.decision, 'confirmed')
  assert.equal(result.evidence.recurringCoauthorCount, 2)
})

test('an exact ORCID confirms attribution but a missing ORCID remains optional', () => {
  const researcher = { _id: 'researcher-1', name: 'Jane Smith', orcid: '0000-0001-2345-6789' }
  const exact = evaluatePublicationAttribution({
    researcher,
    publication: {
      doi: '10.1000/orcid',
      attributionAuthors: [{ given: 'J.', family: 'Smith', orcid: 'https://orcid.org/0000-0001-2345-6789' }],
    },
  })
  const missing = evaluatePublicationAttribution({
    researcher: { ...researcher, orcid: null },
    publication: {
      doi: '10.1000/no-orcid',
      attributionAuthors: [{ given: 'Jane', family: 'Smith' }],
    },
  })

  assert.equal(exact.decision, 'confirmed')
  assert.equal(missing.decision, 'hold')
})

test('review document ids are deterministic per researcher and canonical publication key', () => {
  assert.equal(
    getPublicationAttributionReviewId('researcher-1', { doi: '10.1000/ABC' }),
    getPublicationAttributionReviewId('researcher-1', 'doi:10.1000/abc')
  )
  assert.notEqual(
    getPublicationAttributionReviewId('researcher-1', 'doi:10.1000/abc'),
    getPublicationAttributionReviewId('researcher-2', 'doi:10.1000/abc')
  )
})
