import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { handleRejectedSubmission, reviewSubmission } from '@/lib/studyApprovals'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')

async function getSession(token) {
  return getScopedAdminSession(token, { scope: 'approvals' })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const token = extractBearerToken(request)
  const { session, error, status } = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  try {
    const freshFetch = writeClient.config().token
      ? (query, params) => writeClient.fetch(query, params)
      : sanityFetch
    const [submissionsRaw, areasRaw, researchersRaw] = await Promise.all([
      freshFetch(`
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
  const token = extractBearerToken(request)
  const { session, error, status } = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
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

    if (decision === 'reject') {
      try {
        await handleRejectedSubmission({ submission: result.submission, sanityFetch, writeClient })
      } catch (error) {
        console.error('[approvals] rejection email failed', error)
      }
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
