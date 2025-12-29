import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'
import { reviewSubmission } from '@/lib/studyApprovals'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

async function getSession(token) {
  if (!token) return null
  const session = await sanityFetch(
    `*[_type == "studyApprovalSession" && token == $token][0]{ _id, email, expiresAt, revoked }`,
    { token }
  )
  if (!session || session.revoked) return null
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return null
  return session
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const token = extractToken(request)
  const session = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  try {
    const [submissionsRaw, areasRaw, researchersRaw] = await Promise.all([
      sanityFetch(`
        *[_type == "studySubmission"] | order(submittedAt desc) {
          _id,
          title,
          action,
          status,
          submittedAt,
          submittedBy,
          payload,
          "studyId": studyRef._ref,
          "supersedesCount": count(*[_type == "studySubmission" && supersededBy._ref == ^._id]),
          "study": studyRef->{
            _id,
            title,
            "slug": slug.current,
            status,
            nctId
          }
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

    const seenStudyIds = new Set()
    const latestSubmissions = []
    for (const submission of submissionsRaw || []) {
      if (submission.action === 'update' && submission.studyId) {
        if (seenStudyIds.has(submission.studyId)) continue
        seenStudyIds.add(submission.studyId)
      }
      latestSubmissions.push(submission)
    }

    return NextResponse.json(
      {
        ok: true,
        adminEmail: session.email,
        submissions: latestSubmissions,
        meta: {
          areas: areasRaw || [],
          researchers: researchersRaw || [],
        },
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[approvals] GET failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load submissions.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function PATCH(request) {
  const token = extractToken(request)
  const session = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot approve submissions.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await request.json()
    const submissionId = sanitizeString(body?.submissionId)
    const decision = sanitizeString(body?.decision)
    if (!submissionId || !decision) {
      return NextResponse.json(
        { ok: false, error: 'Submission id and decision are required.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (!['approve', 'reject'].includes(decision)) {
      return NextResponse.json(
        { ok: false, error: 'Decision must be approve or reject.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const result = await reviewSubmission({
      submissionId,
      decision,
      sessionEmail: session.email,
      sanityFetch,
      writeClient,
    })

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: result.status || 400, headers: CORS_HEADERS }
      )
    }

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[approvals] PATCH failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to review submission.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
