import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractArticleBodyText,
  fetchAbstractFromDoi,
  fetchPublicationTextFromDoi,
  transcribePublisherFirstPage,
} from '../lib/doiAbstract.js'

test('continues through abstract sources after empty and unusably short responses', async () => {
  const calls = []
  const expected = 'This is a complete abstract returned by the third source after two earlier misses. '.repeat(2)
  const abstract = await fetchAbstractFromDoi('10.1000/fallback', {
    sourceFetchers: [
      { name: 'first', fetch: async () => { calls.push('first'); return null } },
      { name: 'second', fetch: async () => { calls.push('second'); return 'Too short' } },
      { name: 'third', fetch: async () => { calls.push('third'); return expected } },
      { name: 'fourth', fetch: async () => { calls.push('fourth'); return 'should not run' } },
    ],
  })

  assert.equal(abstract, expected.trim())
  assert.deepEqual(calls, ['first', 'second', 'third'])
})

test('tries every abstract source before returning no result', async () => {
  const calls = []
  const abstract = await fetchAbstractFromDoi('10.1000/missing', {
    sourceFetchers: ['publisher', 'crossref', 'openalex', 'europepmc'].map((name) => ({
      name,
      fetch: async () => { calls.push(name); return null },
    })),
  })

  assert.equal(abstract, null)
  assert.deepEqual(calls, ['publisher', 'crossref', 'openalex', 'europepmc'])
})

test('uses publisher article body text only after every abstract source misses', async () => {
  const calls = []
  const articleBody = 'This is substantive full article text containing methods, results, and conclusions. '.repeat(12)
  const result = await fetchPublicationTextFromDoi('10.1000/body-fallback', {
    sourceFetchers: [
      { name: 'publisher metadata', fetch: async () => { calls.push('publisher metadata'); return null } },
      { name: 'Crossref', fetch: async () => { calls.push('Crossref'); return null } },
      { name: 'OpenAlex', fetch: async () => { calls.push('OpenAlex'); return null } },
      { name: 'Europe PMC', fetch: async () => { calls.push('Europe PMC'); return null } },
      {
        name: 'publisher browser',
        fetch: async () => {
          calls.push('publisher browser')
          return { text: articleBody, contentType: 'article_body' }
        },
      },
    ],
  })

  assert.equal(result?.text, articleBody.trim())
  assert.equal(result?.contentType, 'article_body')
  assert.equal(result?.source, 'publisher browser')
  assert.deepEqual(calls, ['publisher metadata', 'Crossref', 'OpenAlex', 'Europe PMC', 'publisher browser'])
})

test('returns no article text when the publisher HTML is missing', () => {
  // A blocked browser fetch yields null. This used to throw, which aborted the
  // publisher-page source before its plain-HTML fallback could be tried.
  assert.equal(extractArticleBodyText(null), null)
  assert.equal(extractArticleBodyText(undefined), null)
  assert.equal(extractArticleBodyText(''), null)
})

test('extracts substantive article text without navigation or sidebars', () => {
  const paragraph = 'The study methods, measured outcomes, detailed results, and interpretation are reported here. '.repeat(8)
  const html = `<html><body><article><nav>Journal navigation</nav><p>${paragraph}</p><aside>Related articles</aside></article></body></html>`
  const bodyText = extractArticleBodyText(html)

  assert.match(bodyText, /study methods/)
  assert.doesNotMatch(bodyText, /Journal navigation|Related articles/)
})

test('transcribes the publisher first-page image only when the page has no text and a transcriber is available', async () => {
  const html = `<html><head><link rel="canonical" href="https://journals.example.com/doi/10.1177/x"></head>
    <body><section id="abstract"><div class="first-page"><img src="/first-page.jpg" alt="First page"></div></section></body></html>`
  const pageText = 'This edition of the journal includes a position statement on tracking loss from therapy. '.repeat(8)
  const calls = []

  const result = await transcribePublisherFirstPage({
    renderedHtml: null,
    plainHtml: html,
    pageUrl: 'https://doi.org/10.1177/x',
    title: 'An impressive start',
    fetchImage: async (url) => {
      calls.push(['fetch', url])
      return { bytes: Buffer.from([1, 2, 3]), mimeType: 'image/jpeg' }
    },
    transcribeImage: async ({ image, mimeType, title }) => {
      calls.push(['transcribe', mimeType, title, image.length])
      return pageText
    },
  })

  assert.equal(result?.contentType, 'article_body')
  assert.equal(result?.source, 'publisher first page image')
  assert.equal(result?.text, pageText.trim())
  assert.deepEqual(calls, [
    ['fetch', 'https://journals.example.com/first-page.jpg'],
    ['transcribe', 'image/jpeg', 'An impressive start', 3],
  ])
})

test('fetches no first-page image without a transcriber and rejects a transcript too short to be a page', async () => {
  const html = `<html><body><div class="first-page"><img src="https://journals.example.com/first-page.jpg"></div></body></html>`
  const fetched = []

  const withoutTranscriber = await transcribePublisherFirstPage({
    plainHtml: html,
    pageUrl: 'https://doi.org/10.1177/x',
    fetchImage: async (url) => {
      fetched.push(url)
      return { bytes: Buffer.from([1]), mimeType: 'image/jpeg' }
    },
  })
  assert.equal(withoutTranscriber, null)
  assert.deepEqual(fetched, [])

  const tooShort = await transcribePublisherFirstPage({
    plainHtml: html,
    pageUrl: 'https://doi.org/10.1177/x',
    fetchImage: async () => ({ bytes: Buffer.from([1]), mimeType: 'image/jpeg' }),
    transcribeImage: async () => 'Too short to be a page of an article, but longer than fifty characters.',
  })
  assert.equal(tooShort, null)

  const noImage = await transcribePublisherFirstPage({
    plainHtml: '<html><body><p>No abstract available.</p></body></html>',
    pageUrl: 'https://doi.org/10.1177/x',
    fetchImage: async () => { throw new Error('should not fetch') },
    transcribeImage: async () => { throw new Error('should not transcribe') },
  })
  assert.equal(noImage, null)
})
