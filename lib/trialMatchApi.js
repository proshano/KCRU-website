import { claimSecurityRateLimit, getRateLimitResponseDetails } from './securityRateLimit.js'
import { isTrialMatchingAssistantEnabled, resolveTrialMatchingLlmOptions } from './trialMatchingSettings.js'
import { getTrustedClientIp } from './trialMatchRequest.js'

/**
 * Shared plumbing for the trial matching assistant's public routes (`chat` and `rank`): the rate
 * limits, the body bounds, and the Sanity context both routes need before they can do any work.
 * Patient details never leave the request; nothing here writes them anywhere.
 */

export const MAX_MESSAGES = 12
export const MAX_MESSAGE_LENGTH = 600
export const MAX_REQUEST_BODY_BYTES = 32 * 1024
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
/**
 * Per-origin budget. A turn that produces results costs two requests (the chat turn, then the
 * ranking), so this sits above the 20 that the single-request flow allowed.
 */
export const MAX_REQUESTS_PER_WINDOW = 30
export const GLOBAL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
export const MAX_GLOBAL_REQUESTS_PER_WINDOW = 500

export const UNAVAILABLE_ERROR = 'The trial matching assistant is temporarily unavailable.'
export const DISABLED_ERROR = 'The trial conversational assistant is currently unavailable.'
export const NO_STUDIES_REPLY =
  'No active studies are available for the matching assistant yet. Please browse the studies page or contact the research team.'

/**
 * A JSON response with caching disabled. The standard `Response` rather than `NextResponse` so
 * this module, and the routes' plumbing, can be exercised by `node --test` without Next.
 */
export function buildTrialMatchResponse(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      ...headers,
    },
  })
}

/**
 * Claims the per-origin and aggregate rate limits. Resolves to null when the request may proceed,
 * or to the response to send instead.
 *
 * The origin claim runs first and the aggregate claim only once it has passed. Running the two
 * concurrently was tried and reverted: a single throttled origin would then still spend one
 * aggregate claim per attempt, and could spend the whole shared hourly budget while being told
 * to slow down, locking everyone else out. `client` is for tests.
 */
export async function claimTrialMatchRateLimits(request, { label = 'trial-match', client } = {}) {
  try {
    await claimSecurityRateLimit({
      namespace: 'trial-match-origin',
      key: getTrustedClientIp(request.headers),
      limit: MAX_REQUESTS_PER_WINDOW,
      windowMs: RATE_LIMIT_WINDOW_MS,
      minimumIntervalMs: 500,
      client,
    })
    await claimSecurityRateLimit({
      namespace: 'trial-match-global',
      key: 'all-public-callers',
      limit: MAX_GLOBAL_REQUESTS_PER_WINDOW,
      windowMs: GLOBAL_RATE_LIMIT_WINDOW_MS,
      minimumIntervalMs: 50,
      client,
    })
    return null
  } catch (error) {
    const rateLimit = getRateLimitResponseDetails(error)
    if (!rateLimit) {
      console.error(`[${label}] rate-limit check failed`, error)
      return buildTrialMatchResponse({ ok: false, error: UNAVAILABLE_ERROR }, 503)
    }
    return buildTrialMatchResponse(
      { ok: false, error: 'Too many requests. Please wait a few minutes before trying again.' },
      rateLimit.status,
      { 'Retry-After': String(rateLimit.retryAfter) }
    )
  }
}

/** Reads and bounds the JSON body. Resolves to `{ body }`, or `{ response }` when it was refused. */
export async function readTrialMatchBody(request) {
  const invalid = () => ({ response: buildTrialMatchResponse({ ok: false, error: 'Invalid JSON payload.' }, 400) })
  const tooLarge = () => ({ response: buildTrialMatchResponse({ ok: false, error: 'Request payload is too large.' }, 413) })
  try {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) return tooLarge()
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BODY_BYTES) return tooLarge()
    if (!rawBody.trim()) return invalid()
    return { body: JSON.parse(rawBody) }
  } catch {
    return invalid()
  }
}

/**
 * Site settings and the recruiting roster, loaded together. The Sanity client is imported here
 * rather than at the top because it throws without the project environment variables, which
 * would keep this module's other functions out of `node --test`; lib/securityRateLimit.js does
 * the same.
 */
export async function loadTrialMatchContext() {
  const { queries, sanityFetch } = await import('./sanity.js')
  const [settingsRaw, studiesRaw] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.trialMatchingStudies),
  ])
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const studies = JSON.parse(JSON.stringify(studiesRaw || []))
  return {
    settings,
    studies,
    enabled: isTrialMatchingAssistantEnabled(settings),
    llmOptions: resolveTrialMatchingLlmOptions(settings),
  }
}

/**
 * Everything a route needs before it can start, gathered in one round of concurrent calls: the
 * rate-limit claims, the body, and the Sanity context. The Sanity reads used to wait for both
 * claims to finish, which put four sequential Sanity round trips in front of every turn; now
 * they run alongside them. Resolves to `{ body, context }`, or `{ response }` when the request
 * stops here.
 */
export async function prepareTrialMatchRequest(request, { label = 'trial-match' } = {}) {
  try {
    const [rateLimitResponse, bodyResult, context] = await Promise.all([
      claimTrialMatchRateLimits(request, { label }),
      readTrialMatchBody(request),
      loadTrialMatchContext(),
    ])
    if (rateLimitResponse) return { response: rateLimitResponse }
    if (bodyResult.response) return { response: bodyResult.response }
    if (!context.enabled) return { response: buildTrialMatchResponse({ ok: false, error: DISABLED_ERROR }, 503) }
    return { body: bodyResult.body, context }
  } catch (error) {
    console.error(`[${label}] request setup failed`, error)
    return { response: buildTrialMatchResponse({ ok: false, error: UNAVAILABLE_ERROR }, 503) }
  }
}
