import { NextResponse } from 'next/server'
import { STUDY_STAFF_PROJECTION, sanityFetch, writeClient } from '@/lib/sanity'
import { fetchSites, resolveSiteIds } from '@/lib/sites'
import { sendEmail } from '@/lib/email'
import {
  normalizeStudyPayload,
  sanitizeString,
  slugify,
  ensureUniqueSlug,
  buildPatchFields,
  buildUnsetFields,
  buildTrialSummaryDoc,
} from '@/lib/studySubmissions'
import { applyStudyPatch } from '@/lib/studyApprovals'
import { revalidateStudyPages } from '@/lib/studyRevalidation'
import {
  formatTeamError,
  recruitingSites,
  recruitmentSiteLabels,
  summarizePayloadTeam,
  summarizeStudyChanges,
  validateSiteTeams,
} from '@/lib/studyTeams'
import { createAdminTokenSession, getScopedAdminSession, isAdminEmail } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import { getTherapeuticAreaLabel } from '@/lib/communicationOptions'
import { escapeHtml } from '@/lib/escapeHtml'
import { buildCorsHeaders, extractBearerToken, getClientIp } from '@/lib/httpUtils'

const CORS_HEADERS = buildCorsHeaders('GET, POST, PATCH, DELETE, OPTIONS')

const FALLBACK_NOTIFY_EMAIL = (process.env.STUDY_EDITOR_NOTIFY_EMAIL || '').trim()
const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
const APPROVAL_BASE_URL = `${SITE_BASE_URL}/admin/approvals`
const APPROVAL_SESSION_TTL_HOURS = 72
const DEV_PREVIEW_MODE = process.env.NODE_ENV !== 'production'

// Studies in payload shape plus the latest pending change for each, so the Study
// Manager can start a coordinator's edit from it instead of overwriting it. The
// submitter's IP and browser stay approvals-only.
const STUDY_LIST_QUERY = `
  *[_type == "trialSummary"] | order(status asc, title asc) {
    ${STUDY_STAFF_PROJECTION},
    "pendingSubmission": *[_type == "studySubmission" && status == "pending" && studyRef._ref == ^._id]
      | order(submittedAt desc)[0]{ _id, submittedAt, "submittedByEmail": submittedBy.email, payload }
  }
`

// Reads that must see a submission or approval made seconds ago bypass the CDN.
function freshFetch(query, params) {
  return writeClient.config().token ? writeClient.fetch(query, params) : sanityFetch(query, params)
}

function formatDate(value) {
  if (!value) return 'Unknown'
  try {
    return new Date(value).toLocaleString()
  } catch (err) {
    return String(value)
  }
}

function formatBoolean(value) {
  return value ? 'Yes' : 'No'
}

function truncateText(value, limit = 360) {
  const text = String(value || '').trim()
  if (!text) return 'None'
  if (limit === null || limit === undefined) return text
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 3).trim()}...`
}

function formatParagraph(value, limit) {
  const text = truncateText(value, limit)
  if (text === 'None') return text
  return escapeHtml(text).replace(/\n/g, '<br />')
}

function formatListText(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  if (!list.length) return ['- None']
  return list.map((item) => `- ${item}`)
}

function formatListHtml(items) {
  const list = Array.isArray(items) ? items.filter(Boolean) : []
  if (!list.length) {
    return '<p style="margin: 6px 0 0;">None</p>'
  }
  return `
    <ul style="margin: 6px 0 0; padding-left: 18px;">
      ${list.map((item) => `<li style="margin: 2px 0;">${escapeHtml(item)}</li>`).join('')}
    </ul>
  `
}

async function getApprovalAdmins() {
  const settings = await sanityFetch(`
    *[_type == "siteSettings"][0]{
      "admins": studyApprovals.admins
    }
  `)
  const admins = (settings?.admins || []).map((email) => String(email).trim()).filter(Boolean)
  if (admins.length) return admins
  if (FALLBACK_NOTIFY_EMAIL) return [FALLBACK_NOTIFY_EMAIL]
  return []
}

async function canBypassApprovals(session) {
  if (session?.access?.approvals) return true
  if (!session?.email) return false
  return isAdminEmail(session.email, 'approvals')
}

async function canRemoveStudies(session) {
  const email = sanitizeString(session?.email).toLowerCase()
  if (!email) return false
  const settings = await writeClient.fetch(`
    *[_type == "siteSettings"][0]{
      "admins": studyApprovals.admins
    }
  `)
  const admins = Array.isArray(settings?.admins) ? settings.admins : []
  return admins.some((adminEmail) => sanitizeString(adminEmail).toLowerCase() === email)
}

async function createApprovalSessionLink(email) {
  const { token } = await createAdminTokenSession({
    email,
    sessionTtlHours: APPROVAL_SESSION_TTL_HOURS,
  })
  return `${APPROVAL_BASE_URL}?token=${token}`
}

async function loadMeta() {
  const [areas, researchers, sites] = await Promise.all([
    freshFetch(`
      *[_type == "therapeuticArea" && active == true] | order(order asc, name asc) {
        _id,
        name,
        shortLabel
      }
    `),
    freshFetch(`
      *[_type == "researcher"] | order(name asc) {
        _id,
        name,
        slug,
        "primarySiteId": primarySite._ref
      }
    `),
    fetchSites(freshFetch),
  ])
  return { areas: areas || [], researchers: researchers || [], sites }
}

// The first problem with a payload, worded for the form, or '' when it is valid.
// Recruitment locations outside the configured sites are dropped silently.
function validateStudyPayload(payload, sites) {
  if (!payload.title) return 'Title is required.'
  const teamErrors = validateSiteTeams(payload.siteTeams, { sites })
  if (teamErrors.length) return formatTeamError(teamErrors[0], payload.siteTeams, sites)
  payload.recruitmentSiteIds = resolveSiteIds(payload.recruitmentSiteIds, recruitingSites(sites))
  return ''
}

function buildApprovalEmail({
  action,
  approvalLink,
  payload,
  submissionId,
  submittedAt,
  submittedByEmail,
  supersededCount,
  meta,
  changes,
}) {
  const actionLabel = action === 'update' ? 'Update' : 'New study'
  const submittedAtLabel = formatDate(submittedAt)
  const inclusionItems = Array.isArray(payload.inclusionCriteria) ? payload.inclusionCriteria.filter(Boolean) : []
  const exclusionItems = Array.isArray(payload.exclusionCriteria) ? payload.exclusionCriteria.filter(Boolean) : []
  const countLabel = (items) => (items.length ? `${items.length} item${items.length === 1 ? '' : 's'}` : 'None')

  const areaLabels = new Map(
    (meta?.areas || []).map((area) => [
      area._id,
      area.shortLabel
        ? `${area.shortLabel} - ${getTherapeuticAreaLabel(area.name)}`
        : getTherapeuticAreaLabel(area.name),
    ])
  )
  const therapeuticAreaLabel = (payload.therapeuticAreaIds || []).map((id) => areaLabels.get(id) || id).join(', ') || 'None'
  const teamRows = (payload.siteTeams || []).map((team, index) => {
    const summary = summarizePayloadTeam(team, index, meta)
    return [summary.label, summary.summary]
  })
  const recruitmentLabel = recruitmentSiteLabels(payload.recruitmentSiteIds, meta?.sites).join(', ') || 'None'

  const detailRows = [
    ['Study title', payload.title || 'Untitled'],
    ['Short clinical title', payload.emailTitle || 'None'],
    ['Eligibility statement', payload.emailEligibilitySummary || 'None'],
    ['NCT ID', payload.nctId || 'None'],
    ['Status', payload.status || 'None'],
    ['Study type', payload.studyType || 'None'],
    ['Phase', payload.phase || 'None'],
    ['Slug', payload.slug || 'None'],
    ['Featured', formatBoolean(payload.featured)],
    ['Therapeutic areas', therapeuticAreaLabel],
    ...teamRows,
    ['Recruitment locations', recruitmentLabel],
    ['Sponsor website', payload.sponsorWebsite || 'None'],
    ['Inclusion criteria', countLabel(inclusionItems)],
    ['Exclusion criteria', countLabel(exclusionItems)],
  ]

  const notes = []
  if (supersededCount > 0) {
    notes.push(
      `Supersedes ${supersededCount} earlier pending submission${supersededCount === 1 ? '' : 's'}.`
    )
  }
  // What the approver is deciding on: the differences from the live study.
  const changeLines = action === 'update'
    ? (Array.isArray(changes) && changes.length ? changes : ['No differences from the current study.'])
    : []

  const textLines = [
    `Study submission pending approval (${actionLabel})`,
    '',
    `Submitted by: ${submittedByEmail || 'Unknown'}`,
    `Submitted at: ${submittedAtLabel}`,
    `Submission ID: ${submissionId || 'Unknown'}`,
    notes.length ? `Notes: ${notes.join(' ')}` : null,
    '',
    `Open approvals (valid for ${APPROVAL_SESSION_TTL_HOURS} hours): ${approvalLink}`,
    '',
    ...(changeLines.length ? ['What this submission changes:', ...changeLines.map((line) => `- ${line}`), ''] : []),
    'Study details:',
    ...detailRows.map(([label, value]) => `- ${label}: ${value}`),
    '',
    'Summaries:',
    `- Clinical summary: ${truncateText(payload.laySummary, null)}`,
    `- Short clinical title: ${truncateText(payload.emailTitle, null)}`,
    `- Eligibility statement: ${truncateText(payload.emailEligibilitySummary, null)}`,
    '',
    'Eligibility criteria:',
    'Inclusion criteria:',
    ...formatListText(inclusionItems),
    'Exclusion criteria:',
    ...formatListText(exclusionItems),
  ].filter(Boolean)

  const htmlRows = detailRows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding: 6px 8px; font-weight: 600; vertical-align: top;">${escapeHtml(label)}</td>
          <td style="padding: 6px 8px;">${escapeHtml(value)}</td>
        </tr>
      `
    )
    .join('')

  const notesHtml = notes.length
    ? `<p style="margin: 12px 0; padding: 10px 12px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px;">
         <strong>Notes:</strong> ${escapeHtml(notes.join(' '))}
       </p>`
    : ''

  const changesHtml = changeLines.length
    ? `<h3 style="margin: 16px 0 6px; font-size: 14px;">What this submission changes</h3>
       ${formatListHtml(changeLines)}`
    : ''

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5;">
      <h2 style="margin: 0 0 8px;">Study submission pending approval</h2>
      <p style="margin: 0 0 12px; color: #444;">
        <strong>Action:</strong> ${escapeHtml(actionLabel)}<br />
        <strong>Study:</strong> ${escapeHtml(payload.title || 'Untitled')}<br />
        <strong>Submitted by:</strong> ${escapeHtml(submittedByEmail || 'Unknown')}<br />
        <strong>Submitted at:</strong> ${escapeHtml(submittedAtLabel)}<br />
        <strong>Submission ID:</strong> ${escapeHtml(submissionId || 'Unknown')}
      </p>
      ${notesHtml}
      <p style="margin: 0 0 16px;">
        <a href="${escapeHtml(approvalLink)}" style="display: inline-block; padding: 10px 16px; background: #4f46e5; color: #fff; text-decoration: none; border-radius: 6px;">
          Open approvals
        </a>
        <span style="margin-left: 8px; color: #666;">Valid for ${APPROVAL_SESSION_TTL_HOURS} hours</span>
      </p>
      ${changesHtml}
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; margin-top: 12px;">
        <tbody>
          ${htmlRows}
        </tbody>
      </table>
      <h3 style="margin: 16px 0 6px; font-size: 14px;">Summaries</h3>
      <p style="margin: 0 0 8px;"><strong>Clinical summary:</strong><br />${formatParagraph(payload.laySummary, null)}</p>
      <p style="margin: 0 0 8px;"><strong>Short clinical title:</strong><br />${formatParagraph(payload.emailTitle, null)}</p>
      <p style="margin: 0 0 8px;"><strong>Eligibility statement:</strong><br />${formatParagraph(
        payload.emailEligibilitySummary,
        null
      )}</p>
      <h3 style="margin: 16px 0 6px; font-size: 14px;">Eligibility criteria</h3>
      <p style="margin: 0;"><strong>Inclusion criteria:</strong></p>
      ${formatListHtml(inclusionItems)}
      <p style="margin: 12px 0 0;"><strong>Exclusion criteria:</strong></p>
      ${formatListHtml(exclusionItems)}
      <p style="margin: 16px 0 0; font-size: 12px; color: #666;">
        View full details and criteria in the approvals portal.
      </p>
    </div>
  `

  return {
    subject: `Study submission pending approval: ${payload.title || 'Untitled study'} (${actionLabel})`,
    text: textLines.join('\n'),
    html,
  }
}

// Marks every other pending submission for a study superseded, either by a
// newer submission (supersededBy) or by an admin publishing directly, which
// would otherwise leave an older submission live to revert the admin's change.
async function supersedePendingSubmissions({ studyId, submissionId = '', reviewedBy = '' }) {
  const baseId = sanitizeString(studyId).replace(/^drafts\./, '')
  if (!baseId) {
    return { count: 0, promise: Promise.resolve() }
  }
  const pending = await freshFetch(
    `*[_type == "studySubmission" && status == "pending" && studyRef._ref == $studyId && _id != $submissionId] { _id }`,
    { studyId: baseId, submissionId: submissionId || '' }
  )
  if (!Array.isArray(pending) || !pending.length) {
    return { count: 0, promise: Promise.resolve() }
  }
  const supersededAt = new Date().toISOString()
  const fields = submissionId
    ? { status: 'superseded', supersededAt, supersededBy: { _type: 'reference', _ref: submissionId } }
    : { status: 'superseded', supersededAt, reviewedAt: supersededAt, reviewedBy: reviewedBy || 'approval admin' }
  const promise = Promise.allSettled(
    pending.map((item) => writeClient.patch(item._id).set(fields).commit({ returnDocuments: false }))
  )
  return { count: pending.length, promise }
}

async function latestPendingSubmission(studyId) {
  const baseId = sanitizeString(studyId).replace(/^drafts\./, '')
  if (!baseId) return null
  const pending = await freshFetch(
    `*[_type == "studySubmission" && status == "pending" && studyRef._ref == $studyId]
      | order(submittedAt desc)[0]{ _id, submittedAt, "submittedByEmail": submittedBy.email }`,
    { studyId: baseId }
  )
  return pending?._id ? pending : null
}

function buildConflictMessage(latestPending) {
  if (!latestPending) {
    return 'The pending change you built on has already been reviewed. Reload the study and try again.'
  }
  return `This study was changed by ${latestPending.submittedByEmail || 'another coordinator'} on ${formatDate(
    latestPending.submittedAt
  )} since you opened it. Reload the study to see their changes before submitting.`
}

async function fetchCurrentStudy(id) {
  const cleaned = sanitizeString(id)
  if (!cleaned) return null
  const baseId = cleaned.replace(/^drafts\./, '')
  return freshFetch(
    `*[_type == "trialSummary" && _id in $ids] | order(_id asc)[0]{ ${STUDY_STAFF_PROJECTION} }`,
    { ids: [baseId, `drafts.${baseId}`] }
  )
}

async function findDuplicateNctId({ nctId, excludeId }) {
  if (!nctId) return null
  const duplicate = await sanityFetch(
    `*[_type == "trialSummary" && nctId == $nctId && _id != $excludeId && !(_id in path("drafts.**"))][0]{
      _id,
      title,
      nctId,
      "slug": slug.current
    }`,
    { nctId, excludeId: excludeId || '' }
  )
  return duplicate || null
}

async function resolveTrialId(id) {
  const cleaned = sanitizeString(id)
  if (!cleaned) return ''
  const baseId = cleaned.replace(/^drafts\./, '')
  const draftId = baseId ? `drafts.${baseId}` : ''
  const ids = Array.from(
    new Set([cleaned, baseId, draftId].filter(Boolean))
  )
  const matches = await writeClient.fetch(
    `*[_type == "trialSummary" && _id in $ids]{ _id }`,
    { ids }
  )
  if (!Array.isArray(matches) || !matches.length) return ''
  if (baseId && matches.some((doc) => doc?._id === baseId)) {
    return baseId
  }
  if (draftId && matches.some((doc) => doc?._id === draftId)) {
    return draftId
  }
  return matches[0]?._id || ''
}

async function notifyAdmins({
  action,
  submissionId,
  payload,
  recipients,
  submittedAt,
  submittedBy,
  supersededCount,
  meta,
  changes,
}) {
  const targets = recipients?.length ? recipients : await getApprovalAdmins()
  if (!targets.length) return
  const submittedByEmail = submittedBy?.email || ''
  const results = await Promise.allSettled(
    targets.map(async (to) => {
      const approvalLink = await createApprovalSessionLink(to)
      const { subject, text, html } = buildApprovalEmail({
        action,
        approvalLink,
        payload,
        submissionId,
        submittedAt,
        submittedByEmail,
        supersededCount,
        meta,
        changes,
      })
      return sendEmail({ to, subject, text, html })
    })
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('[trials-manage] notify failed', result.reason)
    }
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

async function getCoordinatorSession(token) {
  if (!token) return null
  const session = await sanityFetch(
    `*[_type == "studyCoordinatorSession" && token == $token][0]{ _id, email, expiresAt, revoked }`,
    { token }
  )
  if (!session || session.revoked) return null
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return null
  return session
}

async function getManageSession(request) {
  const sessionAccess = await getSessionAccess()
  if (sessionAccess) {
    if (hasRequiredAccess(sessionAccess.access, { coordinator: true })) {
      return { session: { email: sessionAccess.email, access: sessionAccess.access }, status: 200 }
    }
    return { session: null, error: 'Not authorized for study management.', status: 403 }
  }

  const token = extractBearerToken(request)
  if (!token) {
    return { session: null, error: 'Unauthorized', status: 401 }
  }

  const coordinator = await getCoordinatorSession(token)
  if (coordinator) {
    return { session: coordinator, status: 200 }
  }

  const { session, error, status } = await getScopedAdminSession(token, { scope: 'approvals' })
  if (session) {
    return { session, status: 200 }
  }
  return { session: null, error, status }
}

async function requireManageSession(request) {
  const { session, error, status } = await getManageSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }
  return session
}

async function requireApprovalAdminSession(request) {
  const session = await requireManageSession(request)
  if (session instanceof NextResponse) return session

  const removeAllowed = await canRemoveStudies(session)
  if (!removeAllowed) {
    return NextResponse.json(
      { ok: false, error: 'Only approval admins can remove studies.' },
      { status: 403, headers: CORS_HEADERS }
    )
  }
  return session
}

async function parseJsonBody(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

async function getStudyDocsForRemoval(id) {
  const resolvedId = await resolveTrialId(id)
  if (!resolvedId) return []

  const baseId = resolvedId.replace(/^drafts\./, '')
  const draftId = baseId ? `drafts.${baseId}` : ''
  const ids = Array.from(new Set([resolvedId, baseId, draftId].filter(Boolean)))
  const docs = await writeClient.fetch(
    `*[_type == "trialSummary" && _id in $ids]{ _id, title }`,
    { ids }
  )
  return Array.isArray(docs) ? docs : []
}

async function removeStudyDocs({ docs, removedByEmail }) {
  const studyIds = docs.map((doc) => doc?._id).filter(Boolean)
  const references = await writeClient.fetch(
    `{
      "submissions": *[_type == "studySubmission" && studyRef._ref in $ids]{ _id, status, studyRef },
      "referrals": *[_type == "studyReferral" && study._ref in $ids]{ _id, study }
    }`,
    { ids: studyIds }
  )
  const removedAt = new Date().toISOString()
  let transaction = writeClient.transaction()

  for (const submission of references?.submissions || []) {
    transaction = transaction.patch(submission._id, (patch) => {
      let nextPatch = patch.set({ studyRef: { ...submission.studyRef, _weak: true } })
      if (submission.status === 'pending') {
        nextPatch = nextPatch.set({
          status: 'superseded',
          supersededAt: removedAt,
          reviewedAt: removedAt,
          reviewedBy: removedByEmail || 'approval admin',
        })
      }
      return nextPatch
    })
  }

  for (const referral of references?.referrals || []) {
    transaction = transaction.patch(referral._id, (patch) =>
      patch.set({ study: { ...referral.study, _weak: true } })
    )
  }

  for (const doc of docs) {
    transaction = transaction.delete(doc._id)
  }

  await transaction.commit({ returnDocuments: false })
  return {
    removedIds: studyIds,
    submissionReferenceCount: references?.submissions?.length || 0,
    referralReferenceCount: references?.referrals?.length || 0,
  }
}

export async function GET(request) {
  let session = null
  if (!DEV_PREVIEW_MODE) {
    session = await requireManageSession(request)
    if (session instanceof NextResponse) return session
  } else {
    const result = await getManageSession(request)
    session = result.session
  }

  try {
    const [bypassApprovals, removeAllowed, trialsRaw, meta] = await Promise.all([
      canBypassApprovals(session),
      canRemoveStudies(session),
      freshFetch(STUDY_LIST_QUERY),
      loadMeta(),
    ])

    return NextResponse.json(
      {
        ok: true,
        trials: trialsRaw || [],
        meta,
        access: {
          canBypassApprovals: bypassApprovals,
          canRemoveStudies: removeAllowed,
        },
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[trials-manage] GET failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load studies' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function POST(request) {
  const session = await requireManageSession(request)
  if (session instanceof NextResponse) return session

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot write.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const payload = normalizeStudyPayload(await request.json())
    const meta = await loadMeta()
    const validationError = validateStudyPayload(payload, meta.sites)
    if (validationError) {
      return NextResponse.json(
        { ok: false, error: validationError },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const duplicate = await findDuplicateNctId({ nctId: payload.nctId })
    if (duplicate) {
      return NextResponse.json(
        { ok: false, error: 'A study with this NCT ID already exists.', duplicate },
        { status: 409, headers: CORS_HEADERS }
      )
    }

    const bypassApprovals = await canBypassApprovals(session)
    if (bypassApprovals) {
      const baseSlug = slugify(payload.slug || payload.title)
      if (!baseSlug) {
        return NextResponse.json(
          { ok: false, error: 'Slug is required to create a study.' },
          { status: 400, headers: CORS_HEADERS }
        )
      }
      const slugValue = await ensureUniqueSlug({ baseSlug, sanityFetch })
      const created = await writeClient.create(buildTrialSummaryDoc(payload, slugValue))
      revalidateStudyPages(slugValue)
      return NextResponse.json(
        { ok: true, studyId: created?._id, directPublish: true },
        { headers: CORS_HEADERS }
      )
    }

    const admins = await getApprovalAdmins()
    if (!admins.length) {
      return NextResponse.json(
        { ok: false, error: 'No approval admins configured. Update Site Settings in Sanity.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const submittedAt = new Date().toISOString()
    const submittedBy = {
      ip: getClientIp(request.headers),
      userAgent: request.headers.get('user-agent') || '',
      email: session?.email || '',
    }
    const submission = await writeClient.create({
      _type: 'studySubmission',
      title: payload.title,
      action: 'create',
      status: 'pending',
      submittedAt,
      submittedBy,
      payload,
    })

    await notifyAdmins({
      action: 'create',
      submissionId: submission?._id,
      payload,
      recipients: admins,
      submittedAt,
      submittedBy,
      supersededCount: 0,
      meta,
    })

    return NextResponse.json(
      { ok: true, submissionId: submission?._id, directPublish: false },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[trials-manage] POST failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to submit study' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function PATCH(request) {
  const session = await requireManageSession(request)
  if (session instanceof NextResponse) return session

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot write.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await request.json()
    const id = sanitizeString(body?.id)
    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'Study id is required.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const payload = normalizeStudyPayload(body)
    const meta = await loadMeta()
    const validationError = validateStudyPayload(payload, meta.sites)
    if (validationError) {
      return NextResponse.json(
        { ok: false, error: validationError },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const duplicate = await findDuplicateNctId({ nctId: payload.nctId, excludeId: id })
    if (duplicate) {
      return NextResponse.json(
        { ok: false, error: 'A study with this NCT ID already exists.', duplicate },
        { status: 409, headers: CORS_HEADERS }
      )
    }

    const bypassApprovals = await canBypassApprovals(session)
    if (bypassApprovals) {
      const resolvedId = await resolveTrialId(id)
      if (!resolvedId) {
        return NextResponse.json(
          { ok: false, error: 'Study not found. Refresh the list and try again.' },
          { status: 404, headers: CORS_HEADERS }
        )
      }
      let slugValue = null
      if (payload.slug || payload.title) {
        const baseSlug = slugify(payload.slug || payload.title)
        if (baseSlug) {
          slugValue = await ensureUniqueSlug({ baseSlug, excludeId: resolvedId, sanityFetch })
        }
      }
      await applyStudyPatch({
        writeClient,
        studyId: resolvedId,
        fields: buildPatchFields(payload, slugValue),
        unset: buildUnsetFields(),
      })
      // The admin's version already includes any pending change they built on.
      const { count: supersededCount, promise: supersedePromise } = await supersedePendingSubmissions({
        studyId: resolvedId,
        reviewedBy: session?.email,
      })
      await supersedePromise
      revalidateStudyPages(slugValue)
      return NextResponse.json(
        { ok: true, studyId: resolvedId, directPublish: true, supersededCount },
        { headers: CORS_HEADERS }
      )
    }

    // A coordinator's form starts from the latest pending change for the study.
    // If a newer one arrived since, refuse rather than silently supersede it.
    const basedOnSubmissionId = sanitizeString(body?.basedOnSubmissionId)
    const latestPending = await latestPendingSubmission(id)
    if ((latestPending?._id || '') !== basedOnSubmissionId) {
      return NextResponse.json(
        {
          ok: false,
          conflict: true,
          error: buildConflictMessage(latestPending),
          pendingSubmission: latestPending,
        },
        { status: 409, headers: CORS_HEADERS }
      )
    }

    const admins = await getApprovalAdmins()
    if (!admins.length) {
      return NextResponse.json(
        { ok: false, error: 'No approval admins configured. Update Site Settings in Sanity.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const currentStudy = await fetchCurrentStudy(id)
    const changes = currentStudy
      ? summarizeStudyChanges(normalizeStudyPayload(currentStudy), payload, { sites: meta.sites })
      : []

    const submittedAt = new Date().toISOString()
    const submittedBy = {
      ip: getClientIp(request.headers),
      userAgent: request.headers.get('user-agent') || '',
      email: session?.email || '',
    }
    const submission = await writeClient.create({
      _type: 'studySubmission',
      title: payload.title,
      action: 'update',
      status: 'pending',
      submittedAt,
      studyRef: { _type: 'reference', _ref: id },
      submittedBy,
      payload,
    })

    const { count: supersededCount, promise: supersedePromise } = await supersedePendingSubmissions({
      submissionId: submission?._id,
      studyId: id,
    })

    await notifyAdmins({
      action: 'update',
      submissionId: submission?._id,
      payload,
      recipients: admins,
      submittedAt,
      submittedBy,
      supersededCount,
      meta,
      changes,
    })
    await supersedePromise

    return NextResponse.json(
      { ok: true, submissionId: submission?._id, directPublish: false },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[trials-manage] PATCH failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to submit study' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function DELETE(request) {
  const session = await requireApprovalAdminSession(request)
  if (session instanceof NextResponse) return session

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot remove study.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await parseJsonBody(request)
    const id = sanitizeString(body?.id)
    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'Study id is required.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const docs = await getStudyDocsForRemoval(id)
    if (!docs.length) {
      return NextResponse.json(
        { ok: false, error: 'Study not found. Refresh the list and try again.' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    const publishedDoc = docs.find((doc) => !doc._id.startsWith('drafts.')) || docs[0]
    const result = await removeStudyDocs({ docs, removedByEmail: session?.email })
    revalidateStudyPages()

    return NextResponse.json(
      {
        ok: true,
        studyId: publishedDoc?._id,
        title: publishedDoc?.title || '',
        ...result,
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[trials-manage] DELETE failed', error)
    const message = String(error?.message || '')
    const isReferenceError = /reference|referenced|references/i.test(message)
    return NextResponse.json(
      {
        ok: false,
        error: isReferenceError
          ? 'Study could not be removed because it is still referenced by another document.'
          : 'Failed to remove study.',
      },
      { status: isReferenceError ? 409 : 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
