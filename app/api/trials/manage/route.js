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
const APPROVAL_BASE_URL = `${(process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')}/trials/approvals`
const APPROVAL_SESSION_TTL_HOURS = 8

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
  return `${APPROVAL_BASE_URL}?token=${token}`
}

async function notifyAdmins({ action, submissionId, payload, headers, recipients }) {
  const targets = recipients?.length ? recipients : await getApprovalAdmins()
  if (!targets.length) return

  const submittedAt = new Date().toISOString()
  const summary = {
    action,
    submittedAt,
    submissionId,
    title: payload.title || null,
    slug: payload.slug || null,
    nctId: payload.nctId || null,
    status: payload.status || null,
    studyType: payload.studyType || null,
    phase: payload.phase || null,
    sex: payload.sex || null,
    conditions: payload.conditions || [],
    therapeuticAreaIds: payload.therapeuticAreaIds || [],
    recruitmentSiteIds: payload.recruitmentSiteIds || [],
    principalInvestigatorId: payload.principalInvestigatorId || null,
    acceptsReferrals: payload.acceptsReferrals,
    featured: payload.featured,
    sponsorWebsite: payload.sponsorWebsite || null,
    duration: payload.duration || null,
    compensation: payload.compensation || null,
    laySummary: payload.laySummary || null,
    eligibilityOverview: payload.eligibilityOverview || null,
    inclusionCriteria: payload.inclusionCriteria || [],
    exclusionCriteria: payload.exclusionCriteria || [],
    whatToExpect: payload.whatToExpect || null,
    localContact: payload.localContact || null,
    meta: {
      ip: getClientIp(headers),
      userAgent: headers.get('user-agent') || null,
    },
  }

  const subject = `Study submission pending approval (${action})`
  const results = await Promise.allSettled(
    targets.map(async (to) => {
      const approvalLink = await createApprovalSessionLink(to)
      const text = [
        `A study submission requires approval (${action}).`,
        '',
        `Open approvals (valid for ${APPROVAL_SESSION_TTL_HOURS} hours): ${approvalLink}`,
        '',
        JSON.stringify(summary, null, 2),
      ].join('\n')
      const html = `
        <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5;">
          <p style="margin: 0 0 12px;"><strong>Study submission pending approval (${action})</strong></p>
          <p style="margin: 0 0 12px;">
            Open approvals (valid for ${APPROVAL_SESSION_TTL_HOURS} hours): <a href="${approvalLink}">${approvalLink}</a>
          </p>
          <pre style="white-space: pre-wrap; background: #f7f7f7; border: 1px solid #eee; padding: 12px; border-radius: 8px;">${JSON.stringify(summary, null, 2)}</pre>
        </div>
      `
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
  const auth = await requireCoordinatorSession(request)
  if (auth) return auth

  try {
    const [trialsRaw, areasRaw, researchersRaw, sitesRaw] = await Promise.all([
      sanityFetch(`
        *[_type == "trialSummary"] | order(status asc, title asc) {
          _id,
          nctId,
          title,
          "slug": slug.current,
          status,
          studyType,
          phase,
          conditions,
          laySummary,
          eligibilityOverview,
          inclusionCriteria,
          exclusionCriteria,
          sex,
          whatToExpect,
          duration,
          compensation,
          featured,
          sponsorWebsite,
          acceptsReferrals,
          localContact,
          "therapeuticAreaIds": therapeuticAreas[]._ref,
          "recruitmentSiteIds": recruitmentSites[]._ref,
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
      sanityFetch(`
        *[_type == "site" && active == true] | order(order asc, name asc) {
          _id,
          name,
          shortName,
          city
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
          sites: sitesRaw || [],
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
    const submission = await writeClient.create({
      _type: 'studySubmission',
      title: payload.title,
      action: 'create',
      status: 'pending',
      submittedAt,
      submittedBy: {
        ip: getClientIp(request.headers),
        userAgent: request.headers.get('user-agent') || '',
      },
      payload,
    })

    await notifyAdmins({
      action: 'create',
      submissionId: submission?._id,
      payload,
      headers: request.headers,
      recipients: admins,
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
    const submission = await writeClient.create({
      _type: 'studySubmission',
      title: payload.title,
      action: 'update',
      status: 'pending',
      submittedAt,
      studyRef: { _type: 'reference', _ref: id },
      submittedBy: {
        ip: getClientIp(request.headers),
        userAgent: request.headers.get('user-agent') || '',
      },
      payload,
    })

    await notifyAdmins({
      action: 'update',
      submissionId: submission?._id,
      payload,
      headers: request.headers,
      recipients: admins,
    })

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
