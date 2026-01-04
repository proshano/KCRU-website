
import { sanityFetch } from '@/lib/sanity'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const REPLY_TO_QUERY = `*[_type == "siteSettings"][0]{ replyToEmail }`
const REPLY_TO_CACHE_TTL_MS = 5 * 60 * 1000

let cachedReplyTo
let replyToCachedAt = 0
let replyToPromise = null

async function getDefaultReplyTo() {
  const now = Date.now()
  if (replyToCachedAt && now - replyToCachedAt < REPLY_TO_CACHE_TTL_MS) return cachedReplyTo
  if (replyToPromise) return replyToPromise

  replyToPromise = sanityFetch(REPLY_TO_QUERY)
    .then((settings) => {
      const normalized = (settings?.replyToEmail || '').trim()
      cachedReplyTo = normalized || undefined
      replyToCachedAt = Date.now()
      return cachedReplyTo
    })
    .catch((error) => {
      console.warn('Failed to load reply-to email from Sanity.', error)
      cachedReplyTo = undefined
      replyToCachedAt = Date.now()
      return cachedReplyTo
    })
    .finally(() => {
      replyToPromise = null
    })

  return replyToPromise
}

async function sendWithResend({ apiKey, from, to, subject, text, html, replyTo, attachments }) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      html,
      reply_to: replyTo,
      ...(attachments?.length
        ? {
            attachments: attachments.map((a) => ({
              filename: a.filename,
              content: a.content, // base64 without mime prefix
              ...(a.contentType ? { content_type: a.contentType } : {})
            }))
          }
        : {})
    })
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Resend failed: ${res.status} ${error}`)
  }

  return res.json()
}

export async function sendEmail({ to, subject, text, html, replyTo, attachments }) {
  if (!to) throw new Error('Missing email recipient')
  const fromEmail = (
    process.env.CONTACT_FROM_EMAIL ||
    process.env.SEND_EMAIL_FROM ||
    'contact@kcru.example'
  ).trim()
  const fromName = (process.env.CONTACT_FROM_NAME || '').trim()

  const resendKey = (process.env.RESEND_API_KEY || '').trim()
  if (!resendKey) {
    console.warn('No email provider configured (RESEND_API_KEY). Skipping email send.')
    return { skipped: true, reason: 'missing_provider' }
  }

  const normalizedReplyTo = (replyTo || '').trim()
  const resolvedReplyTo = normalizedReplyTo || (await getDefaultReplyTo())
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail
  return sendWithResend({
    apiKey: resendKey,
    from,
    to,
    subject,
    text,
    html,
    replyTo: resolvedReplyTo,
    attachments
  })
}

