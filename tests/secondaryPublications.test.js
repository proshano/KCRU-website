import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchCrossrefPublications,
  matchesResearcherAuthorList,
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

test('secondary discovery rejects an ORCID result whose authors do not match the researcher', async () => {
  const fetchFn = async () => new Response(JSON.stringify({
    message: {
      items: [{
        DOI: '10.1200/jco-26-01201',
        type: 'journal-article',
        title: ['EXTENDing the Role of Radiation in Oligometastatic Disease'],
        author: [
          { given: 'Vivian S.', family: 'Tan', ORCID: 'https://orcid.org/0000-0001-9086-220X' },
          { given: 'David A.', family: 'Palma' },
        ],
        'container-title': ['Journal of Clinical Oncology'],
        'published-online': { 'date-parts': [[2026, 6, 24]] },
      }],
    },
  }), { status: 200 })

  const publications = await fetchCrossrefPublications(
    { name: 'Kyla Naylor', orcid: '0000-0001-9086-220X' },
    { fetchFn, sinceYear: 2025 }
  )

  assert.deepEqual(publications, [])
})

test('secondary author matching accepts full names and family-name-first initials', () => {
  assert.equal(matchesResearcherAuthorList(['Kyla L. Naylor'], 'Kyla Naylor'), true)
  assert.equal(matchesResearcherAuthorList(['Naylor KL'], 'Kyla Naylor'), true)
  assert.equal(matchesResearcherAuthorList(['Vivian S. Tan', 'David A. Palma'], 'Kyla Naylor'), false)
})

test('Crossref name discovery rejects a namesake with a conflicting middle initial', async () => {
  const fetchFn = async () => new Response(JSON.stringify({
    message: {
      items: [
        {
          DOI: '10.1000/canadian-matthew',
          type: 'journal-article',
          title: ['Canadian Matthew paper'],
          author: [{ given: 'Matthew A.', family: 'Weir' }],
          'published-online': { 'date-parts': [[2026, 1, 1]] },
        },
        {
          DOI: '10.1000/us-matthew',
          type: 'journal-article',
          title: ['US Matthew paper'],
          author: [{ given: 'Matthew R.', family: 'Weir' }],
          'published-online': { 'date-parts': [[2026, 1, 1]] },
        },
        {
          DOI: '10.1000/canadian-matthew-no-middle',
          type: 'journal-article',
          title: ['Canadian Matthew paper with no middle initial'],
          author: [{ given: 'Matthew', family: 'Weir' }],
          'published-online': { 'date-parts': [[2026, 1, 1]] },
        },
      ],
    },
  }), { status: 200 })

  const publications = await fetchCrossrefPublications(
    {
      name: 'Matthew Weir',
      publicationAuthorName: 'Matthew A. Weir',
      orcid: '0000-0001-6736-603X',
    },
    { fetchFn, sinceYear: 2025 }
  )

  assert.deepEqual(publications.map((publication) => publication.doi), [
    '10.1000/canadian-matthew',
    '10.1000/canadian-matthew-no-middle',
  ])
})
