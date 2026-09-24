import { readCache } from '@/lib/pubmedCache'
import { sanityFetch, queries } from '@/lib/sanity'
import { getSiteBaseUrl, normalizeDescription, resolveSiteTitle } from '@/lib/seo'
import { buildPublicationFeedXml, selectFeedPublications } from '@/lib/publicationFeed'

// Kept in sync with /publications and refreshed immediately after each
// PubMed refresh via /api/pubmed/revalidate so new papers reach the
// downstream Zapier/LinkedIn automation quickly.
export const revalidate = 3600

export async function GET() {
  const [cache, settingsRaw, pageContentRaw, researchersRaw] = await Promise.all([
    readCache(),
    sanityFetch(queries.siteSettings),
    sanityFetch(queries.pageContent),
    sanityFetch(queries.allResearchers),
  ])

  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const content = JSON.parse(JSON.stringify(pageContentRaw || {}))
  const researchers = JSON.parse(JSON.stringify(researchersRaw || []))

  const siteTitle = resolveSiteTitle(settings)
  const siteUrl = getSiteBaseUrl()
  const channelDescription = normalizeDescription(content.publicationsDescription, 300) ||
    `New research publications from ${siteTitle}.`

  const items = selectFeedPublications(cache?.publications || [])

  const xml = buildPublicationFeedXml({
    items,
    provenance: cache?.provenance || {},
    researchers,
    siteTitle,
    siteUrl,
    channelDescription,
    lastBuildDate: cache?.generatedAt,
  })

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  })
}
