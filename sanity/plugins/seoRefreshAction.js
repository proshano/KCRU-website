import { useState } from 'react'
import { definePlugin } from 'sanity'
import { useToast } from '@sanity/ui'

const NEXT_APP_URL = process.env.SANITY_STUDIO_NEXT_APP_URL || 'http://localhost:3000'
const REFRESH_URL = process.env.SANITY_STUDIO_SEO_REFRESH_URL || `${NEXT_APP_URL}/api/seo/refresh`
const AUTH_TOKEN = process.env.SANITY_STUDIO_SEO_REFRESH_TOKEN || ''

function SeoRefreshAction(props) {
  const toast = useToast()
  const [isRunning, setIsRunning] = useState(false)

  async function handleRefresh() {
    setIsRunning(true)
    try {
      const res = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
        },
        body: JSON.stringify({ trigger: 'sanity-action' }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const msg = data?.error || `Request failed (${res.status})`
        throw new Error(msg)
      }

      const results = data?.results || {}
      const site = results?.site || {}
      const trialsUpdated = Number(results?.trials?.updated || 0)
      const newsUpdated = Number(results?.news?.updated || 0)
      const researchersUpdated = Number(results?.researchers?.updated || 0)
      const parts = []

      if (site.updated) parts.push('Site summary updated')
      if (site.publicationsUpdated) parts.push('Publication snapshot updated')
      parts.push(`Trials ${trialsUpdated}`)
      parts.push(`News ${newsUpdated}`)
      parts.push(`Researchers ${researchersUpdated}`)

      toast.push({
        status: 'success',
        title: 'SEO refresh complete',
        description: parts.filter(Boolean).join(' • ') || 'Refresh complete',
      })
    } catch (err) {
      console.error('SEO refresh failed', err)
      toast.push({
        status: 'error',
        title: 'SEO refresh failed',
        description: err.message || 'Unable to refresh SEO metadata',
      })
    } finally {
      setIsRunning(false)
      props.onComplete?.()
    }
  }

  return {
    ...props,
    label: isRunning ? 'Refreshing...' : 'Refresh SEO metadata',
    tone: 'primary',
    disabled: isRunning,
    onHandle: handleRefresh,
  }
}

export const seoRefreshAction = definePlugin(() => ({
  name: 'seo-refresh-action',
  document: {
    actions: (prev, context) => {
      if (context.schemaType !== 'siteSettings') return prev
      return [...prev, SeoRefreshAction]
    },
  },
}))
