import fs from 'fs/promises'
import path from 'path'
import { createClient } from '@sanity/client'
import { writeClient } from './sanity.js'

// Create a dedicated non-CDN client for reading the pubmed cache
// This ensures we always get fresh data, not stale CDN-cached responses
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 't6eeltne'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'

const noCdnClient = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false, // Always bypass CDN for cache reads
})

// Document ID for the singleton cache document
const CACHE_DOC_ID = 'pubmedCache'
const CACHE_DOC_TYPE = 'pubmedCache'

// Local file path (for backup and upload workflow)
const LOCAL_CACHE_PATH = path.join(process.cwd(), 'runtime', 'pubmed-cache.json')

// Lock timeout: if a refresh started more than 10 minutes ago, consider it stale
const LOCK_TTL_MS = Number(process.env.PUBMED_CACHE_LOCK_TTL_MS || 10 * 60 * 1000)

// Cache staleness: 24 hours default
const DEFAULT_MAX_AGE_MS = Number(process.env.PUBMED_CACHE_MAX_AGE_MS || 24 * 60 * 60 * 1000)

async function ensureLocalDir() {
  const dir = path.dirname(LOCAL_CACHE_PATH)
  await fs.mkdir(dir, { recursive: true })
}

/**
 * Check if the cache is stale based on lastRefreshedAt
 */
export function isCacheStale(cache, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  if (!cache?.lastRefreshedAt) return true
  const ts = Date.parse(cache.lastRefreshedAt)
  if (Number.isNaN(ts)) return true
  return Date.now() - ts > maxAgeMs
}

/**
 * Read the cache from Sanity
 */
export async function readCache() {
  try {
    const doc = await noCdnClient.fetch(
      `*[_type == $type && _id == $id][0]`,
      { type: CACHE_DOC_TYPE, id: CACHE_DOC_ID }
    )
    if (!doc) return null

    // Convert Sanity format to the expected format
    const provenanceObj = {}
    if (doc.provenance) {
      for (const entry of doc.provenance) {
        if (entry.pmid) {
          provenanceObj[entry.pmid] = entry.researcherIds || []
        }
      }
    }

    const publications = (doc.publications || []).map(p => ({
      ...p,
      topics: p.topics || [],
      studyDesign: p.studyDesign || [],
      methodologicalFocus: p.methodologicalFocus || [],
      exclude: Boolean(p.exclude)
    }))

    return {
      key: doc.cacheKey,
      generatedAt: doc.lastRefreshedAt,
      publications,
      provenance: provenanceObj,
      meta: {
        cachePath: 'sanity:pubmedCache',
        summaries: {
          totalWithSummary: doc.stats?.totalWithSummary || 0,
          model: doc.stats?.lastSummaryModel || null,
        },
        counts: {
          combined: doc.stats?.totalPublications || 0,
        },
      },
    }
  } catch (err) {
    console.error('Failed to read PubMed cache from Sanity', err)
    return null
  }
}

/**
 * Write the cache to both local file AND Sanity
 * Local file is used for backup and the upload workflow
 * Sanity is the primary storage for Vercel deployment
 */
export async function writeCache(payload) {
  // 1. Write to local file first (always works, no network needed)
  try {
    await ensureLocalDir()
    const localPayload = {
      key: payload.key,
      generatedAt: payload.generatedAt || new Date().toISOString(),
      publications: payload.publications || [],
      provenance: payload.provenance || {},
      meta: payload.meta || {},
    }
    const tmpPath = `${LOCAL_CACHE_PATH}.tmp`
    await fs.writeFile(tmpPath, JSON.stringify(localPayload, null, 2), 'utf8')
    await fs.rename(tmpPath, LOCAL_CACHE_PATH)
    console.info('[pubmed] Cache written to local file', {
      path: LOCAL_CACHE_PATH,
      publications: (payload.publications || []).length,
    })
  } catch (err) {
    console.error('Failed to write local cache file', err)
    // Continue to Sanity write even if local fails
  }

  // 2. Write to Sanity
  try {
    // Convert provenance object to array format for Sanity
    const provenanceArray = Object.entries(payload.provenance || {}).map(([pmid, ids]) => ({
      _key: pmid,
      pmid,
      researcherIds: Array.isArray(ids) ? ids : Array.from(ids || []),
    }))

    // Convert publications to Sanity format (add _key for array items)
    const publications = (payload.publications || []).map((pub, idx) => ({
      _key: pub.pmid || `pub-${idx}`,
      pmid: pub.pmid,
      title: pub.title,
      authors: pub.authors || [],
      journal: pub.journal,
      year: pub.year,
      month: pub.month,
      abstract: pub.abstract,
      doi: pub.doi,
      pubmedUrl: pub.pubmedUrl,
      laySummary: pub.laySummary || null,
      topics: pub.topics || [],
      studyDesign: pub.studyDesign || [],
      methodologicalFocus: pub.methodologicalFocus || [],
      exclude: Boolean(pub.exclude)
    }))

    const totalWithSummary = publications.filter(p => p.laySummary).length

    const doc = {
      _id: CACHE_DOC_ID,
      _type: CACHE_DOC_TYPE,
      cacheKey: payload.key,
      lastRefreshedAt: payload.generatedAt || new Date().toISOString(),
      refreshInProgress: false,
      refreshStartedAt: null,
      publications,
      provenance: provenanceArray,
      stats: {
        totalPublications: publications.length,
        totalWithSummary,
        lastSummaryModel: payload.meta?.summaries?.model || null,
      },
    }

    await writeClient.createOrReplace(doc)
    console.info('[pubmed] Cache written to Sanity', {
      publications: publications.length,
      withSummary: totalWithSummary,
    })
  } catch (err) {
    console.error('Failed to write PubMed cache to Sanity', err)
    throw err
  }
}

/**
 * Get current lock info
 */
export async function getLockInfo() {
  try {
    const doc = await noCdnClient.fetch(
      `*[_type == $type && _id == $id][0]{ refreshInProgress, refreshStartedAt }`,
      { type: CACHE_DOC_TYPE, id: CACHE_DOC_ID }
    )
    return doc || null
  } catch (err) {
    return null
  }
}

/**
 * Check if a refresh is currently in progress (and not timed out)
 */
async function isLocked() {
  const lock = await getLockInfo()
  if (!lock?.refreshInProgress) return false

  // Check if the lock has timed out
  if (lock.refreshStartedAt) {
    const startedAt = Date.parse(lock.refreshStartedAt)
    if (!Number.isNaN(startedAt) && Date.now() - startedAt > LOCK_TTL_MS) {
      // Lock has timed out, clear it
      await clearLock()
      return false
    }
  }
  return true
}

/**
 * Acquire the lock
 */
async function acquireLock() {
  const startedAtIso = new Date().toISOString()
  // Best-effort CAS-style lock acquisition to avoid concurrent refreshes.
  // We rely on _rev and ifRevisionId to make the "set refreshInProgress" step atomic.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const doc = await noCdnClient.fetch(
        `*[_type == $type && _id == $id][0]{ _rev, refreshInProgress, refreshStartedAt }`,
        { type: CACHE_DOC_TYPE, id: CACHE_DOC_ID }
      )

      // If currently locked and not stale, do not acquire.
      if (doc?.refreshInProgress) {
        if (doc.refreshStartedAt) {
          const ts = Date.parse(doc.refreshStartedAt)
          if (!Number.isNaN(ts) && Date.now() - ts > LOCK_TTL_MS) {
            await clearLock()
          } else {
            return false
          }
        } else {
          return false
        }
      }

      // If doc doesn't exist, try to create it in locked state.
      if (!doc?._rev) {
        try {
          await writeClient.create({
            _id: CACHE_DOC_ID,
            _type: CACHE_DOC_TYPE,
            cacheKey: null,
            lastRefreshedAt: null,
            refreshInProgress: true,
            refreshStartedAt: startedAtIso,
            publications: [],
            provenance: [],
            stats: { totalPublications: 0, totalWithSummary: 0 },
          })
          return true
        } catch {
          // Someone else created it; retry.
          continue
        }
      }

      // Attempt atomic patch based on _rev.
      try {
        await writeClient
          .patch(CACHE_DOC_ID)
          .ifRevisionId(doc._rev)
          .set({
            refreshInProgress: true,
            refreshStartedAt: startedAtIso,
          })
          .commit()
        return true
      } catch {
        // Revision conflict / race; retry.
        continue
      }
    } catch {
      // Transient read/write error; retry a couple times.
      continue
    }
  }
  return false
}

/**
 * Clear the lock
 */
export async function clearLock() {
  try {
    await writeClient
      .patch(CACHE_DOC_ID)
      .set({
        refreshInProgress: false,
        refreshStartedAt: null,
      })
      .commit()
  } catch (err) {
    // Ignore errors if document doesn't exist
    if (!err.message?.includes('not found')) {
      console.error('Failed to clear lock', err)
    }
  }
}

/**
 * Request cancellation of an ongoing refresh
 */
export async function requestCancel() {
  // For Sanity-based implementation, we'll use a simple approach:
  // Just clear the lock. The refresh process should check the lock status
  // periodically and stop if the lock is cleared.
  await clearLock()
}

/**
 * Check if cancellation has been requested
 * In Sanity mode, we check if the lock was cleared while we were running
 */
export async function isCancelRequested() {
  const lock = await getLockInfo()
  // If lock is not set but we're supposed to be running, we were cancelled
  return lock?.refreshInProgress === false
}

/**
 * Clear any cancel request (no-op in Sanity mode, handled by clearLock)
 */
export async function clearCancelRequest() {
  // No-op - cancel is handled by clearing the lock
}

/**
 * Execute an action with the cache lock
 */
export async function withCacheLock(action) {
  // Check if already locked
  if (await isLocked()) {
    throw new Error('PubMed cache refresh already in progress')
  }

  // Acquire the lock
  const acquired = await acquireLock()
  if (!acquired) {
    throw new Error('Failed to acquire PubMed cache lock')
  }

  try {
    const result = await action()
    await clearLock()
    return result
  } catch (err) {
    await clearLock()
    throw err
  }
}

/**
 * Get existing summaries map (PMID -> laySummary) from current cache
 * Used for incremental updates
 */
export async function getExistingSummaries() {
  try {
    const doc = await noCdnClient.fetch(
      `*[_type == $type && _id == $id][0].publications[]{ pmid, laySummary, topics, studyDesign, methodologicalFocus, exclude }`,
      { type: CACHE_DOC_TYPE, id: CACHE_DOC_ID }
    )
    if (!doc) return new Map()

    const map = new Map()
    for (const pub of doc) {
      if (pub?.pmid) {
        map.set(pub.pmid, {
          laySummary: pub.laySummary || null,
          topics: pub.topics || [],
          studyDesign: pub.studyDesign || [],
          methodologicalFocus: pub.methodologicalFocus || [],
          exclude: Boolean(pub.exclude)
        })
      }
    }
    return map
  } catch (err) {
    console.error('Failed to get existing summaries', err)
    return new Map()
  }
}

// Export local cache path for file operations
export const CACHE_PATH = LOCAL_CACHE_PATH

// Friendly identifier for display in metadata (not environment-specific)
export const CACHE_PATH_DISPLAY = 'runtime/pubmed-cache.json + sanity:pubmedCache'
