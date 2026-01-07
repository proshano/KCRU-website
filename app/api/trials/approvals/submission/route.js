import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { normalizeStudyPayload, sanitizeString } from '@/lib/studySubmissions'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')

async function getSession(request) {
  const sessionAccess = await getSessionAccess()
  if (sessionAccess) {
    if (hasRequiredAccess(sessionAccess.access, { approvals: true })) {
      return { session: { email: sessionAccess.email }, status: 200 }
    }
    return { session: null, error: 'Not authorized for study approvals.', status: 403 }
  }

  const token = extractBearerToken(request)
  return getScopedAdminSession(token, { scope: 'approvals' })
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const { session, error, status } = await getSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  const url = new URL(request.url)
  const submissionId = sanitizeString(url.searchParams.get('submissionId'))
  if (!submissionId) {
    return NextResponse.json(
      { ok: false, error: 'Submission id is required.' },
      { status: 400, headers: CORS_HEADERS }
    )
  }

  try {
    const [submission, areasRaw, researchersRaw] = await Promise.all([
      sanityFetch(
        `*[_type == "studySubmission" && _id == $id][0]{
          _id,
          title,
          action,
          status,
          submittedAt,
          submittedBy,
          payload
        }`,
        { id: submissionId }
      ),
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

    if (!submission?._id) {
      return NextResponse.json(
        { ok: false, error: 'Submission not found.' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    if (submission.status !== 'pending') {
      return NextResponse.json(
        { ok: false, error: 'Submission already reviewed.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    return NextResponse.json(
      {
        ok: true,
        adminEmail: session.email,
        submission,
        meta: {
          areas: areasRaw || [],
          researchers: researchersRaw || [],
        },
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[approvals-submission] GET failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load submission.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function PATCH(request) {
  const { session, error, status } = await getSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot edit submissions.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await request.json()
    const submissionId = sanitizeString(body?.submissionId)
    if (!submissionId) {
      return NextResponse.json(
        { ok: false, error: 'Submission id is required.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const payload = normalizeStudyPayload(body?.payload || body)
    if (!payload.title) {
      return NextResponse.json(
        { ok: false, error: 'Title is required.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }
    if (!payload.principalInvestigatorId && !payload.principalInvestigatorName) {
      return NextResponse.json(
        { ok: false, error: 'Principal investigator is required.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const submission = await sanityFetch(
      `*[_type == "studySubmission" && _id == $id][0]{ _id, status }`,
      { id: submissionId }
    )

    if (!submission?._id) {
      return NextResponse.json(
        { ok: false, error: 'Submission not found.' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    if (submission.status !== 'pending') {
      return NextResponse.json(
        { ok: false, error: 'Submission already reviewed.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    await writeClient
      .patch(submissionId)
      .set({
        title: payload.title,
        payload,
        editedAt: new Date().toISOString(),
        editedBy: session.email,
      })
      .commit({ returnDocuments: false })

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[approvals-submission] PATCH failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to update submission.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
