import { normalizeList } from '@/lib/inputUtils'

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function normalizeTestEmailList(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\n,;]+/)
      : []
  const normalized = normalizeList(raw)
    .map((item) => item.toLowerCase())
    .filter((item) => EMAIL_PATTERN.test(item))
  return Array.from(new Set(normalized))
}

export function normalizeUpdateEmailTesting(value) {
  return {
    enabled: Boolean(value?.enabled),
    recipients: normalizeTestEmailList(value?.recipients),
  }
}

export function filterSubscribersByTestEmails(subscribers, recipients) {
  if (!Array.isArray(subscribers)) return []
  if (!recipients?.length) return []
  const allowed = new Set(recipients.map((email) => String(email || '').toLowerCase()))
  return subscribers.filter((subscriber) => {
    const email = String(subscriber?.email || '').trim().toLowerCase()
    return email && allowed.has(email)
  })
}
