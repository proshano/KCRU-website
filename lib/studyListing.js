/**
 * Helpers for the public study list.
 *
 * Browser-safe: `app/trials/TrialCards.js` is a client component.
 */

export const STUDY_LISTING_TIMEZONE = 'America/Toronto'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "3 Oct 2026": the day a study was added, in the team's time zone.
 *
 * The list is prerendered on the server and hydrated in the browser, so the
 * two must format identically. Numeric date parts are stable across ICU
 * versions while locale month abbreviations are not ("Oct." in newer en-CA
 * data), so the month name comes from a fixed table.
 */
export function formatStudyAddedDate(value, timeZone = STUDY_LISTING_TIMEZONE) {
  const date = new Date(value || '')
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date)
  const map = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  const month = MONTHS[Number(map.month) - 1]
  if (!month || !map.day || !map.year) return ''
  return `${Number(map.day)} ${month} ${map.year}`
}
