// Combines PubMed data with OpenAlex citation counts

import { getPublicationsForAffiliation, getPublicationsForResearcher, getPublicationsByCustomQuery } from './pubmed'
import { enrichWithSummaries } from './summaries'

// Simple in-memory cache (per runtime) to avoid expensive PubMed calls.
// Each cache entry stores { timestamp, key, data } and expires after TTL_MS.
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const cache = {
  researchersDisplay: null,
  enrichedResearchers: null,
}

export async function getEnrichedPublications(affiliation, maxResults = 100) {
  const publications = await getPublicationsForAffiliation(affiliation, maxResults)
  return filterRecent(publications)
}

/**
 * Get publications across researchers using their individual PubMed queries.
 * Deduplicates by PMID.
 */
export async function getEnrichedPublicationsForResearchers(researchers = [], maxPerResearcher = 200) {
  const key = buildResearchersKey(researchers, maxPerResearcher)
  if (cache.enrichedResearchers && cache.enrichedResearchers.key === key && !isExpired(cache.enrichedResearchers.timestamp)) {
    return cache.enrichedResearchers.data
  }

  const pubs = []
  const seen = new Set()
  const provenance = {} // pmid -> Set of researcher IDs

  for (const researcher of researchers) {
    if (!researcher.pubmedQuery) continue
    try {
      const query = researcher.pubmedQuery.trim()
      const items = await getPublicationsByCustomQuery(query, maxPerResearcher)
      for (const pub of items) {
        if (pub.pmid && !seen.has(pub.pmid)) {
          seen.add(pub.pmid)
          pubs.push(pub)
        }
        if (pub.pmid) {
          if (!provenance[pub.pmid]) provenance[pub.pmid] = new Set()
          provenance[pub.pmid].add(researcher._id)
        }
      }
    } catch (err) {
      console.error('PubMed fetch failed for researcher', researcher.name, err)
    }
  }
  const recent = filterRecent(pubs)
  const data = { publications: recent, provenance }
  cache.enrichedResearchers = { key, timestamp: Date.now(), data }
  return data
}

/**
 * Get publications grouped and sorted for display
 */
export async function getPublicationsForDisplay(affiliation, maxResults = 100) {
  const publications = await getEnrichedPublications(affiliation, maxResults)

  return buildDisplay(publications)
}

/**
 * Get publications for display using researcher-level queries (no affiliation required)
 */
export async function getPublicationsForResearchersDisplay(researchers, maxPerResearcher = 30) {
  const key = buildResearchersKey(researchers, maxPerResearcher)
  if (cache.researchersDisplay && cache.researchersDisplay.key === key && !isExpired(cache.researchersDisplay.timestamp)) {
    return cache.researchersDisplay.data
  }

  const { publications, provenance } = await getEnrichedPublicationsForResearchers(researchers, maxPerResearcher)

  // Serialize provenance Sets to arrays for safe React/server rendering
  const provenanceSerialized = Object.fromEntries(
    Object.entries(provenance || {}).map(([pmid, set]) => [pmid, Array.from(set || [])])
  )

  const data = { ...buildDisplay(publications), provenance: provenanceSerialized }
  cache.researchersDisplay = { key, timestamp: Date.now(), data }
  return data
}

/**
 * Optionally add AI-generated lay summaries to publications using LLMs.
 * Currently uses OpenRouter by default; skips if no API key is present or on error.
 */
export async function addLaySummaries(publications = [], options = {}) {
  const hasKey = Boolean(
    options.apiKey ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY
  )
  if (!hasKey) return publications
  try {
    return await enrichWithSummaries(publications, options)
  } catch (err) {
    console.error('Error generating lay summaries, proceeding without them:', err)
    return publications
  }
}

function buildDisplay(publications) {
  // Sort by newest first
  publications.sort((a, b) => {
    const yearDiff = (b.year || 0) - (a.year || 0)
    return yearDiff
  })

  // Group by year
  const byYear = publications.reduce((acc, pub) => {
    const year = pub.year || 'Unknown'
    if (!acc[year]) acc[year] = []
    acc[year].push(pub)
    return acc
  }, {})

  // Calculate stats
  const stats = {
    totalPublications: publications.length,
    yearsSpan: publications.length > 0
      ? `${Math.min(...publications.map(p => p.year).filter(Boolean))}-${Math.max(...publications.map(p => p.year).filter(Boolean))}`
      : null
  }
  
  return {
    publications,
    byYear,
    stats,
    years: Object.keys(byYear).sort((a, b) => b - a)
  }
}

/**
 * Find high-impact publications (most cited)
 */
export async function getHighImpactPublications(affiliation, topN = 10) {
  const publications = await getEnrichedPublications(affiliation, 200)
  return publications.slice(0, topN)
}

/**
 * Get recent publications (last N months)
 */
export async function getRecentPublications(affiliation, months = 6) {
  const publications = await getEnrichedPublications(affiliation, 50)
  
  const cutoffDate = new Date()
  cutoffDate.setMonth(cutoffDate.getMonth() - months)
  const cutoffYear = cutoffDate.getFullYear()
  const cutoffMonth = cutoffDate.getMonth() + 1
  
  return publications.filter(pub => {
    if (!pub.year) return false
    const pubYear = parseInt(pub.year)
    if (pubYear > cutoffYear) return true
    if (pubYear === cutoffYear) {
      // Rough month comparison
      const monthMap = {
        'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
        'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
      }
      const pubMonth = monthMap[pub.month] || 1
      return pubMonth >= cutoffMonth
    }
    return false
  })
}

function filterRecent(publications) {
  const currentYear = new Date().getFullYear()
  const cutoff = currentYear - 2 // last 3 calendar years including current
  return publications.filter(pub => {
    const yr = parseInt(pub.year, 10)
    return !Number.isNaN(yr) && yr >= cutoff
  })
}

function buildResearchersKey(researchers = [], maxPerResearcher) {
  try {
    const parts = (researchers || [])
      .map(r => {
        // Extract only primitive values to avoid circular references
        const id = r?._id || (r?.slug?.current ? String(r.slug.current) : '') || (typeof r?.slug === 'string' ? String(r.slug) : '') || (r?.name ? String(r.name) : '') || ''
        const query = (r?.pubmedQuery ? String(r.pubmedQuery).trim() : '')
        return { id, query }
      })
      .sort((a, b) => a.id.localeCompare(b.id))
    return JSON.stringify({ max: maxPerResearcher, researchers: parts })
  } catch (err) {
    // Fallback to a simple key if serialization fails
    console.error('Error building researchers key:', err)
    const simpleKey = researchers.map(r => r?._id || r?.name || '').join('|')
    return `${simpleKey}-${maxPerResearcher}`
  }
}

function isExpired(timestamp) {
  return !timestamp || Date.now() - timestamp > TTL_MS
}

