import { extractBearerToken } from '@/lib/httpUtils'

const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
}

const OCCURRENCE_INDEX = {
  '1st': 1,
  '2nd': 2,
  '3rd': 3,
  '4th': 4,
}

const DEFAULT_SCHEDULE_OCCURRENCE = '1st'
const DEFAULT_SCHEDULE_DAY_OF_WEEK = 'monday'

function isValidScheduleOccurrence(value) {
  const normalizedValue = String(value || '').toLowerCase()
  return normalizedValue === 'last' || Boolean(OCCURRENCE_INDEX[normalizedValue])
}

export function isVercelCronRequest(request) {
  return request?.headers?.get('x-vercel-cron') === '1'
}

export function isCronAuthorized(request, cronSecret) {
  if (!cronSecret) {
    return isVercelCronRequest(request)
  }
  const token = extractBearerToken(request)
  return token === cronSecret
}

export function getZonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
  const parts = fmt.formatToParts(date)
  const map = {}
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value
  }
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
  }
}

export function sameLocalDate(a, b, timeZone) {
  if (!a || !b) return false
  const pa = getZonedParts(a, timeZone)
  const pb = getZonedParts(b, timeZone)
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day
}

export function getNthWeekdayOfMonth(year, month, occurrence, dayOfWeek) {
  const weekday = WEEKDAY_INDEX[String(dayOfWeek || '').toLowerCase()]
  if (!Number.isInteger(year) || !Number.isInteger(month) || weekday === undefined) return null

  const normalizedOccurrence = String(occurrence || '').toLowerCase()
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()

  if (normalizedOccurrence === 'last') {
    const lastDay = new Date(Date.UTC(year, month - 1, daysInMonth))
    const offset = (lastDay.getUTCDay() - weekday + 7) % 7
    return daysInMonth - offset
  }

  const occurrenceIndex = OCCURRENCE_INDEX[normalizedOccurrence]
  if (!occurrenceIndex) return null

  const firstDay = new Date(Date.UTC(year, month - 1, 1))
  const offset = (weekday - firstDay.getUTCDay() + 7) % 7
  const targetDay = 1 + offset + (occurrenceIndex - 1) * 7

  return targetDay <= daysInMonth ? targetDay : null
}

export function isTodayNthWeekday({ timeZone, occurrence, dayOfWeek, date = new Date() }) {
  const parts = getZonedParts(date, timeZone)
  const targetDay = getNthWeekdayOfMonth(parts.year, parts.month, occurrence, dayOfWeek)
  return targetDay === parts.day
}

export function normalizeNthWeekdaySchedule({ occurrence, dayOfWeek, defaultOccurrence, defaultDayOfWeek }) {
  const normalizedDefaultOccurrence = isValidScheduleOccurrence(defaultOccurrence)
    ? String(defaultOccurrence).toLowerCase()
    : DEFAULT_SCHEDULE_OCCURRENCE
  const normalizedDefaultDayOfWeek = WEEKDAY_INDEX[String(defaultDayOfWeek || '').toLowerCase()] !== undefined
    ? String(defaultDayOfWeek).toLowerCase()
    : DEFAULT_SCHEDULE_DAY_OF_WEEK

  const normalizedOccurrence = isValidScheduleOccurrence(occurrence)
    ? String(occurrence).toLowerCase()
    : normalizedDefaultOccurrence
  const normalizedDayOfWeek = WEEKDAY_INDEX[String(dayOfWeek || '').toLowerCase()] !== undefined
    ? String(dayOfWeek).toLowerCase()
    : normalizedDefaultDayOfWeek

  return {
    occurrence: normalizedOccurrence,
    dayOfWeek: normalizedDayOfWeek,
  }
}

export function isWithinCronWindow({ timeZone, targetHour, allowedMinutes, date = new Date() }) {
  const p = getZonedParts(date, timeZone)
  const fallbackHour = (targetHour + 23) % 24
  const hourMatches = p.hour === targetHour || p.hour === fallbackHour
  return hourMatches && p.minute >= 0 && p.minute < allowedMinutes
}
