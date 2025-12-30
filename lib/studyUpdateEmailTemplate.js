import { buildStudyReferralMailto, canShowReferralLink } from '@/lib/studyUpdateEmail'

const BRAND_COLOR = '#4f46e5'
const BORDER_COLOR = '#e5e7eb'
const MUTED_TEXT = '#6b7280'

function sanitizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function ensurePeriod(value) {
  if (!value) return ''
  return /[.!?]$/.test(value) ? value : `${value}.`
}

function applySubjectTemplate(template, monthLabel) {
  const cleaned = sanitizeText(template)
  if (!cleaned) return ''
  const monthValue = monthLabel || ''
  return cleaned
    .replace(/\{\{\s*month\s*\}\}/gi, monthValue)
    .replace(/\{\{\s*monthLabel\s*\}\}/gi, monthValue)
    .trim()
}

function resolveSubject({ monthLabel, settings }) {
  const templated = applySubjectTemplate(settings?.subjectTemplate, monthLabel)
  if (templated) return templated
  return monthLabel ? `Monthly study updates - ${monthLabel}` : 'Monthly study updates'
}

function formatEligibilityLine(raw) {
  const cleaned = sanitizeText(raw)
  if (!cleaned) return ''
  if (/^refer patients/i.test(cleaned)) return ensurePeriod(cleaned)
  if (/^patients? who/i.test(cleaned)) return ensurePeriod(`Refer ${cleaned}`)
  return ensurePeriod(`Refer patients who: ${cleaned}`)
}

function buildFallbackEligibility(study) {
  const items = Array.isArray(study?.inclusionCriteria)
    ? study.inclusionCriteria.map((item) => sanitizeText(item)).filter(Boolean)
    : []
  if (!items.length) return ''
  return ensurePeriod(`Refer patients who meet: ${items.slice(0, 3).join('; ')}`)
}

function resolveShortTitle(study) {
  return sanitizeText(study?.emailTitle || study?.title || 'Study update')
}

function resolveEligibility(study) {
  const statement = sanitizeText(study?.emailEligibilitySummary)
  if (statement) return formatEligibilityLine(statement)
  return buildFallbackEligibility(study)
}

function resolvePiName(study) {
  return sanitizeText(study?.principalInvestigator?.name || study?.principalInvestigatorName || '')
}

function buildStudyTextBlock(study, senderEmail) {
  const shortTitle = resolveShortTitle(study)
  const eligibility = resolveEligibility(study)
  const piName = resolvePiName(study) || 'TBD'
  const mailto = buildStudyReferralMailto({
    coordinatorEmail: study?.localContact?.email,
    studyTitle: study?.title,
    senderEmail,
  })
  const canRefer = canShowReferralLink({
    acceptsReferrals: study?.acceptsReferrals,
    coordinatorEmail: study?.localContact?.email,
  })

  const lines = [`${shortTitle}`, eligibility, `PI: ${piName}`]
  if (canRefer && mailto) {
    lines.push(`Refer: ${mailto}`)
  } else {
    lines.push('Referrals: currently closed')
  }
  return lines.filter(Boolean).join('\n')
}

function buildStudyHtmlBlock(study, senderEmail) {
  const shortTitle = resolveShortTitle(study)
  const eligibility = resolveEligibility(study)
  const piName = resolvePiName(study) || 'TBD'
  const mailto = buildStudyReferralMailto({
    coordinatorEmail: study?.localContact?.email,
    studyTitle: study?.title,
    senderEmail,
  })
  const canRefer = canShowReferralLink({
    acceptsReferrals: study?.acceptsReferrals,
    coordinatorEmail: study?.localContact?.email,
  })

  const referHtml = canRefer && mailto
    ? `<a href="${escapeHtml(mailto)}" style="display: inline-block; padding: 10px 14px; background: ${BRAND_COLOR}; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px;">
        Refer a patient
      </a>`
    : `<span style="display: inline-block; padding: 10px 14px; background: #f3f4f6; color: ${MUTED_TEXT}; border-radius: 6px; font-weight: 600; font-size: 13px;">
        Referrals closed
      </span>`

  return `
    <div style="border: 1px solid ${BORDER_COLOR}; border-radius: 10px; padding: 16px; margin-bottom: 14px;">
      <p style="margin: 0 0 6px; font-size: 16px; font-weight: 700; color: #111;">
        ${escapeHtml(shortTitle)}
      </p>
      ${
        eligibility
          ? `<p style="margin: 0 0 6px; font-size: 14px; color: #111;">${escapeHtml(eligibility)}</p>`
          : `<p style="margin: 0 0 6px; font-size: 14px; color: ${MUTED_TEXT};">Eligibility statement pending.</p>`
      }
      <p style="margin: 0 0 12px; font-size: 12px; color: ${MUTED_TEXT};">PI: ${escapeHtml(piName)}</p>
      ${referHtml}
    </div>
  `
}

export function buildStudyUpdateEmail({ subscriber, studies = [], manageUrl, monthLabel, settings }) {
  const recipientName = sanitizeText(subscriber?.name)
  const recipientEmail = sanitizeText(subscriber?.email)
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hello,'
  const subject = resolveSubject({ monthLabel, settings })
  const title = subject
  const introText = sanitizeText(settings?.introText)
  const emptyIntroText = sanitizeText(settings?.emptyIntroText)
  const intro = studies.length
    ? (introText || 'Here are this month\'s studies that may be relevant to your patients.')
    : (emptyIntroText || 'There are no recruiting studies to share right now.')
  const outro = sanitizeText(settings?.outroText)
  const signature = sanitizeText(settings?.signature) || 'London Kidney Clinical Research'
  const footerNote = manageUrl
    ? `Manage preferences: ${manageUrl}`
    : 'You can manage your preferences or unsubscribe at any time.'

  const textBlocks = studies.map((study, index) => {
    const block = buildStudyTextBlock(study, recipientEmail)
    return `${index + 1}) ${block}`
  })

  const text = [
    greeting,
    '',
    intro,
    '',
    ...textBlocks,
    '',
    ...(outro ? [outro, ''] : []),
    footerNote,
    '',
    '—',
    signature,
  ].join('\n')

  const manageLink = manageUrl
    ? `<a href="${escapeHtml(manageUrl)}" style="color: ${BRAND_COLOR}; font-weight: 600; text-decoration: none;">Manage preferences</a>`
    : ''

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5; background: #ffffff;">
      <h1 style="margin: 0 0 6px; font-size: 20px;">${escapeHtml(title)}</h1>
      <p style="margin: 0 0 16px; color: ${MUTED_TEXT};">
        ${escapeHtml(intro)}
      </p>

      ${studies.map((study) => buildStudyHtmlBlock(study, recipientEmail)).join('')}

      ${outro ? `<p style="margin: 16px 0 6px; color: #111;">${escapeHtml(outro)}</p>` : ''}
      <p style="margin: 18px 0 6px; font-size: 12px; color: ${MUTED_TEXT};">
        ${
          manageUrl
            ? `Update your email preferences at any time: ${manageLink}`
            : 'You can manage your preferences or unsubscribe at any time.'
        }
      </p>
      <p style="margin: 0; font-size: 12px; color: ${MUTED_TEXT};">${escapeHtml(signature)}</p>
    </div>
  `

  return { subject, text, html }
}
