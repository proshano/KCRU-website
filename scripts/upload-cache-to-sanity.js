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

const CACHE_PATH = path.join(process.cwd(), 'runtime', 'pubmed-cache.json')
const CACHE_DOC_ID = 'pubmedCache'
const CACHE_DOC_TYPE = 'pubmedCache'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 't6eeltne'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
const token = process.env.SANITY_API_TOKEN

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

  const publications = (localCache.publications || []).map((pub, idx) => ({
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
  }))

  const provenanceArray = Object.entries(localCache.provenance || {}).map(([pmid, ids]) => ({
    _key: pmid,
    pmid,
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
