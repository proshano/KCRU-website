import Link from 'next/link'
import { sanityFetch, queries } from '@/lib/sanity'
import { buildOpenGraph, buildOpenGraphImage, buildTwitterMetadata, getMetadataBase, getSiteBaseUrl, normalizeDescription, resolveSiteDescription, resolveSiteTitle } from '@/lib/seo'
import { SpeedInsights } from '@vercel/speed-insights/next'
import AltmetricScript from './components/AltmetricScript'
import JsonLd from './components/JsonLd'
import './globals.css'

function collectTopicKeywords(settings) {
  const baseTopics = Array.isArray(settings?.seo?.llmTopics) ? settings.seo.llmTopics : []
  const publicationTopics = Array.isArray(settings?.seo?.publicationTopics) ? settings.seo.publicationTopics : []
  const seen = new Set()
  const out = []

  const addTopic = (value) => {
    const cleaned = String(value || '').replace(/\s+/g, ' ').trim()
    if (!cleaned) return
    const key = cleaned.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(cleaned)
  }

  baseTopics.forEach(addTopic)
  publicationTopics.forEach(addTopic)
  return out
}

export async function generateMetadata() {
  const settingsRaw = await sanityFetch(queries.siteSettings)
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const siteTitle = resolveSiteTitle(settings)
  const siteDescription = normalizeDescription(resolveSiteDescription(settings))
  const keywords = collectTopicKeywords(settings)

  return {
    metadataBase: getMetadataBase(),
    title: {
      default: siteTitle,
      template: `%s | ${siteTitle}`
    },
    description: siteDescription,
    keywords: keywords.length ? keywords : undefined,
    openGraph: buildOpenGraph({
      settings,
      title: siteTitle,
      description: siteDescription,
      path: '/'
    }),
    twitter: buildTwitterMetadata({
      settings,
      title: siteTitle,
      description: siteDescription
    })
  }
}

const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/trials', label: 'Studies' },
  { href: '/team', label: 'Team' },
  { href: '/publications', label: 'Publications' },
  { href: '/updates', label: 'Subscribe' },
  { href: '/contact', label: 'Contact' },
]

export default async function RootLayout({ children }) {
  const settingsRaw = await sanityFetch(queries.siteSettings)
  // Strip Sanity data to plain JSON to break any circular references
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const altmetricEnabled = settings?.altmetric?.enabled === true
  const siteTitle = resolveSiteTitle(settings)
  const siteDescription = normalizeDescription(resolveSiteDescription(settings))
  const baseUrl = getSiteBaseUrl()
  const socialLinks = settings?.socialLinks || {}
  const sameAs = Object.values(socialLinks).filter(Boolean)
  const topicKeywords = collectTopicKeywords(settings)
  const logoImage = settings?.seo?.shareImage || settings?.logo
  const logo = buildOpenGraphImage(logoImage, siteTitle)
  const organizationId = `${baseUrl}#organization`
  const contactPoints = []

  if (settings?.contactEmail) {
    contactPoints.push({
      '@type': 'ContactPoint',
      contactType: 'information',
      email: settings.contactEmail
    })
  }

  if (settings?.phone) {
    contactPoints.push({
      '@type': 'ContactPoint',
      contactType: 'information',
      telephone: settings.phone
    })
  }

  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': organizationId,
    name: siteTitle,
    url: baseUrl,
    description: siteDescription
  }

  if (logo?.url) organizationSchema.logo = logo.url
  if (sameAs.length) organizationSchema.sameAs = sameAs
  if (settings?.address) {
    organizationSchema.address = {
      '@type': 'PostalAddress',
      streetAddress: settings.address
    }
  }
  if (contactPoints.length) organizationSchema.contactPoint = contactPoints
  if (topicKeywords.length) organizationSchema.knowsAbout = topicKeywords
  const websiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${baseUrl}#website`,
    name: siteTitle,
    url: baseUrl,
    description: siteDescription,
    publisher: {
      '@id': organizationId
    }
  }
  if (topicKeywords.length) websiteSchema.keywords = topicKeywords

  return (
    <html lang="en">
      <body>
        {altmetricEnabled && <AltmetricScript />}
        <JsonLd data={organizationSchema} />
        <JsonLd data={websiteSchema} />
        <div className="min-h-screen flex flex-col">
          {/* Purple accent bar */}
          <div className="bg-purple h-10"></div>

          {/* Navigation */}
          <nav className="sticky top-0 z-50 bg-background border-b border-black/[0.06] px-6 md:px-12 py-5">
            <div className="max-w-[1400px] mx-auto flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <Link href="/" className="font-bold text-base tracking-tight text-[#444]">
                {settings?.unitName || 'London Kidney Clinical Research'}
              </Link>
              <div className="flex flex-wrap gap-4 text-sm font-medium text-[#444] md:gap-9 md:text-base">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="nav-link"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          </nav>

          {/* Main content */}
          <main className="flex-1">{children}</main>

          {/* Footer */}
          <footer className="border-t border-black/[0.08] py-12 px-6 md:px-12 text-sm text-[#888] font-medium mt-6">
            <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <span>© {new Date().getFullYear()}</span>
                <a
                  href="https://github.com/proshano/KCRU-website"
                  className="hover:text-purple transition-colors"
                  target="_blank"
                  rel="noreferrer"
                >
                  read technical information about this site
                </a>
              </div>
              <div className="flex gap-6">
                <Link href="/privacy" className="hover:text-purple transition-colors">Privacy</Link>
                <Link href="/accessibility" className="hover:text-purple transition-colors">Accessibility</Link>
              </div>
            </div>
          </footer>
        </div>
        <SpeedInsights />
      </body>
    </html>
  )
}
