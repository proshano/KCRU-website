import { getSiteBaseUrl } from '@/lib/seo'

export default function robots() {
  const baseUrl = getSiteBaseUrl()

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/admin',
          '/api',
          '/trials/manage',
          '/trials/approvals',
          '/updates/admin',
          '/updates/manage',
          '/under-construction'
        ]
      }
    ],
    sitemap: `${baseUrl}/sitemap.xml`
  }
}
