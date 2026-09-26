import { createHash } from 'node:crypto'

import { classifyResearcherAuthor, normalizeAttributionAuthor } from './publicationAttribution.js'
import { getPublicationAnchorId } from './publicationIdentity.js'
import {
  SOCIAL_NETWORK_X,
  SOCIAL_POST_TYPE,
  buildSocialPostNotificationEmail,
  computeHasOtherAuthors,
  selectSocialPostsToNotify,
} from './socialPosting.js'

// Server-only social posting helpers that need node:crypto. They are kept out
// of socialPosting.js because /admin/social imports that module in the browser.

function cleanString(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function toIso(value) {
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

export function socialPostDocumentId(network, guid) {
  const safeNetwork = String(network || '').toLowerCase().replace(/[^a-z0-9_-]/g, '')
  const hash = createHash('sha1').update(String(guid || '')).digest('hex')
  return `socialPost-${safeNetwork}-${hash}`
}

function dedupeResearchers(researchers) {
  const byId = new Map()
  for (const researcher of researchers || []) {
    if (researcher?._id && !byId.has(researcher._id)) byId.set(researcher._id, researcher)
  }
  return Array.from(byId.values())
}

// The team researcher whose publication names match the paper's first listed author, or ''
// when none does or more than one could. The raw first entry is used: filtering the list
// first would let a consortium byline shift someone else into first place.
function findFirstAuthorResearcherId(publication = {}, researchers = []) {
  const firstAuthor = Array.isArray(publication?.authors) ? publication.authors[0] : null
  if (!firstAuthor) return ''
  const author = normalizeAttributionAuthor(firstAuthor, publication.source)
  if (!author?.family) return ''
  const matches = dedupeResearchers(researchers).filter((researcher) => classifyResearcherAuthor(author, researcher))
  return matches.length === 1 ? matches[0]._id : ''
}

// The fields drafting uses to pick whose profile the post links to: the team researcher
// ids, the first author among them and the paper's anchor on profile pages. Empty values
// are omitted. `researchers` are the paper's team researcher documents ({ _id, name,
// publicationAuthorName, publicationAuthorAliases }). Used by the sync and by the
// backfill in scripts/migrate-social-posts-to-available.js.
export function buildSocialPostTeamFields({ publication = {}, researchers = [] } = {}) {
  const teamResearchers = dedupeResearchers(researchers)
  const teamMemberIds = teamResearchers.map((researcher) => researcher._id)
  const firstAuthorId = findFirstAuthorResearcherId(publication, teamResearchers)
  const paperAnchor = getPublicationAnchorId(publication)
  return {
    ...(teamMemberIds.length ? { teamMemberIds } : {}),
    ...(firstAuthorId ? { firstAuthorId } : {}),
    ...(paperAnchor ? { paperAnchor } : {}),
  }
}

// `item` is a publication feed entry from selectFeedPublications(). New records
// carry no post text: an approver creates the draft at /admin/social.
// `researchers` are the paper's team researcher documents (see buildSocialPostTeamFields).
export function buildSocialPostRecord({
  item,
  network = SOCIAL_NETWORK_X,
  teamMembers = [],
  researchers = [],
  status = 'available',
  now = new Date(),
} = {}) {
  const { publication = {}, identity = {} } = item || {}
  const journal = cleanString(publication.journal)
  const laySummary = cleanString(publication.laySummary)
  const publishedAt = new Date(item?.date || '')
  const dedupedTeamMembers = Array.from(new Set((teamMembers || []).map(cleanString).filter(Boolean)))
  const hasOtherAuthors = computeHasOtherAuthors(publication.authors, dedupedTeamMembers)
  return {
    _id: socialPostDocumentId(network, identity.guid),
    _type: SOCIAL_POST_TYPE,
    network,
    guid: identity.guid,
    link: identity.link,
    title: cleanString(publication.title),
    ...(journal ? { journal } : {}),
    ...(Number.isNaN(publishedAt.getTime()) ? {} : { publishedAt: publishedAt.toISOString() }),
    teamMembers: dedupedTeamMembers,
    ...(hasOtherAuthors === null ? {} : { hasOtherAuthors }),
    ...buildSocialPostTeamFields({ publication, researchers }),
    ...(laySummary ? { laySummary } : {}),
    status,
    createdAt: toIso(now),
  }
}

export function buildSocialPostNotificationIdempotencyKey(posts = [], now = new Date()) {
  const ids = posts.map((post) => post._id).sort().join('|')
  const day = toIso(now).slice(0, 10)
  return `social-post-approval:${createHash('sha256').update(`${ids}|${day}`).digest('hex').slice(0, 40)}`
}

// Emails approvers once about papers newly offered for posting. Each paper is
// included only until an email about it is confirmed sent; there are no reminders.
export async function dispatchSocialPostNotifications({
  records = [],
  recipients = [],
  portalUrl,
  send,
  markNotified,
  dryRun = false,
  now = new Date(),
} = {}) {
  const due = selectSocialPostsToNotify(records)
  const normalizedRecipients = Array.from(new Set((recipients || [])
    .map((email) => cleanString(email).toLowerCase())
    .filter(Boolean)))
  const summary = {
    due: due.length,
    recipientCount: normalizedRecipients.length,
    postIds: due.map((post) => post._id),
  }
  if (!due.length) {
    return { ok: true, skipped: true, dryRun, reason: 'No new publications to tell approvers about.', ...summary }
  }
  if (dryRun) return { ok: true, dryRun: true, ...summary }
  if (!normalizedRecipients.length) {
    throw new Error('No social media post approvers are configured (socialPosting.approverEmails or studyApprovals.admins).')
  }
  if (typeof send !== 'function' || typeof markNotified !== 'function') {
    throw new Error('Notification delivery and tracking functions are required.')
  }

  const email = buildSocialPostNotificationEmail({ posts: due, portalUrl })
  const delivery = await send({
    to: normalizedRecipients,
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: buildSocialPostNotificationIdempotencyKey(due, now),
  })
  if (delivery?.skipped) {
    throw new Error(`Social media post email was not sent: ${delivery.reason || 'email provider unavailable'}.`)
  }
  await markNotified(due, now)
  return { ok: true, sent: true, ...summary }
}
