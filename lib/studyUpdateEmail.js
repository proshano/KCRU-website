const INTERNAL_MRN_DOMAINS = new Set(['lhsc.on.ca', 'sjhc.london.on.ca'])

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase()
}

function extractDomain(email) {
  const normalized = normalizeEmail(email)
  const atIndex = normalized.lastIndexOf('@')
  if (atIndex === -1) return ''
  return normalized.slice(atIndex + 1)
}

function shouldIncludeMrnPrompt(senderEmail) {
  const domain = extractDomain(senderEmail)
  return INTERNAL_MRN_DOMAINS.has(domain)
}

function buildReferralBody({ studyTitle, senderEmail }) {
  const title = String(studyTitle || '').trim() || 'this study'
  const lines = [`I have a patient who may be eligible for ${title}.`]
  if (shouldIncludeMrnPrompt(senderEmail)) {
    lines.push('', "The patient's MRN is: ")
  }
  return lines.join('\n')
}

export function buildStudyReferralMailto({ coordinatorEmail, studyTitle, senderEmail }) {
  const to = String(coordinatorEmail || '').trim()
  if (!to) return ''
  const title = String(studyTitle || '').trim()
  const subject = title ? `Study referral: ${title}` : 'Study referral'
  const body = buildReferralBody({ studyTitle: title, senderEmail })

  const params = new URLSearchParams()
  params.set('subject', subject)
  params.set('body', body)
  if (senderEmail) {
    params.set('reply-to', String(senderEmail).trim())
  }

  return `mailto:${to}?${params.toString()}`
}

export function canShowReferralLink({ acceptsReferrals, coordinatorEmail }) {
  return Boolean(acceptsReferrals && String(coordinatorEmail || '').trim())
}
