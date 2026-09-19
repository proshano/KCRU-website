import { JEV_THRESHOLD_KEYS } from './jevDecisions.js'

/**
 * Staff-editable choice of publication classifier and Jev thresholds, stored on
 * `siteSettings.publicationClassification`. Browser-safe.
 *
 * `backend` picks the system that assigns tags: the chat model (the original path through
 * classifyPublication) or Jev. Thresholds only matter for Jev. Sanity values win over the
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
    thresholds,
    thresholdsSource: block.thresholdsSource || null,
    thresholdsUpdatedAt: block.thresholdsUpdatedAt || null,
  }
}

/**
 * Build the next value of the block from a partial update. Only fields present in `input`
 * change; thresholds are clamped to [0, 1] and an unparseable value leaves the field alone.
 */
export function buildPublicationClassificationPatch(input = {}, current = {}, { now = new Date() } = {}) {
  const next = { ...current }
  if ('backend' in input) {
    const backend = normalizeClassificationBackend(input.backend)
    if (backend !== normalizeClassificationBackend(current.backend)) {
      next.backendUpdatedAt = now.toISOString()
      next.backendUpdatedBy = typeof input.backendUpdatedBy === 'string' && input.backendUpdatedBy.trim()
        ? input.backendUpdatedBy.trim().slice(0, 200)
        : null
    }
    next.backend = backend
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
  }
  return next
}
