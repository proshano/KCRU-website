import { sanityFetch, queries } from '@/lib/sanity'
import { isResearchDigestPublicEnabled } from '@/lib/researchDigestPublic'
import { getSiteBaseUrl } from '@/lib/seo'

export const revalidate = 3600

const STATIC_ROUTES = [
  '/',
  '/trials',
  '/team',
  '/publications',
  '/research-digest',
  '/opportunities',
  '/news',
  '/updates',
  '/contact',
  '/training',
  '/capabilities',
  '/privacy',
  '/accessibility',
  '/llms.txt'
]

function getStaticRoutes(settings = {}) {
  if (isResearchDigestPublicEnabled(settings)) return STATIC_ROUTES
  return STATIC_ROUTES.filter((route) => route !== '/research-digest')
}

export default async function sitemap() {
  const baseUrl = getSiteBaseUrl()
  const now = new Date()

  try {
    const [settings, researchers, trials, news] = await Promise.all([
      sanityFetch(queries.siteSettings),
      sanityFetch(queries.sitemapResearchers),
      sanityFetch(queries.sitemapTrials),
      sanityFetch(queries.sitemapNews)
    ])
    const staticEntries = getStaticRoutes(settings).map((route) => ({
      url: `${baseUrl}${route}`,
      lastModified: now
    }))

    const teamEntries = (researchers || []).map((person) => ({
      url: `${baseUrl}/team/${person.slug}`,
      lastModified: person._updatedAt ? new Date(person._updatedAt) : now
    }))

    const trialEntries = (trials || []).map((trial) => ({
      url: `${baseUrl}/trials/${trial.slug}`,
      lastModified: trial._updatedAt ? new Date(trial._updatedAt) : now
    }))

    const newsEntries = (news || []).map((post) => ({
      url: `${baseUrl}/news/${post.slug}`,
      lastModified: post._updatedAt
        ? new Date(post._updatedAt)
        : post.publishedAt
          ? new Date(post.publishedAt)
          : now
    }))

    return [...staticEntries, ...teamEntries, ...trialEntries, ...newsEntries]
  } catch (err) {
    console.error('Failed to generate sitemap', err)
    return getStaticRoutes().map((route) => ({
      url: `${baseUrl}${route}`,
      lastModified: now
    }))
  }
}
