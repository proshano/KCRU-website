const RECAPTCHA_ENDPOINT = 'https://www.google.com/recaptcha/api/siteverify'
const DEFAULT_MIN_SCORE = 0.4

export async function verifyRecaptcha(token, { secret, minScore = DEFAULT_MIN_SCORE } = {}) {
  const resolvedSecret = secret || process.env.RECAPTCHA_SECRET_KEY || process.env.RECAPTCHA_SECRET
  if (!resolvedSecret) {
    console.warn('reCAPTCHA secret not configured; skipping verification.')
    return { success: true, skipped: true }
  }

  try {
    const res = await fetch(RECAPTCHA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(resolvedSecret)}&response=${encodeURIComponent(token || '')}`
    })

    const data = await res.json()
    const scoreOk = typeof data.score !== 'number' || data.score >= minScore
    return { success: Boolean(data.success) && scoreOk, data }
  } catch (err) {
    console.error('Failed to verify reCAPTCHA', err)
    return { success: false, error: err }
  }
}
