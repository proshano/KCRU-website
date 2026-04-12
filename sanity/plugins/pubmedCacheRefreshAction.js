import { useState } from 'react'
import { definePlugin } from 'sanity'
import { useToast } from '@sanity/ui'

const BASE_URL =
  process.env.SANITY_STUDIO_PUBMED_BASE_URL ||
  process.env.SANITY_STUDIO_NEXT_APP_URL ||
  process.env.SANITY_STUDIO_API_URL ||
  'http://localhost:3000'
const REFRESH_URL = process.env.SANITY_STUDIO_PUBMED_REFRESH_URL || `${BASE_URL}/api/pubmed/refresh`
const CANCEL_URL = process.env.SANITY_STUDIO_PUBMED_CANCEL_URL || `${BASE_URL}/api/pubmed/cancel`
const WORKFLOW_URL =
  process.env.SANITY_STUDIO_PUBMED_WORKFLOW_URL ||
  'https://github.com/proshano/KCRU-website/actions/workflows/pubmed-refresh.yml'
const AUTH_TOKEN =
  process.env.SANITY_STUDIO_PUBMED_REFRESH_TOKEN ||
  process.env.SANITY_STUDIO_PUBMED_CANCEL_TOKEN ||
  process.env.NEXT_PUBLIC_PUBMED_REFRESH_TOKEN
const MANUAL_BASE_URL_KEY = 'pubmedCacheTool.baseUrl'
const MANUAL_TOKEN_KEY = 'pubmedCacheTool.token'

function normalizeBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '')
}

function readLocalStorage(key) {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(key) || ''
  } catch (err) {
    console.warn('Failed to read localStorage', err)
    return ''
  }
}

function isNetworkError(message = '') {
  return /load failed|failed to fetch/i.test(message)
}

function withNetworkHint(message, url) {
  if (!isNetworkError(message)) return message
  return `Unable to reach ${url}. If using hosted Studio, set SANITY_STUDIO_NEXT_APP_URL or SANITY_STUDIO_PUBMED_REFRESH_URL to your deployed site URL.`
}

function resolveManualBaseUrl() {
  return normalizeBaseUrl(readLocalStorage(MANUAL_BASE_URL_KEY))
}

function resolveManualToken() {
  return readLocalStorage(MANUAL_TOKEN_KEY)
}

function isLocalBaseUrl(value = '') {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalizeBaseUrl(value))
}

function PubmedCacheRefreshAction(props) {
  const toast = useToast()
  const [isRunning, setIsRunning] = useState(false)

  async function handleRefresh() {
    const manualToken = resolveManualToken()
    const authToken = manualToken || AUTH_TOKEN
    const manualBaseUrl = resolveManualBaseUrl()
    const refreshUrl = manualBaseUrl ? `${manualBaseUrl}/api/pubmed/refresh` : REFRESH_URL
    const baseUrl = manualBaseUrl || BASE_URL

    if (!isLocalBaseUrl(baseUrl)) {
      if (typeof window !== 'undefined') {
        window.open(WORKFLOW_URL, '_blank', 'noopener,noreferrer')
      }
      toast.push({
        status: 'success',
        title: 'Opened GitHub Actions',
        description: 'Run the PubMed Refresh workflow there for hosted refreshes.',
      })
      props.onComplete?.()
      return
    }

    if (!authToken) {
      toast.push({
        status: 'error',
        title: 'Missing token',
        description: 'SANITY_STUDIO_PUBMED_REFRESH_TOKEN or SANITY_STUDIO_PUBMED_CANCEL_TOKEN is not configured.',
      })
      props.onComplete?.()
      return
    }

    setIsRunning(true)
    try {
      const res = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
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
        title: data?.queued ? 'PubMed refresh queued' : 'PubMed cache refreshed',
        description: data?.queued
          ? 'GitHub Actions is handling the refresh.'
          : data?.meta?.cachePath
            ? `Cached to ${data.meta.cachePath}`
            : 'Refresh complete',
      })
    } catch (err) {
      console.error('PubMed cache refresh failed', err)
      const raw = err?.message || 'Unable to refresh cache'
      toast.push({
        status: 'error',
        title: 'Refresh failed',
        description: withNetworkHint(raw, refreshUrl),
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
    const manualToken = resolveManualToken()
    const authToken = manualToken || AUTH_TOKEN
    const manualBaseUrl = resolveManualBaseUrl()
    const cancelUrl = manualBaseUrl ? `${manualBaseUrl}/api/pubmed/cancel` : CANCEL_URL

    if (!authToken) {
      toast.push({
        status: 'error',
        title: 'Missing token',
        description: 'SANITY_STUDIO_PUBMED_REFRESH_TOKEN or SANITY_STUDIO_PUBMED_CANCEL_TOKEN is not configured.',
      })
      props.onComplete?.()
      return
    }

    setIsRunning(true)
    try {
      const res = await fetch(cancelUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
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
        description: 'Refresh stopped and lock cleared.',
      })
    } catch (err) {
      console.error('PubMed cache cancel failed', err)
      const raw = err?.message || 'Unable to cancel refresh'
      toast.push({
        status: 'error',
        title: 'Cancel failed',
        description: withNetworkHint(raw, cancelUrl),
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
