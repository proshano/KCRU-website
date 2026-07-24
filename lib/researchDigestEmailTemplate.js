import { escapeHtml } from './escapeHtml.js'

const BRAND_COLOR = '#4f46e5'
const MUTED_TEXT = '#6b7280'
const CARD_BACKGROUND = '#f8fafc'
const CARD_BORDER = '#dbe2ea'

// Superseded defaults that may still be saved in Sanity. The first hardcodes "papers" and
// would read "1 papers" now that the digest ships a single paper by default. Treating them
// as unset lets the current default apply without anyone editing the field by hand.
const LEGACY_SUBJECT_TEMPLATES = new Set([
  'Today’s kidney research: {{paperCount}} papers - {{date}}',
  "Today's kidney research: {{paperCount}} papers - {{date}}",
  'Today’s kidney research: {{paperCount}} {{paperNoun}} - {{date}}',
  "Today's kidney research: {{paperCount}} {{paperNoun}} - {{date}}",
])

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

// "Tier 2" is internal triage vocabulary, so subscribers see the journal and date instead.
function paperMeta(paper) {
  return [clean(paper.journal), formatDateLabel(paper.pubDate) || paper.year]
    .filter(Boolean)
    .join(' - ')
}

function paperTopics(paper) {
  return (Array.isArray(paper?.topics) ? paper.topics : [])
    .map((topic) => clean(topic))
    .filter(Boolean)
    .slice(0, 5)
}

function truncateForSubject(value, maxLength = 72) {
  const text = clean(value)
  if (text.length <= maxLength) return text
  const clipped = text.slice(0, maxLength)
  const lastSpace = clipped.lastIndexOf(' ')
  return `${(lastSpace > maxLength * 0.6 ? clipped.slice(0, lastSpace) : clipped).replace(/[\s,;:.-]+$/, '')}…`
}

function paperText(paper, index) {
  const topics = paperTopics(paper)
  const lines = [
    `${index + 1}. ${clean(paper.title)}`,
    paperMeta(paper),
    paper.whyItMatters ? `Why it matters: ${clean(paper.whyItMatters)}` : '',
    paper.summary ? `Summary: ${clean(paper.summary)}` : '',
    topics.length ? `Topics: ${topics.join(', ')}` : '',
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
  const topics = paperTopics(paper)
  return `
    <article style="background: ${CARD_BACKGROUND}; border: 1px solid ${CARD_BORDER}; padding: 16px; margin: 0 0 14px;">
      <h3 style="margin: 0 0 8px; font-size: 17px; line-height: 1.4;">
        ${href ? `<a href="${escapeHtml(href)}" style="color: #111; text-decoration: none;">${escapeHtml(title)}</a>` : escapeHtml(title)}
      </h3>
      <p style="margin: 0 0 8px; color: ${MUTED_TEXT}; font-size: 13px;">
        ${escapeHtml(paperMeta(paper))}
      </p>
      ${paper.whyItMatters ? `<p style="margin: 0 0 8px; color: #111; font-size: 14px;"><strong>Why it matters:</strong> ${escapeHtml(clean(paper.whyItMatters))}</p>` : ''}
      ${paper.summary ? `<p style="margin: 0 0 10px; color: #374151; font-size: 14px; line-height: 1.6;">${escapeHtml(clean(paper.summary))}</p>` : ''}
      ${topics.length ? `<p style="margin: 0; color: ${MUTED_TEXT}; font-size: 12px;">${topics.map((topic) => escapeHtml(topic)).join(' &middot; ')}</p>` : ''}
      ${href ? `<p style="margin: 10px 0 0; font-size: 13px;"><a href="${escapeHtml(href)}" style="color: ${BRAND_COLOR}; font-weight: 600;">Read the paper</a></p>` : ''}
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
  const leadPaper = papers[0]
  const extraPaperCount = Math.max(papers.length - 1, 0)
  const tokens = {
    date: dateLabel || issue?.date || '',
    paperCount: papers.length,
    paperNoun: papers.length === 1 ? 'paper' : 'papers',
    opportunityCount: opportunities.length,
    opportunityNoun: opportunities.length === 1 ? 'opportunity' : 'opportunities',
    leadTitle: truncateForSubject(leadPaper?.title),
    leadTopic: paperTopics(leadPaper)[0] || '',
    andMore: extraPaperCount ? ` + ${extraPaperCount} more` : '',
  }
  // Leading with the paper itself is the strongest signal a subject line can carry, but it
  // only works when there is a paper — an empty-day send falls back to the generic form.
  const defaultSubjectTemplate = leadPaper
    ? '{{leadTitle}}{{andMore}} - {{date}}'
    : 'Today’s kidney research - {{date}}'
  const configuredSubjectTemplate = LEGACY_SUBJECT_TEMPLATES.has(clean(settings.subjectTemplate))
    ? ''
    : clean(settings.subjectTemplate)
  const subjectTemplate = configuredSubjectTemplate && (leadPaper || !/\{\{\s*leadTitle\s*\}\}/i.test(configuredSubjectTemplate))
    ? configuredSubjectTemplate
    : defaultSubjectTemplate
  const subject = applyTemplate(subjectTemplate, tokens) || applyTemplate(defaultSubjectTemplate, tokens)
  const intro = applyTemplate(
    papers.length || opportunities.length
      ? settings.introText || 'Here is today’s most useful new kidney research for {{date}}.'
      : settings.emptyIntroText || 'There are no approved research digest items to send today.',
    tokens
  )
  const outro = applyTemplate(settings.outroText || '', tokens)
  const signature = clean(settings.signature) || 'London Kidney Clinical Research'
  const greeting = clean(subscriber?.name) ? `Hi ${clean(subscriber.name)},` : 'Hello,'
  const manageUrl = buildManageUrl(siteBaseUrl, subscriber?.manageToken)
  const archiveUrl = settings.publicEnabled
    ? (issue?.slug ? `${siteBaseUrl}/research-digest/${issue.slug}` : `${siteBaseUrl}/research-digest`)
    : ''
  const opportunityUrl = `${siteBaseUrl}/opportunities`

  // Built as blank-line-separated blocks. The previous version filtered out every '' entry,
  // which removed the intended blank lines too and collapsed the plain-text part into a wall.
  const text = [
    greeting,
    intro,
    papers.length
      ? [papers.length === 1 ? 'Paper' : 'Papers', ...papers.map(paperText)].join('\n\n')
      : '',
    opportunities.length
      ? ['Opportunities', ...opportunities.map(opportunityText)].join('\n\n')
      : '',
    [
      archiveUrl ? `Read online: ${archiveUrl}` : '',
      `Research opportunities: ${opportunityUrl}`,
      manageUrl ? `Manage preferences: ${manageUrl}` : '',
    ].filter(Boolean).join('\n'),
    outro,
    `--\n${signature}`,
  ].filter(Boolean).join('\n\n')

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; color: #111; line-height: 1.5;">
      <p style="margin: 0 0 14px;">${escapeHtml(greeting)}</p>
      <p style="margin: 0 0 18px;">${escapeHtml(intro)}</p>
      ${papers.length ? `<h2 style="font-size: 18px; margin: 18px 0 10px;">${papers.length === 1 ? 'Paper' : 'Papers'}</h2>${papers.map(paperHtml).join('')}` : ''}
      ${opportunities.length ? `<h2 style="font-size: 18px; margin: 22px 0 4px;">Grants and conferences</h2>${opportunities.map(opportunityHtml).join('')}` : ''}
      <p style="margin: 18px 0 6px; font-size: 13px;">
        ${archiveUrl ? `<a href="${escapeHtml(archiveUrl)}" style="color: ${BRAND_COLOR}; font-weight: 600;">Read this digest online</a>&nbsp;|&nbsp;` : ''}
        <a href="${escapeHtml(opportunityUrl)}" style="color: ${BRAND_COLOR}; font-weight: 600;">View research opportunities</a>
      </p>
      ${outro ? `<p style="margin: 16px 0 8px;">${escapeHtml(outro)}</p>` : ''}
      ${manageUrl ? `<p style="margin: 16px 0 6px; color: ${MUTED_TEXT}; font-size: 12px;">Update your email preferences: <a href="${escapeHtml(manageUrl)}" style="color: ${BRAND_COLOR};">Manage preferences</a></p>` : ''}
      <p style="margin: 0; color: ${MUTED_TEXT}; font-size: 13px;">${escapeHtml(signature)}</p>
    </div>
  `

  // manageUrl is returned so the caller can also set a List-Unsubscribe header without
  // rebuilding the token URL.
  return { subject, text, html, manageUrl }
}
