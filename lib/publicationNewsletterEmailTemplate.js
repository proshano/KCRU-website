import { escapeHtml } from '@/lib/escapeHtml'
import { getShareButtons, shareIcons } from '@/lib/sharing'
import { findResearchersForPublication } from '@/lib/publicationUtils'

const BRAND_COLOR = '#4f46e5'
const MUTED_TEXT = '#6b7280'
const CARD_BACKGROUND = '#f3f4f6'
const CARD_BORDER_COLOR = '#d1d5db'
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
  if (pub?.pubmedUrl) return pub.pubmedUrl
  if (pub?.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${pub.pmid}/`
  if (pub?.doi) return `https://doi.org/${pub.doi}`
  if (pub?.url) return pub.url
  return ''
}

function buildCitation(pub) {
  const authors = Array.isArray(pub?.authors) ? pub.authors.filter(Boolean).join(', ') : ''
  const journal = sanitizeText(pub?.journal)
  const year = pub?.year ? String(pub.year) : ''
  const meta = [journal, year].filter(Boolean).join(' - ')
  return { authors, journal, year, meta }
}

function buildInvestigatorLinksHtml(pub, researchers, provenance, siteBaseUrl) {
  const matches = findResearchersForPublication(pub, researchers, provenance)
  if (!matches.length) return ''
  const baseUrl = resolveSiteBaseUrl(siteBaseUrl)
  const links = matches.map((researcher) => {
    const name = sanitizeText(researcher?.name)
    if (!name) return ''
    const slug = researcher?.slug?.current || researcher?.slug
    const href = slug ? `${baseUrl}/team/${encodeURIComponent(slug)}` : ''
    if (href) {
      return `<a href="${escapeHtml(href)}" style="color: ${BRAND_COLOR} !important; text-decoration: none !important; font-weight: 600;">${escapeHtml(name)}</a>`
    }
    return `<span style="color: ${BRAND_COLOR} !important; font-weight: 600;">${escapeHtml(name)}</span>`
  }).filter(Boolean)

  return links.join(', ')
}

function buildShareLinksHtml(pub) {
  const buttons = getShareButtons(pub)
  if (!buttons.length) return ''
  const textLinks = buttons.map((btn, index) => {
    const spacing = index === 0 ? '' : ' margin-left: 16px;'
    return `
      <a href="${escapeHtml(btn.url)}" target="_blank" rel="noopener noreferrer"
        style="color: ${MUTED_TEXT}; text-decoration: none; font-weight: 600; font-size: 15px;${spacing}">
        ${escapeHtml(btn.label || 'Share')}
      </a>
    `
  })
  return textLinks.join('')
}

function buildPublicationHtmlBlock({ pub, researchers, provenance, siteBaseUrl }) {
  const title = sanitizeText(pub?.title) || 'Publication'
  const link = buildPublicationLink(pub)
  const { journal, year } = buildCitation(pub)
  const investigatorsHtml = buildInvestigatorLinksHtml(pub, researchers, provenance, siteBaseUrl)
  const metaParts = []
  if (journal) {
    metaParts.push(`<span style="font-weight: 600; color: #374151;">${escapeHtml(journal)}</span>`)
  }
  if (year) {
    metaParts.push(`<span style="color: ${MUTED_TEXT};">${escapeHtml(year)}</span>`)
  }
  if (investigatorsHtml) {
    metaParts.push(investigatorsHtml)
  }
  const metaLine = metaParts.join('<span style="color: #9ca3af;">&nbsp;&bull;&nbsp;</span>')
  const summary = sanitizeText(pub?.laySummary)
  const shareLinksHtml = buildShareLinksHtml(pub)

  return `
    <div style="background: ${CARD_BACKGROUND}; border: 1px solid ${CARD_BORDER_COLOR}; border-radius: 12px; padding: 18px; margin: 0 0 18px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);">
      <h2 style="margin: 0 0 8px; font-size: 18px; line-height: 1.45; color: #111; font-weight: 700;">
        ${link ? `<a href="${escapeHtml(link)}" style="color: #111; text-decoration: none; font-weight: 700;">${escapeHtml(title)}</a>` : escapeHtml(title)}
      </h2>
      ${metaLine ? `<p style="margin: 0 0 8px; font-size: 15px; line-height: 1.4; color: ${MUTED_TEXT};">${metaLine}</p>` : ''}
      ${summary ? `<p style="margin: 8px 0 0; font-size: 15px; line-height: 1.6; color: #374151;">${escapeHtml(summary)}</p>` : ''}
      ${
        link || shareLinksHtml
          ? `<div style="margin: 14px 0 0; border-top: 1px solid ${CARD_BORDER_COLOR}; padding-top: 12px;">
              <table role="presentation" width="100%" style="border-collapse: collapse;">
                <tr>
                  <td style="padding: 0; vertical-align: middle;">
                    ${
                      link
                        ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer"
                            style="display: inline-block; background: ${BRAND_COLOR}; color: #ffffff; text-decoration: none; font-weight: 600; font-size: 15px; padding: 10px 16px; border-radius: 8px;">
                            Read Full Paper &rarr;
                          </a>`
                        : ''
                    }
                  </td>
                  <td align="right" style="padding: 0; vertical-align: middle; text-align: right;">
                    ${shareLinksHtml}
                  </td>
                </tr>
              </table>
            </div>`
          : ''
      }
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
    ...(shareLines.length ? ['Share:', ...shareLines] : [])
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
