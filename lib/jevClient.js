import { buildOpenRouterAttributionHeaders } from './summaries.js'

/**
 * Minimal client for TypeSafe's System One API, whose first model is Jev.
 *
 * Jev does not generate text. A request carries one `state` (here: a publication) and a set
 * of named, typed questions; the response carries a probability for every question, all
 * evaluated in parallel against that state. Only the `noul` (yes/no) question type is used
 * here - see lib/jevClassifier.js.
 *
 * Two transports accept the same request body:
 *   - `typesafe`   POST https://api.typesafe.ai/v1/systemone      (TYPESAFE_API_KEY)
 *   - `openrouter` POST https://openrouter.ai/api/alpha/decisions  (OPENROUTER_API_KEY)
 * The body and response shapes mirror @typesafe-ai/sdk 0.6.0. A hand-rolled fetch keeps
 * this consistent with the other providers in lib/summaries.js and avoids a dependency
 * for what is still an evaluation.
 */

export const JEV_TRANSPORTS = Object.freeze(['typesafe', 'openrouter'])

const ENDPOINTS = Object.freeze({
  typesafe: 'https://api.typesafe.ai/v1/systemone',
  openrouter: 'https://openrouter.ai/api/alpha/decisions',
})

const DEFAULT_MODELS = Object.freeze({
  typesafe: 'jev-latest',
  openrouter: 'typesafe/jev-1.13',
})

const DEFAULT_TIMEOUT_MS = Number(process.env.JEV_TIMEOUT_MS || 20000)
const DEFAULT_RETRIES = 2
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504])

export function resolveJevTransport(override) {
  const requested = String(override || process.env.JEV_TRANSPORT || '').trim().toLowerCase()
  if (requested) {
    if (!JEV_TRANSPORTS.includes(requested)) {
      throw new Error(`Unknown Jev transport: ${requested}. Expected one of ${JEV_TRANSPORTS.join(', ')}.`)
    }
    return requested
  }
  if (process.env.TYPESAFE_API_KEY) return 'typesafe'
  if (process.env.OPENROUTER_API_KEY) return 'openrouter'
  return 'typesafe'
}

export function resolveJevApiKey(transport, override) {
  if (override) return override
  return transport === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.TYPESAFE_API_KEY
}

export function resolveJevModel(transport, override) {
  const requested = String(override || process.env.JEV_MODEL || '').trim()
  return requested || DEFAULT_MODELS[transport] || DEFAULT_MODELS.typesafe
}

/** Which transport and model a call would use, and whether a credential is present. */
export function describeJevConfig(options = {}) {
  const transport = resolveJevTransport(options.transport)
  return {
    transport,
    model: resolveJevModel(transport, options.model),
    endpoint: ENDPOINTS[transport],
    hasApiKey: Boolean(resolveJevApiKey(transport, options.apiKey)),
    apiKeyEnvVar: transport === 'openrouter' ? 'OPENROUTER_API_KEY' : 'TYPESAFE_API_KEY',
  }
}

function extractAnswerEnvelope(data) {
  for (const candidate of [data, data?.data, data?.result, data?.response]) {
    if (candidate && typeof candidate === 'object' && candidate.answers && typeof candidate.answers === 'object') {
      return candidate
    }
  }
  return null
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Ask Jev a set of questions about one state.
 *
 * @returns {{ model: string, answers: Record<string, { type: string, noul?: number }>, usage: { inputTokens: number, outputTokens: number }, latencyMs: number, transport: string }}
 */
export async function callJevSystemOne({ state, questions }, options = {}) {
  if (!questions || typeof questions !== 'object' || Object.keys(questions).length === 0) {
    throw new Error('Jev request needs at least one question.')
  }
  const transport = resolveJevTransport(options.transport)
  const apiKey = resolveJevApiKey(transport, options.apiKey)
  if (!apiKey) {
    const envVar = transport === 'openrouter' ? 'OPENROUTER_API_KEY' : 'TYPESAFE_API_KEY'
    throw new Error(`Missing ${envVar} for Jev transport "${transport}".`)
  }
  const model = resolveJevModel(transport, options.model)
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS
  const retries = Number.isInteger(options.retries) ? Math.max(0, options.retries) : DEFAULT_RETRIES
  const fetchImpl = options.fetch || globalThis.fetch

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    ...(transport === 'openrouter' ? buildOpenRouterAttributionHeaders() : {}),
  }
  const body = JSON.stringify({ model, state, questions })

  let lastError = null
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const started = Date.now()
    try {
      const response = await fetchImpl(ENDPOINTS[transport], {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      })
      const latencyMs = Date.now() - started
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        data = null
      }

      if (!response.ok) {
        const detail = data?.error?.message || data?.error || data?.detail || data?.message || text
        const error = new Error(`Jev request failed ${response.status}: ${String(detail || '').slice(0, 300)}`)
        error.status = response.status
        if (attempt < retries && RETRYABLE_STATUSES.has(response.status)) {
          lastError = error
          await sleep(500 * 2 ** attempt)
          continue
        }
        throw error
      }

      const envelope = extractAnswerEnvelope(data)
      if (!envelope) {
        throw new Error(`Jev response did not contain answers: ${text.slice(0, 200)}`)
      }
      const usage = envelope.usage || data?.usage || {}
      return {
        transport,
        model: envelope.model || data?.model || model,
        answers: envelope.answers,
        usage: {
          inputTokens: Number(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens) || 0,
          outputTokens: Number(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens) || 0,
        },
        latencyMs,
      }
    } catch (error) {
      const aborted = error?.name === 'AbortError'
      const wrapped = aborted ? new Error(`Jev request timed out after ${timeoutMs}ms`) : error
      if (attempt < retries && (aborted || !wrapped.status)) {
        lastError = wrapped
        await sleep(500 * 2 ** attempt)
        continue
      }
      throw wrapped
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error('Jev request failed')
}
