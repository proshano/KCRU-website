import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractArticleBodyText,
  fetchAbstractFromDoi,
  fetchPublicationTextFromDoi,
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

test('extracts substantive article text without navigation or sidebars', () => {
  const paragraph = 'The study methods, measured outcomes, detailed results, and interpretation are reported here. '.repeat(8)
  const html = `<html><body><article><nav>Journal navigation</nav><p>${paragraph}</p><aside>Related articles</aside></article></body></html>`
  const bodyText = extractArticleBodyText(html)

  assert.match(bodyText, /study methods/)
  assert.doesNotMatch(bodyText, /Journal navigation|Related articles/)
})
