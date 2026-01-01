const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

// Optional: Add API key for higher rate limits (10/sec vs 3/sec)
const API_KEY = process.env.PUBMED_API_KEY || ''
const apiKeyParam = API_KEY ? `&api_key=${API_KEY}` : ''

const REQUEST_TIMEOUT_MS = Number(process.env.PUBMED_TIMEOUT_MS || 15000)
const MAX_RETRIES = Number(process.env.PUBMED_RETRIES || 2)
const RETRY_DELAY_MS = Number(process.env.PUBMED_RETRY_DELAY_MS || 500)
const PUBMED_DEBUG = process.env.PUBMED_DEBUG === 'true'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LOOKUP = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

function logPubmedDebug(message, data = {}) {
  if (PUBMED_DEBUG) {
    console.info('[pubmed]', message, data)
  }
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function getLastDayOfMonth(year, month) {
  if (!year || !month) return 1
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function normalizeMonthToken(token) {
  if (!token) return null
  const key = String(token).trim().toLowerCase()
  return MONTHS_LOOKUP[key] || null
}

function buildCandidate({ year, month, dayStart, dayEnd, precision }) {
  if (!Number.isFinite(year) || year <= 0) return null
  const safeMonth = Number.isFinite(month) && month >= 1 && month <= 12 ? month : 1
  const maxDay = getLastDayOfMonth(year, safeMonth)
  const safeStart = Math.min(Math.max(Number.isFinite(dayStart) ? dayStart : 1, 1), maxDay)
  const safeEnd = Math.min(Math.max(Number.isFinite(dayEnd) ? dayEnd : safeStart, safeStart), maxDay)
  return {
    year,
    month: safeMonth,
    monthName: MONTHS_SHORT[safeMonth - 1] || '',
    dayStart: safeStart,
    dayEnd: safeEnd,
    precision,
    startMs: Date.UTC(year, safeMonth - 1, safeStart),
    endMs: Date.UTC(year, safeMonth - 1, safeEnd),
  }
}

function extractDateCandidates(raw) {
  const text = String(raw || '').trim()
  if (!text) return []

  const candidates = []
  const monthHasDay = new Set()

  const numericRegex = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/g
  for (const match of text.matchAll(numericRegex)) {
    const year = Number(match[1])
    const month = Number(match[2])
    const day = Number(match[3])
    const candidate = buildCandidate({ year, month, dayStart: day, dayEnd: day, precision: 'day' })
    if (candidate) {
      candidates.push(candidate)
      monthHasDay.add(`${candidate.year}-${candidate.month}`)
    }
  }

  const monthDayRegex = /(\d{4})\s+([A-Za-z]{3,9})\s+(\d{1,2})(?:\s*-\s*(\d{1,2}))?/g
  for (const match of text.matchAll(monthDayRegex)) {
    const year = Number(match[1])
    const month = normalizeMonthToken(match[2])
    if (!month) continue
    const dayStart = Number(match[3])
    const dayEnd = match[4] ? Number(match[4]) : dayStart
    const candidate = buildCandidate({ year, month, dayStart, dayEnd, precision: 'day' })
    if (candidate) {
      candidates.push(candidate)
      monthHasDay.add(`${candidate.year}-${candidate.month}`)
    }
  }

  const monthOnlyRegex = /(\d{4})\s+([A-Za-z]{3,9})/g
  for (const match of text.matchAll(monthOnlyRegex)) {
    const year = Number(match[1])
    const month = normalizeMonthToken(match[2])
    if (!month) continue
    if (monthHasDay.has(`${year}-${month}`)) continue
    const endDay = getLastDayOfMonth(year, month)
    const candidate = buildCandidate({ year, month, dayStart: 1, dayEnd: endDay, precision: 'month' })
    if (candidate) {
      candidates.push(candidate)
    }
  }

  if (candidates.length === 0) {
    const yearMatch = text.match(/(\d{4})/)
    if (yearMatch) {
      const year = Number(yearMatch[1])
      const candidate = buildCandidate({ year, month: 1, dayStart: 1, dayEnd: 1, precision: 'year' })
      if (candidate) {
        candidates.push(candidate)
      }
    }
  }

  return candidates
}

function selectEarliestCandidate(candidates) {
  if (!candidates.length) return null
  return candidates.reduce((best, candidate) => (
    candidate.startMs < best.startMs ? candidate : best
  ))
}

function resolvePublicationDate(candidate) {
  if (!candidate) return null
  const day = candidate.precision === 'month' ? candidate.dayEnd : candidate.dayStart
  const isoDate = `${candidate.year}-${String(candidate.month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00Z`
  return {
    isoDate,
    year: candidate.year,
    month: candidate.month,
    monthName: candidate.monthName,
  }
}

function parsePubDate(item = {}) {
  const epubCandidates = extractDateCandidates(item.epubdate)
  const pubCandidates = extractDateCandidates(item.pubdate)
  const sortCandidates = extractDateCandidates(item.sortpubdate)

  const publicationCandidates = [...epubCandidates, ...pubCandidates]
  const bestPublication = selectEarliestCandidate(publicationCandidates)
  const best = bestPublication || selectEarliestCandidate(sortCandidates)

  if (best) {
    const resolved = resolvePublicationDate(best)
    if (resolved) return resolved
  }

  const fallbackYear = item.pubdate?.split(' ')[0]
  const fallbackYearNum = fallbackYear ? Number.parseInt(fallbackYear, 10) : null

  return {
    isoDate: fallbackYearNum ? `${fallbackYearNum}-01-01T00:00:00Z` : null,
    year: fallbackYearNum,
    month: null,
    monthName: '',
  }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) {
      throw new Error(`PubMed request failed: ${response.status} ${response.statusText}`)
    }
    return response
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJsonWithRetry(url) {
  let lastErr
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url)
      return await res.json()
    } catch (err) {
      lastErr = err
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * (attempt + 1))
      }
    }
  }
  throw lastErr
}

async function fetchTextWithRetry(url) {
  let lastErr
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url)
      return await res.text()
    } catch (err) {
      lastErr = err
      if (attempt < MAX_RETRIES) {
        await delay(RETRY_DELAY_MS * (attempt + 1))
      }
    }
  }
  throw lastErr
}

/**
 * Search PubMed and return PMIDs
 * @param {string} query - PubMed search query
 * @param {number} maxResults - Maximum number of results
 * @returns {Promise<string[]>} Array of PMIDs
 */
export async function searchPubMed(query, maxResults = 200) {
  const url = `${BASE_URL}/esearch.fcgi?db=pubmed${apiKeyParam}&term=${encodeURIComponent(query)}&retmode=json&retmax=${maxResults}`

  const data = await fetchJsonWithRetry(url)
  
  return data.esearchresult?.idlist || []
}

/**
 * Fetch publication details for given PMIDs using esummary (returns JSON)
 * @param {string[]} pmids - Array of PubMed IDs
 * @returns {Promise<Publication[]>} Array of publication objects
 */
export async function fetchPublicationDetails(pmids) {
  if (!pmids.length) return []

  // esummary handles up to ~200 IDs per request reliably
  const chunks = []
  for (let i = 0; i < pmids.length; i += 200) {
    chunks.push(pmids.slice(i, i + 200))
  }

  const allPublications = []

  for (const chunk of chunks) {
    const url = `${BASE_URL}/esummary.fcgi?db=pubmed${apiKeyParam}&id=${chunk.join(',')}&retmode=json`
    
    try {
      const data = await fetchJsonWithRetry(url)
      
      const publications = Object.values(data.result || {})
        .filter(item => item && item.uid)
        .map(item => ({
          ...(() => {
            const parsed = parsePubDate(item)
            return {
              publishedAt: parsed.isoDate,
              month: parsed.monthName || '',
              year: parsed.year || (item.pubdate?.split(' ')[0] || '')
            }
          })(),
          pmid: item.uid,
          title: item.title || 'No title',
          authors: (item.authors || []).map(a => a.name).filter(Boolean),
          journal: item.source || '',
          volume: item.volume || '',
          issue: item.issue || '',
          pages: item.pages || '',
          doi: item.elocationid?.replace('doi: ', '') || '',
          url: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`,
          pubDate: item.pubdate || '',
          epubDate: item.epubdate || '',
          sortDate: item.sortpubdate || ''
        }))

      allPublications.push(...publications)
    } catch (error) {
      console.error('Error fetching publications:', error)
    }
  }

  return allPublications
}

/**
 * Fetch abstracts for given PMIDs using efetch
 * esummary doesn't return abstracts, so we need efetch for this
 * @param {string[]} pmids - Array of PubMed IDs
 * @returns {Promise<Map<string, string>>} Map of PMID -> abstract
 */
export async function fetchAbstracts(pmids) {
  if (!pmids.length) return new Map()

  const abstracts = new Map()
  let parsedArticles = 0
  let abstractsWithText = 0
  
  // Process in chunks of 200
  const chunks = []
  for (let i = 0; i < pmids.length; i += 200) {
    chunks.push(pmids.slice(i, i + 200))
  }

  for (const chunk of chunks) {
    logPubmedDebug('Fetching abstract chunk', { requested: chunk.length, sample: chunk.slice(0, 5) })
    const url = `${BASE_URL}/efetch.fcgi?db=pubmed${apiKeyParam}&id=${chunk.join(',')}&rettype=abstract&retmode=xml`
    
    try {
      const xml = await fetchTextWithRetry(url)
      
      // Extract abstracts from XML
      const articleMatches = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || []
      
      for (const articleXml of articleMatches) {
        const pmidMatch = articleXml.match(/<PMID[^>]*>(\d+)<\/PMID>/)
        const abstractMatch = articleXml.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/g)
        
        if (pmidMatch) {
          const pmid = pmidMatch[1]
          let abstract = ''
          
          if (abstractMatch) {
            // Handle structured abstracts (multiple AbstractText elements)
            abstract = abstractMatch
              .map(a => a.replace(/<\/?AbstractText[^>]*>/g, '').trim())
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim()
          }
          
          abstracts.set(pmid, abstract)
          parsedArticles += 1
          if (abstract) {
            abstractsWithText += 1
          }
        }
      }
      logPubmedDebug('Parsed abstract chunk', {
        chunkSize: chunk.length,
        articlesFound: articleMatches.length,
        parsedArticles,
        abstractsWithText
      })
    } catch (error) {
      console.error('Error fetching abstracts:', error)
    }
  }

  logPubmedDebug('Abstract fetching complete', {
    requested: pmids.length,
    parsedArticles,
    abstractsWithText,
    missingAbstracts: pmids.length - abstractsWithText
  })

  return abstracts
}

/**
 * Fetch publications with abstracts
 * Combines esummary (metadata) + efetch (abstracts)
 */
export async function fetchPublicationsWithAbstracts(pmids) {
  const [publications, abstracts] = await Promise.all([
    fetchPublicationDetails(pmids),
    fetchAbstracts(pmids)
  ])

  return publications.map(pub => ({
    ...pub,
    abstract: abstracts.get(pub.pmid) || ''
  }))
}

/**
 * Search by affiliation
 * @param {string} affiliation - Affiliation search term
 * @param {number} maxResults - Maximum publications to fetch
 */
export async function getPublicationsForAffiliation(affiliation, maxResults = 100) {
  const query = `${affiliation}[Affiliation]`
  const pmids = await searchPubMed(query, maxResults)
  return fetchPublicationsWithAbstracts(pmids)
}

/**
 * Search by researcher name with multiple name field variants
 * @param {string} authorName - Author name (e.g., "Smith J" or "John Smith")
 * @param {string[]} affiliations - Array of affiliation terms to filter by
 */
export async function getPublicationsForResearcher(authorName, affiliations = [], maxResults = 50) {
  // Search Author, Investigator, and Full Author Name fields
  const nameQuery = `(${authorName}[Author] OR ${authorName}[Investigator] OR ${authorName}[Full Author Name])`

  let query = nameQuery
  if (affiliations.length > 0) {
    const affQuery = affiliations.map(aff => `${aff}[Affiliation]`).join(' OR ')
    query = `${nameQuery} AND (${affQuery})`
  }

  const pmids = await searchPubMed(query, maxResults)
  return fetchPublicationsWithAbstracts(pmids)
}

/**
 * Run an arbitrary PubMed query string (expects properly formatted fielded terms)
 */
export async function getPublicationsByCustomQuery(query, maxResults = 200) {
  const pmids = await searchPubMed(query, maxResults)
  return fetchPublicationsWithAbstracts(pmids)
}

/**
 * Search with date range
 */
export async function getPublicationsInDateRange(affiliation, fromDate, toDate, maxResults = 200) {
  // fromDate/toDate format: YYYY/MM/DD or YYYY
  const dateQuery = `(${fromDate}[dp] : ${toDate}[dp])`
  const query = `${affiliation}[Affiliation] AND ${dateQuery}`
  
  const pmids = await searchPubMed(query, maxResults)
  return fetchPublicationsWithAbstracts(pmids)
}
