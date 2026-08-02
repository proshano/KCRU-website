import net from 'node:net'

function sanitizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

export function getTrustedClientIp(headers) {
  const realIp = sanitizeText(headers?.get?.('x-real-ip'))
  if (net.isIP(realIp)) return realIp

  const forwarded = sanitizeText(headers?.get?.('x-forwarded-for'))
  if (forwarded) {
    const addresses = forwarded.split(',').map((value) => value.trim()).filter(Boolean)
    const edgeAddress = addresses.at(-1)
    if (net.isIP(edgeAddress)) return edgeAddress
  }

  return 'unknown'
}

/**
 * Bounds the caller-supplied transcript before it reaches the LLM: keeps the most recent turns,
 * clamps each turn's length, and drops anything that is not a usable message. Patient text is
 * passed through as written. The widget warns users to keep details non-identifying; the
 * assistant deliberately does not try to scrub what they send, because every heuristic we tried
 * removed clinical detail (diagnoses, "on dialysis") far more often than it removed identifiers.
 */
export function sanitizeTrialMatchMessages(value, { maxMessages = 12, maxMessageLength = 600 } = {}) {
  if (!Array.isArray(value)) return []

  return value
    .slice(-maxMessages)
    .map((message) => {
      if (!message || typeof message !== 'object') return null
      const role = message.role === 'assistant' ? 'assistant' : 'user'
      const content = sanitizeText(message.content).slice(0, maxMessageLength)
      if (!content) return null
      return { role, content }
    })
    .filter(Boolean)
}
