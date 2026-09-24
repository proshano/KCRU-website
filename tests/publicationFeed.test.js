import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PUBLICATION_FEED_MAX_ITEMS,
  PUBLICATION_FEED_WINDOW_DAYS,
  buildPublicationFeedXml,
  escapeXml,
  extractDoi,
  getFeedItemIdentity,
  selectFeedPublications,
} from '../lib/publicationFeed.js'

const NOW = new Date('2026-09-24T12:00:00Z')

function publication(overrides = {}) {
  return {
    title: 'A kidney research paper',
    laySummary: 'Plain language summary of the findings.',
    doi: '10.1000/kept',
    pmid: null,
    url: '',
    publicationKey: 'doi:10.1000/kept',
    publishedAt: NOW.toISOString(),
    exclude: false,
    ...overrides,
  }
}

test('extractDoi finds a DOI inside malformed pii junk', () => {
  assert.equal(
    extractDoi('pii: s0008-4182(26)00244-9. 10.1016/j.jcjo.2026.07.001'),
    '10.1016/j.jcjo.2026.07.001'
  )
})

test('extractDoi strips a doi.org URL prefix', () => {
  assert.equal(
    extractDoi('https://doi.org/10.1016/j.jcjo.2026.07.001'),
    '10.1016/j.jcjo.2026.07.001'
  )
})

test('extractDoi keeps parentheses that are part of the DOI', () => {
  assert.equal(
    extractDoi('10.1016/s0140-6736(26)00123-4'),
    '10.1016/s0140-6736(26)00123-4'
  )
})

test('extractDoi strips trailing punctuation and lowercases', () => {
  assert.equal(extractDoi('10.1000/ABC.123,'), '10.1000/abc.123')
})

test('extractDoi returns empty string when no DOI is present', () => {
  assert.equal(extractDoi('not a doi'), '')
  assert.equal(extractDoi(''), '')
  assert.equal(extractDoi(null), '')
})

test('getFeedItemIdentity yields the same guid/link before and after a PMID merges in', () => {
  const doiOnly = getFeedItemIdentity({ doi: '10.1016/j.jcjo.2026.07.001', pmid: null })
  const withPmid = getFeedItemIdentity({ doi: '10.1016/j.jcjo.2026.07.001', pmid: '40123456' })

  assert.deepEqual(doiOnly, { guid: 'doi:10.1016/j.jcjo.2026.07.001', link: 'https://doi.org/10.1016/j.jcjo.2026.07.001' })
  assert.deepEqual(withPmid, doiOnly)
})

test('getFeedItemIdentity falls back to PMID when no DOI is extractable', () => {
  assert.deepEqual(
    getFeedItemIdentity({ doi: '', pmid: '40123456' }),
    { guid: 'pmid:40123456', link: 'https://pubmed.ncbi.nlm.nih.gov/40123456/' }
  )
})

test('getFeedItemIdentity falls back to url/publicationKey, and returns null with nothing usable', () => {
  assert.deepEqual(
    getFeedItemIdentity({ doi: '', pmid: '', url: 'https://example.org/paper', publicationKey: 'openalex:W123' }),
    { guid: 'openalex:W123', link: 'https://example.org/paper' }
  )
  assert.equal(getFeedItemIdentity({ doi: '', pmid: '', url: '' }), null)
  assert.equal(getFeedItemIdentity(null), null)
})

test('selectFeedPublications keeps items inside the window and drops items outside it', () => {
  const inWindow = publication({
    title: 'Inside the window',
    publicationKey: 'doi:10.1000/in-window',
    doi: '10.1000/in-window',
    publishedAt: new Date(NOW.getTime() - (PUBLICATION_FEED_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000).toISOString(),
  })
  const outsideWindow = publication({
    title: 'Outside the window',
    publicationKey: 'doi:10.1000/outside-window',
    doi: '10.1000/outside-window',
    publishedAt: new Date(NOW.getTime() - (PUBLICATION_FEED_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString(),
  })

  const items = selectFeedPublications([inWindow, outsideWindow], { now: NOW })

  assert.equal(items.length, 1)
  assert.equal(items[0].publication.title, 'Inside the window')
})

test('selectFeedPublications omits excluded publications and ones missing a lay summary', () => {
  const excluded = publication({ title: 'Excluded paper', exclude: true, publicationKey: 'doi:10.1000/excluded', doi: '10.1000/excluded' })
  const noSummary = publication({ title: 'No summary yet', laySummary: '', publicationKey: 'doi:10.1000/no-summary', doi: '10.1000/no-summary' })
  const noTitle = publication({ title: '   ', publicationKey: 'doi:10.1000/no-title', doi: '10.1000/no-title' })
  const good = publication({ title: 'Good paper', publicationKey: 'doi:10.1000/good', doi: '10.1000/good' })

  const items = selectFeedPublications([excluded, noSummary, noTitle, good], { now: NOW })

  assert.equal(items.length, 1)
  assert.equal(items[0].publication.title, 'Good paper')
})

test('selectFeedPublications sorts newest first, tie-breaking by title, dedupes by guid, and caps at maxItems', () => {
  const older = publication({
    title: 'Older paper',
    doi: '10.1000/older',
    publicationKey: 'doi:10.1000/older',
    publishedAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(),
  })
  const newerB = publication({
    title: 'B newer paper',
    doi: '10.1000/newer-b',
    publicationKey: 'doi:10.1000/newer-b',
    publishedAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  })
  const newerA = publication({
    title: 'A newer paper',
    doi: '10.1000/newer-a',
    publicationKey: 'doi:10.1000/newer-a',
    publishedAt: new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  })
  const duplicateOfNewerA = publication({
    title: 'A newer paper (duplicate)',
    doi: '10.1000/newer-a',
    publicationKey: 'doi:10.1000/newer-a',
    // Older than the other copy of this guid, so the sort-then-dedupe keeps
    // the newer copy ("A newer paper") rather than this stale one.
    publishedAt: new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  })

  const items = selectFeedPublications([older, newerB, newerA, duplicateOfNewerA], { now: NOW })

  assert.deepEqual(items.map((item) => item.publication.title), ['A newer paper', 'B newer paper', 'Older paper'])

  const many = Array.from({ length: PUBLICATION_FEED_MAX_ITEMS + 10 }, (_, i) => publication({
    title: `Paper ${i}`,
    doi: `10.1000/paper-${i}`,
    publicationKey: `doi:10.1000/paper-${i}`,
    publishedAt: new Date(NOW.getTime() - i * 60 * 60 * 1000).toISOString(),
  }))
  const capped = selectFeedPublications(many, { now: NOW })
  assert.equal(capped.length, PUBLICATION_FEED_MAX_ITEMS)
})

test('escapeXml strips invalid control characters and escapes XML entities', () => {
  assert.equal(
    escapeXml(`Tom & Jerry <says> "hi" it's \u0000\u001F fine`),
    `Tom &amp; Jerry &lt;says&gt; &quot;hi&quot; it&apos;s  fine`
  )
})

test('buildPublicationFeedXml produces a well-formed empty feed', () => {
  const xml = buildPublicationFeedXml({
    items: [],
    provenance: {},
    researchers: [],
    siteTitle: 'KCRU',
    siteUrl: 'https://kcru.example.com/',
    channelDescription: 'New research publications from KCRU.',
    lastBuildDate: null,
  })

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  assert.match(xml, /<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom" xmlns:dc="http:\/\/purl\.org\/dc\/elements\/1\.1\/">/)
  assert.match(xml, /<title>KCRU publications<\/title>/)
  assert.match(xml, /<link>https:\/\/kcru\.example\.com\/publications<\/link>/)
  assert.match(xml, /<atom:link href="https:\/\/kcru\.example\.com\/publications\/feed\.xml" rel="self" type="application\/rss\+xml"\/>/)
  assert.doesNotMatch(xml, /<item>/)
  assert.doesNotMatch(xml, /<lastBuildDate>/)
})

test('buildPublicationFeedXml emits items with dc:creator names from provenance, skipping unknown ids', () => {
  const pub = publication({
    title: 'Findings on  dialysis   outcomes',
    laySummary: 'A summary with a & an <angle bracket>.',
    doi: '10.1000/creators',
    publicationKey: 'doi:10.1000/creators',
    publishedAt: '2026-09-20T00:00:00Z',
  })
  const items = selectFeedPublications([pub], { now: NOW })

  const xml = buildPublicationFeedXml({
    items,
    provenance: { 'doi:10.1000/creators': ['researcher-1', 'researcher-unknown', 'researcher-2', 'researcher-1'] },
    researchers: [
      { _id: 'researcher-1', name: 'Dr. Alice Smith' },
      { _id: 'researcher-2', name: 'Dr. Bob Lee' },
    ],
    siteTitle: 'KCRU',
    siteUrl: 'https://kcru.example.com',
    channelDescription: 'New research publications from KCRU.',
    lastBuildDate: '2026-09-24T08:00:00Z',
  })

  assert.match(xml, /<lastBuildDate>[^<]+<\/lastBuildDate>/)
  assert.match(xml, /<title>Findings on dialysis outcomes<\/title>/)
  assert.match(xml, /<link>https:\/\/doi\.org\/10\.1000\/creators<\/link>/)
  assert.match(xml, /<guid isPermaLink="false">doi:10\.1000\/creators<\/guid>/)
  assert.match(xml, /<description>A summary with a &amp; an &lt;angle bracket&gt;\.<\/description>/)
  assert.match(xml, /<dc:creator>Dr\. Alice Smith<\/dc:creator>/)
  assert.match(xml, /<dc:creator>Dr\. Bob Lee<\/dc:creator>/)
  assert.equal((xml.match(/<dc:creator>/g) || []).length, 2)
})
