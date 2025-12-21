// Combines PubMed data with OpenAlex citation counts

import { getPublicationsByCustomQuery } from './pubmed.js'
import { generateSummariesBatch, classifyPublication } from './summaries.js'
import { readCache, writeCache, writeCacheIncremental, withCacheLock, isCacheStale, CACHE_PATH_DISPLAY, isCancelRequested, getExistingSummaries } from './pubmedCache.js'
import { client as sanityClient } from './sanity.js'

async function fetchClassificationsByPmid(pmids = []) {
  if (!pmids.length) return new Map()
  const docs = await sanityClient.fetch(
    `*[_type == "pubmedClassification" && pmid in $pmids]{
      pmid,
      topics,
      studyDesign,
      methodologicalFocus,
      exclude
    }`,
    { pmids }
  )
  const map = new Map()
  for (const d of docs || []) {
    if (d?.pmid) {
      map.set(d.pmid, {
        topics: d.topics || [],
        studyDesign: d.studyDesign || [],
        methodologicalFocus: d.methodologicalFocus || [],
        exclude: Boolean(d.exclude),
      })
    }
  }
  return map
}

// Simple in-memory cache (per runtime) to avoid expensive PubMed calls.
// Each cache entry stores { timestamp, key, data } and expires after TTL_MS.
const TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const cache = {
  researchersDisplay: null,
  enrichedResearchers: null,
}

const DEFAULT_MAX_PER_RESEARCHER = Number(process.env.PUBMED_MAX_PER_RESEARCHER || 1000)
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
const DEFAULT_SUMMARY_MODEL = process.env.LLM_MODEL || 'google/gemma-3-27b-it:free'

export function getPublicationsSinceYear(now = new Date()) {
  return now.getFullYear() - DEFAULT_PUBLICATIONS_SINCE_YEARS_BACK
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
  const TOTAL_CAP = 5000 // guard against runaway size

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
 * Get publications for display using researcher-level queries
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

export function buildPubmedCacheKey({ researchers = [], maxPerResearcher = DEFAULT_MAX_PER_RESEARCHER } = {}) {
  const researchersKey = buildResearchersKey(researchers, maxPerResearcher)
  const sinceYear = getPublicationsSinceYear()
  return JSON.stringify({
    researchersKey,
    maxPerResearcher,
    window: { mode: 'since_year', sinceYear }
  })
}

async function fetchCombinedPublicationsLive({ researchers = [], maxPerResearcher = DEFAULT_MAX_PER_RESEARCHER }) {
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

  return {
    publications: researcherPubs || [],
    provenance: normalizeProvenance(provenance),
    meta: {
      generatedAt: new Date().toISOString(),
      counts: {
        total: (researcherPubs || []).length
      },
      maxPerResearcher
    }
  }
}

export async function refreshPubmedCache({
  researchers = [],
  maxPerResearcher = DEFAULT_MAX_PER_RESEARCHER,
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

  const key = buildPubmedCacheKey({ researchers, maxPerResearcher })
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

    const latest = await fetchCombinedPublicationsLive({ researchers, maxPerResearcher })
    await throwIfCancelled('after fetch')
    const totalWithAbstract = (latest.publications || []).filter(p => p.abstract && p.abstract.length > 0).length
    console.info('[pubmed] Combined publications fetched', {
      total: (latest.publications || []).length,
      withAbstract: totalWithAbstract,
      withoutAbstract: (latest.publications || []).length - totalWithAbstract
    })

    // Merge existing summaries into newly fetched publications
    // This preserves summaries we already generated
    // Also track which publications are new vs existing
    const existingPmids = new Set(existingSummaries.keys())
    const newPublications = []
    const existingPublicationsToUpdate = []

    let publicationsWithSummaries = (latest.publications || []).map(pub => {
      const existing = existingSummaries.get(pub.pmid) || {}
      const merged = {
        ...pub,
        laySummary: pub.laySummary || existing.laySummary || null,
        topics: pub.topics || existing.topics || [],
        studyDesign: pub.studyDesign || existing.studyDesign || [],
        methodologicalFocus: pub.methodologicalFocus || existing.methodologicalFocus || [],
        exclude: typeof pub.exclude === 'boolean' ? pub.exclude : Boolean(existing.exclude)
      }

      // Track new vs existing publications
      if (!existingPmids.has(pub.pmid)) {
        newPublications.push(merged)
      }

      return merged
    })

    const alreadyHaveSummary = publicationsWithSummaries.filter(p => p.laySummary).length
    const newPapersWithoutSummary = publicationsWithSummaries.filter(p => !p.laySummary && p.abstract && p.abstract.length >= 50).length
    console.info('[pubmed] Summary status after merge', {
      alreadyHaveSummary,
      newPapersWithoutSummary,
      totalPapers: publicationsWithSummaries.length,
      newPublications: newPublications.length
    })

    console.info('[pubmed] llmOptions received', {
      model: llmOptions.model,
      provider: llmOptions.provider,
      concurrency: llmOptions.concurrency,
      delayMs: llmOptions.delayMs,
      hasApiKey: Boolean(llmOptions.apiKey)
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

    // Track publications that got new summaries (for incremental update)
    let newSummariesGenerated = 0
    const publicationsWithNewSummaries = []

    // Only generate summaries for papers that don't already have one
    // Use a timeout to prevent cron from hanging on slow LLM responses
    const SUMMARY_TIMEOUT_MS = Number(process.env.SUMMARY_TIMEOUT_MS || 25000) // 25s default
    if (summariesPerRun > 0 && hasLlmKey && newPapersWithoutSummary > 0) {
      await throwIfCancelled('before summaries')
      const beforeSummaries = new Map(
        publicationsWithSummaries
          .filter(p => p.laySummary)
          .map(p => [p.pmid, p.laySummary])
      )
      console.info('[pubmed] Starting summary generation...', { timeoutMs: SUMMARY_TIMEOUT_MS })
      const summaryStartTime = Date.now()

      // Wrap summary generation in a timeout to prevent cron from hanging
      try {
        const summaryPromise = addLaySummaries(publicationsWithSummaries, {
          ...llmOptions,
          maxSummaries: summariesPerRun,
          summaryOrder: 'recent'
        })
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Summary generation timeout')), SUMMARY_TIMEOUT_MS)
        )
        publicationsWithSummaries = await Promise.race([summaryPromise, timeoutPromise])
      } catch (err) {
        if (err.message === 'Summary generation timeout') {
          console.warn('[pubmed] Summary generation timed out, proceeding without new summaries', {
            durationMs: Date.now() - summaryStartTime
          })
          // Continue with existing publications (no new summaries)
        } else {
          throw err
        }
      }

      // Find which publications got new summaries
      for (const pub of publicationsWithSummaries) {
        if (pub.laySummary && !beforeSummaries.has(pub.pmid)) {
          publicationsWithNewSummaries.push(pub)
          // If this is an existing publication that got a new summary, track it for update
          if (existingPmids.has(pub.pmid)) {
            existingPublicationsToUpdate.push(pub)
          }
        }
      }

      newSummariesGenerated = publicationsWithNewSummaries.length
      const afterCount = publicationsWithSummaries.filter(p => p.laySummary).length
      summariesMeta = {
        ...summariesMeta,
        attempted: Math.min(summariesPerRun, newPapersWithoutSummary),
        generated: newSummariesGenerated,
        totalWithSummary: afterCount
      }
      console.info('[pubmed] Summary generation completed', {
        ...summariesMeta,
        durationMs: Date.now() - summaryStartTime
      })
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

    // Skip cache write if nothing changed (no new publications and no new summaries)
    if (newPublications.length === 0 && newSummariesGenerated === 0) {
      console.info('[pubmed] Skipping cache write - no changes detected', {
        existingPublications: existingSummaries.size,
        fetchedPublications: (latest.publications || []).length,
        newPublications: newPublications.length,
        newSummaries: newSummariesGenerated
      })
      return payload
    }

    // Use incremental update for small changes (much faster)
    const useIncremental = newPublications.length <= 10 && existingPublicationsToUpdate.length <= 10
    console.info('[pubmed] Writing cache...', {
      newPublications: newPublications.length,
      updatedPublications: existingPublicationsToUpdate.length,
      useIncremental
    })
    const writeStartTime = Date.now()

    if (useIncremental) {
      await writeCacheIncremental({
        newPublications,
        updatedPublications: existingPublicationsToUpdate,
        provenance: latest.provenance,
        meta: payload.meta
      })
    } else {
      // Fall back to full write for large changes
      await writeCache(payload)
    }
    console.info('[pubmed] Cache write completed', { durationMs: Date.now() - writeStartTime })
    return payload
  })
}

export async function getCachedPublicationsDisplay({
  researchers = [],
  maxPerResearcher = DEFAULT_MAX_PER_RESEARCHER,
  summariesPerRun = DEFAULT_SUMMARIES_PER_REFRESH,
  llmOptions = {}
} = {}) {
  const key = buildPubmedCacheKey({ researchers, maxPerResearcher })
  const cached = await readCache()
  const hasLlmKey = Boolean(
    llmOptions.apiKey ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY
  )
  const needsSummaryRefresh = summariesPerRun > 0 && hasLlmKey && (!cached?.meta?.summaries || (cached.meta.summaries.totalWithSummary || 0) === 0)

  if (cached && cached.key === key && !needsSummaryRefresh) {
    const publicationsWithClass = await mergeWithClassifications(cached.publications || [])
    const display = buildDisplay([...publicationsWithClass])
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
      maxPerResearcher,
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
  const display = buildDisplay([...(await mergeWithClassifications(refreshed.publications || []))])
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

async function mergeWithClassifications(publications = []) {
  if (!publications.length) return publications
  const pmids = publications.map(p => p.pmid).filter(Boolean)
  const classMap = await fetchClassificationsByPmid(pmids)
  if (!classMap.size) return publications
  return publications.map(pub => {
    const c = classMap.get(pub.pmid)
    if (!c) return pub
    return {
      ...pub,
      topics: c.topics?.length ? c.topics : pub.topics || [],
      studyDesign: c.studyDesign?.length ? c.studyDesign : pub.studyDesign || [],
      methodologicalFocus: c.methodologicalFocus?.length ? c.methodologicalFocus : pub.methodologicalFocus || [],
      exclude: typeof c.exclude === 'boolean' ? c.exclude : pub.exclude,
    }
  })
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
      provider: providerOptions.provider,
      model: providerOptions.model,
      apiKey: providerOptions.apiKey,
      classificationPrompt: providerOptions.classificationPrompt,
      maxItems: maxSummaries,
      order: summaryOrder,
      concurrency,
      delayMs,
      retryAttempts,
      retryDelayMs
    })

    return publications.map(pub => ({
      ...pub,
      laySummary: summaries.get(pub.pmid)?.summary || pub.laySummary || null,
      topics: summaries.get(pub.pmid)?.topics || pub.topics || [],
      studyDesign: summaries.get(pub.pmid)?.studyDesign || pub.studyDesign || [],
      methodologicalFocus: summaries.get(pub.pmid)?.methodologicalFocus || pub.methodologicalFocus || [],
      exclude: typeof pub.exclude === 'boolean'
        ? pub.exclude
        : Boolean(summaries.get(pub.pmid)?.exclude)
    }))
  } catch (err) {
    console.error('Error generating lay summaries, proceeding without them:', err)
    return publications
  }
}

/**
 * Generate summaries for publications that don't have them yet.
 * This is a standalone operation that reads from cache, generates summaries,
 * and writes back incrementally.
 */
export async function generateMissingSummaries({
  maxSummaries = 5,
  llmOptions = {}
} = {}) {
  const startTime = Date.now()

  // Read current cache
  const cached = await readCache()
  if (!cached?.publications?.length) {
    console.info('[pubmed] No publications in cache to summarize')
    return { attempted: 0, generated: 0, totalWithSummary: 0 }
  }

  // Find publications without summaries that have abstracts
  const withSummary = cached.publications.filter(p => p.laySummary)
  const withoutSummary = cached.publications.filter(p => !p.laySummary)
  const withAbstract = withoutSummary.filter(p => p.abstract && p.abstract.length >= 50)
  const withoutAbstract = withoutSummary.filter(p => !p.abstract || p.abstract.length < 50)

  console.info('[pubmed-summarize] Cache analysis', {
    totalPublications: cached.publications.length,
    withSummary: withSummary.length,
    withoutSummary: withoutSummary.length,
    withAbstract: withAbstract.length,
    withoutAbstract: withoutAbstract.length,
    // Show PMIDs of publications without abstracts (for debugging)
    sampleWithoutAbstract: withoutAbstract.slice(0, 5).map(p => ({
      pmid: p.pmid,
      title: p.title?.slice(0, 50),
      abstractLength: p.abstract?.length || 0
    }))
  })

  // Also find publications without classification (topics/studyDesign/methodologicalFocus)
  // These need to be classified even if they don't have abstracts
  const needsClassification = withoutAbstract.filter(p =>
    (!p.topics || p.topics.length === 0) &&
    (!p.studyDesign || p.studyDesign.length === 0) &&
    (!p.methodologicalFocus || p.methodologicalFocus.length === 0)
  )

  const needsSummary = withAbstract

  if (needsSummary.length === 0 && needsClassification.length === 0) {
    console.info('[pubmed] All publications already processed')
    return {
      attempted: 0,
      generated: 0,
      classified: 0,
      totalWithSummary: withSummary.length,
      alreadyComplete: true,
      diagnostic: {
        totalPublications: cached.publications.length,
        withSummary: withSummary.length,
        withoutSummary: withoutSummary.length,
        withAbstract: withAbstract.length,
        withoutAbstract: withoutAbstract.length,
        needsClassification: needsClassification.length
      }
    }
  }

  console.info('[pubmed] Publications to process', {
    total: cached.publications.length,
    needsSummary: needsSummary.length,
    needsClassificationOnly: needsClassification.length,
    maxSummaries
  })

  // Check for LLM key
  const hasLlmKey = Boolean(
    llmOptions.apiKey ||
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY
  )

  if (!hasLlmKey) {
    console.warn('[pubmed] No LLM API key available')
    return { attempted: 0, generated: 0, classified: 0, error: 'No LLM API key' }
  }

  const allUpdatedPublications = []
  let summariesGenerated = 0
  let classificationsGenerated = 0

  // 1. Process publications WITH abstracts (summary + classification)
  if (needsSummary.length > 0) {
    const toProcess = [...needsSummary]
      .sort((a, b) => {
        const yearDiff = (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0)
        if (yearDiff !== 0) return yearDiff
        return (parseInt(b.pmid, 10) || 0) - (parseInt(a.pmid, 10) || 0)
      })
      .slice(0, maxSummaries)

    console.info('[pubmed] Processing summaries', {
      count: toProcess.length,
      pmids: toProcess.map(p => p.pmid)
    })

    const updatedWithSummaries = await addLaySummaries(toProcess, {
      ...llmOptions,
      maxSummaries,
      summaryOrder: 'recent'
    })

    const newlySummarized = updatedWithSummaries.filter(p => p.laySummary)
    summariesGenerated = newlySummarized.length
    allUpdatedPublications.push(...newlySummarized)
  }

  // 2. Process publications WITHOUT abstracts (classification only, based on title)
  // Only process if we have room within the limit
  const remainingSlots = maxSummaries - allUpdatedPublications.length
  if (needsClassification.length > 0 && remainingSlots > 0) {
    const toClassify = [...needsClassification]
      .sort((a, b) => {
        const yearDiff = (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0)
        if (yearDiff !== 0) return yearDiff
        return (parseInt(b.pmid, 10) || 0) - (parseInt(a.pmid, 10) || 0)
      })
      .slice(0, remainingSlots)

    console.info('[pubmed] Processing classifications (no abstract)', {
      count: toClassify.length,
      pmids: toClassify.map(p => p.pmid)
    })

    // Classify each publication based on title
    for (const pub of toClassify) {
      try {
        const classification = await classifyPublication(
          { title: pub.title, abstract: pub.abstract || '', laySummary: null },
          {
            provider: llmOptions.provider,
            model: llmOptions.model,
            apiKey: llmOptions.apiKey,
            classificationPrompt: llmOptions.classificationPrompt,
          }
        )

        if (classification.topics?.length > 0 ||
            classification.studyDesign?.length > 0 ||
            classification.methodologicalFocus?.length > 0) {
          allUpdatedPublications.push({
            ...pub,
            topics: classification.topics,
            studyDesign: classification.studyDesign,
            methodologicalFocus: classification.methodologicalFocus,
            exclude: classification.exclude
          })
          classificationsGenerated++
        }
      } catch (err) {
        console.warn('[pubmed] Classification failed for', pub.pmid, err.message)
      }

      // Small delay between classification calls
      if (toClassify.indexOf(pub) < toClassify.length - 1) {
        await new Promise(resolve => setTimeout(resolve, llmOptions.delayMs || 1000))
      }
    }
  }

  if (allUpdatedPublications.length === 0) {
    console.info('[pubmed] No updates generated')
    return { attempted: needsSummary.length + needsClassification.length, generated: 0, classified: 0 }
  }

  // Write back incrementally
  console.info('[pubmed] Writing updates incrementally', {
    summaries: summariesGenerated,
    classifications: classificationsGenerated
  })
  await writeCacheIncremental({
    newPublications: [],
    updatedPublications: allUpdatedPublications,
    provenance: {},
    meta: { summaries: { model: llmOptions.model } }
  })

  const duration = Date.now() - startTime
  const totalWithSummary = cached.publications.filter(p => p.laySummary).length + summariesGenerated

  console.info('[pubmed] Processing complete', {
    attemptedSummaries: needsSummary.length,
    attemptedClassifications: needsClassification.length,
    generatedSummaries: summariesGenerated,
    generatedClassifications: classificationsGenerated,
    totalWithSummary,
    durationMs: duration
  })

  return {
    attempted: needsSummary.length + needsClassification.length,
    generated: summariesGenerated,
    classified: classificationsGenerated,
    totalWithSummary,
    remaining: needsSummary.length - summariesGenerated + needsClassification.length - classificationsGenerated,
    durationMs: duration
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

