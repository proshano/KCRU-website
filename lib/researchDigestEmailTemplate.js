import { escapeHtml } from './escapeHtml.js'

const BRAND_COLOR = '#4f46e5'
const MUTED_TEXT = '#6b7280'
const CARD_BACKGROUND = '#f8fafc'
const CARD_BORDER = '#dbe2ea'

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function applyTemplate(template, tokens = {}) {
  let result = clean(template)
  for (const [key, value] of Object.entries(tokens)) {
    result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), clean(value))
  }
  return result
}

function formatDateLabel(value) {
  if (!value) return ''
  const date = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function buildManageUrl(siteBaseUrl, token) {
  if (!token) return ''
  return `${siteBaseUrl}/updates/manage?token=${encodeURIComponent(token)}`
}

function paperUrl(paper) {
  return paper?.url || (paper?.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/` : '')
}

function paperText(paper, index) {
  const lines = [
    `${index + 1}. ${clean(paper.title)}`,
    [paper.journal, paper.pubDate || paper.year, paper.tier].filter(Boolean).join(' - '),
    paper.whyItMatters ? `Why it matters: ${clean(paper.whyItMatters)}` : '',
    paper.summary ? `Summary: ${clean(paper.summary)}` : '',
    paperUrl(paper),
  ]
  return lines.filter(Boolean).join('\n')
}

function opportunityText(item, index) {
  const lines = [
    `${index + 1}. ${clean(item.title)}`,
    [prettyType(item.type), item.deadline ? `Deadline: ${item.deadline}` : '', item.sourceName].filter(Boolean).join(' - '),
    item.description ? clean(item.description) : '',
    item.url,
  ]
  return lines.filter(Boolean).join('\n')
}

function paperHtml(paper) {
  const href = paperUrl(paper)
  const title = clean(paper.title) || 'Publication'
  return `
    <article style="background: ${CARD_BACKGROUND}; border: 1px solid ${CARD_BORDER}; padding: 16px; margin: 0 0 14px;">
      <h3 style="margin: 0 0 8px; font-size: 17px; line-height: 1.4;">
        ${href ? `<a href="${escapeHtml(href)}" style="color: #111; text-decoration: none;">${escapeHtml(title)}</a>` : escapeHtml(title)}
      </h3>
      <p style="margin: 0 0 8px; color: ${MUTED_TEXT}; font-size: 13px;">
        ${escapeHtml([paper.journal, paper.pubDate || paper.year, paper.tier].filter(Boolean).join(' - '))}
      </p>
      ${paper.whyItMatters ? `<p style="margin: 0 0 8px; color: #111; font-size: 14px;"><strong>Why it matters:</strong> ${escapeHtml(clean(paper.whyItMatters))}</p>` : ''}
      ${paper.summary ? `<p style="margin: 0; color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(clean(paper.summary))}</p>` : ''}
    </article>
  `
}

function opportunityHtml(item) {
  const deadline = item.deadline ? formatDateLabel(item.deadline) : ''
  return `
    <article style="border-top: 1px solid ${CARD_BORDER}; padding: 12px 0;">
      <h3 style="margin: 0 0 5px; font-size: 15px; line-height: 1.35;">
        <a href="${escapeHtml(item.url)}" style="color: ${BRAND_COLOR}; text-decoration: none;">${escapeHtml(clean(item.title))}</a>
      </h3>
      <p style="margin: 0 0 6px; color: ${MUTED_TEXT}; font-size: 12px;">
        ${escapeHtml([prettyType(item.type), deadline ? `Deadline: ${deadline}` : '', item.sourceName].filter(Boolean).join(' - '))}
      </p>
      ${item.description ? `<p style="margin: 0; color: #374151; font-size: 13px; line-height: 1.5;">${escapeHtml(clean(item.description))}</p>` : ''}
    </article>
  `
}

function prettyType(type) {
  const labels = {
    grant: 'Grant',
    conference: 'Conference',
    award: 'Award',
    training: 'Training',
    other: 'Opportunity',
  }
  return labels[type] || 'Opportunity'
}

export function buildResearchDigestEmail({
  subscriber,
  issue,
  papers = [],
  opportunities = [],
  settings = {},
  siteBaseUrl,
}) {
  const dateLabel = formatDateLabel(issue?.date)
  const tokens = {
    date: dateLabel || issue?.date || '',
    paperCount: papers.length,
    opportunityCount: opportunities.length,
  }
  const subject = applyTemplate(settings.subjectTemplate || 'Today’s kidney research: {{paperCount}} papers - {{date}}', tokens)
  const intro = applyTemplate(
    papers.length || opportunities.length
      ? settings.introText || 'Here are today’s most useful new kidney research papers for {{date}}.'
      : settings.emptyIntroText || 'There are no approved research digest items to send today.',
    tokens
  )
  const outro = applyTemplate(settings.outroText || '', tokens)
  const signature = clean(settings.signature) || 'London Kidney Clinical Research'
  const greeting = clean(subscriber?.name) ? `Hi ${clean(subscriber.name)},` : 'Hello,'
  const manageUrl = buildManageUrl(siteBaseUrl, subscriber?.manageToken)
  const archiveUrl = issue?.slug ? `${siteBaseUrl}/research-digest/${issue.slug}` : `${siteBaseUrl}/research-digest`
  const opportunityUrl = `${siteBaseUrl}/opportunities`

  const text = [
    greeting,
    '',
    intro,
    '',
    papers.length ? 'Papers' : '',
    ...papers.map(paperText),
    '',
    opportunities.length ? 'Opportunities' : '',
    ...opportunities.map(opportunityText),
    '',
    `Read online: ${archiveUrl}`,
    `Research opportunities: ${opportunityUrl}`,
    manageUrl ? `Manage preferences: ${manageUrl}` : '',
    '',
    outro,
    '',
    '--',
    signature,
  ].filter((line) => line !== '').join('\n')

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; line-height: 1.5;">
      <p style="margin: 0 0 14px;">${escapeHtml(greeting)}</p>
      <p style="margin: 0 0 18px;">${escapeHtml(intro)}</p>
      ${papers.length ? `<h2 style="font-size: 18px; margin: 18px 0 10px;">Papers</h2>${papers.map(paperHtml).join('')}` : ''}
      ${opportunities.length ? `<h2 style="font-size: 18px; margin: 22px 0 4px;">Grants and conferences</h2>${opportunities.map(opportunityHtml).join('')}` : ''}
      <p style="margin: 18px 0 6px; font-size: 13px;">
        <a href="${escapeHtml(archiveUrl)}" style="color: ${BRAND_COLOR}; font-weight: 600;">Read this digest online</a>
        &nbsp;|&nbsp;
        <a href="${escapeHtml(opportunityUrl)}" style="color: ${BRAND_COLOR}; font-weight: 600;">View research opportunities</a>
      </p>
      ${outro ? `<p style="margin: 16px 0 8px;">${escapeHtml(outro)}</p>` : ''}
      ${manageUrl ? `<p style="margin: 16px 0 6px; color: ${MUTED_TEXT}; font-size: 12px;">Update your email preferences: <a href="${escapeHtml(manageUrl)}" style="color: ${BRAND_COLOR};">Manage preferences</a></p>` : ''}
      <p style="margin: 0; color: ${MUTED_TEXT}; font-size: 13px;">${escapeHtml(signature)}</p>
    </div>
  `

  return { subject, text, html }
}
