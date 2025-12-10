const BASE_URL = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

// Optional: Add API key for higher rate limits (10/sec vs 3/sec)
const API_KEY = process.env.PUBMED_API_KEY || ''
const apiKeyParam = API_KEY ? `&api_key=${API_KEY}` : ''

const REQUEST_TIMEOUT_MS = Number(process.env.PUBMED_TIMEOUT_MS || 15000)
const MAX_RETRIES = Number(process.env.PUBMED_RETRIES || 2)
const RETRY_DELAY_MS = Number(process.env.PUBMED_RETRY_DELAY_MS || 500)

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
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
          pmid: item.uid,
          title: item.title || 'No title',
          authors: (item.authors || []).map(a => a.name).filter(Boolean),
          journal: item.source || '',
          year: item.pubdate?.split(' ')[0] || '',
          volume: item.volume || '',
          issue: item.issue || '',
          pages: item.pages || '',
          doi: item.elocationid?.replace('doi: ', '') || '',
          url: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}/`
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
  
  // Process in chunks of 200
  const chunks = []
  for (let i = 0; i < pmids.length; i += 200) {
    chunks.push(pmids.slice(i, i + 200))
  }

  for (const chunk of chunks) {
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
        }
      }
    } catch (error) {
      console.error('Error fetching abstracts:', error)
    }
  }

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

