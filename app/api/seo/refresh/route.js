import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { sanityFetch, queries, writeClient } from '@/lib/sanity'
import { generateSeoSummary, generateSeoTopics } from '@/lib/summaries'
import { normalizeDescription } from '@/lib/seo'
import { getPublicationSeoSnapshot } from '@/lib/publicationsSeo'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { isCronAuthorized } from '@/lib/cronUtils'

const AUTH_TOKEN = process.env.SEO_REFRESH_TOKEN
const CRON_SECRET = process.env.CRON_SECRET || ''
const CORS_HEADERS = buildCorsHeaders('GET, POST, OPTIONS')

const REFRESH_LIMIT = Number(process.env.SEO_REFRESH_LIMIT || 10)
const SUMMARY_MAX_CHARS = Number(process.env.SEO_META_MAX_CHARS || 160)
const INPUT_MAX_CHARS = Number(process.env.SEO_LLM_INPUT_CHARS || 1400)
const SITE_SUMMARY_REFRESH_DAYS = Number(process.env.SEO_LLM_REFRESH_DAYS || 14)
const TOPICS_LIMIT = Number(process.env.SEO_TOPICS_LIMIT || 10)
const LLM_DELAY_MS = Number(process.env.SEO_LLM_DELAY_MS || 0)
const FALLBACK_MIN_CHARS = Number(process.env.SEO_FALLBACK_MIN_CHARS || 90)
const PUBLICATION_CONTEXT_LIMIT = Number(process.env.SEO_PUBLICATION_CONTEXT_LIMIT || 5)
const PUBLICATION_CONTEXT_SUMMARY_MAX = Number(process.env.SEO_PUBLICATION_CONTEXT_SUMMARY_MAX || 120)

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function truncateText(value, limit) {
  const text = cleanText(value)
  if (!text) return ''
  if (!Number.isFinite(limit) || limit <= 0) return text
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`
}

function extractPortableText(blocks) {
  if (!Array.isArray(blocks)) return ''
  const lines = []
  blocks.forEach((block) => {
    if (block?._type === 'block' && Array.isArray(block.children)) {
      const text = block.children.map((child) => child?.text || '').join('')
      if (text.trim()) lines.push(text)
    }
  })
  return cleanText(lines.join(' '))
}

function getSlugValue(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.current || ''
}

function parseDate(value) {
  const dt = value ? new Date(value) : null
  if (!dt || Number.isNaN(dt.getTime())) return null
  return dt
}

function shouldRefreshSeo(seo, updatedAt) {
  if (!seo?.description) return true
  if (!seo?.generatedAt) return false
  const updated = parseDate(updatedAt)
  const generated = parseDate(seo.generatedAt)
  if (!generated) return true
  if (updated && updated > generated) return true
  return false
}

function isOlderThanDays(dateValue, days) {
  const date = parseDate(dateValue)
  if (!date) return true
  if (!Number.isFinite(days) || days <= 0) return false
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return date.getTime() < cutoff
}

function hasLlmKey(provider, apiKey) {
  if (apiKey) return true
  switch (provider) {
    case 'openrouter':
      return Boolean(process.env.OPENROUTER_API_KEY)
    case 'openai':
      return Boolean(process.env.OPENAI_API_KEY)
    case 'together':
      return Boolean(process.env.TOGETHER_API_KEY)
    case 'groq':
      return Boolean(process.env.GROQ_API_KEY)
    case 'anthropic':
      return Boolean(process.env.ANTHROPIC_API_KEY)
    case 'ollama':
      return true
    default:
      return Boolean(process.env.OPENROUTER_API_KEY)
  }
}

function uniqueStrings(values, limit) {
  const seen = new Set()
  const out = []
  values.forEach((value) => {
    const cleaned = cleanText(value)
    if (!cleaned) return
    const key = cleaned.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(cleaned)
  })
  if (Number.isFinite(limit) && limit > 0) return out.slice(0, limit)
  return out
}

function buildSummaryBody(parts) {
  const combined = parts.map(cleanText).filter(Boolean).join(' ')
  return truncateText(combined, INPUT_MAX_CHARS)
}

function buildPublicationContext(highlights = []) {
  if (!Array.isArray(highlights) || highlights.length === 0) return ''
  const lines = []
  highlights.slice(0, PUBLICATION_CONTEXT_LIMIT).forEach((item) => {
    const title = cleanText(item?.title)
    if (!title) return
    const summary = normalizeDescription(item?.summary || '', PUBLICATION_CONTEXT_SUMMARY_MAX)
    if (summary) {
      lines.push(`${title}: ${summary}`)
    } else {
      lines.push(title)
    }
  })
  return lines.join(' | ')
}

function shouldUseLlmForDescription(description) {
  if (!description) return true
  const length = description.length
  if (length < FALLBACK_MIN_CHARS) return true
  return false
}

async function delayIfNeeded() {
  if (LLM_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, LLM_DELAY_MS))
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  if (!CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500, headers: CORS_HEADERS })
  }
  if (!isCronAuthorized(request, CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  return runRefresh({ source: 'cron' })
}

export async function POST(request) {
  if (!AUTH_TOKEN) {
    return NextResponse.json(
      { ok: false, error: 'SEO_REFRESH_TOKEN not configured' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  const token = extractBearerToken(request)
  if (token !== AUTH_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  return runRefresh({ source: 'manual' })
}

async function runRefresh({ source = 'manual' } = {}) {
  if (!process.env.SANITY_API_TOKEN) {
    return NextResponse.json({ ok: false, error: 'SANITY_API_TOKEN not configured' }, { status: 500, headers: CORS_HEADERS })
  }

  try {
    const [settingsRaw, capabilitiesRaw, areasRaw, trialsRaw, newsRaw, researchersRaw] = await Promise.all([
      sanityFetch(queries.siteSettings),
      sanityFetch(queries.capabilities),
      sanityFetch(queries.therapeuticAreas),
      sanityFetch(queries.seoTrials),
      sanityFetch(queries.seoNewsPosts),
      sanityFetch(queries.seoResearchers)
    ])

    const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
    const capabilities = JSON.parse(JSON.stringify(capabilitiesRaw || {}))
    const areas = JSON.parse(JSON.stringify(areasRaw || []))
    const trials = JSON.parse(JSON.stringify(trialsRaw || []))
    const newsPosts = JSON.parse(JSON.stringify(newsRaw || []))
    const researchers = JSON.parse(JSON.stringify(researchersRaw || []))

    if (!settings?._id) {
      return NextResponse.json({ ok: false, error: 'Site settings not found' }, { status: 500, headers: CORS_HEADERS })
    }

    const provider = settings.llmProvider || process.env.LLM_PROVIDER || 'openrouter'
    const model = settings.llmModel || process.env.LLM_MODEL
    const apiKey = settings.llmApiKey || ''
    const llmAvailable = hasLlmKey(provider, apiKey)
    const llmOptions = { provider, model, apiKey }

    let publicationSnapshot = {
      topics: [],
      highlights: [],
      total: 0,
      generatedAt: null
    }

    try {
      publicationSnapshot = await getPublicationSeoSnapshot()
    } catch (err) {
      console.warn('[seo] publication snapshot failed', err)
    }

    const publicationTopics = Array.isArray(publicationSnapshot.topics) ? publicationSnapshot.topics : []
    const publicationHighlights = Array.isArray(publicationSnapshot.highlights) ? publicationSnapshot.highlights : []

    const results = {
      site: { updated: false, publicationsUpdated: false },
      trials: { updated: 0 },
      news: { updated: 0 },
      researchers: { updated: 0 }
    }

    const siteSummaryIsManual = Boolean(settings?.seo?.llmSummary && !settings?.seo?.llmGeneratedAt)
    const shouldRefreshSite = !siteSummaryIsManual && isOlderThanDays(settings?.seo?.llmGeneratedAt, SITE_SUMMARY_REFRESH_DAYS)

    const sitePatch = {}

    if (shouldRefreshSite) {
      const areaTopics = areas.map((area) => area?.name).filter(Boolean)
      const tagTopics = researchers.flatMap((person) => person?.researchTags || [])
      const topicCandidates = uniqueStrings([...publicationTopics, ...areaTopics, ...tagTopics], TOPICS_LIMIT)
      const publicationContext = buildPublicationContext(publicationHighlights)

      const siteContextParts = [
        settings.unitName && `Unit: ${settings.unitName}`,
        settings.tagline && `Tagline: ${settings.tagline}`,
        settings.description && `About: ${settings.description}`,
        settings.institutionAffiliation && `Institution: ${settings.institutionAffiliation}`,
        capabilities?.introduction && `Capabilities: ${capabilities.introduction}`,
        topicCandidates.length ? `Focus areas: ${topicCandidates.join(', ')}` : '',
        publicationTopics.length ? `Publication topics: ${publicationTopics.join(', ')}` : '',
        publicationContext ? `Recent publications: ${publicationContext}` : ''
      ]

      const siteContext = buildSummaryBody(siteContextParts)
      let summary = normalizeDescription(siteContext, SUMMARY_MAX_CHARS)
      let topics = topicCandidates

      if (llmAvailable) {
        const llmSummary = await generateSeoSummary({ title: settings.unitName, body: siteContext }, llmOptions)
        if (llmSummary) summary = normalizeDescription(llmSummary, SUMMARY_MAX_CHARS)
        await delayIfNeeded()
      }

      if (llmAvailable && topicCandidates.length < TOPICS_LIMIT) {
        const llmTopics = await generateSeoTopics(
          { context: siteContext },
          { ...llmOptions, maxTopics: TOPICS_LIMIT }
        )
        if (llmTopics.length) topics = uniqueStrings(llmTopics, TOPICS_LIMIT)
      }

      sitePatch['seo.llmSummary'] = summary
      sitePatch['seo.llmTopics'] = topics
      sitePatch['seo.llmGeneratedAt'] = new Date().toISOString()
      results.site.updated = true
    }

    if (publicationSnapshot.total > 0) {
      sitePatch['seo.publicationTopics'] = publicationTopics
      sitePatch['seo.publicationHighlights'] = publicationHighlights
      sitePatch['seo.publicationGeneratedAt'] = publicationSnapshot.generatedAt || new Date().toISOString()
      results.site.publicationsUpdated = true
    }

    if (Object.keys(sitePatch).length > 0) {
      await writeClient.patch(settings._id).set(sitePatch).commit()
      revalidatePath('/llms.txt')
      if (results.site.publicationsUpdated) revalidatePath('/publications.md')
    }

    const staleTrials = trials.filter((trial) => shouldRefreshSeo(trial.seo, trial._updatedAt)).slice(0, REFRESH_LIMIT)
    const staleNews = newsPosts.filter((post) => shouldRefreshSeo(post.seo, post._updatedAt)).slice(0, REFRESH_LIMIT)
    const staleResearchers = researchers.filter((person) => shouldRefreshSeo(person.seo, person._updatedAt)).slice(0, REFRESH_LIMIT)

    for (const trial of staleTrials) {
      const areaNames = (trial.therapeuticAreas || []).map((area) => area?.name).filter(Boolean)
      const piName = trial.principalInvestigator?.name || trial.principalInvestigatorName
      const summaryBody = buildSummaryBody([
        trial.laySummary,
        trial.ctGovData?.briefSummary,
        trial.ctGovData?.officialTitle,
        trial.status && `Status: ${trial.status}`,
        areaNames.length ? `Areas: ${areaNames.join(', ')}` : '',
        piName ? `Principal investigator: ${piName}` : ''
      ])

      let description = normalizeDescription(summaryBody, SUMMARY_MAX_CHARS)
      let sourceLabel = 'fallback'

      if (llmAvailable && shouldUseLlmForDescription(description)) {
        const llmSummary = await generateSeoSummary(
          { title: trial.title, body: summaryBody, hints: areaNames },
          llmOptions
        )
        if (llmSummary) {
          description = normalizeDescription(llmSummary, SUMMARY_MAX_CHARS)
          sourceLabel = 'llm'
        }
        await delayIfNeeded()
      }

      if (description) {
        await writeClient
          .patch(trial._id)
          .set({
            'seo.description': description,
            'seo.generatedAt': new Date().toISOString(),
            'seo.source': sourceLabel
          })
          .commit()
        results.trials.updated += 1

        const slug = getSlugValue(trial.slug)
        if (slug) revalidatePath(`/trials/${slug}`)
      }
    }

    for (const post of staleNews) {
      const bodyText = extractPortableText(post.body)
      const summaryBody = buildSummaryBody([
        post.excerpt,
        bodyText,
        Array.isArray(post.tags) ? `Tags: ${post.tags.join(', ')}` : ''
      ])

      let description = normalizeDescription(summaryBody, SUMMARY_MAX_CHARS)
      let sourceLabel = 'fallback'

      if (llmAvailable && shouldUseLlmForDescription(description)) {
        const llmSummary = await generateSeoSummary(
          { title: post.title, body: summaryBody, hints: post.tags || [] },
          llmOptions
        )
        if (llmSummary) {
          description = normalizeDescription(llmSummary, SUMMARY_MAX_CHARS)
          sourceLabel = 'llm'
        }
        await delayIfNeeded()
      }

      if (description) {
        await writeClient
          .patch(post._id)
          .set({
            'seo.description': description,
            'seo.generatedAt': new Date().toISOString(),
            'seo.source': sourceLabel
          })
          .commit()
        results.news.updated += 1

        const slug = getSlugValue(post.slug)
        if (slug) revalidatePath(`/news/${slug}`)
      }
    }

    for (const person of staleResearchers) {
      const summaryBody = buildSummaryBody([
        person.bio,
        person.role,
        person.category,
        Array.isArray(person.researchTags) ? `Research tags: ${person.researchTags.join(', ')}` : ''
      ])

      let description = normalizeDescription(summaryBody, SUMMARY_MAX_CHARS)
      let sourceLabel = 'fallback'

      if (llmAvailable && shouldUseLlmForDescription(description)) {
        const llmSummary = await generateSeoSummary(
          { title: person.name, body: summaryBody, hints: person.researchTags || [] },
          llmOptions
        )
        if (llmSummary) {
          description = normalizeDescription(llmSummary, SUMMARY_MAX_CHARS)
          sourceLabel = 'llm'
        }
        await delayIfNeeded()
      }

      if (description) {
        await writeClient
          .patch(person._id)
          .set({
            'seo.description': description,
            'seo.generatedAt': new Date().toISOString(),
            'seo.source': sourceLabel
          })
          .commit()
        results.researchers.updated += 1

        const slug = getSlugValue(person.slug)
        if (slug) revalidatePath(`/team/${slug}`)
      }
    }

    if (results.trials.updated) revalidatePath('/trials')
    if (results.news.updated) revalidatePath('/news')
    if (results.researchers.updated) revalidatePath('/team')

    return NextResponse.json({ ok: true, source, results }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[seo] refresh failed', err)
    return NextResponse.json({ ok: false, error: err?.message || 'SEO refresh failed' }, { status: 500, headers: CORS_HEADERS })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
export const maxDuration = 60
