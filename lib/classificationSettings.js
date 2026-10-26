import { DEFAULT_DECISION_MODEL, normalizeDecisionModel } from './decisionModels.js'
import { JEV_THRESHOLD_KEYS } from './jevDecisions.js'

/**
 * Staff-editable choice of publication classifier, decision model and thresholds, stored on
 * `siteSettings.publicationClassification`. Browser-safe.
 *
 * `backend` picks the system that assigns tags: the chat model (the original path through
 * classifyPublication) or a decision model (the value `jev` dates from when Jev was the only
 * one). `decisionModel` picks which decision model (lib/decisionModels.js); a missing value
 * means Jev. Thresholds only matter for a decision model. Sanity values win over the
 * JEV_THRESHOLD_* env vars, which win over the 0.5 defaults - see resolveJevThresholds.
 */

export const CLASSIFICATION_BACKENDS = Object.freeze(['chat', 'jev'])
export const DEFAULT_CLASSIFICATION_BACKEND = 'chat'

const THRESHOLD_FIELDS = Object.freeze({
  topics: 'jevThresholdTopics',
  studyDesign: 'jevThresholdStudyDesign',
  methodologicalFocus: 'jevThresholdMethodologicalFocus',
  exclude: 'jevThresholdExclude',
})

export const JEV_THRESHOLD_FIELD_NAMES = Object.freeze(Object.values(THRESHOLD_FIELDS))

function clampProbability(value) {
  const n = Number(value)
  if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return null
  return Math.min(1, Math.max(0, n))
}

export function normalizeClassificationBackend(value) {
  const backend = String(value || '').trim().toLowerCase()
  return CLASSIFICATION_BACKENDS.includes(backend) ? backend : DEFAULT_CLASSIFICATION_BACKEND
}

/**
 * Read the block off a siteSettings document. `thresholds` holds only the axes staff have
 * set, so the caller can layer env and defaults underneath.
 */
export function resolvePublicationClassificationSettings(siteSettings) {
  const block = siteSettings?.publicationClassification || {}
  const thresholds = {}
  for (const key of JEV_THRESHOLD_KEYS) {
    const value = clampProbability(block[THRESHOLD_FIELDS[key]])
    if (value !== null) thresholds[key] = value
  }
  return {
    backend: normalizeClassificationBackend(block.backend),
    backendUpdatedAt: block.backendUpdatedAt || null,
    backendUpdatedBy: block.backendUpdatedBy || null,
    decisionModel: normalizeDecisionModel(block.decisionModel),
    thresholds,
    thresholdsSource: block.thresholdsSource || null,
    thresholdsUpdatedAt: block.thresholdsUpdatedAt || null,
    // The decision model whose probabilities the thresholds were tuned on. Thresholds applied
    // before there was a choice of model came from Jev runs.
    thresholdsDecisionModel: block.thresholdsDecisionModel
      ? normalizeDecisionModel(block.thresholdsDecisionModel)
      : block.thresholdsUpdatedAt ? DEFAULT_DECISION_MODEL : null,
  }
}

/**
 * Build the next value of the block from a partial update. Only fields present in `input`
 * change; thresholds are clamped to [0, 1] and an unparseable value leaves the field alone.
 */
export function buildPublicationClassificationPatch(input = {}, current = {}, { now = new Date() } = {}) {
  const next = { ...current }
  // Switching the classifier and switching its decision model are recorded the same way.
  let classifierChanged = false
  if ('backend' in input) {
    const backend = normalizeClassificationBackend(input.backend)
    if (backend !== normalizeClassificationBackend(current.backend)) classifierChanged = true
    next.backend = backend
  }
  if ('decisionModel' in input) {
    const decisionModel = normalizeDecisionModel(input.decisionModel)
    if (decisionModel !== normalizeDecisionModel(current.decisionModel)) classifierChanged = true
    next.decisionModel = decisionModel
  }
  if (classifierChanged) {
    next.backendUpdatedAt = now.toISOString()
    next.backendUpdatedBy = typeof input.backendUpdatedBy === 'string' && input.backendUpdatedBy.trim()
      ? input.backendUpdatedBy.trim().slice(0, 200)
      : null
  }

  let thresholdsChanged = false
  if (input.thresholds && typeof input.thresholds === 'object') {
    for (const key of JEV_THRESHOLD_KEYS) {
      if (!(key in input.thresholds)) continue
      const value = clampProbability(input.thresholds[key])
      if (value === null) continue
      next[THRESHOLD_FIELDS[key]] = value
      thresholdsChanged = true
    }
  }
  if (thresholdsChanged) {
    next.thresholdsUpdatedAt = now.toISOString()
    next.thresholdsSource = typeof input.thresholdsSource === 'string' && input.thresholdsSource.trim()
      ? input.thresholdsSource.trim().slice(0, 200)
      : null
    if (input.thresholdsDecisionModel) next.thresholdsDecisionModel = normalizeDecisionModel(input.thresholdsDecisionModel)
    else delete next.thresholdsDecisionModel
  }
  return next
}
