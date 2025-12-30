import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { normalizeStudyPayload, sanitizeString } from '@/lib/studySubmissions'
import { getAdminSession } from '@/lib/adminSessions'

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
  return getAdminSession(token)
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
  const token = extractToken(request)
  const session = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
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
