import { sanityFetch, queries } from '@/lib/sanity'
import { getSiteBaseUrl } from '@/lib/seo'

export const revalidate = 3600

const STATIC_ROUTES = [
  '/',
  '/trials',
  '/team',
  '/publications',
  '/news',
  '/updates',
  '/contact',
  '/training',
  '/capabilities',
  '/privacy',
  '/accessibility',
  '/llms.txt'
]

export default async function sitemap() {
  const baseUrl = getSiteBaseUrl()
  const now = new Date()
  const staticEntries = STATIC_ROUTES.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: now
  }))

  try {
    const [researchers, trials, news] = await Promise.all([
      sanityFetch(queries.sitemapResearchers),
      sanityFetch(queries.sitemapTrials),
      sanityFetch(queries.sitemapNews)
    ])

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
    return staticEntries
  }
}
