import { mergePublications, normalizeDoi, withPublicationKey } from './publicationIdentity.js'
import { getResearcherPublicationName } from './researcherPublicationIdentity.js'

const CROSSREF_BASE_URL = 'https://api.crossref.org/works'
const OPENALEX_BASE_URL = 'https://api.openalex.org/works'
const EUROPE_PMC_BASE_URL = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search'
const DEFAULT_TIMEOUT_MS = Number(process.env.SECONDARY_PUBLICATION_TIMEOUT_MS || 12000)
const DEFAULT_MAX_RESULTS = Number(process.env.SECONDARY_PUBLICATION_MAX_PER_RESEARCHER || 100)
const DEFAULT_RETRY_ATTEMPTS = Number(process.env.SECONDARY_PUBLICATION_RETRIES || 3)
const DEFAULT_RETRY_DELAY_MS = Number(process.env.SECONDARY_PUBLICATION_RETRY_DELAY_MS || 1000)
const MAX_RETRY_DELAY_MS = Number(process.env.SECONDARY_PUBLICATION_MAX_RETRY_DELAY_MS || 15000)
const SOURCE_DELAY_MS = Number(process.env.SECONDARY_PUBLICATION_DELAY_MS || 250)
const OPENALEX_MAILTO = process.env.OPENALEX_MAILTO || process.env.CROSSREF_MAILTO || ''

function normalizeOrcid(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, '')
}

function cleanText(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

export function matchesResearcherAuthorList(authors = [], researcherName = '') {
  const honorifics = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms'])
  const nameParts = normalizeName(researcherName).split(' ').filter((part) => part && !honorifics.has(part))
  if (nameParts.length < 2) return false

  const expectedGiven = nameParts[0]
  const expectedFamily = nameParts.at(-1)

  return authors.some((author) => {
    const authorParts = normalizeName(author).split(' ').filter(Boolean)
    if (!authorParts.includes(expectedFamily)) return false

    return authorParts.some((part) => {
      if (part === expectedFamily) return false
      if (part === expectedGiven) return true
      return part.length <= 3 && part.startsWith(expectedGiven[0])
    })
  })
}

function matchesResearcherName(authors = [], researcherName = '', researcherOrcid = '') {
  const honorifics = new Set(['dr', 'prof', 'professor', 'mr', 'mrs', 'ms'])
  const nameParts = normalizeName(researcherName).split(' ').filter((part) => part && !honorifics.has(part))
  if (nameParts.length < 2) return false
  const expectedFamily = nameParts.at(-1)
  const expectedGiven = nameParts[0]
  const expectedMiddleInitials = nameParts.slice(1, -1).map((part) => part[0])
  const expectedOrcid = normalizeOrcid(researcherOrcid)

  return authors.some((author) => {
    const family = normalizeName(author?.family)
    const given = normalizeName(author?.given)
    const authorOrcid = normalizeOrcid(author?.ORCID)
    if (authorOrcid && expectedOrcid && authorOrcid !== expectedOrcid) return false
    if (!(family === expectedFamily || family.endsWith(` ${expectedFamily}`)) || !given) return false
    const givenParts = given.split(' ').filter(Boolean)
    const givenMatches = given.length === 1 ? given === expectedGiven[0] : givenParts[0] === expectedGiven
    if (!givenMatches || (authorOrcid && expectedOrcid)) return givenMatches
    if (!expectedMiddleInitials.length) return true

    const authorMiddleInitials = givenParts.slice(1).map((part) => part[0])
    // A source may omit the researcher's middle initial entirely. Treat an
    // explicit conflicting initial as a mismatch without requiring the source
    // to include the expected initial.
    if (!authorMiddleInitials.length) return true
    return expectedMiddleInitials.every((initial, index) => authorMiddleInitials[index] === initial)
  })
}

function dateFromParts(parts) {
  const values = parts?.['date-parts']?.[0]
  if (!Array.isArray(values) || !values[0]) return null
  const [year, month = 1, day = 1] = values.map(Number)
  if (!Number.isFinite(year)) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`
}

function publicationDateFromCrossref(item) {
  return dateFromParts(item?.['published-online']) ||
    dateFromParts(item?.published) ||
    dateFromParts(item?.['published-print']) ||
    item?.created?.['date-time'] ||
    null
}

function dateParts(value) {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return { year: null, month: '' }
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  }
}

async function sleep(ms) {
  if (!(ms > 0)) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status < 600)
}

function resolveRetryDelayMs(response, fallbackMs) {
  const header = response?.headers?.get?.('retry-after')
  if (header) {
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS)
    }
    const retryAt = Date.parse(header)
    if (!Number.isNaN(retryAt)) {
      return Math.min(Math.max(retryAt - Date.now(), 0), MAX_RETRY_DELAY_MS)
    }
  }
  return Math.min(fallbackMs, MAX_RETRY_DELAY_MS)
}

/**
 * Fetch JSON from a discovery source, retrying throttled and transient failures.
 *
 * Crossref answers sustained bursts with 429 and OpenAlex occasionally 5xxs. Without a
 * retry the whole researcher's contribution from that source silently drops out of the
 * run, which used to remove already-published papers from the site (see
 * lib/publicationRetention.js for the second half of that safety net).
 */
async function fetchJson(url, {
  fetchFn = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  headers = {},
  retryAttempts = DEFAULT_RETRY_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  const attempts = Math.max(0, Number(retryAttempts) || 0)
  let lastError = null

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchFn(url, { headers, signal: controller.signal })
      if (response.ok) return await response.json()

      const error = new Error(`${response.status} ${response.statusText}`.trim())
      error.status = response.status
      if (attempt >= attempts || !isRetryableStatus(response.status)) throw error
      lastError = error
      await sleep(resolveRetryDelayMs(response, retryDelayMs * (attempt + 1)))
    } catch (error) {
      if (Number.isFinite(error?.status) && !isRetryableStatus(error.status)) throw error
      if (attempt >= attempts) throw error
      lastError = error
      await sleep(Math.min(retryDelayMs * (attempt + 1), MAX_RETRY_DELAY_MS))
    } finally {
      clearTimeout(timer)
    }
  }

  throw lastError || new Error('Secondary publication request failed')
}

function normalizeCrossrefItem(item, queryPath) {
  const doi = normalizeDoi(item?.DOI)
  if (!doi) return null
  const publishedAt = publicationDateFromCrossref(item)
  const { year, month } = dateParts(publishedAt)
  const abstract = cleanText(item?.abstract)
  return withPublicationKey({
    source: 'crossref',
    sources: ['crossref'],
    doi,
    pmid: null,
    title: cleanText(item?.title?.[0]),
    authors: (item?.author || [])
      .map((author) => cleanText([author.given, author.family].filter(Boolean).join(' ')))
      .filter(Boolean),
    attributionAuthors: (item?.author || []).map((author) => ({
      given: cleanText(author?.given),
      family: cleanText(author?.family),
      displayName: cleanText([author?.given, author?.family].filter(Boolean).join(' ')),
      orcid: normalizeOrcid(author?.ORCID) || null,
      affiliations: (author?.affiliation || []).map((entry) => cleanText(entry?.name)).filter(Boolean),
    })),
    attributionQueryPaths: queryPath ? [queryPath] : [],
    journal: cleanText(item?.['container-title']?.[0]),
    publishedAt,
    year,
    month,
    abstract,
    abstractContentType: abstract ? 'abstract' : null,
    abstractSource: abstract ? 'crossref' : null,
    publicationTypes: item?.type === 'journal-article' ? ['Journal Article'] : [],
    url: item?.URL || `https://doi.org/${doi}`,
  })
}

export async function fetchCrossrefPublications(researcher, options = {}) {
  const orcid = normalizeOrcid(researcher?.orcid)
  const name = getResearcherPublicationName(researcher)
  if (!orcid && !name) return []

  const maxResults = Math.min(Number(options.maxResults || DEFAULT_MAX_RESULTS), 1000)
  const sinceYear = Number(options.sinceYear) || new Date().getUTCFullYear() - 4
  const baseFilters = ['type:journal-article', `from-pub-date:${sinceYear}-01-01`]
  const requests = []
  if (orcid) {
    requests.push({
      queryPath: 'crossref:orcid',
      params: new URLSearchParams({
        rows: String(maxResults),
        filter: [...baseFilters, `orcid:${orcid}`].join(','),
        sort: 'published',
        order: 'desc',
      }),
    })
  }
  const nameParams = new URLSearchParams({
    rows: String(maxResults),
    filter: baseFilters.join(','),
    'query.author': name,
    sort: 'published',
    order: 'desc',
  })
  requests.push({ queryPath: 'crossref:name', params: nameParams })

  const publications = []
  for (const { params, queryPath } of requests) {
    if (process.env.CROSSREF_MAILTO) params.set('mailto', process.env.CROSSREF_MAILTO)
    const data = await fetchJson(`${CROSSREF_BASE_URL}?${params}`, options)
    const items = data?.message?.items || []
    publications.push(...items
      .filter((item) => matchesResearcherName(item?.author || [], name, orcid))
      .map((item) => normalizeCrossrefItem(item, queryPath))
      .filter((item) => item?.title && item?.year >= sinceYear))
  }
  return mergePublications(publications)
}

export function reconstructOpenAlexAbstract(index) {
  if (!index || typeof index !== 'object') return ''
  const words = []
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions || []) words[position] = word
  }
  return cleanText(words.filter(Boolean).join(' '))
}

function normalizeOpenAlexItem(item) {
  const doi = normalizeDoi(item?.doi || item?.ids?.doi)
  if (!doi) return null
  const publishedAt = item?.publication_date ? `${item.publication_date}T00:00:00Z` : null
  const { year, month } = dateParts(publishedAt)
  const abstract = reconstructOpenAlexAbstract(item?.abstract_inverted_index)
  return withPublicationKey({
    source: 'openalex',
    sources: ['openalex'],
    doi,
    pmid: String(item?.ids?.pmid || '').replace(/^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//i, '') || null,
    openAlexId: item?.id || null,
    title: cleanText(item?.display_name || item?.title),
    authors: (item?.authorships || []).map((entry) => cleanText(entry?.author?.display_name)).filter(Boolean),
    attributionAuthors: (item?.authorships || []).map((entry) => ({
      displayName: cleanText(entry?.author?.display_name),
      orcid: normalizeOrcid(entry?.author?.orcid) || null,
      affiliations: [
        ...(entry?.institutions || []).map((institution) => cleanText(institution?.display_name)),
        ...(entry?.raw_affiliation_strings || []).map(cleanText),
      ].filter(Boolean),
    })),
    attributionQueryPaths: ['openalex:orcid'],
    journal: cleanText(item?.primary_location?.source?.display_name),
    publishedAt,
    year: year || item?.publication_year || null,
    month,
    abstract,
    abstractContentType: abstract ? 'abstract' : null,
    abstractSource: abstract ? 'openalex' : null,
    publicationTypes: item?.type === 'article' ? ['Journal Article'] : [],
    url: item?.primary_location?.landing_page_url || `https://doi.org/${doi}`,
  })
}

export async function fetchOpenAlexPublications(researcher, options = {}) {
  const orcid = normalizeOrcid(researcher?.orcid)
  const name = getResearcherPublicationName(researcher)
  // The API key only buys a higher rate limit. Gating discovery on it meant a missing or
  // expired key silently disabled OpenAlex entirely, so treat it as optional.
  const apiKey = options.openAlexApiKey || process.env.OPENALEX_API_KEY
  if (!orcid) return []

  const maxResults = Math.min(Number(options.maxResults || DEFAULT_MAX_RESULTS), 100)
  const sinceYear = Number(options.sinceYear) || new Date().getUTCFullYear() - 4
  const params = new URLSearchParams({
    filter: `authorships.author.orcid:${orcid},from_publication_date:${sinceYear}-01-01,type:article`,
    // OpenAlex expects `field:direction`. A leading hyphen is read as part of the field
    // name and rejects the whole request with 400 Invalid query parameters.
    sort: 'publication_date:desc',
    per_page: String(maxResults),
  })
  if (apiKey) params.set('api_key', apiKey)
  const mailto = options.openAlexMailto || OPENALEX_MAILTO
  if (mailto) params.set('mailto', mailto)
  const data = await fetchJson(`${OPENALEX_BASE_URL}?${params}`, options)
  return (data?.results || [])
    .map(normalizeOpenAlexItem)
    .filter((item) => item?.title && item?.year >= sinceYear && matchesResearcherAuthorList(item.authors, name))
}

function normalizeEuropePmcItem(item) {
  const doi = normalizeDoi(item?.doi)
  if (!doi || String(item?.source || '').toUpperCase() === 'PPR') return null
  const publishedAtRaw = item?.firstPublicationDate || item?.electronicPublicationDate || null
  const publishedAt = publishedAtRaw ? `${publishedAtRaw.slice(0, 10)}T00:00:00Z` : null
  const { year, month } = dateParts(publishedAt)
  const europePmcId = [item?.source, item?.id].filter(Boolean).join(':')
  const abstract = cleanText(item?.abstractText)
  return withPublicationKey({
    source: 'europepmc',
    sources: ['europepmc'],
    doi,
    pmid: item?.pmid || (item?.source === 'MED' ? item?.id : null),
    europePmcId: europePmcId || null,
    title: cleanText(item?.title),
    authors: (item?.authorList?.author || [])
      .map((author) => cleanText(author?.fullName || [author?.firstName, author?.lastName].filter(Boolean).join(' ')))
      .filter(Boolean),
    attributionAuthors: (item?.authorList?.author || []).map((author) => ({
      given: cleanText(author?.firstName),
      family: cleanText(author?.lastName),
      displayName: cleanText(author?.fullName || [author?.firstName, author?.lastName].filter(Boolean).join(' ')),
      orcid: normalizeOrcid(author?.authorId?.type === 'ORCID' ? author?.authorId?.value : author?.authorId) || null,
      affiliations: (author?.authorAffiliationDetailsList?.authorAffiliation || [])
        .map((entry) => cleanText(entry?.affiliation))
        .filter(Boolean),
    })),
    attributionQueryPaths: ['europepmc:orcid'],
    journal: cleanText(item?.journalTitle),
    publishedAt,
    year: year || Number(item?.pubYear) || null,
    month,
    abstract,
    abstractContentType: abstract ? 'abstract' : null,
    abstractSource: abstract ? 'europepmc' : null,
    publicationTypes: item?.pubTypeList?.pubType || [],
    url: `https://doi.org/${doi}`,
  })
}

export async function fetchEuropePmcPublications(researcher, options = {}) {
  const orcid = normalizeOrcid(researcher?.orcid)
  const name = getResearcherPublicationName(researcher)
  if (!orcid) return []

  const maxResults = Math.min(Number(options.maxResults || DEFAULT_MAX_RESULTS), 1000)
  const sinceYear = Number(options.sinceYear) || new Date().getUTCFullYear() - 4
  const params = new URLSearchParams({
    query: `AUTHORID:"${orcid}" AND PUB_YEAR:[${sinceYear} TO 3000]`,
    resultType: 'core',
    format: 'json',
    pageSize: String(maxResults),
  })
  const data = await fetchJson(`${EUROPE_PMC_BASE_URL}?${params}`, options)
  return (data?.resultList?.result || [])
    .map(normalizeEuropePmcItem)
    .filter((item) => item?.title && item?.year >= sinceYear && matchesResearcherAuthorList(item.authors, name))
}

/**
 * Discover a researcher's publications across the non-PubMed sources.
 *
 * A failing source is logged and skipped so one outage cannot abort the run, but the
 * failure is also reported through `options.onSourceError` so the caller knows this
 * researcher's result set is incomplete and must not be treated as authoritative.
 */
export async function getSecondaryPublicationsForResearcher(researcher, options = {}) {
  const sourceCalls = [
    ['Crossref', fetchCrossrefPublications],
    ['OpenAlex', fetchOpenAlexPublications],
    ['Europe PMC', fetchEuropePmcPublications],
  ]
  const publications = []
  const delayMs = Number.isFinite(options.sourceDelayMs) ? options.sourceDelayMs : SOURCE_DELAY_MS

  for (let index = 0; index < sourceCalls.length; index += 1) {
    const [sourceName, fetchSource] = sourceCalls[index]
    try {
      publications.push(...await fetchSource(researcher, options))
    } catch (error) {
      console.warn(`[publications] ${sourceName} discovery failed for ${researcher?.name || researcher?._id || 'researcher'}`, error?.message || error)
      if (typeof options.onSourceError === 'function') {
        options.onSourceError({ source: sourceName, researcher, error })
      }
    }
    if (index < sourceCalls.length - 1) await sleep(delayMs)
  }

  return mergePublications(publications)
}
