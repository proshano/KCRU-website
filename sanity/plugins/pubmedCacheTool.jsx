import { useState, useEffect, useCallback } from 'react'
import { definePlugin } from 'sanity'
import { Card, Stack, Text, Button, Code, Heading, Flex, Badge, Box, Spinner, TextInput } from '@sanity/ui'
import { DatabaseIcon, SearchIcon } from '@sanity/icons'

const BASE_URL = process.env.SANITY_STUDIO_API_URL || 'http://localhost:3000'
const REFRESH_URL = process.env.SANITY_STUDIO_PUBMED_REFRESH_URL || `${BASE_URL}/api/pubmed/refresh`
const CANCEL_URL = process.env.SANITY_STUDIO_PUBMED_CANCEL_URL || `${BASE_URL}/api/pubmed/cancel`
const UPLOAD_URL = process.env.SANITY_STUDIO_PUBMED_UPLOAD_URL || `${BASE_URL}/api/pubmed/upload`
const DOWNLOAD_URL = process.env.SANITY_STUDIO_PUBMED_DOWNLOAD_URL || `${BASE_URL}/api/pubmed/download`
const PUBLICATION_URL = `${BASE_URL}/api/pubmed/publication`
const AUTH_TOKEN =
  process.env.SANITY_STUDIO_PUBMED_REFRESH_TOKEN ||
  process.env.SANITY_STUDIO_PUBMED_CANCEL_TOKEN
const STUDIO_PROJECT_ID = process.env.SANITY_STUDIO_PROJECT_ID
const STUDIO_DATASET = process.env.SANITY_STUDIO_DATASET
const hasStudioConfig = Boolean(STUDIO_PROJECT_ID && STUDIO_DATASET)

// Cache staleness: 24 hours (same as lib/pubmedCache.js)
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

function isCacheStale(lastRefreshedAt) {
  if (!lastRefreshedAt) return true
  const ts = Date.parse(lastRefreshedAt)
  if (Number.isNaN(ts)) return true
  return Date.now() - ts > CACHE_MAX_AGE_MS
}

function PubmedCacheTool({ tool }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [message, setMessage] = useState(null)
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [actionLoading, setActionLoading] = useState({}) // pmid -> 'delete' | 'regenerate' | null

  const requireAuthToken = () => {
    if (AUTH_TOKEN) return true
    setMessage({
      tone: 'critical',
      text: 'SANITY_STUDIO_PUBMED_REFRESH_TOKEN or SANITY_STUDIO_PUBMED_CANCEL_TOKEN is not configured.',
    })
    return false
  }

  const fetchStatus = useCallback(async () => {
    if (!hasStudioConfig) {
      setStatus(null)
      setLoading(false)
      return
    }
    try {
      // We'll fetch the cache status from Sanity directly
      const projectId = STUDIO_PROJECT_ID
      const dataset = STUDIO_DATASET
      const query = encodeURIComponent(`*[_type == "pubmedCache" && _id == "pubmedCache"][0]{
        lastRefreshedAt,
        refreshInProgress,
        "totalPublications": stats.totalPublications,
        "totalWithSummary": stats.totalWithSummary,
        "recentWithSummary": publications[defined(laySummary) && laySummary != null][0...5]{
          pmid,
          title,
          journal,
          year,
          laySummary
        },
        "recentWithoutSummary": publications[!defined(laySummary) || laySummary == null][0...3]{
          pmid,
          title,
          journal,
          year
        }
      }`)
      const res = await fetch(`https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}?query=${query}`)
      const data = await res.json()
      setStatus(data.result || null)
    } catch (err) {
      console.error('Failed to fetch cache status', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!hasStudioConfig) {
      setMessage({
        tone: 'critical',
        text: 'SANITY_STUDIO_PROJECT_ID and SANITY_STUDIO_DATASET are not configured.',
      })
      setLoading(false)
      return
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [fetchStatus])

  const handleSearch = useCallback(async () => {
    if (!hasStudioConfig) {
      setMessage({
        tone: 'critical',
        text: 'SANITY_STUDIO_PROJECT_ID and SANITY_STUDIO_DATASET are not configured.',
      })
      setSearchResults([])
      return
    }
    if (!searchQuery.trim()) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    try {
      const projectId = STUDIO_PROJECT_ID
      const dataset = STUDIO_DATASET
      const searchTerm = searchQuery.trim().toLowerCase()
      // Fetch all publications and filter client-side for flexible search
      const query = encodeURIComponent(`*[_type == "pubmedCache"][0].publications[]{
        pmid,
        title,
        journal,
        year,
        laySummary,
        authors
      }`)
      const res = await fetch(`https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}?query=${query}`)
      const data = await res.json()
      const pubs = data.result || []
      // Filter by title, PMID, journal, or authors
      const matches = pubs.filter(p => {
        const titleMatch = p.title?.toLowerCase().includes(searchTerm)
        const pmidMatch = p.pmid?.includes(searchTerm)
        const journalMatch = p.journal?.toLowerCase().includes(searchTerm)
        const authorMatch = p.authors?.some(a => a?.toLowerCase().includes(searchTerm))
        const summaryMatch = p.laySummary?.toLowerCase().includes(searchTerm)
        return titleMatch || pmidMatch || journalMatch || authorMatch || summaryMatch
      }).slice(0, 25) // Limit to 25 results
      setSearchResults(matches)
    } catch (err) {
      console.error('Search failed', err)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  const handleDeletePublication = async (pmid) => {
    if (!requireAuthToken()) return
    if (!confirm(`Delete publication ${pmid} from cache?`)) return
    setActionLoading(prev => ({ ...prev, [pmid]: 'delete' }))
    try {
      const res = await fetch(`${PUBLICATION_URL}?pmid=${pmid}`, {
        method: 'DELETE',
        headers: {
          ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
        },
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage({ tone: 'positive', text: `Deleted ${pmid}` })
        setSearchResults(prev => prev?.filter(p => p.pmid !== pmid) || null)
        fetchStatus()
      } else {
        setMessage({ tone: 'critical', text: data.error || 'Delete failed' })
      }
    } catch (err) {
      setMessage({ tone: 'critical', text: err.message || 'Delete failed' })
    } finally {
      setActionLoading(prev => ({ ...prev, [pmid]: null }))
    }
  }

  const handleRegenerateSummary = async (pmid) => {
    if (!requireAuthToken()) return
    setActionLoading(prev => ({ ...prev, [pmid]: 'regenerate' }))
    try {
      const res = await fetch(PUBLICATION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
        },
        body: JSON.stringify({ pmid }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage({ tone: 'positive', text: `Regenerated summary for ${pmid}` })
        // Update the search result with new summary
        setSearchResults(prev => prev?.map(p => 
          p.pmid === pmid ? { ...p, laySummary: data.summary } : p
        ) || null)
        fetchStatus()
      } else {
        setMessage({ tone: 'critical', text: data.error || 'Regenerate failed' })
      }
    } catch (err) {
      setMessage({ tone: 'critical', text: err.message || 'Regenerate failed' })
    } finally {
      setActionLoading(prev => ({ ...prev, [pmid]: null }))
    }
  }

  const handleRefresh = async () => {
    if (!requireAuthToken()) return
    setRefreshing(true)
    setMessage(null)
    try {
      const res = await fetch(REFRESH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
        },
        body: JSON.stringify({ trigger: 'sanity-tool' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage({ tone: 'positive', text: `Refreshed! ${data.meta?.counts?.combined || 0} publications, ${data.meta?.summaries?.generated || 0} new summaries` })
        fetchStatus()
      } else {
        setMessage({ tone: 'critical', text: data.error || 'Refresh failed' })
      }
    } catch (err) {
      setMessage({ tone: 'critical', text: err.message || 'Network error' })
    } finally {
      setRefreshing(false)
    }
  }

  const handleCancel = async () => {
    if (!requireAuthToken()) return
    try {
      const res = await fetch(CANCEL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
        },
        body: JSON.stringify({ trigger: 'sanity-tool' }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setMessage({ tone: 'caution', text: 'Cancelled and lock cleared' })
        fetchStatus()
      } else {
        setMessage({ tone: 'critical', text: data.error || 'Cancel failed' })
      }
    } catch (err) {
      setMessage({ tone: 'critical', text: err.message || 'Network error' })
    }
  }

  const handleUpload = async () => {
    if (!requireAuthToken()) return
    const attemptUpload = async (force = false) => {
      const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
        },
        body: JSON.stringify({ trigger: 'sanity-tool', force }),
      })
      const data = await res.json().catch(() => ({}))
      return { res, data }
    }

    setUploading(true)
    setMessage(null)
    try {
      let { res, data } = await attemptUpload(false)
      if (res.ok) {
        setMessage({ tone: 'positive', text: `Uploaded! ${data.stats?.publications || 0} publications, ${data.stats?.withSummary || 0} with summaries` })
        fetchStatus()
        return
      }

      if (res.status === 409 && data?.code === 'LOCAL_CACHE_OLDER') {
        const localDate = data?.details?.localGeneratedAt
        const sanityDate = data?.details?.sanityLastRefreshedAt
        const shouldProceed = window.confirm(
          `Local cache (${formatDate(localDate)}) is older than Sanity (${formatDate(sanityDate)}). Re-upload anyway?`
        )
        if (!shouldProceed) {
          setMessage({ tone: 'caution', text: 'Upload canceled (local cache older than Sanity).' })
          return
        }
        ;({ res, data } = await attemptUpload(true))
        if (res.ok) {
          setMessage({ tone: 'positive', text: `Uploaded! ${data.stats?.publications || 0} publications, ${data.stats?.withSummary || 0} with summaries` })
          fetchStatus()
          return
        }
      }
      setMessage({ tone: 'critical', text: data.error || 'Upload failed' })
    } catch (err) {
      setMessage({ tone: 'critical', text: err.message || 'Network error' })
    } finally {
      setUploading(false)
    }
  }

  const handleDownload = async () => {
    if (!requireAuthToken()) return
    setDownloading(true)
    setMessage(null)
    try {
      const res = await fetch(DOWNLOAD_URL, {
        method: 'GET',
        headers: {
          ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
        },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Download failed')
      }
      const blob = await res.blob()
      const disposition = res.headers.get('content-disposition') || ''
      const match = disposition.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || 'pubmed-cache.json'
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      setMessage({ tone: 'positive', text: 'Download started' })
    } catch (err) {
      setMessage({ tone: 'critical', text: err.message || 'Download failed' })
    } finally {
      setDownloading(false)
    }
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never'
    try {
      return new Intl.DateTimeFormat('en-CA', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
      }).format(new Date(dateStr)) + ' UTC'
    } catch {
      return dateStr
    }
  }

  return (
    <Card padding={4}>
      <Stack space={5}>
        <Heading as="h1" size={2}>
          <Flex align="center" gap={2}>
            <DatabaseIcon />
            PubMed Cache Manager
          </Flex>
        </Heading>

        {/* Status Card */}
        <Card padding={4} radius={2} shadow={1} tone="primary">
          <Stack space={3}>
            <Heading as="h2" size={1}>Cache Status</Heading>
            {loading ? (
              <Flex align="center" gap={2}>
                <Spinner />
                <Text size={1}>Loading...</Text>
              </Flex>
            ) : status ? (
              <Stack space={2}>
                <Flex gap={2} align="center">
                  <Text size={1} weight="semibold">Last refreshed:</Text>
                  <Text size={1}>{formatDate(status.lastRefreshedAt)}</Text>
                </Flex>
                <Flex gap={2} align="center">
                  <Text size={1} weight="semibold">Publications:</Text>
                  <Badge tone="primary">{status.totalPublications || 0}</Badge>
                </Flex>
                <Flex gap={2} align="center">
                  <Text size={1} weight="semibold">With summaries:</Text>
                  <Badge tone="positive">{status.totalWithSummary || 0}</Badge>
                </Flex>
                {status.refreshInProgress && (
                  <Badge tone="caution">Refresh in progress...</Badge>
                )}
                {!status.refreshInProgress && isCacheStale(status.lastRefreshedAt) && (
                  <Badge tone="caution">Refresh recommended</Badge>
                )}
              </Stack>
            ) : (
              <Text size={1} muted>No cache found. Run a refresh to create one.</Text>
            )}
          </Stack>
        </Card>

        {/* Search */}
        <Card padding={4} radius={2} shadow={1} tone="default">
          <Stack space={4}>
            <Heading as="h2" size={1}>
              <Flex align="center" gap={2}>
                <SearchIcon />
                Search Publications
              </Flex>
            </Heading>
            <Flex gap={2}>
              <Box flex={1}>
                <TextInput
                  placeholder="Search by title, PMID, journal, or author..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.currentTarget.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                />
              </Box>
              <Button
                tone="primary"
                text={searching ? 'Searching...' : 'Search'}
                onClick={handleSearch}
                disabled={searching}
              />
            </Flex>
            
            {searchResults !== null && (
              <Stack space={3}>
                <Text size={1} muted>
                  {searchResults.length === 0
                    ? 'No results found'
                    : `Found ${searchResults.length}${searchResults.length === 25 ? '+' : ''} result${searchResults.length !== 1 ? 's' : ''}`}
                </Text>
                {searchResults.map((pub) => (
                  <Card key={pub.pmid} padding={3} radius={2} tone="transparent" style={{ background: '#f9f9f9' }}>
                    <Stack space={2}>
                      <Text size={1} weight="semibold" style={{ lineHeight: 1.4 }}>
                        {pub.title}
                      </Text>
                      <Text size={0} muted>
                        {pub.journal} · {pub.year} · PMID: {pub.pmid}
                      </Text>
                      {pub.laySummary && (
                        <Card padding={2} radius={1} tone="positive" style={{ background: '#ecfdf5' }}>
                          <Text size={1} style={{ fontStyle: 'italic', color: '#065f46' }}>
                            {pub.laySummary}
                          </Text>
                        </Card>
                      )}
                      {!pub.laySummary && (
                        <Badge tone="caution">No summary</Badge>
                      )}
                      <Flex gap={2} marginTop={2}>
                        <Button
                          tone="primary"
                          mode="ghost"
                          fontSize={1}
                          padding={2}
                          text={actionLoading[pub.pmid] === 'regenerate' ? 'Regenerating...' : 'Regenerate Summary'}
                          onClick={() => handleRegenerateSummary(pub.pmid)}
                          disabled={!!actionLoading[pub.pmid]}
                        />
                        <Button
                          tone="critical"
                          mode="ghost"
                          fontSize={1}
                          padding={2}
                          text={actionLoading[pub.pmid] === 'delete' ? 'Deleting...' : 'Delete'}
                          onClick={() => handleDeletePublication(pub.pmid)}
                          disabled={!!actionLoading[pub.pmid]}
                        />
                      </Flex>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            )}
          </Stack>
        </Card>

        {/* Actions */}
        <Card padding={4} radius={2} shadow={1}>
          <Stack space={4}>
            <Heading as="h2" size={1}>Actions</Heading>
            <Text size={1} muted>
              Requires Next.js dev server running locally (npm run dev). No timeout limits when running locally!
            </Text>
            
            <Stack space={3}>
              <Text size={2} weight="semibold">Step 1: Build/Refresh Cache</Text>
              <Text size={1} muted>Fetches all publications from PubMed and generates AI summaries for new papers.</Text>
              <Button
                tone="primary"
                text={refreshing ? 'Refreshing...' : 'Refresh Cache'}
                onClick={handleRefresh}
                disabled={refreshing || uploading || downloading}
              />
            </Stack>

            <Stack space={3}>
              <Text size={2} weight="semibold">Re-upload to Sanity (Optional)</Text>
              <Text size={1} muted>Refresh already saves to Sanity. Use this only if Sanity sync failed or to re-upload from local file.</Text>
              <Button
                tone="default"
                mode="ghost"
                text={uploading ? 'Uploading...' : 'Re-upload to Sanity'}
                onClick={handleUpload}
                disabled={refreshing || uploading || downloading}
              />
            </Stack>

            <Stack space={3}>
              <Text size={2} weight="semibold">Download cache from Sanity</Text>
              <Text size={1} muted>Grab the current cache JSON stored in Sanity directly to your machine.</Text>
              <Button
                tone="default"
                mode="ghost"
                text={downloading ? 'Downloading...' : 'Download cache JSON'}
                onClick={handleDownload}
                disabled={refreshing || uploading || downloading}
              />
            </Stack>

            <Stack space={3}>
              <Text size={2} weight="semibold">Troubleshooting</Text>
              <Button
                tone="critical"
                mode="ghost"
                text="Cancel / Clear Lock"
                onClick={handleCancel}
              />
            </Stack>

            {message && (
              <Card padding={3} radius={2} tone={message.tone}>
                <Text size={1}>{message.text}</Text>
              </Card>
            )}
          </Stack>
        </Card>

        {/* Cache Preview */}
        {status?.recentWithSummary?.length > 0 && (
          <Card padding={4} radius={2} shadow={1}>
            <Stack space={4}>
              <Heading as="h2" size={1}>Sample Publications with Summaries</Heading>
              <Stack space={3}>
                {status.recentWithSummary.map((pub) => (
                  <Card key={pub.pmid} padding={3} radius={2} tone="transparent" style={{ background: '#f9f9f9' }}>
                    <Stack space={2}>
                      <Text size={1} weight="semibold" style={{ lineHeight: 1.4 }}>
                        {pub.title?.length > 120 ? pub.title.slice(0, 120) + '...' : pub.title}
                      </Text>
                      <Text size={0} muted>
                        {pub.journal} · {pub.year} · PMID: {pub.pmid}
                      </Text>
                      <Card padding={2} radius={1} tone="positive" style={{ background: '#ecfdf5' }}>
                        <Text size={1} style={{ fontStyle: 'italic', color: '#065f46' }}>
                          {pub.laySummary}
                        </Text>
                      </Card>
                    </Stack>
                  </Card>
                ))}
              </Stack>
            </Stack>
          </Card>
        )}

        {/* Papers needing summaries */}
        {status?.recentWithoutSummary?.length > 0 && (
          <Card padding={4} radius={2} shadow={1} tone="caution">
            <Stack space={3}>
              <Heading as="h2" size={1}>Papers Still Needing Summaries</Heading>
              <Text size={1} muted>These papers don't have AI summaries yet. Run a refresh to generate them.</Text>
              <Stack space={2}>
                {status.recentWithoutSummary.map((pub) => (
                  <Text key={pub.pmid} size={1}>
                    • {pub.title?.length > 80 ? pub.title.slice(0, 80) + '...' : pub.title} ({pub.year})
                  </Text>
                ))}
              </Stack>
            </Stack>
          </Card>
        )}

        {/* Terminal Alternative */}
        <Card padding={4} radius={2} shadow={1} tone="transparent">
          <Stack space={3}>
            <Heading as="h2" size={1}>Terminal Alternative</Heading>
            <Text size={1} muted>
              You can also run these commands directly in your terminal (without the dev server):
            </Text>
            <Card padding={3} radius={2} tone="transparent" style={{ background: '#1a1a1a' }}>
              <Stack space={2}>
                <Code size={1} style={{ color: '#22c55e' }}>npm run refresh:pubmed</Code>
                <Code size={1} style={{ color: '#22c55e' }}>npm run upload:pubmed</Code>
              </Stack>
            </Card>
          </Stack>
        </Card>

        {/* Cron Info */}
        <Card padding={4} radius={2} shadow={1} tone="transparent">
          <Stack space={3}>
            <Heading as="h2" size={1}>Automatic Updates</Heading>
            <Text size={1}>
              Once deployed, the cache refreshes automatically via Vercel cron at 2am UTC daily.
              It only generates summaries for new papers, so it stays fast.
            </Text>
          </Stack>
        </Card>
      </Stack>
    </Card>
  )
}

export const pubmedCacheTool = definePlugin(() => ({
  name: 'pubmed-cache-tool',
  tools: [
    {
      name: 'pubmed-cache',
      title: 'PubMed Cache',
      icon: DatabaseIcon,
      component: PubmedCacheTool,
    },
  ],
}))
