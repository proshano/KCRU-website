import { escapeHtml } from '@/lib/escapeHtml'

const BRAND_COLOR = '#4f46e5'
const MUTED_TEXT = '#6b7280'
const DEFAULT_SIGNATURE = 'London Kidney Clinical Research'

function normalizeMessage(value) {
  return String(value || '').trim()
}

function buildHtmlMessage(message) {
  if (!message) return ''
  const paragraphs = message.split(/\n{2,}/).map((block) =>
    escapeHtml(block).replace(/\n/g, '<br />')
  )
  return paragraphs.map((paragraph) =>
    `<p style="margin: 0 0 12px; color: #111;">${paragraph}</p>`
  ).join('')
}

export function buildCustomNewsletterEmail({
  subscriber,
  subject,
  message,
  manageUrl,
  signature,
}) {
  const recipientName = String(subscriber?.name || '').trim()
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hello,'
  const cleanedSubject = String(subject || '').trim() || 'Newsletter update'
  const cleanedMessage = normalizeMessage(message)
  const footerNote = manageUrl
    ? `Manage preferences: ${manageUrl}`
    : 'You can manage your preferences or unsubscribe at any time.'
  const signatureText = String(signature || '').trim() || DEFAULT_SIGNATURE

  const text = [
    greeting,
    '',
    cleanedMessage,
    '',
    footerNote,
    '',
    '--',
    signatureText,
  ].join('\n')

  const manageLink = manageUrl
    ? `<a href="${escapeHtml(manageUrl)}" style="color: ${BRAND_COLOR}; font-weight: 600; text-decoration: none;">Manage preferences</a>`
    : ''

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.6; background: #ffffff;">
      <p style="margin: 0 0 12px;">${escapeHtml(greeting)}</p>
      ${buildHtmlMessage(cleanedMessage)}
      <p style="margin: 18px 0 6px; font-size: 12px; color: ${MUTED_TEXT};">
        ${
          manageUrl
            ? `Update your email preferences at any time: ${manageLink}`
            : 'You can manage your preferences or unsubscribe at any time.'
        }
      </p>
      <p style="margin: 0; font-size: 12px; color: ${MUTED_TEXT};">${escapeHtml(signatureText)}</p>
    </div>
  `

  return { subject: cleanedSubject, text, html }
}
