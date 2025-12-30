import { extractBearerToken } from '@/lib/httpUtils'

export function isCronAuthorized(request, cronSecret) {
  if (!cronSecret) return false
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

export function isWithinCronWindow({ timeZone, targetHour, allowedMinutes, date = new Date() }) {
  const p = getZonedParts(date, timeZone)
  const fallbackHour = (targetHour + 23) % 24
  const hourMatches = p.hour === targetHour || p.hour === fallbackHour
  return hourMatches && p.minute >= 0 && p.minute < allowedMinutes
}
