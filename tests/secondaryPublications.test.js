import assert from 'node:assert/strict'
import test from 'node:test'

import {
  fetchCrossrefPublications,
  fetchOpenAlexPublications,
  fetchEuropePmcPublications,
  getSecondaryPublicationsForResearcher,
  matchesResearcherAuthorList,
  reconstructOpenAlexAbstract,
} from '../lib/secondaryPublications.js'

test('discovery sources discard supplementary files before attribution and summary generation', async () => {
  const title = 'Additional file 3 of Definition, analysis, reporting, and interpretation of perioperative bleeding'
  const researcher = { name: 'Jane Smith', orcid: '0000-0001-2345-6789' }
  for (const doi of ['10.6084/m9.figshare.33961115', '10.6084/m9.figshare.33961115.v1']) {
    const options = {
      sinceYear: 2025,
      fetchFn: async () => new Response(JSON.stringify({
        message: { items: [{ DOI: doi, title: [title], type: 'journal-article', author: [{ given: 'Jane', family: 'Smith' }], published: { 'date-parts': [[2026, 7, 1]] } }] },
        results: [{ doi, display_name: title, type: 'article', publication_date: '2026-07-01', authorships: [{ author: { display_name: 'Jane Smith' } }] }],
        resultList: { result: [{ doi, title, source: 'MED', firstPublicationDate: '2026-07-01', authorList: { author: [{ fullName: 'Jane Smith' }] } }] },
      }), { status: 200 }),
    }
    assert.deepEqual(await fetchCrossrefPublications(researcher, options), [])
    assert.deepEqual(await fetchOpenAlexPublications(researcher, options), [])
    assert.deepEqual(await fetchEuropePmcPublications(researcher, options), [])
  }
})

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

test('Crossref name discovery ranks by relevance, not date, so the window is not filled by unrelated papers', async () => {
  const requestedUrls = []
  const fetchFn = async (url) => {
    requestedUrls.push(new URL(String(url)))
    return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 })
  }

  await fetchCrossrefPublications({ name: 'Jane Smith', orcid: '0000-0001-2345-6789' }, { fetchFn, sinceYear: 2025 })

  const nameRequest = requestedUrls.find((url) => url.searchParams.get('query.author') === 'Jane Smith')
  const orcidRequest = requestedUrls.find((url) => url.searchParams.get('filter')?.includes('orcid:'))
  assert.ok(nameRequest)
  assert.ok(orcidRequest)
  // Sorted by date, the fuzzy author query returned 100 unrelated works published after
  // the researcher's latest paper, and the name check discarded every one of them.
  assert.equal(nameRequest.searchParams.get('sort'), null)
  assert.equal(nameRequest.searchParams.get('order'), null)
  assert.equal(orcidRequest.searchParams.get('sort'), 'published')
})

test('OpenAlex discovery includes review-typed works and records them as reviews', async () => {
  const requestedUrls = []
  const review = {
    doi: 'https://doi.org/10.1136/bmjsurg-2026-000011',
    type: 'review',
    publication_date: '2026-09-01',
    publication_year: 2026,
    display_name: 'Outcome selection in clinical trials of pharmacologic haemostatic agents in surgery: systematic review',
    authorships: [{ author: { display_name: 'Jane Smith', orcid: 'https://orcid.org/0000-0001-2345-6789' } }],
    primary_location: { source: { type: 'journal', display_name: 'BMJ Surgery' } },
  }
  const fetchFn = async (url) => {
    requestedUrls.push(new URL(String(url)))
    return new Response(JSON.stringify({ results: [review] }), { status: 200 })
  }

  const publications = await fetchOpenAlexPublications(
    { name: 'Jane Smith', orcid: '0000-0001-2345-6789' },
    { fetchFn, sinceYear: 2025 }
  )

  // OpenAlex types systematic reviews `review`; filtering on `article` alone dropped them.
  assert.ok(requestedUrls[0].searchParams.get('filter').includes('type:article|review'))
  assert.equal(publications.length, 1)
  assert.equal(publications[0].doi, '10.1136/bmjsurg-2026-000011')
  assert.deepEqual(publications[0].publicationTypes, ['Journal Article', 'Review'])
})

test('OpenAlex requests use the field:direction sort syntax the API accepts', async () => {
  const requestedUrls = []
  const fetchFn = async (url) => {
    requestedUrls.push(String(url))
    return new Response(JSON.stringify({ results: [] }), { status: 200 })
  }

  await fetchOpenAlexPublications(
    { name: 'Jane Smith', orcid: '0000-0001-2345-6789' },
    { fetchFn, sinceYear: 2025, openAlexApiKey: 'key-123' }
  )

  assert.equal(requestedUrls.length, 1)
  // `-publication_date` is parsed as a field named `_publication_date` and 400s.
  assert.ok(requestedUrls[0].includes('sort=publication_date%3Adesc'))
  assert.ok(!requestedUrls[0].includes('-publication_date'))
})

test('OpenAlex discovery skips repository-hosted copies so the journal version is not duplicated', async () => {
  const shared = {
    type: 'article',
    publication_date: '2026-03-01',
    publication_year: 2026,
    display_name: 'CRT-Estimands Framework',
    authorships: [{ author: { display_name: 'Jane Smith' } }],
  }
  const repositoryWork = {
    ...shared,
    doi: 'https://doi.org/10.17615/vcsn-dr67',
    primary_location: { source: { type: 'repository', display_name: 'Carolina Digital Repository' } },
  }
  const journalWork = {
    ...shared,
    doi: 'https://doi.org/10.1136/bmj-2025-089050',
    primary_location: { source: { type: 'journal', display_name: 'BMJ' } },
  }
  const fetchFn = async () => new Response(JSON.stringify({ results: [repositoryWork, journalWork] }), { status: 200 })

  const publications = await fetchOpenAlexPublications(
    { name: 'Jane Smith', orcid: '0000-0001-2345-6789' },
    { fetchFn, sinceYear: 2025 }
  )

  assert.equal(publications.length, 1)
  assert.equal(publications[0].doi, '10.1136/bmj-2025-089050')
})

test('OpenAlex discovery still runs when no API key is configured', async () => {
  let calls = 0
  const fetchFn = async () => {
    calls += 1
    return new Response(JSON.stringify({ results: [] }), { status: 200 })
  }

  await fetchOpenAlexPublications(
    { name: 'Jane Smith', orcid: '0000-0001-2345-6789' },
    { fetchFn, sinceYear: 2025, openAlexApiKey: '' }
  )

  assert.equal(calls, 1)
})

test('a throttled discovery request is retried instead of dropping the researcher', async () => {
  const statuses = [429, 200]
  let calls = 0
  const fetchFn = async () => {
    calls += 1
    const status = statuses.shift() ?? 200
    if (status === 429) {
      return new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } })
    }
    return new Response(JSON.stringify({ results: [] }), { status: 200 })
  }

  await fetchOpenAlexPublications(
    { name: 'Jane Smith', orcid: '0000-0001-2345-6789' },
    { fetchFn, sinceYear: 2025, retryDelayMs: 0 }
  )

  assert.equal(calls, 2)
})

test('a persistently failing source is reported so the run counts as degraded', async () => {
  const fetchFn = async () => new Response('rate limited', { status: 429, headers: { 'retry-after': '0' } })
  const failures = []

  const publications = await getSecondaryPublicationsForResearcher(
    { _id: 'researcher-1', name: 'Jane Smith', orcid: '0000-0001-2345-6789' },
    {
      fetchFn,
      sinceYear: 2025,
      retryAttempts: 1,
      retryDelayMs: 0,
      sourceDelayMs: 0,
      onSourceError: ({ source }) => failures.push(source),
    }
  )

  assert.deepEqual(publications, [])
  assert.deepEqual(failures, ['Crossref', 'OpenAlex', 'Europe PMC'])
})

test('a non-retryable client error fails fast without burning retries', async () => {
  let calls = 0
  const fetchFn = async () => {
    calls += 1
    return new Response('bad request', { status: 400 })
  }

  await assert.rejects(
    fetchOpenAlexPublications(
      { name: 'Jane Smith', orcid: '0000-0001-2345-6789' },
      { fetchFn, sinceYear: 2025, retryDelayMs: 0 }
    ),
    /400/
  )
  assert.equal(calls, 1)
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
