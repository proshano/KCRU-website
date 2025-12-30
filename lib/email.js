const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const SENDGRID_ENDPOINT = 'https://api.sendgrid.com/v3/mail/send'

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

async function sendWithSendGrid({ apiKey, fromEmail, fromName, to, subject, text, html, replyTo, attachments }) {
  const res = await fetch(SENDGRID_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      from: { email: fromEmail, ...(fromName ? { name: fromName } : {}) },
      personalizations: [{ to: [{ email: to }], subject, ...(replyTo ? { reply_to: { email: replyTo } } : {}) }],
      content: [
        ...(text ? [{ type: 'text/plain', value: text }] : []),
        ...(html ? [{ type: 'text/html', value: html }] : [])
      ],
      ...(attachments?.length
        ? {
            attachments: attachments.map((a) => ({
              content: a.content, // base64 without mime prefix
              filename: a.filename,
              type: a.contentType || undefined,
              disposition: 'attachment'
            }))
          }
        : {})
    })
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`SendGrid failed: ${res.status} ${error}`)
  }

  return res.json()
}

export async function sendEmail({ to, subject, text, html, replyTo, attachments }) {
  if (!to) throw new Error('Missing email recipient')
  const fromEmail = (
    process.env.CONTACT_FROM_EMAIL ||
    process.env.SEND_EMAIL_FROM ||
    process.env.SENDGRID_FROM ||
    'contact@kcru.example'
  ).trim()
  const fromName = (process.env.CONTACT_FROM_NAME || '').trim()

  const resendKey = (process.env.RESEND_API_KEY || '').trim()
  const sendgridKey = (process.env.SENDGRID_API_KEY || '').trim()

  if (!resendKey && !sendgridKey) {
    console.warn('No email provider configured (RESEND_API_KEY or SENDGRID_API_KEY). Skipping email send.')
    return { skipped: true, reason: 'missing_provider' }
  }

  if (resendKey) {
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail
    return sendWithResend({ apiKey: resendKey, from, to, subject, text, html, replyTo, attachments })
  }

  return sendWithSendGrid({ apiKey: sendgridKey, fromEmail, fromName, to, subject, text, html, replyTo, attachments })
}








