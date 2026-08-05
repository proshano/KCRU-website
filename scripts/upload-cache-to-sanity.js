/**
 * Upload local pubmed-cache.json to Sanity
 * 
 * Usage:
 *   1. Generate cache locally: npm run refresh:pubmed
 *   2. Upload to Sanity: npm run upload:pubmed
 */

import fs from 'fs/promises'
import path from 'path'
import { createClient } from '@sanity/client'
import { isPublicationExcluded, normalizePublicationTypes } from '../lib/publicationExclusions.js'
import { getPublicationKey, toSanityPublicationKey, withPublicationKey } from '../lib/publicationIdentity.js'
import { toSanityBackfillFailures } from '../lib/doiBackfillHistory.js'

const CACHE_PATH = path.join(process.cwd(), 'runtime', 'pubmed-cache.json')
const CACHE_DOC_ID = 'pubmedCache'
const CACHE_DOC_TYPE = 'pubmedCache'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET
const token = process.env.SANITY_API_TOKEN

if (!projectId) {
  console.error('Error: NEXT_PUBLIC_SANITY_PROJECT_ID environment variable is required')
  process.exit(1)
}

if (!dataset) {
  console.error('Error: NEXT_PUBLIC_SANITY_DATASET environment variable is required')
  process.exit(1)
}

if (!token) {
  console.error('Error: SANITY_API_TOKEN environment variable is required')
  console.error('Get a token from: https://www.sanity.io/manage → your project → API → Tokens')
  process.exit(1)
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false,
  token,
})

async function main() {
  console.log('[upload] Reading local cache from', CACHE_PATH)
  
  let localCache
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8')
    localCache = JSON.parse(raw)
  } catch (err) {
    console.error('Error: Could not read local cache file')
    console.error('Run `npm run refresh:pubmed` first to generate the cache')
    process.exit(1)
  }

  const publications = (localCache.publications || []).map((pub, idx) => {
    const normalized = withPublicationKey(pub)
    const publicationTypes = normalizePublicationTypes(pub.publicationTypes || pub.pubTypes || pub.pubtype)
    return {
      _key: toSanityPublicationKey(normalized, `pub-${idx}`),
      publicationKey: normalized.publicationKey,
      pmid: normalized.pmid || null,
      title: normalized.title,
      publishedAt: normalized.publishedAt || null,
      authors: normalized.authors || [],
      journal: normalized.journal,
      year: normalized.year,
      month: normalized.month,
      abstract: normalized.abstract,
      abstractContentType: normalized.abstractContentType || null,
      abstractSource: normalized.abstractSource || null,
      doi: normalized.doi,
      source: normalized.source || null,
      sources: normalized.sources || [],
      openAlexId: normalized.openAlexId || null,
      europePmcId: normalized.europePmcId || null,
      publicationTypes,
      url: normalized.url || normalized.pubmedUrl || null,
      pubmedUrl: normalized.pubmedUrl || (normalized.source === 'pubmed' && normalized.pmid ? normalized.url : null) || null,
      laySummary: normalized.laySummary || null,
      topics: normalized.topics || [],
      studyDesign: normalized.studyDesign || [],
      methodologicalFocus: normalized.methodologicalFocus || [],
      exclude: isPublicationExcluded({ ...normalized, publicationTypes }),
    }
  })

  const publicationsByKey = new Map((localCache.publications || []).map((pub) => [getPublicationKey(pub), pub]))
  const provenanceArray = Object.entries(localCache.provenance || {}).map(([publicationKey, ids]) => ({
    _key: toSanityPublicationKey({ publicationKey }),
    publicationKey,
    pmid: publicationsByKey.get(publicationKey)?.pmid || null,
    researcherIds: Array.isArray(ids) ? ids : Array.from(ids || []),
  }))

  const totalWithSummary = publications.filter(p => p.laySummary).length

  const doc = {
    _id: CACHE_DOC_ID,
    _type: CACHE_DOC_TYPE,
    cacheKey: localCache.key,
    lastRefreshedAt: localCache.generatedAt || new Date().toISOString(),
    refreshInProgress: false,
    refreshStartedAt: null,
    publications,
    provenance: provenanceArray,
    // createOrReplace drops anything omitted here, so the DOI backfill history has to
    // ride along or an upload would reset the weekly retry schedule.
    doiBackfillFailures: toSanityBackfillFailures(localCache.meta?.doiBackfillFailures),
    stats: {
      totalPublications: publications.length,
      totalWithSummary,
      lastSummaryModel: localCache.meta?.summaries?.model || null,
    },
  }

  console.log('[upload] Uploading to Sanity...')
  console.log(`  - ${publications.length} publications`)
  console.log(`  - ${totalWithSummary} with summaries`)
  console.log(`  - ${provenanceArray.length} provenance entries`)

  try {
    await client.createOrReplace(doc)
    console.log('[upload] Success! Cache uploaded to Sanity')
  } catch (err) {
    console.error('[upload] Failed to upload cache:', err.message)
    process.exit(1)
  }
}

main()
