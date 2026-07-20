import { sanityFetch, queries } from '@/lib/sanity'
import { getCachedPublicationsDisplay, getPublicationsSinceYear } from '@/lib/publications'
import { isPublicationExcluded } from '@/lib/publicationExclusions'
import PublicationsBrowser from './PublicationsBrowser'
import { buildOpenGraph, buildTwitterMetadata, normalizeDescription, resolveSiteTitle } from '@/lib/seo'

// Keep the revalidate window short enough that a bad render cannot pin an
// empty state for long. The /api/pubmed/revalidate endpoint is also called
// by the scheduled refresh workflow to immediately surface new publications.
export const revalidate = 3600 // 1 hour

export async function generateMetadata() {
  const [settingsRaw, pageContentRaw] = await Promise.all([
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.pageContent)
  ])

  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const content = JSON.parse(JSON.stringify(pageContentRaw || {}))
  const siteTitle = resolveSiteTitle(settings)
  const rawTitle = (content.publicationsTitle || '').trim()
  const title = rawTitle && !rawTitle.includes('{') ? rawTitle : 'Publications'
  const description = normalizeDescription(
    content.publicationsDescription || `Research publications from ${siteTitle}.`
  )
  const canonical = '/publications'

  return {
    title,
    description,
    alternates: {
      canonical
    },
    openGraph: buildOpenGraph({
      settings,
      title,
      description,
      path: canonical
    }),
    twitter: buildTwitterMetadata({
      settings,
      title,
      description
    })
  }
}

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
    pubmedQuery: r.pubmedQuery,
    publicationAuthorName: r.publicationAuthorName,
    publicationExclusions: r.publicationExclusions,
    orcid: r.orcid,
  }))

  let bundle = { publications: [], provenance: {}, byYear: {}, years: [], meta: {} }
  try {
    bundle = await getCachedPublicationsDisplay({
      researchers: strippedResearchers,
      maxPerResearcher: 1000
    })
  } catch (err) {
    console.error('Failed to load cached publications', err)
  }

  const combinedPubs = bundle.publications || []
  const provenance = bundle.provenance || {}

  // Lay summaries are generated during cache refresh and stored with publications
  // Filter out excluded publications (corrections, errata, etc.) for accurate counts
  const publications = combinedPubs.filter(pub => !isPublicationExcluded(pub))
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
