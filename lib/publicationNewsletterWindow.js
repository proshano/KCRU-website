/**
 * The publication newsletter's send window.
 *
 * One timestamp, site-wide, recorded when a newsletter goes out. It answers both questions
 * a run has to ask: whether to send at all, and what the issue should cover.
 *
 * The alternative - measuring from each subscriber's own last email - makes recipients
 * drift apart, so the same issue covers a different span for different people and anyone
 * who joined mid-cycle silently receives a shorter one. A global timestamp keeps every
 * issue identical, which is what a "recent publications from your colleagues" newsletter
 * is meant to be.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function parseLastGlobalSentAt(settings) {
  const raw = settings?.lastGlobalSentAt
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Whether enough time has passed since the last send to run another one.
 *
 * The nth-weekday check alone lands on every 3rd Monday, which are 28 or 35 days apart.
 * Gating on elapsed days as well is what produces the configured cadence: consecutive
 * 3rd Mondays are always 28 or 35 days apart, and skipping one is always 56 or 63, so any
 * windowDays from 35 to 55 suppresses every single interval and admits every double one -
 * every other 3rd Monday, indefinitely.
 *
 * Global rather than per subscriber on purpose. A per-subscriber gate lets one person with
 * no send history trigger an off-cycle run, which would advance the timestamp and swallow
 * that stretch of publications for everyone else.
 */
export function hasWindowElapsed({ lastGlobalSentAt, now = new Date(), windowDays }) {
  if (!lastGlobalSentAt) return true
  if (!(windowDays > 0)) return true
  return now.getTime() - lastGlobalSentAt.getTime() > windowDays * MS_PER_DAY
}

/**
 * The span an issue covers: everything published since the newsletter last went out.
 *
 * Falls back to a rolling window when there is no send on record - the first run under
 * this scheme, and what keeps a list with no history from receiving the back catalogue.
 */
export function getWindowStart({ lastGlobalSentAt, now = new Date(), windowDays }) {
  if (lastGlobalSentAt) return lastGlobalSentAt
  if (windowDays > 0) return new Date(now.getTime() - windowDays * MS_PER_DAY)
  return null
}
