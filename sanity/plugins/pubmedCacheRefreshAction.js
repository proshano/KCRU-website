import { useState } from 'react'
import { definePlugin } from 'sanity'
import { useToast } from '@sanity/ui'

const REFRESH_URL = process.env.SANITY_STUDIO_PUBMED_REFRESH_URL || 'http://localhost:3000/api/pubmed/refresh'
const CANCEL_URL = process.env.SANITY_STUDIO_PUBMED_CANCEL_URL || 'http://localhost:3000/api/pubmed/cancel'
const AUTH_TOKEN =
  process.env.SANITY_STUDIO_PUBMED_REFRESH_TOKEN ||
  process.env.SANITY_STUDIO_PUBMED_CANCEL_TOKEN ||
  process.env.NEXT_PUBLIC_PUBMED_REFRESH_TOKEN ||
  ''

function PubmedCacheRefreshAction(props) {
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

      toast.push({
        status: 'success',
        title: 'PubMed cache refreshed',
        description: data?.meta?.cachePath
          ? `Cached to ${data.meta.cachePath}`
          : 'Refresh complete',
      })
    } catch (err) {
      console.error('PubMed cache refresh failed', err)
      toast.push({
        status: 'error',
        title: 'Refresh failed',
        description: err.message || 'Unable to refresh cache',
      })
    } finally {
      setIsRunning(false)
      props.onComplete?.()
    }
  }

  return {
    ...props,
    label: isRunning ? 'Refreshing...' : 'Refresh PubMed cache',
    tone: 'primary',
    disabled: isRunning,
    onHandle: handleRefresh,
  }
}

function PubmedCacheCancelAction(props) {
  const toast = useToast()
  const [isRunning, setIsRunning] = useState(false)

  async function handleCancel() {
    setIsRunning(true)
    try {
      const res = await fetch(CANCEL_URL, {
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

      toast.push({
        status: 'success',
        title: 'Cancellation requested',
        description: 'Active refresh will stop soon if running.',
      })
    } catch (err) {
      console.error('PubMed cache cancel failed', err)
      toast.push({
        status: 'error',
        title: 'Cancel failed',
        description: err.message || 'Unable to cancel refresh',
      })
    } finally {
      setIsRunning(false)
      props.onComplete?.()
    }
  }

  return {
    ...props,
    label: isRunning ? 'Cancelling...' : 'Cancel PubMed refresh',
    tone: 'critical',
    disabled: isRunning,
    onHandle: handleCancel,
  }
}

export const pubmedCacheRefreshAction = definePlugin(() => ({
  name: 'pubmed-cache-refresh-action',
  document: {
    actions: (prev, context) => {
      if (context.schemaType !== 'siteSettings') return prev
      return [...prev, PubmedCacheRefreshAction, PubmedCacheCancelAction]
    },
  },
}))
