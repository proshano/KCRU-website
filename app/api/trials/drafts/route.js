import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { normalizeStudyPayload, sanitizeString } from '@/lib/studySubmissions'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
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
  return session
}

function normalizeDraftData(raw) {
  const normalized = normalizeStudyPayload(raw)
  return {
    ...normalized,
    id: sanitizeString(raw?.id),
    studyType: normalized.studyType || '',
    phase: normalized.phase || '',
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const session = await requireCoordinatorSession(request)
  if (session instanceof NextResponse) return session

  try {
    const email = sanitizeString(session.email)
    const draft = await sanityFetch(
      `*[_type == "studyDraft" && email == $email] | order(savedAt desc)[0]{
        _id,
        savedAt,
        data
      }`,
      { email }
    )
    return NextResponse.json({ ok: true, draft: draft || null }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[trials-drafts] GET failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load draft' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function POST(request) {
  const session = await requireCoordinatorSession(request)
  if (session instanceof NextResponse) return session

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot write.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await request.json()
    const raw = body?.data && typeof body.data === 'object' ? body.data : body
    const data = normalizeDraftData(raw)
    const savedAt = new Date().toISOString()
    const title = sanitizeString(raw?.title) || data.title || 'Untitled study'
    const email = sanitizeString(session.email)

    const existing = await sanityFetch(
      `*[_type == "studyDraft" && email == $email] | order(savedAt desc)[0]{ _id }`,
      { email }
    )

    let draft
    if (existing?._id) {
      draft = await writeClient
        .patch(existing._id)
        .set({ savedAt, title, email, data })
        .commit()
    } else {
      draft = await writeClient.create({
        _type: 'studyDraft',
        email,
        savedAt,
        title,
        data,
      })
    }

    return NextResponse.json(
      {
        ok: true,
        draft: {
          _id: draft?._id,
          savedAt: draft?.savedAt || savedAt,
          data: draft?.data || data,
        },
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[trials-drafts] POST failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to save draft' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function DELETE(request) {
  const session = await requireCoordinatorSession(request)
  if (session instanceof NextResponse) return session

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot write.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const email = sanitizeString(session.email)
    const drafts = await sanityFetch(
      `*[_type == "studyDraft" && email == $email]{ _id }`,
      { email }
    )
    if (Array.isArray(drafts) && drafts.length) {
      await Promise.allSettled(drafts.map((draft) => writeClient.delete(draft._id)))
    }
    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[trials-drafts] DELETE failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to delete draft' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
