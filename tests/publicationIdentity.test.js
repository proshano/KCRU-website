import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getPublicationKey,
  mergePublications,
  normalizeDoi,
  withPublicationKey,
} from '../lib/publicationIdentity.js'

test('discovery sources are deduplicated and ordered so comparisons are stable', () => {
  const withCrossref = mergePublications([
    { source: 'pubmed', doi: '10.1000/stable', sources: ['pubmed'] },
    { source: 'crossref', doi: '10.1000/stable', sources: ['crossref'] },
    { source: 'europepmc', doi: '10.1000/stable', sources: ['europepmc'] },
  ])[0]
  const reordered = mergePublications([
    { source: 'europepmc', doi: '10.1000/stable', sources: ['europepmc'] },
    { source: 'pubmed', doi: '10.1000/stable', sources: ['pubmed'] },
    { source: 'crossref', doi: '10.1000/stable', sources: ['crossref'] },
  ])[0]

  assert.deepEqual(withCrossref.sources, ['crossref', 'europepmc', 'pubmed'])
  assert.deepEqual(withCrossref.sources, reordered.sources)
})

test('the primary source is always represented in the sources list', () => {
  assert.deepEqual(withPublicationKey({ source: 'pubmed', doi: '10.1000/x' }).sources, ['pubmed'])
  assert.deepEqual(withPublicationKey({ doi: '10.1000/x' }).sources, [])
})

test('normalizes DOI variants into one canonical publication key', () => {
  assert.equal(normalizeDoi(' HTTPS://doi.org/10.1000/Example '), '10.1000/example')
  assert.equal(getPublicationKey({ doi: 'doi:10.1000/EXAMPLE' }), 'doi:10.1000/example')
})

test('merges a DOI-only discovery into its later PubMed record', () => {
  const [publication] = mergePublications([
    {
      source: 'crossref',
      sources: ['crossref'],
      doi: '10.1000/example',
      title: 'Early online title',
      abstract: 'A detailed abstract supplied by the publisher. '.repeat(4),
      url: 'https://doi.org/10.1000/example',
    },
    {
      source: 'pubmed',
      sources: ['pubmed'],
      pmid: '12345678',
      doi: 'https://doi.org/10.1000/EXAMPLE',
      title: 'Final indexed title',
      abstract: '',
      url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/',
    },
  ])

  assert.equal(publication.publicationKey, 'doi:10.1000/example')
  assert.equal(publication.pmid, '12345678')
  assert.equal(publication.title, 'Final indexed title')
  assert.match(publication.abstract, /detailed abstract/)
  assert.deepEqual(publication.sources.sort(), ['crossref', 'pubmed'])
})

test('replaces a longer article-body fallback when a true abstract becomes available', () => {
  const bodyText = 'Long publisher article body text. '.repeat(100)
  const trueAbstract = 'A shorter but authoritative indexed abstract describing the study findings. '.repeat(2)
  const [publication] = mergePublications([
    {
      source: 'crossref',
      doi: '10.1000/content-priority',
      abstract: bodyText,
      abstractContentType: 'article_body',
      abstractSource: 'publisher browser',
    },
    {
      source: 'pubmed',
      doi: '10.1000/content-priority',
      pmid: '99887766',
      abstract: trueAbstract,
      abstractContentType: 'abstract',
      abstractSource: 'pubmed',
    },
  ])

  assert.equal(publication.abstract, trueAbstract.trim())
  assert.equal(publication.abstractContentType, 'abstract')
  assert.equal(publication.abstractSource, 'pubmed')
})

test('replaces longer unlabeled legacy text with a newly labeled abstract', () => {
  const [publication] = mergePublications([
    {
      source: 'crossref',
      doi: '10.1000/legacy-content',
      abstract: 'Legacy cached publisher text. '.repeat(100),
    },
    {
      source: 'pubmed',
      doi: '10.1000/legacy-content',
      abstract: 'The newly indexed abstract reports the study methods and findings. '.repeat(2),
      abstractContentType: 'abstract',
      abstractSource: 'pubmed',
    },
  ])

  assert.match(publication.abstract, /newly indexed abstract/)
  assert.equal(publication.abstractContentType, 'abstract')
})
