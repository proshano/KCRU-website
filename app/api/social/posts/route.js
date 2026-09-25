import { NextResponse } from 'next/server'

import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { sanityFetch, writeClient } from '@/lib/sanity'
import {
  SOCIAL_NETWORK_X,
  approveSocialPost,
  canManageSocialPosts,
  createBufferClient,
  restoreSocialPost,
  skipSocialPost,
} from '@/lib/socialPosting'
import {
  createSanitySocialPostStore,
  fetchSocialPostRecords,
  fetchSocialPostingSettings,
} from '@/lib/socialPostingStore'
import { sanitizeString } from '@/lib/studySubmissions'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')
const RECENT_LIMIT = 30
const ACTIONS = ['approve', 'skip', 'restore']

async function getSocialPostSession(request) {
  const sessionAccess = await getSessionAccess()
  if (sessionAccess) {
    if (canManageSocialPosts(sessionAccess.access)) {
      return { session: { email: sessionAccess.email }, status: 200 }
    }
    return { session: null, error: 'Not authorized to manage social media posts.', status: 403 }
  }

  const token = extractBearerToken(request)
  return getScopedAdminSession(token, { scope: 'approvals' })
}

function newestFirst(field) {
  return (left, right) => String(right[field] || '').localeCompare(String(left[field] || ''))
}

function actionTime(post) {
  return String(post.queuedAt || post.skippedAt || post.createdAt || '')
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const { session, error, status } = await getSocialPostSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  try {
    const fetchClient = writeClient.config().token ? writeClient : { fetch: sanityFetch }
    const [settings, records] = await Promise.all([
      fetchSocialPostingSettings(fetchClient),
      fetchSocialPostRecords(fetchClient, SOCIAL_NETWORK_X),
    ])
    const pending = records
      .filter((post) => post.status === 'pending')
      .sort((left, right) => newestFirst('createdAt')(left, right) || newestFirst('publishedAt')(left, right))
    const inProgress = records
      .filter((post) => post.status === 'sending')
      .sort(newestFirst('approvedAt'))
    const recent = records
      .filter((post) => post.status === 'queued' || post.status === 'skipped')
      .sort((left, right) => actionTime(right).localeCompare(actionTime(left)))
      .slice(0, RECENT_LIMIT)

    return NextResponse.json({
      ok: true,
      adminEmail: session.email,
      enabled: settings.postToX,
      pending,
      inProgress,
      recent,
    }, { headers: CORS_HEADERS })
  } catch (requestError) {
    console.error('[social-posting] GET failed', requestError)
    return NextResponse.json(
      { ok: false, error: requestError?.message || 'Failed to load social media posts.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function PATCH(request) {
  const { session, error, status } = await getSocialPostSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  try {
    const body = await request.json()
    const id = sanitizeString(body?.id)
    const action = sanitizeString(body?.action).toLowerCase()
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Social media post id is required.' }, { status: 400, headers: CORS_HEADERS })
    }
    if (!ACTIONS.includes(action)) {
      return NextResponse.json({ ok: false, error: 'Action must be approve, skip or restore.' }, { status: 400, headers: CORS_HEADERS })
    }
    if (!writeClient.config().token) {
      return NextResponse.json(
        { ok: false, error: 'SANITY_API_TOKEN missing; cannot save social media post decisions.' },
        { status: 500, headers: CORS_HEADERS }
      )
    }

    const store = createSanitySocialPostStore(writeClient)
    let result
    if (action === 'approve') {
      const apiKey = process.env.BUFFER_API_KEY
      if (!apiKey) {
        return NextResponse.json(
          { ok: false, error: 'BUFFER_API_KEY is not configured on the server' },
          { status: 500, headers: CORS_HEADERS }
        )
      }
      const settings = await fetchSocialPostingSettings(writeClient)
      result = await approveSocialPost({
        id,
        text: typeof body?.text === 'string' ? body.text : undefined,
        approverEmail: session.email,
        enabled: settings.postToX,
        store,
        buffer: createBufferClient({ apiKey }),
        preferredChannelId: sanitizeString(process.env.BUFFER_X_CHANNEL_ID),
      })
    } else if (action === 'skip') {
      result = await skipSocialPost({ id, actorEmail: session.email, store })
    } else {
      result = await restoreSocialPost({ id, actorEmail: session.email, store })
    }

    if (result.status >= 500) {
      console.error('[social-posting] PATCH failed', { id, action, status: result.status, message: result.message })
    }
    return NextResponse.json(result, { status: result.status || (result.ok ? 200 : 400), headers: CORS_HEADERS })
  } catch (requestError) {
    console.error('[social-posting] PATCH failed', requestError)
    return NextResponse.json(
      { ok: false, error: requestError?.message || 'Failed to save the social media post decision.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
