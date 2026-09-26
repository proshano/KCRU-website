/**
 * Migration: move social posts from the approve-every-paper flow to the flow
 * where approvers choose which papers to post about.
 *
 *   pending -> available  (post text, errors and approval audit removed; lay
 *                          summary filled from the publication cache)
 *   skipped -> dismissed  (skippedBy/skippedAt copied to dismissedBy/dismissedAt)
 *
 * Usage:
 *   npm run migrate:social-posts               # dry run, prints counts only
 *   npm run migrate:social-posts -- --apply    # writes in one revision-guarded transaction
 */

import { pathToFileURL } from 'node:url'

import { selectFeedPublications } from '../lib/publicationFeed.js'
import { SOCIAL_POST_TYPE, computeHasOtherAuthors } from '../lib/socialPosting.js'

const PENDING_FIELDS_TO_UNSET = ['text', 'proposedText', 'lastError', 'lastErrorAt', 'approvedBy', 'approvedAt']

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function planSocialPostMigration({ records = [], publications = [] } = {}) {
  // The feed's own selection and identity rules, without its 60-day window and
  // 50-item cap, so papers that have aged out of the feed still match.
  const feedItems = selectFeedPublications(publications, {
    windowDays: Number.POSITIVE_INFINITY,
    maxItems: Number.POSITIVE_INFINITY,
  })
  const laySummaryByGuid = new Map(feedItems.map((item) => [item.identity.guid, cleanString(item.publication.laySummary)]))
  const authorsByGuid = new Map(feedItems.map((item) => [item.identity.guid, item.publication.authors]))

  const patches = []
  const counts = {
    socialPosts: records.length,
    pendingToAvailable: 0,
    laySummaryFilled: 0,
    laySummaryMissing: 0,
    skippedToDismissed: 0,
    hasOtherAuthorsFilled: 0,
    hasOtherAuthorsUnknown: 0,
    unchanged: 0,
  }
  for (const record of records) {
    const set = {}
    const unset = []

    if (record?.status === 'pending') {
      const laySummary = laySummaryByGuid.get(record.guid) || ''
      counts.pendingToAvailable += 1
      counts[laySummary ? 'laySummaryFilled' : 'laySummaryMissing'] += 1
      Object.assign(set, { status: 'available', ...(laySummary ? { laySummary } : {}) })
      unset.push(...PENDING_FIELDS_TO_UNSET)
    } else if (record?.status === 'skipped') {
      counts.skippedToDismissed += 1
      Object.assign(set, {
        status: 'dismissed',
        ...(record.skippedBy ? { dismissedBy: record.skippedBy } : {}),
        ...(record.skippedAt ? { dismissedAt: record.skippedAt } : {}),
      })
    }

    // Fills the flag on records of any status, but never overwrites an existing true/false.
    // GROQ returns null (not undefined) for a field absent from the document, so treat
    // both as missing.
    if (record?.hasOtherAuthors == null) {
      const hasOtherAuthors = computeHasOtherAuthors(authorsByGuid.get(record?.guid), record?.teamMembers)
      if (hasOtherAuthors === null) {
        counts.hasOtherAuthorsUnknown += 1
      } else {
        set.hasOtherAuthors = hasOtherAuthors
        counts.hasOtherAuthorsFilled += 1
      }
    }

    if (Object.keys(set).length || unset.length) {
      patches.push({ id: record._id, rev: record._rev, set, unset })
    } else {
      counts.unchanged += 1
    }
  }
  return { patches, counts }
}

async function applyMigration(writeClient, patches) {
  const transaction = writeClient.transaction()
  for (const patch of patches) {
    transaction.patch(patch.id, (builder) => {
      const next = builder.ifRevisionId(patch.rev).set(patch.set)
      return patch.unset.length ? next.unset(patch.unset) : next
    })
  }
  await transaction.commit()
}

async function main() {
  const apply = process.argv.slice(2).includes('--apply')
  const [{ writeClient }, { readCache }] = await Promise.all([
    import('../lib/sanity.js'),
    import('../lib/pubmedCache.js'),
  ])
  if (apply && !writeClient.config().token) {
    throw new Error('SANITY_API_TOKEN is required to apply the migration.')
  }

  const [records, cache] = await Promise.all([
    writeClient.fetch(
      `*[_type == $type && !(_id in path("drafts.**"))] { _id, _rev, guid, status, skippedBy, skippedAt, teamMembers, hasOtherAuthors }`,
      { type: SOCIAL_POST_TYPE }
    ),
    readCache(),
  ])
  if (!cache) throw new Error('The publication cache could not be read, so lay summaries cannot be filled.')

  const { patches, counts } = planSocialPostMigration({ records: records || [], publications: cache.publications || [] })
  const report = { mode: apply ? 'apply' : 'dry-run', ...counts, patches: patches.length }
  if (!apply || !patches.length) {
    console.log(JSON.stringify({ ...report, applied: false }, null, 2))
    return
  }

  await applyMigration(writeClient, patches)
  console.log(JSON.stringify({ ...report, applied: true }, null, 2))
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  main().catch((error) => {
    console.error('[social-posts-migration] failed', error?.message || error)
    process.exitCode = 1
  })
}
