/**
 * Negative cache for the DOI abstract backfill.
 *
 * A stable minority of DOIs have no abstract in any source we can reach: conference
 * abstracts, meeting supplements and research letters are indexed with metadata only.
 * Without this history the scheduled refresh re-attempted every one of them daily -
 * including a headless browser fetch per DOI that publisher bot protection reliably
 * blocked - which cost minutes of runtime per run and consumed the per-run backfill
 * budget that newly discovered papers need.
 *
 * Entries record when a DOI last exhausted every source, so it is only retried once
 * the retry interval has elapsed. Entries are dropped as soon as the DOI stops being
 * a backfill candidate, so a paper that later gains an abstract leaves no residue.
 */

import { normalizeDoi, toSanityPublicationKey } from './publicationIdentity.js'

const DEFAULT_RETRY_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000

// Bounds the stored array so a runaway candidate list cannot bloat the cache document.
const MAX_HISTORY_ENTRIES = 1000

export const DOI_BACKFILL_RETRY_INTERVAL_MS = (() => {
  const raw = process.env.PUBMED_DOI_ABSTRACT_RETRY_INTERVAL_MS
  if (!raw) return DEFAULT_RETRY_INTERVAL_MS
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RETRY_INTERVAL_MS
})()

function toTimestamp(value) {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Build a doi -> entry map from the array stored on the cache document.
 */
export function parseBackfillHistory(entries = []) {
  const history = new Map()
  if (!Array.isArray(entries)) return history

  for (const entry of entries) {
    const doi = normalizeDoi(entry?.doi)
    if (!doi) continue
    const attempts = Number(entry?.attempts)
    history.set(doi, {
      doi,
      lastAttemptedAt: entry?.lastAttemptedAt || null,
      attempts: Number.isFinite(attempts) && attempts > 0 ? Math.floor(attempts) : 1,
    })
  }
  return history
}

/**
 * Serialize back to a deterministic array. Sorting by DOI keeps the stored value stable
 * across runs so an unchanged history does not register as a document change.
 *
 * The size backstop drops the least recently attempted entries first, so if the cap is
 * ever reached the DOIs that keep failing are the ones that stay deferred.
 */
export function serializeBackfillHistory(history) {
  const entries = history instanceof Map ? Array.from(history.values()) : []
  return entries
    .filter((entry) => entry?.doi)
    .sort((a, b) => (toTimestamp(b.lastAttemptedAt) || 0) - (toTimestamp(a.lastAttemptedAt) || 0))
    .slice(0, MAX_HISTORY_ENTRIES)
    .sort((a, b) => a.doi.localeCompare(b.doi))
    .map((entry) => ({
      doi: entry.doi,
      lastAttemptedAt: entry.lastAttemptedAt || null,
      attempts: entry.attempts,
    }))
}

/**
 * True when the DOI has never failed, or its retry interval has elapsed.
 */
export function shouldAttemptBackfill(history, doi, {
  now = Date.now(),
  retryIntervalMs = DOI_BACKFILL_RETRY_INTERVAL_MS,
} = {}) {
  const key = normalizeDoi(doi)
  if (!key) return false

  const entry = history instanceof Map ? history.get(key) : null
  if (!entry) return true

  const lastAttempt = toTimestamp(entry.lastAttemptedAt)
  if (lastAttempt === null) return true

  return now - lastAttempt >= retryIntervalMs
}

export function recordBackfillFailure(history, doi, { now = Date.now() } = {}) {
  const key = normalizeDoi(doi)
  if (!key || !(history instanceof Map)) return history

  const existing = history.get(key)
  history.set(key, {
    doi: key,
    lastAttemptedAt: new Date(now).toISOString(),
    attempts: (existing?.attempts || 0) + 1,
  })
  return history
}

export function clearBackfillFailure(history, doi) {
  const key = normalizeDoi(doi)
  if (!key || !(history instanceof Map)) return history
  history.delete(key)
  return history
}

/**
 * Drop entries for DOIs that are no longer backfill candidates - they either gained a
 * usable abstract or left the publication set entirely.
 */
export function pruneBackfillHistory(history, activeDois) {
  if (!(history instanceof Map)) return new Map()
  const active = new Set(
    Array.from(activeDois || [])
      .map((value) => normalizeDoi(value))
      .filter(Boolean)
  )

  for (const doi of Array.from(history.keys())) {
    if (!active.has(doi)) history.delete(doi)
  }
  return history
}

/**
 * Convert to the Sanity array shape. Every writer that replaces the whole cache document
 * has to include this field, otherwise the history is silently dropped.
 */
export function toSanityBackfillFailures(entries) {
  if (!Array.isArray(entries)) return []
  return entries
    .filter((entry) => entry?.doi)
    .map((entry) => ({
      _key: toSanityPublicationKey({ doi: entry.doi }, 'doi-backfill'),
      doi: entry.doi,
      lastAttemptedAt: entry.lastAttemptedAt || null,
      attempts: Number(entry.attempts) || 1,
    }))
}

/**
 * Compare two serialized histories so callers can skip a pointless cache write.
 */
export function backfillHistoryChanged(before = [], after = []) {
  const left = Array.isArray(before) ? serializeBackfillHistory(parseBackfillHistory(before)) : []
  const right = Array.isArray(after) ? after : []
  if (left.length !== right.length) return true

  for (let i = 0; i < left.length; i += 1) {
    if (
      left[i].doi !== right[i].doi ||
      left[i].lastAttemptedAt !== right[i].lastAttemptedAt ||
      left[i].attempts !== right[i].attempts
    ) {
      return true
    }
  }
  return false
}
