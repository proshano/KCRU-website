/**
 * Migration: remove deprecated trial fields from Sanity.
 *
 * Usage:
 *   SANITY_API_TOKEN=... node scripts/migrate-trial-fields.js
 *   DRY_RUN=true SANITY_API_TOKEN=... node scripts/migrate-trial-fields.js
 */

import { createClient } from '@sanity/client'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 't6eeltne'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
const token = process.env.SANITY_API_TOKEN
const dryRun = process.env.DRY_RUN === 'true'

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

const TRIAL_UNSET = ['sex', 'whatToExpect', 'duration', 'compensation', 'conditions', 'ctGovData.conditions']
const SUBMISSION_UNSET = [
  'payload.sex',
  'payload.whatToExpect',
  'payload.duration',
  'payload.compensation',
  'payload.conditions',
  'payload.ctGovData.conditions',
  'payload.recruitmentSiteIds',
]

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

async function main() {
  console.log('[migrate] Starting trial field cleanup...')
  if (dryRun) console.log('[migrate] DRY_RUN=true (no writes)')

  const trialQuery = `
    *[_type == "trialSummary" &&
      (defined(sex) || defined(whatToExpect) || defined(duration) || defined(compensation))
    ]{ _id }
  `
  const submissionQuery = `
    *[_type == "studySubmission" &&
      (defined(payload.sex) || defined(payload.whatToExpect) || defined(payload.duration) ||
       defined(payload.compensation) || defined(payload.recruitmentSiteIds))
    ]{ _id }
  `

  const [trialIds, submissionIds] = await Promise.all([
    fetchIds(trialQuery),
    fetchIds(submissionQuery),
  ])

  console.log(`[migrate] Trial docs to update: ${trialIds.length}`)
  await unsetFields(trialIds, TRIAL_UNSET)

  console.log(`[migrate] Submission docs to update: ${submissionIds.length}`)
  await unsetFields(submissionIds, SUBMISSION_UNSET)

  console.log('[migrate] Done.')
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err.message)
  process.exit(1)
})
