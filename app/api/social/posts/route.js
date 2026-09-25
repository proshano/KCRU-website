import { NextResponse } from 'next/server'

import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { resolveSiteTitle } from '@/lib/seo'
import { composeSocialPostDraft } from '@/lib/socialPostDrafting'
import {
  SOCIAL_NETWORK_X,
  canManageSocialPosts,
  createBufferClient,
  discardSocialPostDraft,
  dismissSocialPost,
  draftSocialPost,
  groupSocialPostsForPortal,
  queueSocialPost,
  refreshQueuedSocialPosts,
  restoreSocialPost,
  saveSocialPostDraft,
  socialPostRefusal,
  undoSocialPost,
} from '@/lib/socialPosting'
import {
  createSanitySocialPostStore,
  fetchSocialPostRecords,
  fetchSocialPostingSettings,
} from '@/lib/socialPostingStore'
import { sanitizeString } from '@/lib/studySubmissions'
import { DEFAULT_LLM_MODEL, generateSocialPostText, resolveProviderApiKey } from '@/lib/summaries'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')
const ACTIONS = ['draft', 'regenerate', 'save', 'discard', 'queue', 'undo', 'dismiss', 'restore']
const BUFFER_ACTIONS = ['queue', 'undo']

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

function hasLlmCredential(provider) {
  if (provider === 'ollama') return true
  try {
    return Boolean(resolveProviderApiKey(provider))
  } catch {
    return false
  }
}

function respond(result) {
  return NextResponse.json(result, { status: result.status || (result.ok ? 200 : 400), headers: CORS_HEADERS })
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
    const canWrite = Boolean(writeClient.config().token)
    const fetchClient = canWrite ? writeClient : { fetch: sanityFetch }
    const [settings, fetchedRecords] = await Promise.all([
      fetchSocialPostingSettings(fetchClient),
      fetchSocialPostRecords(fetchClient, SOCIAL_NETWORK_X),
    ])

    // Check queued posts in Buffer so the page shows what has been published.
    // A failure here only adds a warning; the page still loads.
    let records = fetchedRecords
    let bufferStatusWarning = null
    const apiKey = process.env.BUFFER_API_KEY
    if (apiKey && canWrite) {
      try {
        const refresh = await refreshQueuedSocialPosts({
          records,
          store: createSanitySocialPostStore(writeClient),
          buffer: createBufferClient({ apiKey }),
        })
        records = refresh.records
        bufferStatusWarning = refresh.warning
      } catch (refreshError) {
        console.error('[social-posting] Buffer status refresh failed', refreshError)
        bufferStatusWarning = `Could not check Buffer for the latest status of queued posts: ${refreshError?.message || 'unknown error'}`
      }
    }

    return NextResponse.json({
      ok: true,
      adminEmail: session.email,
      enabled: settings.postToX,
      ...groupSocialPostsForPortal(records),
      ...(bufferStatusWarning ? { bufferStatusWarning } : {}),
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
    const text = typeof body?.text === 'string' ? body.text : undefined
    if (!id) return respond(socialPostRefusal(400, 'Social media post id is required.'))
    if (!ACTIONS.includes(action)) {
      return respond(socialPostRefusal(400, `Action must be one of: ${ACTIONS.join(', ')}.`))
    }
    if (!writeClient.config().token) {
      return respond(socialPostRefusal(500, 'SANITY_API_TOKEN missing; cannot save social media post changes.'))
    }
    const apiKey = process.env.BUFFER_API_KEY
    if (BUFFER_ACTIONS.includes(action) && !apiKey) {
      return respond(socialPostRefusal(500, 'BUFFER_API_KEY is not configured on the server, so posts cannot be queued in or removed from Buffer.'))
    }

    const store = createSanitySocialPostStore(writeClient)
    const actorEmail = session.email
    let result
    if (action === 'draft' || action === 'regenerate') {
      const settings = await fetchSocialPostingSettings(writeClient)
      const provider = settings.llmProvider || process.env.LLM_PROVIDER || 'openrouter'
      const model = settings.llmModel || process.env.LLM_MODEL || DEFAULT_LLM_MODEL
      const siteTitle = resolveSiteTitle({ seo: { title: settings.seoTitle }, unitName: settings.unitName })
      const generate = hasLlmCredential(provider)
        ? (input) => generateSocialPostText(input, { provider, model })
        : null
      result = await draftSocialPost({
        id,
        regenerate: action === 'regenerate',
        actorEmail,
        enabled: settings.postToX,
        store,
        compose: (post) => composeSocialPostDraft({
          post,
          intro: settings.xIntro,
          siteTitle,
          generate,
          llmLabel: `llm:${model}`,
        }),
      })
    } else if (action === 'queue') {
      const settings = await fetchSocialPostingSettings(writeClient)
      result = await queueSocialPost({
        id,
        text,
        actorEmail,
        enabled: settings.postToX,
        store,
        buffer: createBufferClient({ apiKey }),
        preferredChannelId: sanitizeString(process.env.BUFFER_X_CHANNEL_ID),
      })
    } else if (action === 'undo') {
      // Deliberately not gated on the Site Settings switch: a queued post can
      // always be pulled back.
      result = await undoSocialPost({ id, actorEmail, store, buffer: createBufferClient({ apiKey }) })
    } else if (action === 'save') {
      result = await saveSocialPostDraft({ id, text, store })
    } else if (action === 'discard') {
      result = await discardSocialPostDraft({ id, store })
    } else if (action === 'dismiss') {
      result = await dismissSocialPost({ id, actorEmail, store })
    } else {
      result = await restoreSocialPost({ id, store })
    }

    if (result.status >= 500) {
      console.error('[social-posting] PATCH failed', { id, action, status: result.status, message: result.message })
    }
    return respond(result)
  } catch (requestError) {
    console.error('[social-posting] PATCH failed', requestError)
    return respond(socialPostRefusal(500, requestError?.message || 'Failed to save the social media post change.'))
  }
}

// Drafting waits on the LLM (up to two attempts), so allow more than the default.
export const maxDuration = 60
export const dynamic = 'force-dynamic'
