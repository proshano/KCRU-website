import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PUBLISHER_FIRST_PAGE_SOURCE,
  extractFirstPageImageUrl,
  fetchPublisherFirstPageImage,
  normalizeImageMimeType,
  resolvePublisherBaseUrl,
} from '../lib/publisherFirstPage.js'

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }]
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

test('finds the preview image named as the first page and resolves it against the canonical URL', () => {
  const html = `<html><head>
    <link rel="canonical" href="https://journals.example.com/doi/10.1177/08968608261479008">
    </head><body>
    <img src="/pb-assets/images/journal-logo.png" alt="Journal logo">
    <section id="abstract"><h2>Abstract</h2>
      <div class="first-page-preview"><img src="/na101/home/literatum/publisher/sage/journals/content/pdib/2026/first-page.jpg" alt="First page of PDF"></div>
    </section>
    <img class="cover-image" src="/cms/asset/cover.jpg" alt="Journal cover">
    <div class="paywall">Get full access to this article</div>
  </body></html>`

  assert.equal(
    extractFirstPageImageUrl(html),
    'https://journals.example.com/na101/home/literatum/publisher/sage/journals/content/pdib/2026/first-page.jpg'
  )
})

test('uses the image inside the abstract block when nothing names the first page, ignoring logos and badges', () => {
  const html = `<html><head><meta property="og:url" content="https://journals.example.com/doi/abs/10.1000/x"></head><body>
    <div class="abstractSection abstractInFull">
      <img class="orcid-id-logo" src="/images/orcid.png" alt="ORCID">
      <p><img data-src="/cms/10.1000/x/asset/page1.jpg" src="data:image/gif;base64,R0lGOD" alt=""></p>
    </div></body></html>`

  assert.equal(extractFirstPageImageUrl(html), 'https://journals.example.com/cms/10.1000/x/asset/page1.jpg')
})

test('prefers the largest srcset candidate and upgrades http to https', () => {
  const html = `<div class="page-preview"><img srcset="http://journals.example.com/page-small.jpg 400w, http://journals.example.com/page-large.jpg 1200w"></div>`

  assert.equal(extractFirstPageImageUrl(html), 'https://journals.example.com/page-large.jpg')
})

test('returns null for decorative images, unresolvable relative paths, and empty pages', () => {
  const decorative = `<html><body>
    <img src="https://cdn.example.com/logo.png" class="logo">
    <section id="abstract"><img src="/icons/share.svg"></section>
  </body></html>`
  assert.equal(extractFirstPageImageUrl(decorative), null)

  const relativeOnly = `<html><body><div class="first-page"><img src="/first-page.jpg"></div></body></html>`
  assert.equal(extractFirstPageImageUrl(relativeOnly), null)
  assert.equal(
    extractFirstPageImageUrl(relativeOnly, { baseUrl: 'https://journals.example.com/doi/10.1/x' }),
    'https://journals.example.com/first-page.jpg'
  )

  assert.equal(extractFirstPageImageUrl(''), null)
  assert.equal(extractFirstPageImageUrl(null), null)
})

test('resolves the page base from <base>, canonical, og:url, then the fetched URL', () => {
  assert.equal(
    resolvePublisherBaseUrl('<base href="https://a.example/dir/"><link rel="canonical" href="https://b.example/x">', 'https://c.example/'),
    'https://a.example/dir/'
  )
  assert.equal(
    resolvePublisherBaseUrl('<link href="https://b.example/x" rel="canonical">', 'https://c.example/'),
    'https://b.example/x'
  )
  assert.equal(
    resolvePublisherBaseUrl('<meta property="og:url" content="https://d.example/doi/1">', 'https://c.example/'),
    'https://d.example/doi/1'
  )
  assert.equal(resolvePublisherBaseUrl('<html></html>', 'https://c.example/page'), 'https://c.example/page')
  assert.equal(resolvePublisherBaseUrl('<html></html>', null), null)
})

test('normalizes image content types to the supported set', () => {
  assert.equal(normalizeImageMimeType('image/jpg; charset=binary'), 'image/jpeg')
  assert.equal(normalizeImageMimeType('IMAGE/PNG'), 'image/png')
  assert.equal(normalizeImageMimeType('text/html'), null)
  assert.equal(normalizeImageMimeType(''), null)
  assert.equal(PUBLISHER_FIRST_PAGE_SOURCE, 'publisher first page image')
})

test('downloads the preview image, falling back to the browser fetcher when the plain request is refused', async () => {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

  const plain = await fetchPublisherFirstPageImage('https://journals.example.com/first-page.jpg', {
    fetchImpl: async () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } }),
    lookup: publicLookup,
  })
  assert.equal(plain.mimeType, 'image/jpeg')
  assert.ok(Buffer.from(plain.bytes).equals(bytes))

  const browserCalls = []
  const viaBrowser = await fetchPublisherFirstPageImage('https://journals.example.com/first-page.jpg', {
    fetchImpl: async () => new Response('blocked', { status: 403 }),
    lookup: publicLookup,
    browserFetch: async (url, options) => {
      browserCalls.push({ url, options })
      return { bytes, contentType: 'image/png' }
    },
  })
  assert.equal(viaBrowser.mimeType, 'image/png')
  assert.equal(browserCalls.length, 1)
  assert.equal(browserCalls[0].url, 'https://journals.example.com/first-page.jpg')
  assert.deepEqual(browserCalls[0].options.allowedContentTypes, IMAGE_TYPES)

  const notAnImage = await fetchPublisherFirstPageImage('https://journals.example.com/first-page.jpg', {
    fetchImpl: async () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    lookup: publicLookup,
  })
  assert.equal(notAnImage, null)
})
