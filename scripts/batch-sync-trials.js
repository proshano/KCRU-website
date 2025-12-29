/**
 * Batch sync all trialSummary docs from ClinicalTrials.gov.
 *
 * Usage:
 *   SANITY_API_TOKEN=... node scripts/batch-sync-trials.js
 *   DRY_RUN=true SANITY_API_TOKEN=... node scripts/batch-sync-trials.js
 *   CONCURRENCY=3 DELAY_MS=400 SANITY_API_TOKEN=... node scripts/batch-sync-trials.js
 */

import { createClient } from '@sanity/client'
import { syncTrialData } from '../lib/trialSync.js'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 't6eeltne'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
const token = process.env.SANITY_API_TOKEN
const dryRun = process.env.DRY_RUN === 'true'
const concurrency = Number(process.env.CONCURRENCY || 3)
const delayMs = Number(process.env.DELAY_MS || 400)
const generateSummary = process.env.GENERATE_SUMMARY !== 'false'

if (!token) {
  console.error('Error: SANITY_API_TOKEN environment variable is required')
  process.exit(1)
}

const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false,
  token,
})

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchTrials() {
  const query = `
    *[_type == "trialSummary" && defined(nctId)]{
      _id,
      nctId,
      title,
      "slug": slug.current
    }
  `
  const rows = await client.fetch(query)
  return Array.isArray(rows) ? rows.filter((row) => row.nctId) : []
}

async function syncOne(trial, summaryOptions) {
  const nctId = String(trial.nctId || '').toUpperCase().trim()
  if (!/^NCT\d{8}$/.test(nctId)) {
    return { id: trial._id, nctId, status: 'skipped', reason: 'invalid_nct' }
  }
  if (dryRun) {
    console.log(`[dry-run] ${trial._id} (${nctId})`)
    return { id: trial._id, nctId, status: 'dry-run' }
  }

  try {
    const synced = await syncTrialData(nctId, { generateSummary, summaryOptions })
    const patch = {
      nctId: nctId,
      ctGovData: synced.ctGovData || null,
      inclusionCriteria: synced.inclusionCriteria || [],
      exclusionCriteria: synced.exclusionCriteria || [],
      studyType: synced.studyType || null,
      phase: synced.phase || null,
    }
    if (generateSummary && synced.laySummary) {
      patch.laySummary = synced.laySummary
    }
    await client.patch(trial._id).set(patch).commit({ returnDocuments: false })
    return { id: trial._id, nctId, status: 'ok' }
  } catch (error) {
    return { id: trial._id, nctId, status: 'error', error: error?.message || String(error) }
  }
}

async function runPool(items, worker, limit) {
  const queue = items.slice()
  const results = []
  const workers = Array.from({ length: Math.max(1, limit) }).map(async () => {
    while (queue.length) {
      const item = queue.shift()
      const result = await worker(item)
      results.push(result)
      if (delayMs > 0) {
        await sleep(delayMs)
      }
    }
  })
  await Promise.all(workers)
  return results
}

async function main() {
  console.log('[batch-sync] Starting...')
  if (dryRun) console.log('[batch-sync] DRY_RUN=true (no writes)')
  console.log(`[batch-sync] project=${projectId} dataset=${dataset} concurrency=${concurrency}`)

  const trials = await fetchTrials()
  const settings = (await client.fetch(`
    *[_type == "siteSettings"][0]{
      llmProvider,
      llmModel,
      llmApiKey,
      llmSystemPrompt,
      trialSummaryLlmProvider,
      trialSummaryLlmModel,
      trialSummaryLlmApiKey,
      trialSummarySystemPrompt
    }
  `)) || {}
  const summaryOptions = {
    provider: settings.trialSummaryLlmProvider || settings.llmProvider,
    model: settings.trialSummaryLlmModel || settings.llmModel,
    apiKey: settings.trialSummaryLlmApiKey || settings.llmApiKey,
    systemPrompt: settings.trialSummarySystemPrompt || undefined,
  }
  console.log(`[batch-sync] Trials to sync: ${trials.length}`)

  const results = await runPool(trials, (trial) => syncOne(trial, summaryOptions), concurrency)
  const totals = results.reduce(
    (acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1
      return acc
    },
    {}
  )
  console.log('[batch-sync] Done.', totals)
}

main().catch((err) => {
  console.error('[batch-sync] Fatal error:', err?.message || err)
  process.exit(1)
})
