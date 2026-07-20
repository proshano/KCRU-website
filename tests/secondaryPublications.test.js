import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchCrossrefPublications,
  reconstructOpenAlexAbstract,
} from '../lib/secondaryPublications.js'

test('Crossref discovery keeps an ORCID-matched DOI even when its abstract is absent', async () => {
  const requestedUrls = []
  const fetchFn = async (url) => {
    requestedUrls.push(String(url))
    return new Response(JSON.stringify({
      message: {
        items: [{
          DOI: '10.1000/early-online',
          type: 'journal-article',
          title: ['An early online article'],
          author: [{ given: 'Jane', family: 'Smith', ORCID: 'https://orcid.org/0000-0001-2345-6789' }],
          'container-title': ['Kidney Journal'],
          'published-online': { 'date-parts': [[2026, 7, 1]] },
          URL: 'https://doi.org/10.1000/early-online',
        }],
      },
    }), { status: 200 })
  }

  const publications = await fetchCrossrefPublications(
    { name: 'Jane Smith', orcid: '0000-0001-2345-6789' },
    { fetchFn, sinceYear: 2025 }
  )

  assert.equal(publications.length, 1)
  assert.equal(publications[0].publicationKey, 'doi:10.1000/early-online')
  assert.equal(publications[0].abstract, null)
  assert.equal(requestedUrls.length, 2)
  assert.ok(requestedUrls.some((url) => url.includes('orcid%3A0000-0001-2345-6789')))
  assert.ok(requestedUrls.some((url) => url.includes('query.author=Jane+Smith')))
})

test('reconstructs OpenAlex inverted-index abstracts in word order', () => {
  assert.equal(
    reconstructOpenAlexAbstract({ abstract: [2], This: [0], is: [1], ordered: [3] }),
    'This is abstract ordered'
  )
})
