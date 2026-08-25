import { createHash } from 'node:crypto'

import { escapeHtml } from './escapeHtml.js'

export const ATTRIBUTION_REMINDER_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

function cleanString(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function selectDueAttributionReviews(reviews = [], {
  now = new Date(),
  reminderDays = ATTRIBUTION_REMINDER_DAYS,
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime()
  const reminderMs = reminderDays * DAY_MS
  return reviews
    .filter((review) => review?.status === 'pending')
    .map((review) => {
      const lastNotifiedMs = Date.parse(review.lastNotifiedAt || '')
      const notificationKind = Number.isNaN(lastNotifiedMs) ? 'new' : 'reminder'
      const isDue = notificationKind === 'new' || nowMs - lastNotifiedMs >= reminderMs
      return isDue ? { ...review, notificationKind } : null
    })
    .filter(Boolean)
}

export function describeAttributionEvidence(review = {}) {
  const evidence = review.evidence || {}
  const lines = [cleanString(review.holdReason)].filter(Boolean)
  if (evidence.matchedAuthor) lines.push(`Matched author: ${cleanString(evidence.matchedAuthor)}`)
  if (evidence.nameKind) lines.push(`Name form: ${cleanString(evidence.nameKind)}`)
  if (evidence.affiliationMatches?.length) {
    lines.push(`Known affiliation: ${evidence.affiliationMatches.map(cleanString).filter(Boolean).join('; ')}`)
  }
  lines.push(`Recurring PubMed-confirmed coauthors: ${Number(evidence.recurringCoauthorCount) || 0}`)
  if (evidence.recurringCoauthors?.length) {
    lines.push(`Recurring coauthors: ${evidence.recurringCoauthors.map(cleanString).filter(Boolean).join(', ')}`)
  }
  if (evidence.matchedOrcid) lines.push(`Candidate ORCID: ${cleanString(evidence.matchedOrcid)}`)
  if (evidence.queryPaths?.length) {
    lines.push(`Discovery paths: ${evidence.queryPaths.map(cleanString).filter(Boolean).join(', ')}`)
  }
  return lines
}

function formatJournalYear(review) {
  return [cleanString(review.journal), review.year || ''].filter(Boolean).join(', ')
}

export function buildPublicationAttributionReviewEmail({ reviews = [], portalUrl } = {}) {
  const newCount = reviews.filter((review) => review.notificationKind === 'new').length
  const reminderCount = reviews.length - newCount
  const subject = `${reviews.length} publication attribution${reviews.length === 1 ? '' : 's'} need review`
  const intro = [
    `${newCount} new candidate${newCount === 1 ? '' : 's'}`,
    `${reminderCount} weekly reminder${reminderCount === 1 ? '' : 's'}`,
  ].join(' and ')

  const textItems = reviews.map((review, index) => {
    const identifier = review.doi ? `DOI ${review.doi}` : review.pmid ? `PMID ${review.pmid}` : review.publicationKey
    const details = [
      `${index + 1}. ${review.researcherName || review.researcherDetails?.name || 'Unknown researcher'} — ${cleanString(review.title)}`,
      `Authors: ${(review.authors || []).join(', ') || 'Not available'}`,
      `Journal/year: ${formatJournalYear(review) || 'Not available'}`,
      `Identifier: ${identifier}`,
      `Sources: ${(review.discoverySources || []).join(', ') || 'Not available'}`,
      ...describeAttributionEvidence(review),
    ]
    return details.join('\n')
  })
  const text = [
    `Publication attribution review: ${intro}.`,
    '',
    ...textItems.flatMap((item) => [item, '']),
    `Open the protected review portal: ${portalUrl}`,
    'Approve or reject candidates only inside the portal. This email intentionally contains no decision links.',
  ].join('\n')

  const htmlItems = reviews.map((review) => {
    const researcherName = review.researcherName || review.researcherDetails?.name || 'Unknown researcher'
    const doiUrl = review.doi ? `https://doi.org/${encodeURI(review.doi)}` : null
    const identifier = review.doi
      ? `<a href="${escapeHtml(doiUrl)}">DOI ${escapeHtml(review.doi)}</a>`
      : review.pmid
        ? `PMID ${escapeHtml(review.pmid)}`
        : escapeHtml(review.publicationKey)
    const evidence = describeAttributionEvidence(review)
      .map((line) => `<li>${escapeHtml(line)}</li>`)
      .join('')
    return `
      <li style="margin-bottom:20px">
        <strong>${escapeHtml(researcherName)} — ${escapeHtml(review.title)}</strong><br>
        Authors: ${escapeHtml((review.authors || []).join(', ') || 'Not available')}<br>
        Journal/year: ${escapeHtml(formatJournalYear(review) || 'Not available')}<br>
        Identifier: ${identifier}<br>
        Sources: ${escapeHtml((review.discoverySources || []).join(', ') || 'Not available')}
        <ul>${evidence}</ul>
      </li>
    `
  }).join('')
  const html = `
    <p>Publication attribution review: ${escapeHtml(intro)}.</p>
    <ol>${htmlItems}</ol>
    <p><a href="${escapeHtml(portalUrl)}">Open the protected publication review portal</a></p>
    <p>Approve or reject candidates only inside the portal. This email intentionally contains no decision links.</p>
  `

  return { subject, text, html, newCount, reminderCount }
}

export function buildAttributionNotificationIdempotencyKey(reviews = []) {
  const fingerprint = reviews
    .map((review) => `${review._id}:${Number(review.notificationCount) || 0}`)
    .sort()
    .join('|')
  return `publication-attribution-review:${createHash('sha256').update(fingerprint).digest('hex').slice(0, 40)}`
}

export async function dispatchPublicationAttributionNotifications({
  reviews = [],
  recipients = [],
  portalUrl,
  send,
  markNotified,
  dryRun = false,
  now = new Date(),
} = {}) {
  const due = selectDueAttributionReviews(reviews, { now })
  const normalizedRecipients = Array.from(new Set((recipients || [])
    .map((email) => cleanString(email).toLowerCase())
    .filter(Boolean)))
  const summary = {
    due: due.length,
    newCandidates: due.filter((review) => review.notificationKind === 'new').length,
    reminders: due.filter((review) => review.notificationKind === 'reminder').length,
    recipientCount: normalizedRecipients.length,
    reviewIds: due.map((review) => review._id),
  }
  if (!due.length) {
    return { ok: true, skipped: true, dryRun, reason: 'No pending attribution review is due.', ...summary }
  }
  if (dryRun) return { ok: true, dryRun: true, ...summary }
  if (!normalizedRecipients.length) {
    throw new Error('No publication attribution review recipients are configured in studyApprovals.admins.')
  }
  if (typeof send !== 'function' || typeof markNotified !== 'function') {
    throw new Error('Notification delivery and tracking functions are required.')
  }

  const email = buildPublicationAttributionReviewEmail({ reviews: due, portalUrl })
  const delivery = await send({
    to: normalizedRecipients,
    ...email,
    idempotencyKey: buildAttributionNotificationIdempotencyKey(due),
  })
  if (delivery?.skipped) {
    throw new Error(`Publication attribution review email was not sent: ${delivery.reason || 'email provider unavailable'}.`)
  }
  await markNotified(due, now)
  return { ok: true, sent: true, ...summary }
}
