import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getPublicationAnchorId,
  getPublicationKey,
  isPlaceholderPublicationText,
  isPublicationReadyToPublish,
  mergePublications,
  needsPublicationText,
  normalizeDoi,
  normalizePublicationProvenance,
  publicationAnchorFromKey,
  replacesPlaceholderText,
  revealLinkedPublication,
  selectPreferredAbstractContent,
  withoutPlaceholderSummary,
  withPublicationKey,
} from '../lib/publicationIdentity.js'

test('publication anchors are page-safe ids built from the publication key or feed GUID', () => {
  assert.equal(publicationAnchorFromKey('doi:10.1000/ABC.def(1)'), 'paper-doi-10-1000-abc-def-1')
  assert.equal(publicationAnchorFromKey('pmid:12345'), 'paper-pmid-12345')
  assert.equal(publicationAnchorFromKey('--doi:10.1000/x--'), 'paper-doi-10-1000-x')
  assert.equal(publicationAnchorFromKey(''), '')
  assert.equal(publicationAnchorFromKey('///'), '')
  assert.equal(publicationAnchorFromKey(null), '')

  assert.equal(getPublicationAnchorId({ doi: 'https://doi.org/10.1000/XYZ', pmid: '999' }), 'paper-doi-10-1000-xyz')
  assert.equal(getPublicationAnchorId({ pmid: '999' }), 'paper-pmid-999')
  assert.equal(getPublicationAnchorId({}), '')
  assert.equal(getPublicationAnchorId(null), '')
  // The feed GUID of a paper gives the same anchor as the paper itself.
  assert.equal(publicationAnchorFromKey('doi:10.1000/xyz'), getPublicationAnchorId({ doi: '10.1000/xyz' }))
})

function fakePage({ inClosedSection = true, sectionOpen = false } = {}) {
  const section = { open: sectionOpen }
  const paper = {
    scrolled: 0,
    closest: (selector) => (selector === 'details' && inClosedSection ? section : null),
    scrollIntoView() { this.scrolled += 1 },
  }
  const lookups = []
  const doc = {
    getElementById(id) {
      lookups.push(id)
      return id === 'paper-doi-10-1000-xyz' ? paper : null
    },
  }
  return { doc, paper, section, lookups }
}

test('revealLinkedPublication opens the closed year section holding the linked paper and scrolls to it', () => {
  const page = fakePage()
  assert.equal(revealLinkedPublication('#paper-doi-10-1000-xyz', page.doc), true)
  assert.equal(page.section.open, true)
  assert.equal(page.paper.scrolled, 1)

  const encoded = fakePage()
  assert.equal(revealLinkedPublication('#paper-doi-10-1000-x%79z', encoded.doc), true)
  assert.equal(encoded.section.open, true)

  const alreadyOpen = fakePage({ sectionOpen: true })
  assert.equal(revealLinkedPublication('#paper-doi-10-1000-xyz', alreadyOpen.doc), true)
  assert.equal(alreadyOpen.section.open, true)
  assert.equal(alreadyOpen.paper.scrolled, 1)

  const outsideSection = fakePage({ inClosedSection: false })
  assert.equal(revealLinkedPublication('#paper-doi-10-1000-xyz', outsideSection.doc), true)
  assert.equal(outsideSection.paper.scrolled, 1)
})

test('revealLinkedPublication does nothing without a paper anchor or a matching paper', () => {
  for (const hash of ['', '#', '#main-content', '#paper-%E0%A4%A', undefined]) {
    const page = fakePage()
    assert.equal(revealLinkedPublication(hash, page.doc), false, String(hash))
    assert.deepEqual(page.lookups, [], String(hash))
    assert.equal(page.section.open, false)
    assert.equal(page.paper.scrolled, 0)
  }
  const missing = fakePage()
  assert.equal(revealLinkedPublication('#paper-doi-10-1000-other', missing.doc), false)
  assert.equal(missing.section.open, false)
  assert.equal(missing.paper.scrolled, 0)
  assert.equal(revealLinkedPublication('#paper-doi-10-1000-xyz', undefined), false)
})

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

test('recovers the DOI from mixed PubMed PII text and rejects a PII alone', () => {
  assert.equal(normalizeDoi('pii: 80. 10.1186/s13741-026-00715-z'), '10.1186/s13741-026-00715-z')
  assert.equal(normalizeDoi('pii: S0272-6386(26)01084-X. doi: 10.1053/j.ajkd.2026.05.023'), '10.1053/j.ajkd.2026.05.023')
  assert.equal(normalizeDoi('pii: S0272-6386(26)01084-X'), '')
  assert.equal(getPublicationKey({ doi: 'pii: 80', pmid: '42387607' }), 'pmid:42387607')
  assert.equal(normalizeDoi('10.1000/example(suffix)'), '10.1000/example(suffix)')
})

test('merges a malformed cached DOI with the real article and keeps all researcher links', () => {
  const doi = '10.1186/s13741-026-00715-z'
  const publications = [
    { source: 'pubmed', pmid: '42387607', doi, publicationKey: `doi:${doi}`, laySummary: 'Original summary.' },
    { source: 'pubmed', pmid: '42387607', doi: `pii: 80. ${doi}`, publicationKey: `doi:pii: 80. ${doi}`, laySummary: 'Duplicate summary.' },
  ]
  const merged = mergePublications(publications)
  const provenance = normalizePublicationProvenance(publications, {
    [`doi:${doi}`]: ['researcher-1'],
    [`doi:pii: 80. ${doi}`]: ['researcher-1', 'researcher-2'],
    '42387607': ['researcher-3'],
  })
  assert.equal(merged.length, 1)
  assert.equal(merged[0].doi, doi)
  assert.equal(merged[0].laySummary, 'Original summary.')
  assert.deepEqual(Object.keys(provenance), [`doi:${doi}`])
  assert.deepEqual(new Set(provenance[`doi:${doi}`]), new Set(['researcher-1', 'researcher-2', 'researcher-3']))
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

const MEETING_TITLE = 'Does Final Peritoneal Dialysis Catheter Tip Position Predict Early Catheter Dysfunction?'
const MEETING_URL = 'https://www.ovid.com/jnls/jasn/fulltext/10.1681/asn.20233411s1903b~does-final-peritoneal-dialysis-catheter-tip-position-predict'

test('recognises a link, a citation string or the title stored in place of text', () => {
  assert.equal(isPlaceholderPublicationText(MEETING_URL, MEETING_TITLE), true)
  assert.equal(isPlaceholderPublicationText(MEETING_TITLE, MEETING_TITLE), true)
  assert.equal(isPlaceholderPublicationText('Does Final Peritoneal Dialysis Catheter Tip Position Predict', MEETING_TITLE), true)
  assert.equal(isPlaceholderPublicationText('citation_journal_title=Clin Res Cardiol; citation_title=Something', 'Other'), true)

  const abstract = 'Background: It is believed that an optimal catheter position matters. Results: tip position did not predict dysfunction.'
  assert.equal(isPlaceholderPublicationText(abstract, MEETING_TITLE), false)
  assert.equal(isPlaceholderPublicationText(`${MEETING_TITLE} Background: tip position did not predict dysfunction.`, MEETING_TITLE), false)
  assert.equal(isPlaceholderPublicationText('', MEETING_TITLE), false)
})

test('real text replaces a placeholder, which is kept only while it is all there is', () => {
  const placeholder = { source: 'crossref', doi: '10.1681/asn.20233411s1903b', title: MEETING_TITLE, abstract: MEETING_URL, abstractContentType: 'abstract', abstractSource: 'publisher metadata' }
  const body = 'Background: It is believed that an optimal catheter position matters. Results: tip position did not predict dysfunction. '.repeat(5)

  const replaced = selectPreferredAbstractContent(placeholder, { abstract: body, abstractContentType: 'article_body', abstractSource: 'publisher HTML' })
  assert.match(replaced.abstract, /^Background/)
  assert.equal(replaced.abstractContentType, 'article_body')

  const kept = selectPreferredAbstractContent({ ...placeholder, abstract: null }, placeholder)
  assert.equal(kept.abstract, MEETING_URL)
  // The placeholder keeps the paper on the site; the backfill still looks for text.
  assert.equal(isPublicationReadyToPublish(placeholder), true)
  assert.equal(needsPublicationText(placeholder), true)
  assert.equal(needsPublicationText({ ...placeholder, abstract: body }), false)
  assert.equal(needsPublicationText({ ...placeholder, abstract: '' }), true)
})

test('the summary written from a placeholder is dropped once real text arrives', () => {
  const placeholder = { title: MEETING_TITLE, abstract: MEETING_URL, laySummary: 'The information provided does not include the results.' }
  assert.deepEqual(withoutPlaceholderSummary(placeholder), { laySummary: null })
  assert.deepEqual(withoutPlaceholderSummary({ ...placeholder, laySummary: null }), {})
  assert.deepEqual(withoutPlaceholderSummary({ ...placeholder, abstract: 'Background: a real abstract with methods and results that is long enough.' }), {})

  const realText = 'Background: a real abstract from OpenAlex with methods, results and a conclusion.'
  assert.equal(replacesPlaceholderText(MEETING_URL, realText, MEETING_TITLE), true)
  assert.equal(replacesPlaceholderText(MEETING_URL, MEETING_URL, MEETING_TITLE), false)
  assert.equal(replacesPlaceholderText(MEETING_URL, MEETING_TITLE, MEETING_TITLE), false)
  assert.equal(replacesPlaceholderText(realText, `${realText} More.`, MEETING_TITLE), false)
  assert.equal(replacesPlaceholderText(null, realText, MEETING_TITLE), false)
})

test('papers found outside PubMed are published only once they have usable text', () => {
  const longText = 'Rationale and objective: a retrospective cohort study of kidney disease progression.'
  assert.equal(isPublicationReadyToPublish({ source: 'openalex', doi: '10.1/x', abstract: '' }), false)
  assert.equal(isPublicationReadyToPublish({ source: 'crossref', doi: '10.1/x', abstract: '  too short  ' }), false)
  assert.equal(isPublicationReadyToPublish({ source: 'openalex', doi: '10.1/x', abstract: longText }), true)
  // A PubMed record is published as it is, abstract or not.
  assert.equal(isPublicationReadyToPublish({ source: 'pubmed', pmid: '123', abstract: '' }), true)
  assert.equal(isPublicationReadyToPublish({ source: 'crossref', pmid: '123', abstract: '' }), true)
})
