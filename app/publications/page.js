import { sanityFetch, queries } from '@/lib/sanity'
import { getCachedPublicationsDisplay, getPublicationsSinceYear } from '@/lib/publications'
import PublicationsBrowser from './PublicationsBrowser'

export const revalidate = 86400 // 24 hours

export default async function PublicationsPage() {
  const [settingsRaw, researchersRaw, pageContentRaw] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.allResearchers),
    sanityFetch(queries.pageContent)
  ])
  // Strip ALL Sanity data to plain JSON to break any circular references
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const altmetricEnabled = settings?.altmetric?.enabled === true
  const researchers = JSON.parse(JSON.stringify(researchersRaw || []))
  const content = JSON.parse(JSON.stringify(pageContentRaw || {}))
  const researcherChips = researchers.map((r) => ({
    _id: r._id,
    name: r.name,
    slug: r.slug,
    photo: r.photo
  }))

  // Strip researchers to plain objects to avoid circular references
  const strippedResearchers = (researchers || []).map(r => ({
    _id: r._id,
    name: r.name,
    pubmedQuery: r.pubmedQuery
  }))

  // Always use researcher queries; optionally augment with affiliation if present
  let bundle = { publications: [], provenance: {}, byYear: {}, years: [], meta: {} }
  try {
    bundle = await getCachedPublicationsDisplay({
      researchers: strippedResearchers,
      affiliation: settings?.pubmedAffiliation || '',
      maxPerResearcher: 120,
      maxAffiliation: 80,
      summariesPerRun: Infinity,
      llmOptions: {
        provider: settings.llmProvider || 'openrouter',
        model: settings.llmModel,
        apiKey: settings.llmApiKey,
        systemPrompt: settings.llmSystemPrompt,
        classificationPrompt: settings.llmClassificationPrompt,
        classificationProvider: settings.llmClassificationProvider,
        classificationModel: settings.llmClassificationModel,
        classificationApiKey: settings.llmClassificationApiKey
      }
    })
  } catch (err) {
    console.error('Failed to load cached publications', err)
  }

  const combinedPubs = bundle.publications || []
  const provenance = bundle.provenance || {}

  // Lay summaries are generated during cache refresh and stored with publications
  const pubsWithSummaries = combinedPubs

  const publications = pubsWithSummaries
  const meta = bundle.meta || {}
  const sinceYear = getPublicationsSinceYear()

  const formatGeneratedAt = (ts) => {
    if (!ts) return null
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      }).format(new Date(ts))
    } catch (err) {
      console.error('Failed to format generatedAt', err)
      return null
    }
  }

  // Page content with fallbacks
  const titleTemplate = content.publicationsTitle || '{count} publications since {year}'
  const pageTitle = titleTemplate
    .replace('{count}', publications.length)
    .replace('{year}', sinceYear)
  const description = (content.publicationsDescription || '').trim()

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-12 space-y-8">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">
          {pageTitle}
        </h1>
        {description && (
          <p className="text-[#666] mt-3 max-w-2xl">{description}</p>
        )}
        <p className="text-xs text-[#888] mt-2">
          {meta?.generatedAt ? `Updated ${formatGeneratedAt(meta.generatedAt)}` : 'Cache not yet generated'}
        </p>
      </header>

      {publications.length === 0 && (
        <p className="text-[#666]">No publications found yet. Add PubMed queries to researchers or an affiliation in Site Settings.</p>
      )}

      {publications.length > 0 && (
        <PublicationsBrowser
          publications={publications}
          researchers={researcherChips}
          provenance={provenance}
          altmetricEnabled={altmetricEnabled}
        />
      )}
    </main>
  )
}

