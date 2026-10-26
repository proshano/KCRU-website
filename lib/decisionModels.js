/**
 * The decision models publications can be classified with. Browser-safe: the evaluation page
 * lists them, and the server turns a stored choice into a transport and model through the
 * same table (describeDecisionModelConfig in lib/jevClient.js).
 *
 * `jev` keeps the configured Jev route: JEV_TRANSPORT / JEV_MODEL when set, else TypeSafe's
 * API when TYPESAFE_API_KEY is set, else typesafe/jev-1.13 on OpenRouter. Choosing it changes
 * nothing about how Jev is called. GPT-6 Luna Decisions is OpenAI's decision model, which
 * OpenRouter serves on the same Decisions endpoint and request format as Jev, so it needs no
 * credential beyond OPENROUTER_API_KEY.
 *
 * Prices are US dollars per million input tokens (neither model charges for output) and only
 * feed the evaluation page's cost estimate.
 */

export const DECISION_MODELS = Object.freeze([
  Object.freeze({
    key: 'jev',
    label: 'Jev (TypeSafe)',
    shortLabel: 'Jev',
    transport: null,
    model: null,
    // Jev's ids differ by transport: typesafe/jev-1.13 on OpenRouter, jev-latest or jev-1.13
    // from TypeSafe's own API.
    modelIdPrefixes: Object.freeze(['typesafe/jev', 'jev']),
    // TypeSafe's published early-access price (September 2026).
    usdPerMillionInputTokens: 0.042,
  }),
  Object.freeze({
    key: 'gpt-6-luna-decisions',
    label: 'GPT-6 Luna Decisions (OpenAI)',
    shortLabel: 'GPT-6 Luna',
    transport: 'openrouter',
    model: 'openai/gpt-6-luna-decisions',
    // Also matches dated ids such as openai/gpt-6-luna-decisions-20261006.
    modelIdPrefixes: Object.freeze(['openai/gpt-6-luna-decisions']),
    // OpenRouter's listing (October 2026), the same as OpenAI's own Decisions API.
    usdPerMillionInputTokens: 0.1,
  }),
])

export const DECISION_MODEL_KEYS = Object.freeze(DECISION_MODELS.map((entry) => entry.key))
export const DEFAULT_DECISION_MODEL = 'jev'

export function isDecisionModelKey(value) {
  return DECISION_MODEL_KEYS.includes(String(value || '').trim().toLowerCase())
}

/** A stored or requested choice, with anything unrecognised read as the default (Jev). */
export function normalizeDecisionModel(value) {
  const key = String(value || '').trim().toLowerCase()
  return DECISION_MODEL_KEYS.includes(key) ? key : DEFAULT_DECISION_MODEL
}

export function getDecisionModel(key) {
  const normalized = normalizeDecisionModel(key)
  return DECISION_MODELS.find((entry) => entry.key === normalized)
}

/**
 * The entry a model id belongs to, such as the id a response reported or an evaluation run
 * stored. Null for a model outside the table.
 */
export function findDecisionModelByModelId(modelId) {
  const id = String(modelId || '').trim().toLowerCase()
  if (!id) return null
  return DECISION_MODELS.find((entry) => entry.modelIdPrefixes.some((prefix) => id.startsWith(prefix))) || null
}
