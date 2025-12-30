import { urlFor } from '@/lib/sanity'

const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')

export function getSiteBaseUrl() {
  return SITE_BASE_URL
}

export function getMetadataBase() {
  try {
    return new URL(SITE_BASE_URL)
  } catch (err) {
    return new URL('http://localhost:3000')
  }
}

export function normalizeDescription(text, maxLength = 160) {
  if (!text) return ''
  const normalized = String(text).replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function resolveSiteTitle(settings) {
  return settings?.seo?.title || settings?.unitName || 'London Kidney Clinical Research'
}

export function resolveSiteDescription(settings) {
  return settings?.seo?.description || settings?.description || 'London Kidney Clinical Research'
}

function normalizeTwitterHandle(value) {
  if (!value) return null
  if (value.startsWith('@')) return value

  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.replace(/^www\./, '')
    if (hostname !== 'twitter.com' && hostname !== 'x.com') return null

    const handle = parsed.pathname.split('/').filter(Boolean)[0]
    if (!handle) return null

    return `@${handle.replace(/^@/, '')}`
  } catch (err) {
    return null
  }
}

export function buildOpenGraphImage(image, alt) {
  if (!image) return null

  try {
    return {
      url: urlFor(image).width(1200).height(630).fit('crop').url(),
      width: 1200,
      height: 630,
      alt: alt || 'Share image'
    }
  } catch (err) {
    return null
  }
}

export function buildOpenGraph({ settings, title, description, path = '/', image, type = 'website' }) {
  const siteTitle = resolveSiteTitle(settings)
  const resolvedTitle = title || siteTitle
  const resolvedDescription = description || resolveSiteDescription(settings)
  const resolvedImage = image || settings?.seo?.shareImage || settings?.logo
  const ogImage = buildOpenGraphImage(resolvedImage, resolvedTitle)

  const openGraph = {
    title: resolvedTitle,
    description: resolvedDescription,
    type,
    url: path,
    siteName: siteTitle
  }

  if (ogImage) openGraph.images = [ogImage]

  return openGraph
}

export function buildTwitterMetadata({ settings, title, description, image }) {
  const resolvedTitle = title || resolveSiteTitle(settings)
  const resolvedDescription = description || resolveSiteDescription(settings)
  const resolvedImage = image || settings?.seo?.shareImage || settings?.logo
  const ogImage = buildOpenGraphImage(resolvedImage, resolvedTitle)
  const handle = normalizeTwitterHandle(settings?.socialLinks?.twitter)

  const twitter = {
    card: ogImage ? 'summary_large_image' : 'summary',
    title: resolvedTitle,
    description: resolvedDescription
  }

  if (ogImage) twitter.images = [ogImage.url]
  if (handle) twitter.site = handle

  return twitter
}
