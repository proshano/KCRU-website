import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PUBLICATION_BROWSER_FIELDS,
  comparePublicationsByDisplayDate,
  findResearchersForPublication,
  pickProvenanceForPublications,
  toPublicationBrowserRecord,
} from '../lib/publicationUtils.js'
import { getPublicationAnchorId, getPublicationKey, getProvenanceIds } from '../lib/publicationIdentity.js'
import { isPublicationExcluded } from '../lib/publicationExclusions.js'

const cachedPublication = {
  publicationKey: 'doi:10.1000/abc',
  doi: '10.1000/abc',
  pmid: '123',
  title: 'A trial of something',
  authors: ['Garg AX', 'Jain AK'],
  journal: 'Kidney Journal',
  year: 2026,
  publishedAt: '2026-03-04T00:00:00.000Z',
  url: 'https://doi.org/10.1000/abc',
  laySummary: 'Plain words about the paper.',
  topics: ['Hemodialysis'],
  studyDesign: ['Interventional Study'],
  methodologicalFocus: ['Pragmatic Trial'],
  // Server-only bookkeeping the browser never reads.
  abstract: 'A long abstract that should stay on the server.',
  abstractContentType: 'abstract',
  abstractSource: 'pubmed',
  publicationTypes: ['Journal Article'],
  lastSeenAt: '2026-03-05T00:00:00.000Z',
  missingRuns: 0,
  openAlexId: 'W123',
  pubmedUrl: 'https://pubmed.ncbi.nlm.nih.gov/123/',
  sources: ['pubmed'],
  attributionAuthors: [{ name: 'Garg AX' }],
  exclude: false,
  _key: 'abc',
}

test('toPublicationBrowserRecord keeps the rendered fields and drops server bookkeeping', () => {
  const record = toPublicationBrowserRecord(cachedPublication)

  assert.deepEqual(
    Object.keys(record).sort(),
    PUBLICATION_BROWSER_FIELDS.filter((field) => cachedPublication[field] !== undefined).sort()
  )
  for (const field of ['abstract', 'abstractContentType', 'abstractSource', 'publicationTypes', 'lastSeenAt', 'missingRuns', 'openAlexId', 'pubmedUrl', 'sources', 'attributionAuthors', '_key']) {
    assert.equal(field in record, false, `${field} should not reach the browser`)
  }
  // Identity, anchor and ordering are unchanged by the projection.
  assert.equal(getPublicationKey(record), getPublicationKey(cachedPublication))
  assert.equal(getPublicationAnchorId(record), getPublicationAnchorId(cachedPublication))
  assert.equal(comparePublicationsByDisplayDate(record, cachedPublication), 0)
})

test('toPublicationBrowserRecord omits null values and ignores a missing publication', () => {
  assert.deepEqual(toPublicationBrowserRecord({ title: 'Only a title', doi: null, pmid: undefined }), { title: 'Only a title' })
  assert.deepEqual(toPublicationBrowserRecord(undefined), {})
})

test('a paper the server kept is never excluded again from its browser record', () => {
  // A Comment-typed paper with a real abstract is kept by the server rule; without the
  // abstract the client-side check must not turn it into correspondence.
  const commentary = { pmid: '5', title: 'A substantive commentary', abstract: 'A real abstract.', publicationTypes: ['Comment'] }
  assert.equal(isPublicationExcluded(commentary), false)
  assert.equal(isPublicationExcluded(toPublicationBrowserRecord(commentary)), false)

  const letter = { pmid: '6', title: 'A letter without an abstract', publicationTypes: ['Letter'] }
  assert.equal(isPublicationExcluded(letter), false)
  assert.equal(isPublicationExcluded(toPublicationBrowserRecord(letter)), false)
})

test('pickProvenanceForPublications keeps the entries getProvenanceIds reads', () => {
  const publications = [{ doi: '10.1000/x', pmid: '1' }, { pmid: '2' }, { pmid: '3' }]
  const provenance = { 'doi:10.1000/x': ['r1'], '2': ['r2'], 'doi:10.1000/other': ['r3'] }

  const picked = pickProvenanceForPublications(publications, provenance)

  assert.deepEqual(picked, { 'doi:10.1000/x': ['r1'], '2': ['r2'] })
  for (const publication of publications) {
    const record = toPublicationBrowserRecord(publication)
    assert.deepEqual(getProvenanceIds(record, picked), getProvenanceIds(publication, provenance))
  }
})

test('researcher chips resolve the same from the browser record', () => {
  const researchers = [{ _id: 'r1', name: 'Amit Garg' }, { _id: 'r2', name: 'Arsh Jain' }]
  const provenance = { 'doi:10.1000/abc': ['r2'] }
  const picked = pickProvenanceForPublications([cachedPublication], provenance)

  assert.deepEqual(
    findResearchersForPublication(toPublicationBrowserRecord(cachedPublication), researchers, picked),
    findResearchersForPublication(cachedPublication, researchers, provenance)
  )
})
