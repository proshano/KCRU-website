/**
 * Migration: move social posts from the approve-every-paper flow to the flow
 * where approvers choose which papers to post about, and fill fields that were
 * added to social posts later.
 *
 *   pending -> available  (post text, errors and approval audit removed; lay
 *                          summary filled from the publication cache)
 *   skipped -> dismissed  (skippedBy/skippedAt copied to dismissedBy/dismissedAt)
 *   hasOtherAuthors       filled on records of any status that lack it
 *   teamMemberIds, firstAuthorId, paperAnchor
 *                         filled on records of any status that lack teamMemberIds,
 *                         so drafting can link the first author's profile. The
 *                         team researchers are the ones the post names in
 *                         teamMembers, and the fields are written only when every
 *                         name matches a researcher; a partly matched team would
 *                         stop drafting from matching names, so it waits for a
 *                         later run. A paper missing from the cache gets no first
 *                         author and an anchor built from its feed GUID.
 *
 * Existing values are never overwritten.
 *
 * Usage:
 *   npm run migrate:social-posts               # dry run, prints counts only
 *   npm run migrate:social-posts -- --apply    # writes in one revision-guarded transaction
 */

import { pathToFileURL } from 'node:url'

import { selectFeedPublications } from '../lib/publicationFeed.js'
import { publicationAnchorFromKey } from '../lib/publicationIdentity.js'
import { SOCIAL_POST_TYPE, computeHasOtherAuthors } from '../lib/socialPosting.js'
import { buildSocialPostTeamFields } from '../lib/socialPostingServer.js'

const PENDING_FIELDS_TO_UNSET = ['text', 'proposedText', 'lastError', 'lastErrorAt', 'approvedBy', 'approvedAt']

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

// Researchers by cleaned, lowercased name, to match the names a post records.
function groupResearchersByName(researchers = []) {
  const byName = new Map()
  for (const researcher of researchers || []) {
    const name = cleanString(researcher?.name).toLowerCase()
    if (!name || !researcher?._id) continue
    byName.set(name, [...(byName.get(name) || []), researcher])
  }
  return byName
}

export function planSocialPostMigration({ records = [], publications = [], researchers = [] } = {}) {
  // The feed's own selection and identity rules, without its 60-day window and
  // 50-item cap, so papers that have aged out of the feed still match.
  const feedItems = selectFeedPublications(publications, {
    windowDays: Number.POSITIVE_INFINITY,
    maxItems: Number.POSITIVE_INFINITY,
  })
  const publicationByGuid = new Map(feedItems.map((item) => [item.identity.guid, item.publication]))
  const researchersByName = groupResearchersByName(researchers)

  const patches = []
  const counts = {
    socialPosts: records.length,
    pendingToAvailable: 0,
    laySummaryFilled: 0,
    laySummaryMissing: 0,
    skippedToDismissed: 0,
    hasOtherAuthorsFilled: 0,
    hasOtherAuthorsUnknown: 0,
    teamMemberIdsFilled: 0,
    firstAuthorIdFilled: 0,
    paperAnchorFilled: 0,
    teamMembersUnmatched: 0,
    teamMembersPartlyMatched: 0,
    unchanged: 0,
  }
  for (const record of records) {
    const set = {}
    const unset = []
    const publication = publicationByGuid.get(record?.guid)

    if (record?.status === 'pending') {
      const laySummary = cleanString(publication?.laySummary)
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
      const hasOtherAuthors = computeHasOtherAuthors(publication?.authors, record?.teamMembers)
      if (hasOtherAuthors === null) {
        counts.hasOtherAuthorsUnknown += 1
      } else {
        set.hasOtherAuthors = hasOtherAuthors
        counts.hasOtherAuthorsFilled += 1
      }
    }

    // The profile-link fields, for records synced before they existed. The team is who the
    // post names, not the cache's current provenance, which may have changed since the sync.
    // Nothing is written unless every name matches: a partial teamMemberIds would stop later
    // runs and drafting from matching names, while leaving it unset keeps both working.
    if (record?.teamMemberIds == null) {
      const matchesByName = (record?.teamMembers || [])
        .map((name) => cleanString(name).toLowerCase())
        .filter(Boolean)
        .map((name) => researchersByName.get(name) || [])
      const matchedNames = matchesByName.filter((matches) => matches.length).length
      if (!matchedNames) {
        counts.teamMembersUnmatched += 1
      } else if (matchedNames < matchesByName.length) {
        counts.teamMembersPartlyMatched += 1
      } else {
        const fields = buildSocialPostTeamFields({ publication, researchers: matchesByName.flat() })
        set.teamMemberIds = fields.teamMemberIds
        counts.teamMemberIdsFilled += 1
        if (fields.firstAuthorId && record?.firstAuthorId == null) {
          set.firstAuthorId = fields.firstAuthorId
          counts.firstAuthorIdFilled += 1
        }
        const paperAnchor = fields.paperAnchor || publicationAnchorFromKey(record?.guid)
        if (paperAnchor && record?.paperAnchor == null) {
          set.paperAnchor = paperAnchor
          counts.paperAnchorFilled += 1
        }
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

  const [records, researchers, cache] = await Promise.all([
    writeClient.fetch(
      `*[_type == $type && !(_id in path("drafts.**"))] { _id, _rev, guid, status, skippedBy, skippedAt, teamMembers, hasOtherAuthors, teamMemberIds, firstAuthorId, paperAnchor }`,
      { type: SOCIAL_POST_TYPE }
    ),
    writeClient.fetch(
      '*[_type == "researcher" && !(_id in path("drafts.**"))] { _id, name, publicationAuthorName, publicationAuthorAliases }'
    ),
    readCache(),
  ])
  if (!cache) throw new Error('The publication cache could not be read, so lay summaries cannot be filled.')

  const { patches, counts } = planSocialPostMigration({
    records: records || [],
    publications: cache.publications || [],
    researchers: researchers || [],
  })
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
