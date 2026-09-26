import { NextResponse } from 'next/server'

import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { getSiteBaseUrl } from '@/lib/seo'
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
  resolveSocialPostSystemPrompt,
  restoreSocialPost,
  saveSocialPostDraft,
  socialPostRefusal,
  undoSocialPost,
  validateSocialPostPrompt,
} from '@/lib/socialPosting'
import {
  createSanitySocialPostStore,
  fetchSocialPostPrompt,
  fetchSocialPostRecords,
  fetchSocialPostingSettings,
  resetSocialPostPrompt,
  resolveSocialPostSpotlight,
  saveSocialPostPrompt,
} from '@/lib/socialPostingStore'
import { sanitizeString } from '@/lib/studySubmissions'
import { DEFAULT_LLM_MODEL, SOCIAL_POST_SYSTEM_PROMPT, createSocialPostGenerateFn, resolveProviderApiKey } from '@/lib/summaries'

const CORS_HEADERS = buildCorsHeaders('GET, PATCH, OPTIONS')
const ACTIONS = ['draft', 'regenerate', 'save', 'discard', 'queue', 'undo', 'dismiss', 'restore', 'saveprompt', 'resetprompt']
const BUFFER_ACTIONS = ['queue', 'undo']
const PROMPT_ACTIONS = ['saveprompt', 'resetprompt']
const PROMPT_CONFLICT_MESSAGE = 'The drafting instructions were changed by someone else. Reload to see the latest version.'

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
    const [settings, fetchedRecords, promptDoc] = await Promise.all([
      fetchSocialPostingSettings(fetchClient),
      fetchSocialPostRecords(fetchClient, SOCIAL_NETWORK_X),
      fetchSocialPostPrompt(fetchClient),
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
      teamLabel: settings.teamLabel,
      prompt: {
        custom: promptDoc.custom,
        defaultPrompt: SOCIAL_POST_SYSTEM_PROMPT,
        effective: resolveSocialPostSystemPrompt(promptDoc.custom, SOCIAL_POST_SYSTEM_PROMPT),
        isCustom: Boolean(promptDoc.custom),
        updatedBy: promptDoc.updatedBy,
        updatedAt: promptDoc.updatedAt,
        rev: promptDoc.rev,
      },
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
    const rev = typeof body?.rev === 'string' ? body.rev : undefined
    if (!ACTIONS.includes(action)) {
      return respond(socialPostRefusal(400, `Action must be one of: ${ACTIONS.join(', ')}.`))
    }
    // The prompt actions edit a separate singleton document, not a social media post.
    if (!PROMPT_ACTIONS.includes(action) && !id) {
      return respond(socialPostRefusal(400, 'Social media post id is required.'))
    }
    if (!writeClient.config().token) {
      return respond(socialPostRefusal(500, 'SANITY_API_TOKEN missing; cannot save social media post changes.'))
    }
    const apiKey = process.env.BUFFER_API_KEY
    if (BUFFER_ACTIONS.includes(action) && !apiKey) {
      return respond(socialPostRefusal(500, 'BUFFER_API_KEY is not configured on the server, so posts cannot be queued in or removed from Buffer.'))
    }

    const actorEmail = session.email
    let result
    if (action === 'saveprompt') {
      const validation = validateSocialPostPrompt(text)
      if (!validation.ok) {
        result = socialPostRefusal(400, validation.error)
      } else {
        try {
          await saveSocialPostPrompt(writeClient, { text, actorEmail, rev, now: new Date() })
          result = { ok: true, status: 200, message: 'Drafting instructions saved. This applies to the next Create post or Regenerate.' }
        } catch (writeError) {
          if (!writeError?.conflict) throw writeError
          result = socialPostRefusal(409, PROMPT_CONFLICT_MESSAGE)
        }
      }
      return respond(result)
    }
    if (action === 'resetprompt') {
      try {
        await resetSocialPostPrompt(writeClient, { actorEmail, rev, now: new Date() })
        result = { ok: true, status: 200, message: 'Drafting instructions reset to the default.' }
      } catch (writeError) {
        if (!writeError?.conflict) throw writeError
        result = socialPostRefusal(409, PROMPT_CONFLICT_MESSAGE)
      }
      return respond(result)
    }

    const store = createSanitySocialPostStore(writeClient)
    if (action === 'draft' || action === 'regenerate') {
      const [settings, promptDoc] = await Promise.all([
        fetchSocialPostingSettings(writeClient),
        fetchSocialPostPrompt(writeClient),
      ])
      const provider = settings.llmProvider || process.env.LLM_PROVIDER || 'openrouter'
      const model = settings.llmModel || process.env.LLM_MODEL || DEFAULT_LLM_MODEL
      const systemPrompt = resolveSocialPostSystemPrompt(promptDoc.custom, SOCIAL_POST_SYSTEM_PROMPT)
      const generate = hasLlmCredential(provider)
        ? createSocialPostGenerateFn({ provider, model, systemPrompt })
        : null
      const regenerate = action === 'regenerate'
      result = await draftSocialPost({
        id,
        regenerate,
        actorEmail,
        enabled: settings.postToX,
        store,
        compose: async (post) => {
          // Link to one investigator's profile, anchored to the paper; if that cannot be
          // worked out, the post links to the paper itself.
          let spotlight = null
          try {
            spotlight = await resolveSocialPostSpotlight({ client: writeClient, post, regenerate, baseUrl: getSiteBaseUrl() })
          } catch (spotlightError) {
            console.error('[social-posting] Could not choose a profile to link; using the paper link', spotlightError)
          }
          const draft = await composeSocialPostDraft({
            post,
            link: spotlight?.link || post.link,
            teamLabel: settings.teamLabel,
            generate,
            llmLabel: `llm:${model}`,
          })
          return { ...draft, spotlight }
        },
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
