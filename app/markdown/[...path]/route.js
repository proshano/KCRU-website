import { sanityFetch, queries, urlFor } from '@/lib/sanity'
import { getSiteBaseUrl, normalizeDescription, resolveSiteDescription, resolveSiteTitle } from '@/lib/seo'

export const revalidate = 3600

const STATUS_LABELS = {
  recruiting: 'Recruiting',
  coming_soon: 'Coming soon',
  active_not_recruiting: 'Active, not recruiting',
  completed: 'Completed',
  closed: 'Closed'
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function toParagraphs(value) {
  const raw = String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!raw) return []
  return raw.split(/\n{2,}/).map(part => cleanText(part)).filter(Boolean)
}

function formatDate(value) {
  if (!value) return ''
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toISOString().slice(0, 10)
}

function getSlugValue(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.current || ''
}

function addParagraphs(lines, value) {
  const parts = toParagraphs(value)
  parts.forEach((part) => {
    lines.push(part)
    lines.push('')
  })
}

function addKeyValue(lines, label, value) {
  if (!value) return
  lines.push(`- ${label}: ${value}`)
}

function addList(lines, items) {
  const cleaned = (items || []).map(item => cleanText(item)).filter(Boolean)
  if (!cleaned.length) return
  cleaned.forEach((item) => {
    lines.push(`- ${item}`)
  })
  lines.push('')
}

function normalizeTitle(value, fallback) {
  const cleaned = cleanText(value)
  if (!cleaned) return fallback
  if (cleaned.includes('{')) return fallback
  return cleaned
}

function portableTextToMarkdown(blocks = []) {
  const lines = []
  let inList = false

  blocks.forEach((block) => {
    if (block?._type === 'block') {
      const markDefs = Array.isArray(block.markDefs) ? block.markDefs : []
      const text = (block.children || []).map((child) => {
        if (!child || child._type !== 'span') return ''
        let spanText = child.text || ''
        const linkKey = (child.marks || []).find(mark =>
          markDefs.some(def => def._key === mark && def._type === 'link' && def.href)
        )
        if (linkKey) {
          const def = markDefs.find(item => item._key === linkKey)
          if (def?.href) {
            spanText = `[${spanText}](${def.href})`
          }
        }
        return spanText
      }).join('')

      if (block.listItem) {
        if (!inList) inList = true
        const indent = block.level ? '  '.repeat(block.level) : ''
        lines.push(`${indent}- ${cleanText(text)}`)
        return
      }

      if (inList) {
        lines.push('')
        inList = false
      }

      const cleanedText = cleanText(text)
      if (!cleanedText) return

      switch (block.style) {
        case 'h1':
          lines.push(`# ${cleanedText}`)
          lines.push('')
          break
        case 'h2':
          lines.push(`## ${cleanedText}`)
          lines.push('')
          break
        case 'h3':
          lines.push(`### ${cleanedText}`)
          lines.push('')
          break
        case 'blockquote':
          lines.push(`> ${cleanedText}`)
          lines.push('')
          break
        default:
          lines.push(cleanedText)
          lines.push('')
      }

      return
    }

    if (block?._type === 'image' && block.asset) {
      const alt = cleanText(block.alt || 'Image')
      const imageUrl = urlFor(block).width(1200).fit('max').url()
      lines.push(`![${alt}](${imageUrl})`)
      lines.push('')
    }
  })

  return lines.join('\n').trim()
}

function finalizeMarkdown(lines) {
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return `${body}\n`
}

async function buildHomeMarkdown() {
  const settingsRaw = await sanityFetch(queries.siteSettings)
  const contentRaw = await sanityFetch(queries.pageContent)
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const content = JSON.parse(JSON.stringify(contentRaw || {}))
  const baseUrl = getSiteBaseUrl()
  const siteTitle = resolveSiteTitle(settings)
  const descriptionSource = resolveSiteDescription(settings) || settings?.tagline || ''
  const description = normalizeDescription(descriptionSource, 320)

  const lines = []
  lines.push(`# ${siteTitle}`)
  lines.push('')

  if (settings?.tagline) {
    lines.push(cleanText(settings.tagline))
    lines.push('')
  }

  if (description) addParagraphs(lines, description)

  const keyPages = [
    { label: normalizeTitle(content.studiesTitle, 'Clinical Studies'), path: '/trials' },
    { label: normalizeTitle(content.publicationsTitle, 'Publications'), path: '/publications' },
    { label: normalizeTitle(content.teamTitle, 'Team'), path: '/team' },
    { label: normalizeTitle(content.newsTitle, 'News'), path: '/news' },
    { label: 'Subscribe for updates', path: '/updates' },
    { label: normalizeTitle(content.contactTitle, 'Contact'), path: '/contact' },
    { label: normalizeTitle(content.trainingTitle, 'Training opportunities'), path: '/training' },
    { label: 'Capabilities (sponsors and partners)', path: '/capabilities' }
  ]

  lines.push('## Key Pages')
  keyPages.forEach((page) => {
    lines.push(`- ${page.label}: ${baseUrl}${page.path}`)
  })
  lines.push('')

  return finalizeMarkdown(lines)
}

async function buildTrialsIndexMarkdown() {
  const [trialsRaw, contentRaw] = await Promise.all([
    sanityFetch(queries.seoTrials),
    sanityFetch(queries.pageContent)
  ])
  const trials = JSON.parse(JSON.stringify(trialsRaw || []))
  const content = JSON.parse(JSON.stringify(contentRaw || {}))
  const baseUrl = getSiteBaseUrl()

  const title = normalizeTitle(content.studiesTitle, 'Clinical Studies')
  const description = content.studiesDescription || ''

  const lines = []
  lines.push(`# ${title}`)
  lines.push('')
  addParagraphs(lines, description)

  lines.push('## Studies')
  lines.push('')

  if (!trials.length) {
    lines.push('No studies are listed at this time.')
    lines.push('')
    return finalizeMarkdown(lines)
  }

  trials.forEach((trial) => {
    const slug = getSlugValue(trial.slug)
    const status = STATUS_LABELS[trial.status] || trial.status || 'Status TBD'
    const summary = normalizeDescription(trial.seo?.description || trial.laySummary || '', 240)

    lines.push(`### ${trial.title}`)
    addKeyValue(lines, 'URL', `${baseUrl}/trials/${slug}`)
    addKeyValue(lines, 'Status', status)
    addKeyValue(lines, 'NCT ID', trial.nctId)
    addKeyValue(lines, 'Sponsor', trial.ctGovData?.sponsor)
    addKeyValue(lines, 'Principal investigator', trial.principalInvestigator?.name)
    if (summary) addKeyValue(lines, 'Summary', summary)
    addKeyValue(lines, 'ClinicalTrials.gov', trial.ctGovData?.url)
    lines.push('')
  })

  return finalizeMarkdown(lines)
}

async function buildTrialDetailMarkdown(slug) {
  const trialRaw = await sanityFetch(queries.trialBySlug, { slug })
  if (!trialRaw) return null
  const trial = JSON.parse(JSON.stringify(trialRaw || {}))
  const baseUrl = getSiteBaseUrl()
  const status = STATUS_LABELS[trial.status] || trial.status || 'Status TBD'
  const summary = normalizeDescription(
    trial.laySummary || trial.ctGovData?.briefSummary || trial.seo?.description || '',
    400
  )

  const lines = []
  lines.push(`# ${trial.title}`)
  lines.push('')
  addKeyValue(lines, 'URL', `${baseUrl}/trials/${getSlugValue(trial.slug)}`)
  addKeyValue(lines, 'Status', status)
  addKeyValue(lines, 'NCT ID', trial.nctId)
  addKeyValue(lines, 'Sponsor', trial.ctGovData?.sponsor)
  addKeyValue(lines, 'Principal investigator', trial.principalInvestigator?.name)
  addKeyValue(lines, 'ClinicalTrials.gov', trial.ctGovData?.url)
  addKeyValue(lines, 'Study website', trial.sponsorWebsite)
  lines.push('')

  if (summary) {
    lines.push('## Summary')
    lines.push('')
    addParagraphs(lines, summary)
  }

  const inclusion = Array.isArray(trial.inclusionCriteria) ? trial.inclusionCriteria : []
  const exclusion = Array.isArray(trial.exclusionCriteria) ? trial.exclusionCriteria : []
  if (inclusion.length || exclusion.length) {
    lines.push('## Eligibility')
    lines.push('')
    if (inclusion.length) {
      lines.push('### Inclusion Criteria')
      addList(lines, inclusion)
    }
    if (exclusion.length) {
      lines.push('### Exclusion Criteria')
      addList(lines, exclusion)
    }
  }

  const contact = trial.localContact || {}
  const contactDetails = []
  if (contact?.displayPublicly !== false) {
    if (contact?.name) contactDetails.push(`Name: ${contact.name}`)
    if (contact?.role) contactDetails.push(`Role: ${contact.role}`)
    if (contact?.email) contactDetails.push(`Email: ${contact.email}`)
    if (contact?.phone) contactDetails.push(`Phone: ${contact.phone}`)
  }
  if (contactDetails.length) {
    lines.push('## Contact')
    lines.push('')
    contactDetails.forEach((detail) => {
      lines.push(`- ${detail}`)
    })
    lines.push('')
  }

  return finalizeMarkdown(lines)
}

async function buildTeamIndexMarkdown() {
  const [researchersRaw, contentRaw] = await Promise.all([
    sanityFetch(queries.seoResearchers),
    sanityFetch(queries.pageContent)
  ])
  const researchers = JSON.parse(JSON.stringify(researchersRaw || []))
  const content = JSON.parse(JSON.stringify(contentRaw || {}))
  const baseUrl = getSiteBaseUrl()

  const title = normalizeTitle(content.teamTitle, 'Team')
  const description = content.teamDescription || ''

  const lines = []
  lines.push(`# ${title}`)
  lines.push('')
  addParagraphs(lines, description)

  lines.push('## Members')
  lines.push('')

  if (!researchers.length) {
    lines.push('No team members are listed at this time.')
    lines.push('')
    return finalizeMarkdown(lines)
  }

  researchers.forEach((person) => {
    const slug = getSlugValue(person.slug)
    const role = cleanText(person.role)
    const category = cleanText(person.category)
    const tagList = Array.isArray(person.researchTags)
      ? person.researchTags.map(tag => cleanText(tag)).filter(Boolean)
      : []

    let line = `- ${person.name}`
    if (role) line += ` — ${role}`
    if (category) line += ` (${category})`
    if (slug) line += `: ${baseUrl}/team/${slug}`
    lines.push(line)

    if (tagList.length) {
      lines.push(`  - Research tags: ${tagList.join(', ')}`)
    }
  })

  lines.push('')
  return finalizeMarkdown(lines)
}

async function buildTeamDetailMarkdown(slug) {
  const slugLower = slug.toLowerCase()
  const slugPattern = `^${slugLower}$`
  const profileRaw = await sanityFetch(queries.researcherBySlug, { slug, slugLower, slugPattern })
  if (!profileRaw) return null
  const profile = JSON.parse(JSON.stringify(profileRaw || {}))
  const baseUrl = getSiteBaseUrl()

  const lines = []
  lines.push(`# ${profile.name}`)
  lines.push('')
  addKeyValue(lines, 'URL', `${baseUrl}/team/${getSlugValue(profile.slug)}`)
  addKeyValue(lines, 'Role', profile.role)
  addKeyValue(lines, 'Category', profile.category)
  addKeyValue(lines, 'Email', profile.email)
  addKeyValue(lines, 'ORCID', profile.orcid)
  addKeyValue(lines, 'Twitter', profile.twitter ? `https://twitter.com/${profile.twitter.replace('@', '')}` : '')
  addKeyValue(lines, 'LinkedIn', profile.linkedin)
  lines.push('')

  if (profile.bio) {
    lines.push('## Biography')
    lines.push('')
    addParagraphs(lines, profile.bio)
  }

  const tags = Array.isArray(profile.researchTags) ? profile.researchTags : []
  if (tags.length) {
    lines.push('## Research Tags')
    addList(lines, tags)
  }

  const studies = Array.isArray(profile.studies) ? profile.studies : []
  if (studies.length) {
    lines.push('## Studies')
    lines.push('')
    studies.forEach((study) => {
      const studySlug = getSlugValue(study.slug)
      const status = STATUS_LABELS[study.status] || study.status || 'Status TBD'
      const studyUrl = studySlug ? `${baseUrl}/trials/${studySlug}` : ''
      let line = `- ${study.title}`
      if (status) line += ` (${status})`
      if (studyUrl) line += `: ${studyUrl}`
      lines.push(line)
    })
    lines.push('')
  }

  return finalizeMarkdown(lines)
}

async function buildNewsIndexMarkdown() {
  const [newsRaw, contentRaw] = await Promise.all([
    sanityFetch(queries.seoNewsPosts),
    sanityFetch(queries.pageContent)
  ])
  const news = JSON.parse(JSON.stringify(newsRaw || []))
  const content = JSON.parse(JSON.stringify(contentRaw || {}))
  const baseUrl = getSiteBaseUrl()

  const title = normalizeTitle(content.newsTitle, 'News')
  const description = content.newsDescription || ''

  const lines = []
  lines.push(`# ${title}`)
  lines.push('')
  addParagraphs(lines, description)

  lines.push('## Posts')
  lines.push('')

  if (!news.length) {
    lines.push('No news posts are published yet.')
    lines.push('')
    return finalizeMarkdown(lines)
  }

  news.forEach((post) => {
    const slug = getSlugValue(post.slug)
    const date = formatDate(post.publishedAt)
    const excerpt = normalizeDescription(post.excerpt || post.seo?.description || '', 200)
    let line = `- ${post.title}`
    if (date) line += ` (${date})`
    if (slug) line += `: ${baseUrl}/news/${slug}`
    if (excerpt) line += ` — ${excerpt}`
    lines.push(line)
  })

  lines.push('')
  return finalizeMarkdown(lines)
}

async function buildNewsDetailMarkdown(slug) {
  const postRaw = await sanityFetch(queries.newsPostBySlug, { slug })
  if (!postRaw) return null
  const post = JSON.parse(JSON.stringify(postRaw || {}))
  const baseUrl = getSiteBaseUrl()

  const lines = []
  lines.push(`# ${post.title}`)
  lines.push('')
  addKeyValue(lines, 'URL', `${baseUrl}/news/${getSlugValue(post.slug)}`)
  addKeyValue(lines, 'Published', formatDate(post.publishedAt))
  addKeyValue(lines, 'Updated', formatDate(post._updatedAt))
  addKeyValue(lines, 'Author', post.author?.name)
  lines.push('')

  if (post.excerpt || post.seo?.description) {
    lines.push('## Summary')
    lines.push('')
    addParagraphs(lines, post.excerpt || post.seo?.description)
  }

  if (post.featuredImage) {
    const imageUrl = urlFor(post.featuredImage).width(1200).height(675).fit('crop').url()
    lines.push(`![Featured image](${imageUrl})`)
    lines.push('')
  }

  if (Array.isArray(post.body) && post.body.length) {
    lines.push('## Article')
    lines.push('')
    const articleBody = portableTextToMarkdown(post.body)
    if (articleBody) lines.push(articleBody)
    lines.push('')
  }

  const tags = Array.isArray(post.tags) ? post.tags : []
  if (tags.length) {
    lines.push('## Tags')
    addList(lines, tags)
  }

  return finalizeMarkdown(lines)
}

async function buildPublicationsMarkdown() {
  const [contentRaw, settingsRaw] = await Promise.all([
    sanityFetch(queries.pageContent),
    sanityFetch(queries.siteSettings)
  ])
  const content = JSON.parse(JSON.stringify(contentRaw || {}))
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const baseUrl = getSiteBaseUrl()
  const title = normalizeTitle(content.publicationsTitle, 'Publications')
  const description = content.publicationsDescription || 'Research publications from our investigators.'
  const publicationTopics = Array.isArray(settings?.seo?.publicationTopics)
    ? settings.seo.publicationTopics
    : []
  const publicationHighlights = Array.isArray(settings?.seo?.publicationHighlights)
    ? settings.seo.publicationHighlights
    : []

  const lines = []
  lines.push(`# ${title}`)
  lines.push('')
  addParagraphs(lines, description)

  lines.push('## Access')
  lines.push(`- Publications page: ${baseUrl}/publications`)
  if (settings?.pubmedAffiliation) {
    lines.push(`- PubMed affiliation query: ${cleanText(settings.pubmedAffiliation)}`)
  }
  lines.push('- Data sources: PubMed, OpenAlex')
  lines.push('')

  if (publicationTopics.length) {
    lines.push('## Publication Topics')
    addList(lines, publicationTopics)
  }

  if (publicationHighlights.length) {
    lines.push('## Recent Publication Summaries')
    lines.push('')
    publicationHighlights.forEach((item) => {
      const titleText = cleanText(item?.title)
      if (!titleText) return
      const year = cleanText(item?.year)
      const heading = year ? `${titleText} (${year})` : titleText
      lines.push(`### ${heading}`)
      lines.push('')

      const summary = cleanText(item?.summary)
      if (summary) addParagraphs(lines, summary)

      const url = cleanText(item?.url)
      if (url) addKeyValue(lines, 'Link', url)

      const tags = Array.isArray(item?.tags) ? item.tags.map(tag => cleanText(tag)).filter(Boolean) : []
      if (tags.length) addKeyValue(lines, 'Topics', tags.join(', '))
      lines.push('')
    })
  }

  return finalizeMarkdown(lines)
}

async function buildContactMarkdown() {
  const [settingsRaw, locationsRaw, contentRaw] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.contactLocations),
    sanityFetch(queries.pageContent)
  ])
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const locationsData = JSON.parse(JSON.stringify(locationsRaw || {}))
  const content = JSON.parse(JSON.stringify(contentRaw || {}))

  const title = normalizeTitle(content.contactTitle, 'Contact')
  const description = content.contactDescription || ''
  const locations = Array.isArray(locationsData?.locations) ? locationsData.locations : []

  const lines = []
  lines.push(`# ${title}`)
  lines.push('')
  addParagraphs(lines, description)

  lines.push('## Contact Details')
  addKeyValue(lines, 'Email', settings.contactEmail)
  addKeyValue(lines, 'Phone', settings.phone)
  addKeyValue(lines, 'Address', settings.address)
  lines.push('')

  if (locations.length) {
    lines.push('## Locations')
    lines.push('')
    locations.forEach((loc) => {
      lines.push(`### ${loc.name}`)
      addKeyValue(lines, 'Address', loc.address)
      addKeyValue(lines, 'Phone', loc.phone)
      addKeyValue(lines, 'Fax', loc.fax)
      addKeyValue(lines, 'Email', loc.email)
      addKeyValue(lines, 'Map', loc.mapUrl)
      if (loc.note) addParagraphs(lines, loc.note)
      lines.push('')
    })
  }

  return finalizeMarkdown(lines)
}

async function buildTrainingMarkdown() {
  const [opportunitiesRaw, contentRaw] = await Promise.all([
    sanityFetch(queries.allOpportunities),
    sanityFetch(queries.pageContent)
  ])
  const opportunities = JSON.parse(JSON.stringify(opportunitiesRaw || []))
  const content = JSON.parse(JSON.stringify(contentRaw || {}))

  const title = normalizeTitle(content.trainingTitle, 'Training opportunities')
  const description = content.trainingDescription || ''
  const openItems = opportunities.filter(item => ['open', 'ongoing'].includes(item.status))

  const lines = []
  lines.push(`# ${title}`)
  lines.push('')
  addParagraphs(lines, description)

  lines.push('## Open Opportunities')
  lines.push('')

  if (!openItems.length) {
    lines.push('No open or ongoing opportunities are listed at this time.')
    lines.push('')
    return finalizeMarkdown(lines)
  }

  openItems.forEach((role) => {
    lines.push(`### ${role.title}`)
    addKeyValue(lines, 'Status', role.status)
    addKeyValue(lines, 'Type', role.type)
    addKeyValue(lines, 'Research area', role.researchArea)
    if (Array.isArray(role.supervisor) && role.supervisor.length) {
      const supervisors = role.supervisor.map(item => item.name).filter(Boolean).join(', ')
      addKeyValue(lines, 'Supervisors', supervisors)
    }
    addKeyValue(lines, 'Funding', role.funding)
    addKeyValue(lines, 'Start date', role.startDate)
    addKeyValue(lines, 'Deadline', role.deadline)
    addKeyValue(lines, 'Contact', role.contactEmail)
    lines.push('')
  })

  return finalizeMarkdown(lines)
}

async function buildCapabilitiesMarkdown() {
  const dataRaw = await sanityFetch(queries.capabilities)
  const data = JSON.parse(JSON.stringify(dataRaw || {}))
  const title = data.headline || 'Capabilities'
  const introduction = data.introduction || ''

  const lines = []
  lines.push(`# ${title}`)
  lines.push('')
  addParagraphs(lines, introduction)

  const sections = [
    { title: 'Therapeutic areas', value: data.therapeuticAreas },
    { title: 'Core capabilities', value: data.coreCapabilities },
    { title: 'Infrastructure', value: data.infrastructure },
    { title: 'Patient volume', value: data.patientVolume },
    { title: 'Track record', value: data.trackRecord },
    { title: 'Regulatory experience', value: data.regulatoryExperience },
    { title: 'Previous sponsors', value: data.previousSponsors },
    { title: 'Additional services', value: data.additionalServices }
  ]

  sections.forEach((section) => {
    if (!section.value || (Array.isArray(section.value) && section.value.length === 0)) return
    lines.push(`## ${section.title}`)
    if (Array.isArray(section.value)) {
      addList(lines, section.value)
    } else {
      addParagraphs(lines, section.value)
    }
  })

  const contactLines = []
  if (data.contactEmail) contactLines.push(`Email: ${data.contactEmail}`)
  if (data.contactPhone) contactLines.push(`Phone: ${data.contactPhone}`)
  if (contactLines.length) {
    lines.push('## Contact')
    contactLines.forEach((item) => lines.push(`- ${item}`))
    lines.push('')
  }

  return finalizeMarkdown(lines)
}

async function buildUpdatesMarkdown() {
  const lines = []
  lines.push('# Subscribe for updates')
  lines.push('')
  lines.push('Share your role, specialty, and interest areas to receive study updates. You can update preferences or unsubscribe any time.')
  lines.push('')
  lines.push(`- Subscribe page: ${getSiteBaseUrl()}/updates`)
  lines.push('')
  return finalizeMarkdown(lines)
}

export async function GET(request, { params }) {
  const rawSegments = Array.isArray(params?.path) ? params.path : []
  const segments = rawSegments.map((segment) => {
    if (typeof segment !== 'string') return ''
    return segment.endsWith('.md') ? segment.slice(0, -3) : segment
  }).filter(Boolean)
  if (!segments.length) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }

  const [first, second] = segments
  const slug = decodeURIComponent(second || '')

  let markdown = null

  if (first === 'index.html' || first === 'index') {
    markdown = await buildHomeMarkdown()
  } else if (first === 'trials') {
    markdown = second ? await buildTrialDetailMarkdown(slug) : await buildTrialsIndexMarkdown()
  } else if (first === 'team') {
    markdown = second ? await buildTeamDetailMarkdown(slug) : await buildTeamIndexMarkdown()
  } else if (first === 'news') {
    markdown = second ? await buildNewsDetailMarkdown(slug) : await buildNewsIndexMarkdown()
  } else if (first === 'publications') {
    markdown = await buildPublicationsMarkdown()
  } else if (first === 'contact') {
    markdown = await buildContactMarkdown()
  } else if (first === 'training') {
    markdown = await buildTrainingMarkdown()
  } else if (first === 'capabilities') {
    markdown = await buildCapabilitiesMarkdown()
  } else if (first === 'updates') {
    markdown = await buildUpdatesMarkdown()
  }

  if (!markdown) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Robots-Tag': 'noindex'
    }
  })
}
