import { buildStudyReferralMailto } from './studyUpdateEmail.js'
import { escapeHtml } from './escapeHtml.js'
import {
  listTeamInvestigators,
  recruitmentSiteNames,
  resolveStudyTeams,
  teamInvestigatorName,
  teamLabel,
  teamsAcceptingReferrals,
} from './studyTeams.js'

const BRAND_COLOR = '#4f46e5'
const BORDER_COLOR = '#e5e7eb'
const MUTED_TEXT = '#6b7280'
const DEFAULT_SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000')
  .replace(/\/$/, '')

function sanitizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function resolveSiteBaseUrl(value) {
  const cleaned = sanitizeText(value)
  return cleaned ? cleaned.replace(/\/$/, '') : DEFAULT_SITE_BASE_URL
}

function getSlugValue(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object' && typeof value.current === 'string') return value.current
  return ''
}

function buildStudyUrl(study, siteBaseUrl) {
  const slug = getSlugValue(study?.slug)
  if (!slug) return ''
  const baseUrl = resolveSiteBaseUrl(siteBaseUrl)
  return `${baseUrl}/trials/${slug}`
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
  return ensurePeriod(cleaned)
}

function buildFallbackEligibility(study) {
  const items = Array.isArray(study?.inclusionCriteria)
    ? study.inclusionCriteria.map((item) => sanitizeText(item)).filter(Boolean)
    : []
  if (!items.length) return ''
  return ensurePeriod(items.slice(0, 3).join('; '))
}

function resolveShortTitle(study) {
  return sanitizeText(study?.emailTitle || study?.title || 'Study update')
}

function resolveEligibility(study) {
  const statement = sanitizeText(study?.emailEligibilitySummary)
  if (statement) return formatEligibilityLine(statement)
  return buildFallbackEligibility(study)
}

// "Amit Garg (University Hospital), Jane Doe (Victoria Hospital)": the site is
// part of the name because referrals are counted per site.
function resolveInvestigatorLine(teams) {
  const names = listTeamInvestigators(teams).map((pi) => (pi.siteName ? `${pi.name} (${pi.siteName})` : pi.name))
  return names.length ? names.join(', ') : 'TBD'
}

// One referral link per team that takes referrals. A study with a single team
// keeps the plain button; with several, each button names the investigator and
// site so the clinician chooses the site deliberately.
function buildReferralLinks(study, teams, senderEmail) {
  const labelled = teams.length > 1
  return teamsAcceptingReferrals(teams)
    .map((team) => {
      const site = teamLabel(team)
      const mailto = buildStudyReferralMailto({
        coordinatorEmail: team.contact?.email,
        studyTitle: study?.title,
        senderEmail,
        teamLabel: site,
      })
      if (!mailto) return null
      const investigator = teamInvestigatorName(team) || 'the study team'
      const label = labelled ? `Refer to ${investigator}${site ? ` (${site})` : ''}` : 'Refer a patient'
      return { label, mailto }
    })
    .filter(Boolean)
}

function buildStudyTextBlock(study, senderEmail, siteBaseUrl) {
  const teams = resolveStudyTeams(study)
  const shortTitle = resolveShortTitle(study)
  const eligibility = resolveEligibility(study)
  const studyUrl = buildStudyUrl(study, siteBaseUrl)
  const locations = recruitmentSiteNames(study)
  const links = buildReferralLinks(study, teams, senderEmail)

  const lines = [`${shortTitle}`, eligibility, `PI: ${resolveInvestigatorLine(teams)}`]
  if (locations.length) {
    lines.push(`Patients can be seen at: ${locations.join(', ')}`)
  }
  if (studyUrl) {
    lines.push(`Read more: ${studyUrl}`)
  }
  if (links.length) {
    links.forEach((link) => lines.push(`${link.label}: ${link.mailto}`))
  } else {
    lines.push('Referrals: currently closed')
  }
  return lines.filter(Boolean).join('\n')
}

function buildStudyHtmlBlock(study, senderEmail, siteBaseUrl) {
  const teams = resolveStudyTeams(study)
  const shortTitle = resolveShortTitle(study)
  const eligibility = resolveEligibility(study)
  const studyUrl = buildStudyUrl(study, siteBaseUrl)
  const locations = recruitmentSiteNames(study)
  const links = buildReferralLinks(study, teams, senderEmail)

  const referHtml = links.length
    ? links
        .map(
          (link) => `<a href="${escapeHtml(link.mailto)}" style="display: inline-block; padding: 10px 14px; background: ${BRAND_COLOR}; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; margin: 0 8px 8px 0;">
        ${escapeHtml(link.label)}
      </a>`
        )
        .join('')
    : `<span style="display: inline-block; padding: 10px 14px; background: #f3f4f6; color: ${MUTED_TEXT}; border-radius: 6px; font-weight: 600; font-size: 13px; margin: 0 8px 8px 0;">
        Referrals closed
      </span>`

  const detailsHtml = studyUrl
    ? `<a href="${escapeHtml(studyUrl)}" style="display: inline-block; padding: 10px 14px; border: 1px solid ${BORDER_COLOR}; color: #111; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; margin: 0 0 8px;">
        Read more
      </a>`
    : ''

  const locationsHtml = locations.length
    ? `<p style="margin: 0 0 12px; font-size: 12px; color: ${MUTED_TEXT};">Patients can be seen at: ${escapeHtml(locations.join(', '))}</p>`
    : ''

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
      <p style="margin: 0 0 ${locations.length ? '6px' : '12px'}; font-size: 12px; color: ${MUTED_TEXT};">PI: ${escapeHtml(resolveInvestigatorLine(teams))}</p>
      ${locationsHtml}
      <div>
        ${referHtml}
        ${detailsHtml}
      </div>
    </div>
  `
}

export function buildStudyUpdateEmail({ subscriber, studies = [], manageUrl, monthLabel, settings, siteBaseUrl }) {
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
    const block = buildStudyTextBlock(study, recipientEmail, siteBaseUrl)
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

      ${studies.map((study) => buildStudyHtmlBlock(study, recipientEmail, siteBaseUrl)).join('')}

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
