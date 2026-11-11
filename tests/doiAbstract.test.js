import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractArticleBodyText,
  extractMetaAbstract,
  fetchAbstractFromDoi,
  fetchPublicationTextFromDoi,
  transcribePublisherFirstPage,
} from '../lib/doiAbstract.js'

// The meta tags of an Ovid page for a JASN meeting abstract (November 2026): no abstract
// tag, a description saying so, and a URL and title longer than any description.
const OVID_TITLE = 'Large Language Model-Assisted Screening in a Systematic Review on the Use, Administration, and Interpretation of Patient-Reported Outcome Measures in Dialysis Randomized Controlled Trials'
const OVID_META = `
  <meta name="Description" content="Abstract was not provided for this article."/>
  <meta name="Title" content="${OVID_TITLE}"/>
  <meta name="dc.identifier" content="doi:10.1681/ASN.2026rnpqqjxm"/>
  <meta property="og:title" content="Large Language Model-Assisted Screening in a... : Journal of the American Society of Nephrology"/>
  <meta property="og:description" content="Abstract was not provided for this article."/>
  <meta property="og:url" content="https://www.ovid.com/jnls/jasn/fulltext/10.1681/asn.2026rnpqqjxm~large-language-model-assisted-screening-in-a-systematic"/>`

test('meta tags other than abstracts and descriptions are never taken as the abstract', () => {
  assert.equal(extractMetaAbstract(`<html><head>${OVID_META}</head></html>`), null)

  const springer = '<meta name="citation_reference" content="citation_journal_title=Clin Res Cardiol; citation_title=The SGLT2 inhibitor empagliflozin reduces tissue sodium content in patients with chronic heart failure; citation_author=X"/>'
  assert.equal(extractMetaAbstract(`<html><head>${springer}</head></html>`), null)

  const abstract = 'Background: this is the abstract a repository exposes under a tag of its own name, with methods and results. '.repeat(2)
  assert.equal(
    extractMetaAbstract(`<html><head><meta name="eprints.abstract" content="${abstract}"/></head></html>`),
    abstract.trim()
  )

  const abstractUrl = '<meta name="citation_abstract_html_url" content="https://journal.example.org/article/10.1000/xyz/abstract-page-for-this-article-with-a-long-path"/>'
  assert.equal(extractMetaAbstract(`<html><head>${abstractUrl}</head></html>`), null)
})

test('reads an Ovid meeting abstract from the article body without the citation header', () => {
  const section = (heading, text) => `<section class="lww-article__section js-lww-article-section"><h2 class="js-lww-content-heading"><b>${heading}:</b></h2><p>${text}</p></section>`
  const html = `<html><head>${OVID_META}</head><body><article>
    <div class="lww-article__citation-info"><span>Journal of the American Society of Nephrology</span> 37(10S), October 2026. DOI: 10.1681/ASN.2026rnpqqjxm</div>
    <div class="lww-article__body js-lww-article-body">
      ${section('Background', 'Patients receiving dialysis prioritize patient-reported outcome measures, yet trials that report them are hard to identify. '.repeat(2))}
      ${section('Methods', 'We built a reference standard of 172 eligible and 516 ineligible records and evaluated twelve models. '.repeat(2))}
      ${section('Results', 'The strongest model reached a sensitivity of 92.5% and a specificity of 94.0%. '.repeat(2))}
      ${section('Conclusion', 'Language model screening identified these trials accurately and reduced reviewer workload. '.repeat(2))}
    </div></article><footer>Site footer</footer></body></html>`

  const text = extractArticleBodyText(html)
  assert.match(text, /^Background: Patients receiving dialysis/)
  assert.match(text, /Results: The strongest model/)
  assert.match(text, /Conclusion: Language model screening/)
  assert.doesNotMatch(text, /October 2026|Site footer/)
})

test('a paywalled landing page is not taken as article text', () => {
  const filler = 'Pediatric Nephrology Letter to the Editors Published: 22 January 2026 Volume 41 Cite this article Save article. '.repeat(6)
  const html = `<html><body><article><p>${filler}</p><p>Access this article. Log in via an institution. Buy article PDF. Price includes VAT (Canada). Instant access to the full article PDF. Institutional subscriptions</p></article></body></html>`
  assert.equal(extractArticleBodyText(html), null)

  // One such phrase in an article's own prose does not make it a paywall page.
  const prose = 'Open access changed how libraries pay: institutional subscriptions fell while article charges rose across the journals studied. '.repeat(6)
  assert.match(extractArticleBodyText(`<html><body><article><p>${prose}</p></article></body></html>`), /libraries pay/)
})

test('comparison signs in fetched text survive, from an API, a meta tag or a page', async () => {
  const abstract = 'Among adults with eGFR <60 mL/min/1.73 m2 and ACR >30 mg/mmol, the hazard ratio was 0.80 (P<0.001) over a follow-up of >5 years.'
  const fromApi = await fetchPublicationTextFromDoi('10.1000/signs', {
    sourceFetchers: [{ name: 'OpenAlex', fetch: async () => abstract }],
  })
  assert.equal(fromApi?.text, abstract)

  const escaped = '<meta name="citation_abstract" content="Among adults with eGFR &lt;60 mL/min/1.73 m2 and ACR &gt;30 mg/mmol, the hazard ratio was 0.80 (&lt;i&gt;P&lt;/i&gt;&lt;0.001) over a follow-up of &gt;5 years.">'
  assert.equal(
    extractMetaAbstract(escaped),
    'Among adults with eGFR <60 mL/min/1.73 m2 and ACR >30 mg/mmol, the hazard ratio was 0.80 ( P <0.001) over a follow-up of >5 years.'
  )

  // An unescaped ">" inside the quoted value used to end the tag and lose the abstract.
  const unescaped = '<meta name="citation_abstract" content="Among adults with eGFR >60 mL/min/1.73 m2 the hazard ratio was 0.80 over a follow-up of five years in the cohort."><meta name="x" content="y">'
  assert.match(extractMetaAbstract(unescaped), /^Among adults with eGFR >60 .* in the cohort\.$/)

  const paragraph = 'Patients with eGFR &lt;60 mL/min and ACR &gt;30 mg/mmol were followed, and the detailed results are reported here. '.repeat(6)
  assert.match(
    extractArticleBodyText(`<html><body><article><button>Open multimedia modal</button><p>${paragraph}</p></article></body></html>`),
    /^Patients with eGFR <60 mL\/min and ACR >30 mg\/mmol were followed/
  )
})

test('a notice in place of an abstract is rejected, the same words inside a real abstract are not', async () => {
  const fetchOne = (text) => fetchAbstractFromDoi('10.1000/notice', { sourceFetchers: [{ name: 'only', fetch: async () => text }] })
  assert.equal(await fetchOne('No abstract available for this article. Please see the full text PDF.'), null)

  assert.equal(await fetchOne('An abstract is not available for this content so a preview has been provided. Please use the Get access link above.'), null)

  const real = 'Background: screening is slow. Methods: records with no abstract were screened in full text by two reviewers, and data were extracted in duplicate. Results: 172 of 688 records were eligible, and agreement between reviewers was high throughout the review. Conclusion: the approach is feasible.'
  assert.equal(await fetchOne(real), real)
})

test('a description that only repeats the title is skipped in favour of another tag', () => {
  const title = 'Kidney Sodium Magnetic Resonance Imaging and the Concept of Residual Kidney Function in People Receiving Maintenance Hemodialysis: A Cohort Study'
  const abstract = 'Background: residual kidney function matters. Methods: sodium imaging in 40 patients. Results: sodium content tracked urine volume. Conclusion: imaging adds information.'
  const html = `<meta name="description" content="${title}"><meta property="og:description" content="${abstract}">`
  assert.equal(extractMetaAbstract(html, title), abstract)
  assert.equal(extractMetaAbstract(`<meta name="description" content="${title}">`, title), null)
})

test('a link or the title returned in place of text moves on to the next source', async () => {
  const calls = []
  const abstract = 'Background: the real abstract, with methods, results and a conclusion, from the third source. '.repeat(2)
  const result = await fetchPublicationTextFromDoi('10.1681/asn.2026rnpqqjxm', {
    title: OVID_TITLE,
    sourceFetchers: [
      {
        name: 'publisher metadata',
        fetch: async () => { calls.push('url'); return 'https://www.ovid.com/jnls/jasn/fulltext/10.1681/asn.2026rnpqqjxm~large-language-model-assisted-screening-in-a-systematic' },
      },
      { name: 'Crossref', fetch: async () => { calls.push('title'); return OVID_TITLE } },
      { name: 'OpenAlex', fetch: async () => { calls.push('abstract'); return abstract } },
    ],
  })

  assert.equal(result?.text, abstract.trim())
  assert.equal(result?.source, 'OpenAlex')
  assert.deepEqual(calls, ['url', 'title', 'abstract'])
})

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
