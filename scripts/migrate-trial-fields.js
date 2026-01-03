/**
 * Migration: remove deprecated trial fields and repair missing array keys.
 *
 * Usage:
 *   SANITY_API_TOKEN=... node scripts/migrate-trial-fields.js
 *   DRY_RUN=true SANITY_API_TOKEN=... node scripts/migrate-trial-fields.js
 */

import { createClient } from '@sanity/client'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET
const token = process.env.SANITY_API_TOKEN
const dryRun = process.env.DRY_RUN === 'true'

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

const TRIAL_UNSET = [
  'sex',
  'whatToExpect',
  'duration',
  'compensation',
  'conditions',
  'ctGovData.conditions',
  'ageRange',
  'eligibilityOverview',
]
const SUBMISSION_UNSET = [
  'payload.sex',
  'payload.whatToExpect',
  'payload.duration',
  'payload.compensation',
  'payload.conditions',
  'payload.ctGovData.conditions',
  'payload.ageRange',
  'payload.eligibilityOverview',
  'payload.recruitmentSiteIds',
]
const DRAFT_UNSET = ['data.ageRange', 'data.conditions', 'data.eligibilityOverview']

async function fetchIds(query) {
  const rows = await client.fetch(query)
  return Array.isArray(rows) ? rows.map((row) => row._id).filter(Boolean) : []
}

async function unsetFields(ids, fields) {
  if (!ids.length) return
  for (const id of ids) {
    if (dryRun) {
      console.log(`[dry-run] ${id} -> unset ${fields.join(', ')}`)
      continue
    }
    try {
      await client.patch(id).unset(fields).commit({ returnDocuments: false })
      console.log(`[migrate] updated ${id}`)
    } catch (err) {
      console.error(`[migrate] failed ${id}: ${err.message}`)
    }
  }
}

function ensureReferenceKeys(items) {
  if (!Array.isArray(items)) return { items: [], updated: false }
  let updated = false
  const next = items.map((item, index) => {
    if (!item || typeof item !== 'object') return item
    if (item._key) return item
    updated = true
    const ref = item._ref || item._id || 'ref'
    return { ...item, _key: `${ref}-${index}` }
  })
  return { items: next, updated }
}

async function fixTherapeuticAreaKeys() {
  const query = `
    *[_type == "trialSummary" &&
      defined(therapeuticAreas) &&
      count(therapeuticAreas[!defined(_key)]) > 0
    ]{ _id, therapeuticAreas }
  `
  const rows = await client.fetch(query)
  const items = Array.isArray(rows) ? rows : []
  console.log(`[migrate] Trial docs with missing therapeuticAreas keys: ${items.length}`)

  for (const row of items) {
    const { items: next, updated } = ensureReferenceKeys(row.therapeuticAreas)
    if (!updated) continue
    if (dryRun) {
      console.log(`[dry-run] ${row._id} -> add _key to therapeuticAreas`)
      continue
    }
    try {
      await client.patch(row._id).set({ therapeuticAreas: next }).commit({ returnDocuments: false })
      console.log(`[migrate] updated ${row._id} (therapeuticAreas keys)`)
    } catch (err) {
      console.error(`[migrate] failed ${row._id}: ${err.message}`)
    }
  }
}

async function main() {
  console.log('[migrate] Starting trial field cleanup...')
  if (dryRun) console.log('[migrate] DRY_RUN=true (no writes)')

  const trialQuery = `
    *[_type == "trialSummary" &&
      (defined(sex) || defined(whatToExpect) || defined(duration) || defined(compensation) ||
       defined(ageRange) || defined(conditions) || defined(eligibilityOverview))
    ]{ _id }
  `
  const submissionQuery = `
    *[_type == "studySubmission" &&
      (defined(payload.sex) || defined(payload.whatToExpect) || defined(payload.duration) ||
       defined(payload.compensation) || defined(payload.recruitmentSiteIds) ||
       defined(payload.ageRange) || defined(payload.conditions) || defined(payload.eligibilityOverview))
    ]{ _id }
  `
  const draftQuery = `
    *[_type == "studyDraft" &&
      (defined(data.ageRange) || defined(data.conditions) || defined(data.eligibilityOverview))
    ]{ _id }
  `

  const [trialIds, submissionIds, draftIds] = await Promise.all([
    fetchIds(trialQuery),
    fetchIds(submissionQuery),
    fetchIds(draftQuery),
  ])

  console.log(`[migrate] Trial docs to update: ${trialIds.length}`)
  await unsetFields(trialIds, TRIAL_UNSET)

  console.log(`[migrate] Submission docs to update: ${submissionIds.length}`)
  await unsetFields(submissionIds, SUBMISSION_UNSET)

  console.log(`[migrate] Draft docs to update: ${draftIds.length}`)
  await unsetFields(draftIds, DRAFT_UNSET)

  await fixTherapeuticAreaKeys()

  console.log('[migrate] Done.')
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err.message)
  process.exit(1)
})
