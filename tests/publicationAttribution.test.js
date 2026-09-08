import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildAttributionFingerprints,
  classifyResearcherAuthor,
  decideAttributionEvidence,
  evaluatePublicationAttribution,
  getPublicationAttributionReviewId,
  preferPubmedAttributionMetadata,
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
  assert.equal(classifyResearcherAuthor({ given: 'MA', family: 'Weir' }, researcher)?.kind, 'abbreviated')
  assert.equal(classifyResearcherAuthor({ given: 'MR', family: 'Weir' }, researcher), null)
  assert.equal(classifyResearcherAuthor({ given: 'DJ', family: 'Weir' }, researcher), null)
})

test('only explicitly configured publication aliases extend name matching', () => {
  const researcher = { name: 'Brad Urquhart', publicationAuthorAliases: ['Bradley Urquhart'] }
  assert.equal(classifyResearcherAuthor({ given: 'Bradley L', family: 'Urquhart' }, researcher)?.kind, 'full')
  assert.equal(classifyResearcherAuthor({ given: 'Brandon', family: 'Urquhart' }, researcher), null)
  const susan = { name: 'Susan Huang', publicationAuthorAliases: ['Shih-Han Susan Huang'] }
  assert.equal(classifyResearcherAuthor({ given: 'Shih-Han', family: 'Susan Huang' }, susan)?.kind, 'full')
  assert.equal(classifyResearcherAuthor({ given: 'Chiu-Ching', family: 'Huang' }, susan), null)
})

test('a malformed publisher ORCID does not create a false identity conflict', () => {
  const result = evaluatePublicationAttribution({
    researcher: { name: 'Jane Smith', orcid: '0000-0001-2345-6789' },
    isPubmedConfirmed: true,
    publication: { attributionAuthors: [{ given: 'Jane', family: 'Smith', orcid: '0000-0001-2345-678' }] },
  })
  assert.equal(result.decision, 'confirmed')
  assert.equal(result.evidence.hasConflictingOrcid, false)
})

test('PubMed hits and ORCID metadata cannot override a different author name', () => {
  const researcher = { name: 'Matthew Weir', publicationAuthorName: 'Matthew A Weir', orcid: '0000-0001-6736-603X' }
  for (const given of ['David J', 'Matthew R', 'Michelle A']) {
    const result = evaluatePublicationAttribution({
      researcher,
      isPubmedConfirmed: true,
      publication: { attributionAuthors: [{ given, family: 'Weir', orcid: researcher.orcid }] },
    })
    assert.equal(result.decision, 'hold', given)
  }
})

test('a conflicting ORCID on a PubMed name match requires review', () => {
  assert.equal(decideAttributionEvidence({ isPubmedConfirmed: true, nameKind: 'full', hasConflictingOrcid: true }).decision, 'hold')
})

test('verified PubMed metadata prevents a secondary namesake label from hiding a genuine paper', () => {
  const researcher = { name: 'Matthew Weir', publicationAuthorName: 'Matthew A Weir' }
  const secondary = {
    source: 'openalex', sources: ['openalex'], attributionQueryPaths: ['openalex:orcid'],
    authors: ['M. Lynn Weir'], attributionAuthors: [{ given: 'M. Lynn', family: 'Weir' }],
  }
  const pubmed = {
    source: 'pubmed', sources: ['pubmed'], attributionQueryPaths: ['pubmed:researcher-query'],
    authors: ['Weir M'], attributionAuthors: [{ given: 'Matthew', family: 'Weir' }],
  }
  const publication = preferPubmedAttributionMetadata(secondary, pubmed)
  const result = evaluatePublicationAttribution({ researcher, publication, isPubmedConfirmed: true })
  assert.equal(result.decision, 'confirmed')
  assert.equal(result.evidence.matchedAuthor, 'Matthew Weir')
  assert.deepEqual(publication.authors, ['Weir M'])
  assert.deepEqual(result.evidence.queryPaths, ['openalex:orcid', 'pubmed:researcher-query'])
  assert.equal(evaluatePublicationAttribution({ researcher, publication: secondary }).decision, 'hold')
})

test('confirms PubMed and ORCID evidence without requiring both', () => {
  assert.deepEqual(
    decideAttributionEvidence({ isPubmedConfirmed: true, nameKind: 'abbreviated' }),
    { decision: 'confirmed', reason: 'compatible indexed PubMed author or collaborator' }
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
