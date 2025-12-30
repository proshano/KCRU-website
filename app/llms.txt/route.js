import { sanityFetch, queries } from '@/lib/sanity'
import { getSiteBaseUrl, normalizeDescription, resolveSiteDescription, resolveSiteTitle } from '@/lib/seo'

export const revalidate = 3600

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function asTitle(value, fallback) {
  const cleaned = cleanText(value)
  if (!cleaned) return fallback
  if (cleaned.includes('{')) return fallback
  return cleaned
}

export async function GET() {
  const [settingsRaw, pageContentRaw] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.pageContent)
  ])

  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const content = JSON.parse(JSON.stringify(pageContentRaw || {}))
  const baseUrl = getSiteBaseUrl()
  const siteTitle = resolveSiteTitle(settings)
  const descriptionSource = resolveSiteDescription(settings) || settings?.tagline || siteTitle
  const description = normalizeDescription(descriptionSource, 240)
  const llmSummary = normalizeDescription(settings?.seo?.llmSummary || '', 400)
  const summary = llmSummary || description

  const llmTopics = Array.isArray(settings?.seo?.llmTopics)
    ? settings.seo.llmTopics.map(item => cleanText(item)).filter(Boolean)
    : []
  const publicationTopics = Array.isArray(settings?.seo?.publicationTopics)
    ? settings.seo.publicationTopics.map(item => cleanText(item)).filter(Boolean)
    : []
  const publicationHighlights = Array.isArray(settings?.seo?.publicationHighlights)
    ? settings.seo.publicationHighlights
    : []

  const keyPages = [
    { label: asTitle(content.studiesTitle, 'Clinical Studies'), path: '/trials' },
    { label: asTitle(content.publicationsTitle, 'Publications'), path: '/publications' },
    { label: asTitle(content.teamTitle, 'Team'), path: '/team' },
    { label: asTitle(content.newsTitle, 'News'), path: '/news' },
    { label: 'Subscribe for updates', path: '/updates' },
    { label: asTitle(content.contactTitle, 'Contact'), path: '/contact' },
    { label: asTitle(content.trainingTitle, 'Training opportunities'), path: '/training' },
    { label: 'Capabilities (sponsors and partners)', path: '/capabilities' }
  ]

  const lines = []
  lines.push(`# ${siteTitle}`)

  if (summary) {
    lines.push('')
    lines.push(`> ${summary}`)
  }

  if (llmTopics.length) {
    lines.push('')
    lines.push('## Topics')
    llmTopics.forEach((topic) => {
      lines.push(`- ${topic}`)
    })
  }

  if (publicationTopics.length) {
    lines.push('')
    lines.push('## Publication Topics')
    publicationTopics.forEach((topic) => {
      lines.push(`- ${topic}`)
    })
  }

  lines.push('')
  lines.push('## Key Pages')
  keyPages.forEach((page) => {
    lines.push(`- [${page.label}](${baseUrl}${page.path})`)
  })

  lines.push('')
  lines.push('## Markdown')
  lines.push(`- Home: ${baseUrl}/index.html.md`)
  keyPages.forEach((page) => {
    lines.push(`- ${page.label}: ${baseUrl}${page.path}.md`)
  })
  lines.push(`- Trial details: ${baseUrl}/trials/{slug}.md`)
  lines.push(`- Team profiles: ${baseUrl}/team/{slug}.md`)
  lines.push(`- News posts: ${baseUrl}/news/{slug}.md`)

  if (publicationHighlights.length) {
    lines.push('')
    lines.push('## Recent Publication Summaries')
    publicationHighlights.forEach((item) => {
      const title = cleanText(item?.title)
      if (!title) return
      const year = cleanText(item?.year)
      const label = year ? `${title} (${year})` : title
      const url = cleanText(item?.url)
      const summary = normalizeDescription(item?.summary || '', 240)
      const tags = Array.isArray(item?.tags) ? item.tags.map(t => cleanText(t)).filter(Boolean) : []
      const link = url ? `[${label}](${url})` : label
      const summaryPart = summary ? ` — ${summary}` : ''
      const tagsPart = tags.length ? ` Topics: ${tags.join(', ')}` : ''
      lines.push(`- ${link}${summaryPart}${tagsPart}`)
    })
  }

  lines.push('')
  lines.push('## Data Sources')
  lines.push('- PubMed (publications)')
  lines.push('- ClinicalTrials.gov (trial metadata)')
  lines.push('- OpenAlex (publication metadata)')

  if (settings?.contactEmail || settings?.phone) {
    lines.push('')
    lines.push('## Contact')
    if (settings?.contactEmail) lines.push(`- Email: ${settings.contactEmail}`)
    if (settings?.phone) lines.push(`- Phone: ${settings.phone}`)
  }

  lines.push('')
  lines.push('## Sitemap')
  lines.push(`${baseUrl}/sitemap.xml`)

  const body = `${lines.join('\n')}\n`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8'
    }
  })
}
