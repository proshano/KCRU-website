import { escapeHtml } from '@/lib/escapeHtml'
import { findResearchersForPublication } from '@/lib/publicationUtils'

const BRAND_COLOR = '#4f46e5'
const MUTED_TEXT = '#6b7280'
const CARD_BACKGROUND = '#f3f4f6'
const CARD_BORDER_COLOR = '#d1d5db'

function sanitizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function sanitizeMultilineText(value) {
  return String(value || '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function applyTemplate(template, tokens, { preserveLineBreaks = false } = {}) {
  const cleaned = preserveLineBreaks ? sanitizeMultilineText(template) : sanitizeText(template)
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

function renderEmailParagraphs(text, style) {
  const cleaned = sanitizeMultilineText(text)
  if (!cleaned) return ''
  const paragraphs = cleaned.split(/\n{2,}/)
  return paragraphs.map((paragraph) => {
    const html = escapeHtml(paragraph).replace(/\n/g, '<br />')
    return `<p style="${style}">${html}</p>`
  }).join('\n')
}

function buildTemplateTokens({ monthLabel, rangeLabel, count, publicationStats }) {
  return {
    month: monthLabel,
    range: rangeLabel,
    count: Number.isFinite(count) ? String(count) : '',
    displayCount: Number.isFinite(count) ? String(count) : '',
    previousYear: Number.isFinite(publicationStats?.previousYear) ? String(publicationStats.previousYear) : '',
    countSincePreviousYear: Number.isFinite(publicationStats?.countSincePreviousYear)
      ? String(publicationStats.countSincePreviousYear)
      : '',
    countSince2022: Number.isFinite(publicationStats?.countSince2022) ? String(publicationStats.countSince2022) : '',
  }
}

function resolveSubject({ settings, monthLabel, rangeLabel, count, publicationStats }) {
  const templated = applyTemplate(
    settings?.subjectTemplate,
    buildTemplateTokens({ monthLabel, rangeLabel, count, publicationStats })
  )
  if (templated) return templated
  const fallback = rangeLabel || monthLabel
  return fallback ? `Research publication updates - ${fallback}` : 'Research publication updates'
}

function resolveIntro({ settings, hasPublications, monthLabel, rangeLabel, count, publicationStats }) {
  const tokens = buildTemplateTokens({ monthLabel, rangeLabel, count, publicationStats })
  if (hasPublications) {
    const templated = applyTemplate(settings?.introText, tokens, { preserveLineBreaks: true })
    if (templated) return templated
    return rangeLabel
      ? `Here are the latest publications from our researchers (${rangeLabel}).`
      : 'Here are the latest publications from our researchers.'
  }

  const emptyTemplated = applyTemplate(settings?.emptyIntroText, tokens, { preserveLineBreaks: true })
  if (emptyTemplated) return emptyTemplated
  return 'There are no new publications to share right now.'
}

function resolveOutro({ settings, monthLabel, rangeLabel, count, publicationStats }) {
  return applyTemplate(
    settings?.outroText,
    buildTemplateTokens({ monthLabel, rangeLabel, count, publicationStats }),
    { preserveLineBreaks: true }
  )
}

function resolveSignature(settings) {
  return sanitizeText(settings?.signature) || 'London Kidney Clinical Research'
}

function buildCitation(pub) {
  const authors = Array.isArray(pub?.authors) ? pub.authors.filter(Boolean).join(', ') : ''
  const journal = sanitizeText(pub?.journal)
  const year = pub?.year ? String(pub.year) : ''
  const meta = [journal, year].filter(Boolean).join(' - ')
  return { authors, journal, year, meta }
}

function buildInvestigatorLinksHtml(pub, researchers, provenance) {
  const matches = findResearchersForPublication(pub, researchers, provenance)
  if (!matches.length) return ''
  const links = matches.map((researcher) => {
    const name = sanitizeText(researcher?.name)
    if (!name) return ''
    return `<span style="color: ${BRAND_COLOR}; font-weight: 600;">${escapeHtml(name)}</span>`
  }).filter(Boolean)

  return links.join(', ')
}

function buildPublicationHtmlBlock({ pub, researchers, provenance }) {
  const title = sanitizeText(pub?.title) || 'Publication'
  const { journal, year } = buildCitation(pub)
  const investigatorsHtml = buildInvestigatorLinksHtml(pub, researchers, provenance)
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

  return `
    <div style="background: ${CARD_BACKGROUND}; border: 1px solid ${CARD_BORDER_COLOR}; border-radius: 12px; padding: 18px; margin: 0 0 18px; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);">
      <h2 style="margin: 0 0 8px; font-size: 18px; line-height: 1.45; color: #111; font-weight: 700;">
        ${escapeHtml(title)}
      </h2>
      ${metaLine ? `<p style="margin: 0 0 8px; font-size: 15px; line-height: 1.4; color: ${MUTED_TEXT};">${metaLine}</p>` : ''}
      ${summary ? `<p style="margin: 8px 0 0; font-size: 15px; line-height: 1.6; color: #374151;">${escapeHtml(summary)}</p>` : ''}
    </div>
  `
}

function buildPublicationTextBlock({ pub, researchers, provenance }) {
  const title = sanitizeText(pub?.title) || 'Publication'
  const { meta } = buildCitation(pub)
  const summary = sanitizeText(pub?.laySummary)
  const matches = findResearchersForPublication(pub, researchers, provenance)
  const investigatorLine = matches.length
    ? `Investigators: ${matches.map((r) => r.name).filter(Boolean).join(', ')}`
    : ''

  const lines = [
    title,
    meta,
    investigatorLine,
    summary ? `Summary: ${summary}` : '',
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
  publicationStats = {},
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
    publicationStats,
  })
  const intro = resolveIntro({
    settings,
    hasPublications: publications.length > 0,
    monthLabel,
    rangeLabel,
    count: publications.length,
    publicationStats,
  })
  const outro = resolveOutro({ settings, monthLabel, rangeLabel, count: publications.length, publicationStats })
  const signature = resolveSignature(settings)
  const footerNote = manageUrl
    ? `Manage preferences: ${manageUrl}`
    : 'You can manage your preferences or unsubscribe at any time.'

  const textBlocks = publications.map((pub, index) =>
    `${index + 1}) ${buildPublicationTextBlock({ pub, researchers, provenance })}`
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
    buildPublicationHtmlBlock({ pub, researchers, provenance })
  ).join('')

  const introHtml = renderEmailParagraphs(
    intro,
    'margin: 0 0 18px; color: #111; font-size: 15px; line-height: 1.6;'
  )
  const outroHtml = outro
    ? renderEmailParagraphs(
        outro,
        'margin: 16px 0 6px; color: #111; font-size: 15px; line-height: 1.6;'
      )
    : ''

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5; background: #ffffff;">
      ${introHtml}

      ${htmlBlocks}

      ${outroHtml}
      <p style="margin: 18px 0 6px; font-size: 12px; color: ${MUTED_TEXT};">
        ${
          manageUrl
            ? `Update your email preferences at any time: ${manageLink}`
            : 'You can manage your preferences or unsubscribe at any time.'
        }
      </p>
      <p style="margin: 0; font-size: 15px; line-height: 1.6; color: ${MUTED_TEXT};">${escapeHtml(signature)}</p>
    </div>
  `

  return { subject, text, html }
}
