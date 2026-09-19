import {
  CLASSIFICATION_AXIS_KEYS,
  applyClassificationPrecedence,
  enforceCanonicalCategories,
} from './classificationTaxonomy.js'

/**
 * Turning Jev's per-tag probabilities into a classification.
 *
 * Browser-safe: the evaluation page calls this when a reviewer moves a threshold, so the
 * stored probabilities can be re-cut without another model call.
 */

export const DEFAULT_JEV_THRESHOLDS = Object.freeze({
  topics: 0.5,
  studyDesign: 0.5,
  methodologicalFocus: 0.5,
  exclude: 0.5,
})

export const JEV_THRESHOLD_KEYS = Object.freeze([...CLASSIFICATION_AXIS_KEYS, 'exclude'])

function clampProbability(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(1, Math.max(0, n))
}

/** Fill in missing thresholds from the defaults and clamp everything to [0, 1]. */
export function normalizeJevThresholds(overrides = {}) {
  const resolved = {}
  for (const key of JEV_THRESHOLD_KEYS) {
    resolved[key] = clampProbability(overrides?.[key], DEFAULT_JEV_THRESHOLDS[key])
  }
  return resolved
}

/**
 * Cut probabilities at the per-axis thresholds, then apply the taxonomy's precedence rules
 * and canonical-axis enforcement so the result has the same shape and guarantees as the
 * chat-model path.
 *
 * @param {Array<{ axis: string, tag: string, p: number }>} probabilities
 */
export function deriveClassificationFromProbabilities(probabilities = [], thresholds = DEFAULT_JEV_THRESHOLDS) {
  const cut = normalizeJevThresholds(thresholds)
  const raw = { topics: [], studyDesign: [], methodologicalFocus: [], exclude: false }
  for (const entry of probabilities || []) {
    const p = Number(entry?.p)
    if (!Number.isFinite(p)) continue
    if (entry.axis === 'exclude') {
      if (p >= cut.exclude) raw.exclude = true
      continue
    }
    if (!Array.isArray(raw[entry.axis])) continue
    if (p >= cut[entry.axis]) raw[entry.axis].push(entry.tag)
  }
  return enforceCanonicalCategories(applyClassificationPrecedence(raw))
}
