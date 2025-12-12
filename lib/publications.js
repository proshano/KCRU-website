// Combines PubMed data with OpenAlex citation counts

import { getPublicationsForAffiliation, getPublicationsByCustomQuery } from './pubmed.js'
import { generateSummariesBatch } from './summaries.js'
import { readCache, writeCache, withCacheLock, isCacheStale, CACHE_PATH_DISPLAY, isCancelRequested, getExistingSummaries } from './pubmedCache.js'

// Simple in-memory cache (per runtime) to avoid expensive PubMed calls.
// Each cache entry stores { timestamp, key, data } and expires after TTL_MS.
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const cache = {
  researchersDisplay: null,
  enrichedResearchers: null,
}

const DEFAULT_MAX_PER_RESEARCHER = Number(process.env.PUBMED_MAX_PER_RESEARCHER || 120)
const DEFAULT_MAX_AFFILIATION = Number(process.env.PUBMED_MAX_AFFILIATION || 80)
const DEFAULT_PUBLICATIONS_SINCE_YEARS_BACK = (() => {
  // We intentionally use whole calendar years (to avoid partial-year fragmentation).
  // Default: start of the year 3 years back (e.g., in 2025 => since 2022).
  const raw = process.env.PUBLICATIONS_SINCE_YEARS_BACK
  if (!raw) return 3
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 3
})()
const DEFAULT_SUMMARIES_PER_REFRESH = (() => {
  const raw = process.env.LLM_SUMMARIES_PER_REFRESH
  if (!raw) return Infinity // process all by default
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : Infinity
})()
const DEFAULT_SUMMARY_MODEL = process.env.LLM_MODEL || 'google/gemma-2-9b-it:free'

export function getPublicationsSinceYear(now = new Date()) {
  return now.getFullYear() - DEFAULT_PUBLICATIONS_SINCE_YEARS_BACK
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

  async function throwIfCancelled(stage) {
    if (await isCancelRequested()) {
      const msg = stage ? `PubMed cache refresh cancelled (${stage})` : 'PubMed cache refresh cancelled'
      const err = new Error(msg)
      err.code = 'PUBMED_REFRESH_CANCELLED'
      throw err
    }
  }

  const pubs = []
  const seen = new Set()
  const provenance = {} // pmid -> Set of researcher IDs

  let totalAdded = 0
  const TOTAL_CAP = 1200 // guard against runaway size

  for (const researcher of researchers) {
    if (!researcher?.pubmedQuery) continue
    if (totalAdded >= TOTAL_CAP) break
    await throwIfCancelled(`researcher ${researcher.name || researcher._id || ''}`)

    try {
      const query = researcher.pubmedQuery.trim()
      const items = await getPublicationsByCustomQuery(query, maxPerResearcher)

      for (const pub of items) {
        if (totalAdded >= TOTAL_CAP) break
        const pmid = pub?.pmid

        if (pmid && !seen.has(pmid)) {
          seen.add(pmid)
          pubs.push(pub)
          totalAdded += 1
        }

        if (pmid) {
          try {
            if (!provenance[pmid]) provenance[pmid] = new Set()
            provenance[pmid].add(researcher._id)
          } catch (err) {
            console.error('Provenance add failed', { pmid, researcher: researcher._id }, err)
          }
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

  try {
    const { publications, provenance } = await getEnrichedPublicationsForResearchers(researchers, maxPerResearcher)

    // Serialize provenance Sets to arrays for safe React/server rendering
    const provenanceSerialized = Object.fromEntries(
      Object.entries(provenance || {}).map(([pmid, set]) => [pmid, Array.from(set || [])])
    )

    const display = buildDisplay(publications || [])

    // Nuclear option: JSON round-trip to break any circular references and ensure plain objects
    const data = JSON.parse(JSON.stringify({ ...display, provenance: provenanceSerialized }))
    cache.researchersDisplay = { key, timestamp: Date.now(), data }
    return data
  } catch (err) {
    console.error('getPublicationsForResearchersDisplay failed', err)
    return {
      publications: [],
      byYear: {},
      years: [],
      provenance: {},
      stats: { totalPublications: 0, yearsSpan: null }
    }
  }
}

function normalizeProvenance(provenance = {}) {
  return Object.fromEntries(
    Object.entries(provenance || {}).map(([pmid, set]) => [pmid, Array.from(set || [])])
  )
}

function dedupePublications(pubLists = []) {
  const seen = new Set()
  const result = []
  for (const pub of pubLists) {
    const key = pub?.pmid || pub?.doi || pub?.title
    if (key && !seen.has(key)) {
      seen.add(key)
      result.push(pub)
    }
  }
  return result
}

export function buildPubmedCacheKey({ researchers = [], affiliation = '', maxPerResearcher = DEFAULT_MAX_PER_RESEARCHER, maxAffiliation = DEFAULT_MAX_AFFILIATION } = {}) {
  const researchersKey = buildResearchersKey(researchers, maxPerResearcher)
  const sinceYear = getPublicationsSinceYear()
  return JSON.stringify({
    researchersKey,
    affiliation: affiliation || '',
    maxPerResearcher,
    maxAffiliation,
    window: { mode: 'since_year', sinceYear }
  })
}

async function fetchCombinedPublicationsLive({ researchers = [], affiliation = '', maxPerResearcher = DEFAULT_MAX_PER_RESEARCHER, maxAffiliation = DEFAULT_MAX_AFFILIATION }) {
  async function throwIfCancelled(stage) {
    if (await isCancelRequested()) {
      const msg = stage ? `PubMed cache refresh cancelled (${stage})` : 'PubMed cache refresh cancelled'
      const err = new Error(msg)
      err.code = 'PUBMED_REFRESH_CANCELLED'
      throw err
    }
  }

  const { publications: researcherPubs, provenance } = await getEnrichedPublicationsForResearchers(researchers, maxPerResearcher)
  await throwIfCancelled('after researcher queries')
  const affPubs = affiliation ? await getEnrichedPublications(affiliation, maxAffiliation) : []

  const combined = dedupePublications([
    ...(researcherPubs || []),
    ...(affPubs || [])
  ])

  return {
    publications: combined,
    provenance: normalizeProvenance(provenance),
    meta: {
      generatedAt: new Date().toISOString(),
      counts: {
        researchers: (researcherPubs || []).length,
        affiliation: (affPubs || []).length,
        combined: combined.length
      },
      affiliation: affiliation || null,
      maxPerResearcher,
      maxAffiliation
    }
  }
}

export async function refreshPubmedCache({
  researchers = [],
  affiliation = '',
  maxPerResearcher = DEFAULT_MAX_PER_RESEARCHER,
  maxAffiliation = DEFAULT_MAX_AFFILIATION,
  force = false,
  summariesPerRun = DEFAULT_SUMMARIES_PER_REFRESH,
  llmOptions = {}
} = {}) {
  async function throwIfCancelled(stage) {
    if (await isCancelRequested()) {
      const msg = stage ? `PubMed cache refresh cancelled (${stage})` : 'PubMed cache refresh cancelled'
      const err = new Error(msg)
      err.code = 'PUBMED_REFRESH_CANCELLED'
      throw err
    }
  }

  const key = buildPubmedCacheKey({ researchers, affiliation, maxPerResearcher, maxAffiliation })
  const current = await readCache()
  if (!force && current && current.key === key && !isCacheStale(current)) {
    return current
  }

  return withCacheLock(async () => {
    await throwIfCancelled('start')

    // Get existing summaries from cache BEFORE fetching new data
    // This allows us to preserve summaries for papers we've already processed
    const existingSummaries = await getExistingSummaries()
    console.info('[pubmed] Existing summaries from cache:', existingSummaries.size)

    const latest = await fetchCombinedPublicationsLive({ researchers, affiliation, maxPerResearcher, maxAffiliation })
    await throwIfCancelled('after fetch')
    const totalWithAbstract = (latest.publications || []).filter(p => p.abstract && p.abstract.length > 0).length
    console.info('[pubmed] Combined publications fetched', {
      total: (latest.publications || []).length,
      withAbstract: totalWithAbstract,
      withoutAbstract: (latest.publications || []).length - totalWithAbstract
    })

    // Merge existing summaries into newly fetched publications
    // This preserves summaries we already generated
    let publicationsWithSummaries = (latest.publications || []).map(pub => ({
      ...pub,
      laySummary: pub.laySummary || existingSummaries.get(pub.pmid) || null
    }))

    const alreadyHaveSummary = publicationsWithSummaries.filter(p => p.laySummary).length
    const newPapersWithoutSummary = publicationsWithSummaries.filter(p => !p.laySummary && p.abstract && p.abstract.length >= 50).length
    console.info('[pubmed] Summary status after merge', {
      alreadyHaveSummary,
      newPapersWithoutSummary,
      totalPapers: publicationsWithSummaries.length
    })

    let summariesMeta = {
      attempted: 0,
      generated: 0,
      totalWithSummary: alreadyHaveSummary,
      model: llmOptions.model || DEFAULT_SUMMARY_MODEL,
      provider: llmOptions.provider || process.env.LLM_PROVIDER || 'openrouter'
    }

    const hasLlmKey = Boolean(
      llmOptions.apiKey ||
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY
    )

    // Only generate summaries for papers that don't already have one
    if (summariesPerRun > 0 && hasLlmKey && newPapersWithoutSummary > 0) {
      await throwIfCancelled('before summaries')
      const beforeCount = publicationsWithSummaries.filter(p => p.laySummary).length
      publicationsWithSummaries = await addLaySummaries(publicationsWithSummaries, {
        ...llmOptions,
        maxSummaries: summariesPerRun,
        summaryOrder: 'recent'
      })
      const afterCount = publicationsWithSummaries.filter(p => p.laySummary).length
      summariesMeta = {
        ...summariesMeta,
        attempted: Math.min(summariesPerRun, newPapersWithoutSummary),
        generated: Math.max(0, afterCount - beforeCount),
        totalWithSummary: afterCount
      }
      console.info('[pubmed] Summary generation', summariesMeta)
    } else if (summariesPerRun > 0 && !hasLlmKey) {
      console.info('[pubmed] Summary generation skipped (missing LLM API key)')
    } else if (newPapersWithoutSummary === 0) {
      console.info('[pubmed] All papers already have summaries, skipping generation')
    }

    const payload = {
      key,
      generatedAt: latest.meta.generatedAt,
      publications: publicationsWithSummaries,
      provenance: latest.provenance,
      meta: {
        ...latest.meta,
        cachePath: CACHE_PATH_DISPLAY,
        summaries: summariesMeta
      }
    }
    await writeCache(payload)
    return payload
  })
}

export async function getCachedPublicationsDisplay({
  researchers = [],
  affiliation = '',
  maxPerResearcher = DEFAULT_MAX_PER_RESEARCHER,
  maxAffiliation = DEFAULT_MAX_AFFILIATION,
  summariesPerRun = DEFAULT_SUMMARIES_PER_REFRESH,
  llmOptions = {}
} = {}) {
  const key = buildPubmedCacheKey({ researchers, affiliation, maxPerResearcher, maxAffiliation })
  const cached = await readCache()
  const hasLlmKey = Boolean(
    llmOptions.apiKey ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY
  )
  const needsSummaryRefresh = summariesPerRun > 0 && hasLlmKey && (!cached?.meta?.summaries || (cached.meta.summaries.totalWithSummary || 0) === 0)

  if (cached && cached.key === key && !needsSummaryRefresh) {
    const display = buildDisplay([...(cached.publications || [])])
    return {
      ...display,
      provenance: cached.provenance || {},
      meta: {
        ...(cached.meta || {}),
        generatedAt: cached.generatedAt,
        stale: isCacheStale(cached)
      }
    }
  }

  let refreshed = null
  try {
    refreshed = await refreshPubmedCache({
      researchers,
      affiliation,
      maxPerResearcher,
      maxAffiliation,
      force: true,
      summariesPerRun,
      llmOptions
    })
  } catch (err) {
    const msg = String(err?.message || '')
    const refreshInProgress = msg.toLowerCase().includes('already in progress')
    // If a refresh is already running (common under load), fall back to serving the last cached data.
    if (refreshInProgress && cached) {
      const display = buildDisplay([...(cached.publications || [])])
      return {
        ...display,
        provenance: cached.provenance || {},
        meta: {
          ...(cached.meta || {}),
          generatedAt: cached.generatedAt,
          stale: true,
          refreshInProgress: true
        }
      }
    }
    throw err
  }
  const display = buildDisplay([...(refreshed.publications || [])])
  return {
    ...display,
    provenance: refreshed.provenance || {},
    meta: {
      ...(refreshed.meta || {}),
      generatedAt: refreshed.generatedAt,
      stale: false
    }
  }
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
    const {
      maxSummaries,
      summaryOrder = 'as-provided',
      concurrency = 1,
      delayMs = 2000,
      retryAttempts,
      retryDelayMs,
      ...providerOptions
    } = options

    const summaries = await generateSummariesBatch(publications, {
      ...providerOptions,
      maxItems: maxSummaries,
      order: summaryOrder,
      concurrency,
      delayMs,
      retryAttempts,
      retryDelayMs
    })

    return publications.map(pub => ({
      ...pub,
      laySummary: summaries.get(pub.pmid) || pub.laySummary || null
    }))
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
  const cutoff = getPublicationsSinceYear()
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

