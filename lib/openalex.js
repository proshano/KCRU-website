const BASE_URL = 'https://api.openalex.org'

// Be a good citizen - identify yourself
const HEADERS = {
  'User-Agent': 'ResearchUnitWebsite/1.0 (mailto:your-email@institution.edu)'
}

/**
 * Search for an author by name and affiliation
 * Returns best match with citation metrics
 */
export async function findAuthor(name, affiliation = null) {
  let query = `display_name.search:${encodeURIComponent(name)}`
  
  if (affiliation) {
    query += `&filter=affiliations.institution.display_name.search:${encodeURIComponent(affiliation)}`
  }

  const response = await fetch(
    `${BASE_URL}/authors?search=${encodeURIComponent(name)}&per_page=5`,
    { headers: HEADERS }
  )
  
  const data = await response.json()
  
  if (!data.results?.length) return null
  
  // Return the top match (most works)
  const author = data.results[0]
  
  return {
    openAlexId: author.id,
    name: author.display_name,
    orcid: author.orcid,
    worksCount: author.works_count,
    citationCount: author.cited_by_count,
    hIndex: author.summary_stats?.h_index,
    i10Index: author.summary_stats?.i10_index,
    currentAffiliation: author.affiliations?.[0]?.institution?.display_name,
    worksApiUrl: author.works_api_url
  }
}

/**
 * Get author metrics by ORCID (more reliable than name search)
 */
export async function getAuthorByOrcid(orcid) {
  // Normalize ORCID format
  const cleanOrcid = orcid.replace('https://orcid.org/', '')
  
  const response = await fetch(
    `${BASE_URL}/authors/orcid:${cleanOrcid}`,
    { headers: HEADERS }
  )
  
  if (!response.ok) return null
  
  const author = await response.json()
  
  return {
    openAlexId: author.id,
    name: author.display_name,
    orcid: author.orcid,
    worksCount: author.works_count,
    citationCount: author.cited_by_count,
    hIndex: author.summary_stats?.h_index,
    i10Index: author.summary_stats?.i10_index,
    twoYearMeanCitedness: author.summary_stats?.['2yr_mean_citedness'],
    currentAffiliation: author.affiliations?.[0]?.institution?.display_name,
    citationsByYear: author.counts_by_year
  }
}

/**
 * Get works (publications) with citation counts for an author
 */
export async function getAuthorWorks(openAlexAuthorId, { maxResults = 50, sortBy = 'cited_by_count' } = {}) {
  const response = await fetch(
    `${BASE_URL}/works?filter=author.id:${openAlexAuthorId}&sort=${sortBy}:desc&per_page=${maxResults}`,
    { headers: HEADERS }
  )
  
  const data = await response.json()
  
  return (data.results || []).map(work => ({
    openAlexId: work.id,
    doi: work.doi,
    pmid: work.ids?.pmid?.replace('https://pubmed.ncbi.nlm.nih.gov/', ''),
    title: work.title,
    publicationYear: work.publication_year,
    journal: work.primary_location?.source?.display_name,
    citationCount: work.cited_by_count,
    isOpenAccess: work.open_access?.is_oa,
    openAccessUrl: work.open_access?.oa_url
  }))
}

/**
 * Get citation counts for a list of DOIs
 * Useful for enriching your PubMed results with citation data
 */
export async function getCitationsForDOIs(dois) {
  if (!dois.length) return {}
  
  // OpenAlex accepts up to 50 DOIs per request
  const chunks = []
  for (let i = 0; i < dois.length; i += 50) {
    chunks.push(dois.slice(i, i + 50))
  }
  
  const citationMap = {}
  
  for (const chunk of chunks) {
    const doiFilter = chunk.map(d => `doi:${d}`).join('|')
    
    const response = await fetch(
      `${BASE_URL}/works?filter=${doiFilter}&per_page=50`,
      { headers: HEADERS }
    )
    
    const data = await response.json()
    
    for (const work of data.results || []) {
      if (work.doi) {
        const cleanDoi = work.doi.replace('https://doi.org/', '')
        citationMap[cleanDoi] = {
          citationCount: work.cited_by_count,
          isOpenAccess: work.open_access?.is_oa,
          openAccessUrl: work.open_access?.oa_url
        }
      }
    }
  }
  
  return citationMap
}

/**
 * Get metrics for multiple researchers (for team page)
 */
export async function getTeamMetrics(researchers) {
  const metrics = []
  
  for (const researcher of researchers) {
    try {
      let authorData = null
      
      // Prefer ORCID lookup if available
      if (researcher.orcid) {
        authorData = await getAuthorByOrcid(researcher.orcid)
      }
      
      // Fall back to name search
      if (!authorData && researcher.name) {
        authorData = await findAuthor(researcher.name, researcher.affiliation)
      }
      
      metrics.push({
        name: researcher.name,
        sanityId: researcher._id,
        ...authorData
      })
      
      // Rate limiting - be nice to the API
      await new Promise(resolve => setTimeout(resolve, 100))
      
    } catch (error) {
      console.error(`Error fetching metrics for ${researcher.name}:`, error)
      metrics.push({
        name: researcher.name,
        sanityId: researcher._id,
        error: true
      })
    }
  }
  
  return metrics
}

/**
 * Get institution-level stats
 */
export async function getInstitutionStats(institutionName) {
  const response = await fetch(
    `${BASE_URL}/institutions?search=${encodeURIComponent(institutionName)}&per_page=1`,
    { headers: HEADERS }
  )
  
  const data = await response.json()
  
  if (!data.results?.length) return null
  
  const inst = data.results[0]
  
  return {
    openAlexId: inst.id,
    name: inst.display_name,
    country: inst.country_code,
    type: inst.type,
    worksCount: inst.works_count,
    citationCount: inst.cited_by_count,
    homepage: inst.homepage_url
  }
}

