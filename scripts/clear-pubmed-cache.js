/**
 * Clear PubMed cache so it can be rebuilt from scratch.
 *
 * Default: clears ONLY the local cache file at runtime/pubmed-cache.json
 * Optional: pass --sanity to also delete the Sanity cache document (id: pubmedCache)
 *
 * Usage:
 *   npm run clear:pubmed
 *   npm run clear:pubmed -- --sanity
 *   npm run clear:pubmed && npm run refresh:pubmed
 */

import fs from 'fs/promises'
import path from 'path'
import { createClient } from '@sanity/client'

const args = new Set(process.argv.slice(2))
const withSanity = args.has('--sanity') || args.has('--remote')

const LOCAL_CACHE_PATH = path.join(process.cwd(), 'runtime', 'pubmed-cache.json')
const CACHE_DOC_ID = 'pubmedCache'

async function deleteLocalCache() {
  try {
    await fs.rm(LOCAL_CACHE_PATH, { force: true })
    console.log('[clear:pubmed] Deleted local cache', LOCAL_CACHE_PATH)
  } catch (err) {
    console.warn('[clear:pubmed] Failed deleting local cache (ignored):', err?.message || err)
  }

  // Also clear any older lock/cancel artifacts if they exist.
  const runtimeDir = path.join(process.cwd(), 'runtime')
  const maybeArtifacts = [
    'pubmed-cache 2.lock',
    'pubmed-cache 3.lock',
    'pubmed-cache 2.cancel',
  ]
  await Promise.all(
    maybeArtifacts.map(async (name) => {
      try {
        await fs.rm(path.join(runtimeDir, name), { force: true })
      } catch (_) {
        // ignore
      }
    })
  )
}

async function deleteSanityCacheDoc() {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 't6eeltne'
  const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
  const token = process.env.SANITY_API_TOKEN

  if (!token) {
    console.error('[clear:pubmed] SANITY_API_TOKEN is required to delete the Sanity cache doc.')
    process.exitCode = 1
    return
  }

  const client = createClient({
    projectId,
    dataset,
    apiVersion: '2024-01-01',
    useCdn: false,
    token,
  })

  try {
    await client.delete(CACHE_DOC_ID)
    console.log('[clear:pubmed] Deleted Sanity cache doc', { dataset, id: CACHE_DOC_ID })
  } catch (err) {
    const msg = String(err?.message || err)
    // If the doc doesn't exist, treat as success.
    if (msg.toLowerCase().includes('not found')) {
      console.log('[clear:pubmed] Sanity cache doc not found (already cleared)', { dataset, id: CACHE_DOC_ID })
      return
    }
    console.error('[clear:pubmed] Failed deleting Sanity cache doc:', msg)
    process.exitCode = 1
  }
}

async function main() {
  await deleteLocalCache()
  if (withSanity) {
    await deleteSanityCacheDoc()
  } else {
    console.log('[clear:pubmed] (local-only) Pass --sanity to also delete the Sanity cache doc.')
  }
}

main().catch((err) => {
  console.error('[clear:pubmed] Unexpected error:', err)
  process.exitCode = 1
})

