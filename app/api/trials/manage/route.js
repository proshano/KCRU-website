import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'
import crypto from 'crypto'
import { normalizeStudyPayload, sanitizeString } from '@/lib/studySubmissions'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const FALLBACK_NOTIFY_EMAIL = (process.env.STUDY_EDITOR_NOTIFY_EMAIL || '').trim()
const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
const APPROVAL_BASE_URL = `${SITE_BASE_URL}/trials/approvals`
const APPROVAL_QUICK_BASE_URL = `${SITE_BASE_URL}/api/trials/approvals/quick`
const APPROVAL_SESSION_TTL_HOURS = 8
const DEV_PREVIEW_MODE = process.env.NODE_ENV !== 'production'

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

function getClientIp(headers) {
  const xfwd = headers.get('x-forwarded-for')
  if (xfwd) return xfwd.split(',')[0]?.trim()
  return headers.get('x-real-ip') || null
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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

function formatLocalContact(contact) {
  if (!contact) return 'None'
  const parts = []
  if (contact.name) parts.push(contact.name)
  if (contact.role) parts.push(contact.role)
  if (contact.email) parts.push(contact.email)
  if (contact.phone) parts.push(contact.phone)
  parts.push(`Public: ${formatBoolean(contact.displayPublicly)}`)
  return parts.length ? parts.join(' | ') : 'None'
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

async function createApprovalSessionLink(email) {
  const token = crypto.randomBytes(32).toString('hex')
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(Date.now() + APPROVAL_SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString()
  await writeClient.create({
    _type: 'studyApprovalSession',
    email,
    token,
    createdAt,
    expiresAt,
    revoked: false,
  })
  return {
    token,
    approvalLink: `${APPROVAL_BASE_URL}?token=${token}`,
  }
}

function buildApprovalEmail({
  action,
  approvalLink,
  approveLink,
  rejectLink,
  payload,
  submissionId,
  submittedAt,
  submittedByEmail,
  supersededCount,
  therapeuticAreaNames,
  principalInvestigatorName,
}) {
  const actionLabel = action === 'update' ? 'Update' : 'New study'
  const submittedAtLabel = formatDate(submittedAt)
  const inclusionCount = Array.isArray(payload.inclusionCriteria)
    ? payload.inclusionCriteria.length
    : 0
  const exclusionCount = Array.isArray(payload.exclusionCriteria)
    ? payload.exclusionCriteria.length
    : 0
  const inclusionLabel = inclusionCount
    ? `${inclusionCount} item${inclusionCount === 1 ? '' : 's'}`
    : 'None'
  const exclusionLabel = exclusionCount
    ? `${exclusionCount} item${exclusionCount === 1 ? '' : 's'}`
    : 'None'
  const inclusionItems = Array.isArray(payload.inclusionCriteria) ? payload.inclusionCriteria.filter(Boolean) : []
  const exclusionItems = Array.isArray(payload.exclusionCriteria) ? payload.exclusionCriteria.filter(Boolean) : []

  const resolvedAreas =
    Array.isArray(therapeuticAreaNames) && therapeuticAreaNames.length
      ? therapeuticAreaNames
      : payload.therapeuticAreaIds
  const therapeuticAreaLabel = Array.isArray(resolvedAreas) && resolvedAreas.length
    ? resolvedAreas.join(', ')
    : 'None'
  const detailRows = [
    ['Study title', payload.title || 'Untitled'],
    ['NCT ID', payload.nctId || 'None'],
    ['Status', payload.status || 'None'],
    ['Study type', payload.studyType || 'None'],
    ['Phase', payload.phase || 'None'],
    ['Slug', payload.slug || 'None'],
    ['Featured', formatBoolean(payload.featured)],
    ['Accepts referrals', formatBoolean(payload.acceptsReferrals)],
    ['Therapeutic areas', therapeuticAreaLabel],
    ['Principal investigator', principalInvestigatorName || payload.principalInvestigatorId || 'None'],
    ['Sponsor website', payload.sponsorWebsite || 'None'],
    ['Local contact', formatLocalContact(payload.localContact)],
    ['Inclusion criteria', inclusionLabel],
    ['Exclusion criteria', exclusionLabel],
  ]

  const notes = []
  if (supersededCount > 0) {
    notes.push(
      `Supersedes ${supersededCount} earlier pending submission${supersededCount === 1 ? '' : 's'}.`
    )
  }

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
    'Study details:',
    ...detailRows.map(([label, value]) => `- ${label}: ${value}`),
    '',
    'Summaries:',
    `- Clinical summary: ${truncateText(payload.laySummary, null)}`,
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

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5;">
      <h2 style="margin: 0 0 8px;">Study submission pending approval</h2>
      <p style="margin: 0 0 12px; color: #444;">
        <strong>Action:</strong> ${escapeHtml(actionLabel)}<br />
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
      <p style="margin: 0 0 16px;">
        <a href="${escapeHtml(approveLink)}" style="display: inline-block; padding: 10px 16px; background: #059669; color: #fff; text-decoration: none; border-radius: 6px;">
          Approve submission
        </a>
        <a href="${escapeHtml(rejectLink)}" style="display: inline-block; margin-left: 8px; padding: 10px 16px; border: 1px solid #dc2626; color: #dc2626; text-decoration: none; border-radius: 6px;">
          Reject submission
        </a>
      </p>
      <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
        <tbody>
          ${htmlRows}
        </tbody>
      </table>
      <h3 style="margin: 16px 0 6px; font-size: 14px;">Summaries</h3>
      <p style="margin: 0 0 8px;"><strong>Clinical summary:</strong><br />${formatParagraph(payload.laySummary, null)}</p>
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
    subject: `Study submission pending approval: ${actionLabel}`,
    text: textLines.join('\n'),
    html,
  }
}

async function supersedePendingSubmissions({ submissionId, studyId }) {
  if (!submissionId || !studyId) {
    return { count: 0, promise: Promise.resolve() }
  }
  const pending = await sanityFetch(
    `*[_type == "studySubmission" && status == "pending" && studyRef._ref == $studyId && _id != $submissionId] { _id }`,
    { studyId, submissionId }
  )
  if (!Array.isArray(pending) || !pending.length) {
    return { count: 0, promise: Promise.resolve() }
  }
  const supersededAt = new Date().toISOString()
  const promise = Promise.allSettled(
    pending.map((item) =>
      writeClient
        .patch(item._id)
        .set({
          status: 'superseded',
          supersededAt,
          supersededBy: { _type: 'reference', _ref: submissionId },
        })
        .commit({ returnDocuments: false })
    )
  )
  return { count: pending.length, promise }
}

async function resolvePayloadReferences(payload) {
  const areaIds = Array.isArray(payload?.therapeuticAreaIds)
    ? payload.therapeuticAreaIds.filter(Boolean)
    : []
  const principalInvestigatorId = payload?.principalInvestigatorId || ''
  const [areas, pi] = await Promise.all([
    areaIds.length
      ? sanityFetch(
          `*[_type == "therapeuticArea" && _id in $ids]{ _id, name, shortLabel }`,
          { ids: areaIds }
        )
      : Promise.resolve([]),
    principalInvestigatorId
      ? sanityFetch(
          `*[_type == "researcher" && _id == $id][0]{ _id, name }`,
          { id: principalInvestigatorId }
        )
      : Promise.resolve(null),
  ])

  const areaMap = new Map(
    (areas || []).map((area) => [
      area._id,
      area.shortLabel ? `${area.shortLabel} - ${area.name}` : area.name,
    ])
  )

  return {
    therapeuticAreaNames: areaIds.map((id) => areaMap.get(id) || id),
    principalInvestigatorName: pi?.name || '',
  }
}

async function notifyAdmins({
  action,
  submissionId,
  payload,
  recipients,
  submittedAt,
  submittedBy,
  supersededCount,
}) {
  const targets = recipients?.length ? recipients : await getApprovalAdmins()
  if (!targets.length) return
  const submittedByEmail = submittedBy?.email || ''
  const resolved = await resolvePayloadReferences(payload)
  const results = await Promise.allSettled(
    targets.map(async (to) => {
      const { token, approvalLink } = await createApprovalSessionLink(to)
      const encodedSubmissionId = encodeURIComponent(submissionId || '')
      const encodedToken = encodeURIComponent(token)
      const approveLink = `${APPROVAL_QUICK_BASE_URL}?token=${encodedToken}&submissionId=${encodedSubmissionId}&decision=approve`
      const rejectLink = `${APPROVAL_QUICK_BASE_URL}?token=${encodedToken}&submissionId=${encodedSubmissionId}&decision=reject`
      const { subject, text, html } = buildApprovalEmail({
        action,
        approvalLink,
        approveLink,
        rejectLink,
        payload,
        submissionId,
        submittedAt,
        submittedByEmail,
        supersededCount,
        therapeuticAreaNames: resolved.therapeuticAreaNames,
        principalInvestigatorName: resolved.principalInvestigatorName,
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

async function requireCoordinatorSession(request) {
  const token = extractToken(request)
  const session = await getCoordinatorSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }
  return null
}

export async function GET(request) {
  if (!DEV_PREVIEW_MODE) {
    const auth = await requireCoordinatorSession(request)
    if (auth) return auth
  }

  try {
    const [trialsRaw, areasRaw, researchersRaw] = await Promise.all([
      sanityFetch(`
        *[_type == "trialSummary"] | order(status asc, title asc) {
          _id,
          nctId,
          title,
          "slug": slug.current,
          status,
          studyType,
          phase,
          laySummary,
          inclusionCriteria,
          exclusionCriteria,
          featured,
          sponsorWebsite,
          acceptsReferrals,
          localContact,
          "therapeuticAreaIds": therapeuticAreas[]._ref,
          "principalInvestigatorId": principalInvestigator._ref
        }
      `),
      sanityFetch(`
        *[_type == "therapeuticArea" && active == true] | order(order asc, name asc) {
          _id,
          name,
          shortLabel
        }
      `),
      sanityFetch(`
        *[_type == "researcher"] | order(name asc) {
          _id,
          name,
          slug
        }
      `),
    ])

    return NextResponse.json(
      {
        ok: true,
        trials: trialsRaw || [],
        meta: {
          areas: areasRaw || [],
          researchers: researchersRaw || [],
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
  const auth = await requireCoordinatorSession(request)
  if (auth) return auth
  const session = await getCoordinatorSession(extractToken(request))

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot write.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const payload = normalizeStudyPayload(await request.json())
    if (!payload.title) {
      return NextResponse.json(
        { ok: false, error: 'Title is required.' },
        { status: 400, headers: CORS_HEADERS }
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

    const supersededCount = 0
    await notifyAdmins({
      action: 'create',
      submissionId: submission?._id,
      payload,
      recipients: admins,
      submittedAt,
      submittedBy,
      supersededCount,
    })

    return NextResponse.json({ ok: true, submissionId: submission?._id }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[trials-manage] POST failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to submit study' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function PATCH(request) {
  const auth = await requireCoordinatorSession(request)
  if (auth) return auth
  const session = await getCoordinatorSession(extractToken(request))

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
    if (!payload.title) {
      return NextResponse.json(
        { ok: false, error: 'Title is required.' },
        { status: 400, headers: CORS_HEADERS }
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
    })
    await supersedePromise

    return NextResponse.json({ ok: true, submissionId: submission?._id }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[trials-manage] PATCH failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to submit study' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
