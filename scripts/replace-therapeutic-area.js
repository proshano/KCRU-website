/**
 * Migration: replace references to an old therapeutic area with a new one.
 *
 * Usage:
 *   SANITY_API_TOKEN=... node scripts/replace-therapeutic-area.js
 *   DRY_RUN=true SANITY_API_TOKEN=... node scripts/replace-therapeutic-area.js
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

const REPLACEMENTS = [
  {
    fromNames: ['chronic kidney disease', 'ckd'],
    toName: 'pre-dialysis ckd'
  },
  {
    fromNames: ['acute transplant'],
    toName: 'transplant – perioperative'
  },
  {
    fromNames: ['alport', "alport's"],
    toName: 'genetic kidney diseases'
  }
]

function normalizeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
}

function dedupeByRef(items) {
  const seen = new Set()
  const next = []
  for (const item of items || []) {
    const ref = item?._ref
    if (!ref || seen.has(ref)) continue
    seen.add(ref)
    next.push(item)
  }
  return next
}

async function findTherapeuticAreas() {
  const rows = await client.fetch(`*[_type == "therapeuticArea"]{ _id, name }`)
  const areas = Array.isArray(rows) ? rows : []
  const byName = new Map()

  for (const area of areas) {
    const key = normalizeName(area?.name)
    if (key && !byName.has(key)) {
      byName.set(key, area)
    }
  }

  return REPLACEMENTS.map((entry) => {
    const target = byName.get(normalizeName(entry.toName))
    const oldAreas = entry.fromNames
      .map((name) => byName.get(normalizeName(name)))
      .filter(Boolean)

    return {
      fromNames: entry.fromNames,
      toName: entry.toName,
      target,
      oldAreas
    }
  })
}

async function updateTrials(oldIds, replacementMap) {
  const rows = await client.fetch(
    `*[_type == "trialSummary" && count(therapeuticAreas[_ref in $oldIds]) > 0]{ _id, therapeuticAreas }`,
    { oldIds }
  )

  for (const row of rows || []) {
    const nextAreas = (row.therapeuticAreas || []).map((area) => {
      const replacement = replacementMap.get(area?._ref)
      if (replacement) {
        return { ...area, _ref: replacement }
      }
      return area
    })
    const deduped = dedupeByRef(nextAreas)

    if (dryRun) {
      console.log(`[dry-run] trialSummary ${row._id} -> replace therapeuticAreas`) 
      continue
    }

    try {
      await client.patch(row._id).set({ therapeuticAreas: deduped }).commit({ returnDocuments: false })
      console.log(`[migrate] updated trialSummary ${row._id}`)
    } catch (err) {
      console.error(`[migrate] failed trialSummary ${row._id}: ${err.message}`)
    }
  }
}

async function updateSubmissions(oldIds, replacementMap) {
  const rows = await client.fetch(
    `*[_type == "studySubmission" && count(payload.therapeuticAreaIds[@ in $oldIds]) > 0]{ _id, payload }`,
    { oldIds }
  )

  for (const row of rows || []) {
    const current = row.payload?.therapeuticAreaIds || []
    const next = Array.from(
      new Set(
        current.map((id) => replacementMap.get(id) || id).filter(Boolean)
      )
    )

    if (dryRun) {
      console.log(`[dry-run] studySubmission ${row._id} -> replace therapeuticAreaIds`) 
      continue
    }

    try {
      await client.patch(row._id).set({ 'payload.therapeuticAreaIds': next }).commit({ returnDocuments: false })
      console.log(`[migrate] updated studySubmission ${row._id}`)
    } catch (err) {
      console.error(`[migrate] failed studySubmission ${row._id}: ${err.message}`)
    }
  }
}

async function updateDrafts(oldIds, replacementMap) {
  const rows = await client.fetch(
    `*[_type == "studyDraft" && count(data.therapeuticAreaIds[@ in $oldIds]) > 0]{ _id, data }`,
    { oldIds }
  )

  for (const row of rows || []) {
    const current = row.data?.therapeuticAreaIds || []
    const next = Array.from(
      new Set(
        current.map((id) => replacementMap.get(id) || id).filter(Boolean)
      )
    )

    if (dryRun) {
      console.log(`[dry-run] studyDraft ${row._id} -> replace therapeuticAreaIds`) 
      continue
    }

    try {
      await client.patch(row._id).set({ 'data.therapeuticAreaIds': next }).commit({ returnDocuments: false })
      console.log(`[migrate] updated studyDraft ${row._id}`)
    } catch (err) {
      console.error(`[migrate] failed studyDraft ${row._id}: ${err.message}`)
    }
  }
}

async function main() {
  console.log('[migrate] Starting therapeutic area replacement...')
  if (dryRun) console.log('[migrate] DRY_RUN=true (no writes)')

  const replacements = await findTherapeuticAreas()
  const replacementMap = new Map()
  const missingTargets = []

  for (const entry of replacements) {
    if (!entry.target?._id) {
      missingTargets.push(entry.toName)
      continue
    }

    for (const oldArea of entry.oldAreas) {
      replacementMap.set(oldArea._id, entry.target._id)
    }
  }

  if (missingTargets.length) {
    console.error(`[migrate] Missing target therapeutic areas: ${missingTargets.join(', ')}`)
    process.exit(1)
  }

  if (!replacementMap.size) {
    console.log('[migrate] No matching therapeutic areas found. Nothing to update.')
    return
  }

  const oldIds = Array.from(replacementMap.keys())
  const summary = replacements
    .filter((entry) => entry.oldAreas.length && entry.target?._id)
    .map((entry) => `${entry.oldAreas.map((a) => a.name).join(', ')} -> ${entry.target.name}`)
    .join(' | ')

  console.log(`[migrate] Replacing ${summary}`)

  await updateTrials(oldIds, replacementMap)
  await updateSubmissions(oldIds, replacementMap)
  await updateDrafts(oldIds, replacementMap)

  console.log('[migrate] Done.')
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err.message)
  process.exit(1)
})
