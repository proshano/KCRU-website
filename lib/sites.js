import { sanityFetch, queries } from '@/lib/sanity'
import { normalizeList } from '@/lib/inputUtils'

export async function fetchSites(fetcher = sanityFetch) {
  const rows = await fetcher(queries.sites)
  return Array.isArray(rows) ? rows : []
}

export function formatSiteTitle(site) {
  const name = String(site?.name || '').trim()
  if (!name) return ''
  const shortName = String(site?.shortName || '').trim()
  const city = String(site?.city || '').trim()
  const province = String(site?.province || '').trim()
  const location = [city, province].filter(Boolean).join(', ')
  const base = shortName && shortName !== name ? `${shortName} - ${name}` : name
  return location ? `${base} (${location})` : base
}

export function buildSiteOptions(sites) {
  return (sites || [])
    .map((site) => {
      const title = formatSiteTitle(site)
      if (!title || !site?._id) return null
      return { value: site._id, title }
    })
    .filter(Boolean)
}

export function resolveSiteIds(values, sites) {
  const allowed = new Set((sites || []).map((site) => site?._id).filter(Boolean))
  return normalizeList(values).filter((value) => allowed.has(value))
}
