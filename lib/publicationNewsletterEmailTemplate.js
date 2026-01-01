import { escapeHtml } from '@/lib/escapeHtml'
import { getShareButtons, shareIcons } from '@/lib/sharing'
import { urlFor } from '@/lib/sanity'
import { findResearchersForPublication } from '@/lib/publicationUtils'

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

function applyTemplate(template, tokens) {
  const cleaned = sanitizeText(template)
  if (!cleaned) return ''
  let result = cleaned
  for (const [key, rawValue] of Object.entries(tokens || {})) {
    const value = sanitizeText(rawValue)
    if (!value) continue
    const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi')
    result = result.replace(pattern, value)
  }
  return result.trim()
}

function resolveSubject({ settings, monthLabel, rangeLabel, count }) {
  const templated = applyTemplate(settings?.subjectTemplate, {
    month: monthLabel,
    range: rangeLabel,
    count: Number.isFinite(count) ? String(count) : '',
  })
  if (templated) return templated
  const fallback = rangeLabel || monthLabel
  return fallback ? `Research publication updates - ${fallback}` : 'Research publication updates'
}

function resolveIntro({ settings, hasPublications, monthLabel, rangeLabel, count }) {
  if (hasPublications) {
    const templated = applyTemplate(settings?.introText, {
      month: monthLabel,
      range: rangeLabel,
      count: Number.isFinite(count) ? String(count) : '',
    })
    if (templated) return templated
    return rangeLabel
      ? `Here are the latest publications from our researchers (${rangeLabel}).`
      : 'Here are the latest publications from our researchers.'
  }

  const emptyTemplated = applyTemplate(settings?.emptyIntroText, {
    month: monthLabel,
    range: rangeLabel,
  })
  if (emptyTemplated) return emptyTemplated
  return 'There are no new publications to share right now.'
}

function resolveOutro({ settings, monthLabel, rangeLabel }) {
  return applyTemplate(settings?.outroText, {
    month: monthLabel,
    range: rangeLabel,
  })
}

function resolveSignature(settings) {
  return sanitizeText(settings?.signature) || 'London Kidney Clinical Research'
}

function buildPublicationLink(pub) {
  if (pub?.doi) return `https://doi.org/${pub.doi}`
  if (pub?.url) return pub.url
  if (pub?.pubmedUrl) return pub.pubmedUrl
  if (pub?.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`
  return ''
}

function buildCitation(pub) {
  const authors = Array.isArray(pub?.authors) ? pub.authors.filter(Boolean).join(', ') : ''
  const journal = sanitizeText(pub?.journal)
  const year = pub?.year ? String(pub.year) : ''
  const meta = [journal, year].filter(Boolean).join(' - ')
  return { authors, meta }
}

function buildResearcherChipsHtml(pub, researchers, provenance, siteBaseUrl) {
  const matches = findResearchersForPublication(pub, researchers, provenance)
  if (!matches.length) return ''
  const baseUrl = resolveSiteBaseUrl(siteBaseUrl)
  const chips = matches.map((researcher) => {
    const name = sanitizeText(researcher?.name)
    if (!name) return ''
    const slug = researcher?.slug?.current || researcher?.slug
    const href = slug ? `${baseUrl}/team/${encodeURIComponent(slug)}` : ''
    const photoUrl = researcher?.photo
      ? urlFor(researcher.photo).width(32).height(32).fit('crop').url()
      : ''
    const content = `
      ${photoUrl ? `<img src="${escapeHtml(photoUrl)}" alt="" width="24" height="24" style="border-radius: 999px; display: inline-block; vertical-align: middle; margin-right: 6px;" />` : ''}
      <span style="vertical-align: middle;">${escapeHtml(name)}</span>
    `
    const wrapperStyle = 'display: inline-block; border: 1px solid #ede9fe; color: #4f46e5; border-radius: 999px; padding: 6px 12px; margin: 0 6px 6px 0; text-decoration: none; font-size: 12px; font-weight: 600;'
    if (href) {
      return `<a href="${escapeHtml(href)}" style="${wrapperStyle}">${content}</a>`
    }
    return `<span style="${wrapperStyle}">${content}</span>`
  }).filter(Boolean)

  return chips.length ? `<div style="margin: 10px 0 4px;">${chips.join('')}</div>` : ''
}

function buildShareLinksHtml(pub) {
  const buttons = getShareButtons(pub)
  if (!buttons.length) return ''
  const textLinks = buttons.map((btn) => `
    <a href="${escapeHtml(btn.url)}" target="_blank" rel="noopener noreferrer"
      style="color: ${BRAND_COLOR}; text-decoration: none; font-weight: 600; font-size: 12px; margin-right: 10px;">
      ${escapeHtml(btn.label || 'Share')}
    </a>
  `)
  return `<div style="margin: 8px 0 6px;">${textLinks.join('')}</div>`
}

function buildPublicationHtmlBlock({ pub, researchers, provenance, siteBaseUrl }) {
  const title = sanitizeText(pub?.title) || 'Publication'
  const link = buildPublicationLink(pub)
  const { meta } = buildCitation(pub)
  const summary = sanitizeText(pub?.laySummary)

  return `
    <div style="padding: 0 0 16px; margin: 0 0 16px; border-bottom: 1px solid ${BORDER_COLOR};">
      <h2 style="margin: 0 0 6px; font-size: 16px; line-height: 1.4; color: #111;">
        ${link ? `<a href="${escapeHtml(link)}" style="color: #111; text-decoration: none;">${escapeHtml(title)}</a>` : escapeHtml(title)}
      </h2>
      ${meta ? `<p style="margin: 0 0 10px; font-size: 12px; color: ${MUTED_TEXT};">${escapeHtml(meta)}</p>` : ''}
      ${buildShareLinksHtml(pub)}
      ${buildResearcherChipsHtml(pub, researchers, provenance, siteBaseUrl)}
      ${summary ? `<p style="margin: 10px 0 0; font-size: 13px; color: #374151;">${escapeHtml(summary)}</p>` : ''}
      ${link ? `<p style="margin: 10px 0 0; font-size: 12px;"><a href="${escapeHtml(link)}" style="color: ${BRAND_COLOR}; text-decoration: none; font-weight: 600;">Read more</a></p>` : ''}
    </div>
  `
}

function buildPublicationTextBlock({ pub, researchers, provenance, siteBaseUrl }) {
  const title = sanitizeText(pub?.title) || 'Publication'
  const link = buildPublicationLink(pub)
  const { meta } = buildCitation(pub)
  const summary = sanitizeText(pub?.laySummary)
  const matches = findResearchersForPublication(pub, researchers, provenance)
  const investigatorLine = matches.length
    ? `Investigators: ${matches.map((r) => r.name).filter(Boolean).join(', ')}`
    : ''

  const shareButtons = getShareButtons(pub)
  const shareLines = shareButtons.map((btn) => `${btn.label}: ${btn.url}`)

  const lines = [
    title,
    meta,
    investigatorLine,
    summary ? `Summary: ${summary}` : '',
    ...(shareLines.length ? ['Share:', ...shareLines] : []),
    link ? `Read more: ${link}` : '',
  ]

  return lines.filter(Boolean).join('\n')
}

export function buildPublicationNewsletterEmail({
  subscriber,
  publications = [],
  manageUrl,
  monthLabel,
  rangeLabel,
  settings = {},
  siteBaseUrl,
  researchers = [],
  provenance = {},
}) {
  const recipientName = sanitizeText(subscriber?.name)
  const greeting = recipientName ? `Hi ${recipientName},` : 'Hello,'
  const subject = resolveSubject({
    settings,
    monthLabel,
    rangeLabel,
    count: publications.length,
  })
  const intro = resolveIntro({
    settings,
    hasPublications: publications.length > 0,
    monthLabel,
    rangeLabel,
    count: publications.length,
  })
  const outro = resolveOutro({ settings, monthLabel, rangeLabel })
  const signature = resolveSignature(settings)
  const footerNote = manageUrl
    ? `Manage preferences: ${manageUrl}`
    : 'You can manage your preferences or unsubscribe at any time.'

  const textBlocks = publications.map((pub, index) =>
    `${index + 1}) ${buildPublicationTextBlock({ pub, researchers, provenance, siteBaseUrl })}`
  )

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
    '--',
    signature,
  ].join('\n')

  const manageLink = manageUrl
    ? `<a href="${escapeHtml(manageUrl)}" style="color: ${BRAND_COLOR}; font-weight: 600; text-decoration: none;">Manage preferences</a>`
    : ''

  const htmlBlocks = publications.map((pub) =>
    buildPublicationHtmlBlock({ pub, researchers, provenance, siteBaseUrl })
  ).join('')

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5; background: #ffffff;">
      <h1 style="margin: 0 0 8px; font-size: 20px;">${escapeHtml(subject)}</h1>
      <p style="margin: 0 0 18px; color: ${MUTED_TEXT};">
        ${escapeHtml(intro)}
      </p>

      ${htmlBlocks}

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
