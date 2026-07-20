import { useCallback, useEffect, useState } from 'react'
import { definePlugin } from 'sanity'
import { Badge, Box, Button, Card, Flex, Heading, Spinner, Stack, Text, TextInput } from '@sanity/ui'
import { DatabaseIcon, SearchIcon } from '@sanity/icons'

const PROJECT_ID = process.env.SANITY_STUDIO_PROJECT_ID
const DATASET = process.env.SANITY_STUDIO_DATASET
const WORKFLOW_URL =
  process.env.SANITY_STUDIO_PUBMED_WORKFLOW_URL ||
  'https://github.com/proshano/KCRU-website/actions/workflows/pubmed-refresh.yml'
const HAS_STUDIO_CONFIG = Boolean(PROJECT_ID && DATASET)

async function fetchSanityQuery(query) {
  if (!HAS_STUDIO_CONFIG) throw new Error('Sanity Studio project and dataset are not configured.')
  const encoded = encodeURIComponent(query)
  const response = await fetch(
    `https://${PROJECT_ID}.api.sanity.io/v2024-01-01/data/query/${DATASET}?query=${encoded}`
  )
  if (!response.ok) throw new Error(`Sanity query failed (${response.status}).`)
  const data = await response.json()
  return data.result
}

function formatDate(value) {
  if (!value) return 'Never'
  try {
    return new Intl.DateTimeFormat('en-CA', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(value)) + ' UTC'
  } catch {
    return value
  }
}

function PubmedCacheTool() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState(null)

  const fetchStatus = useCallback(async () => {
    try {
      const result = await fetchSanityQuery(`*[_type == "pubmedCache" && _id == "pubmedCache"][0]{
        lastRefreshedAt,
        refreshInProgress,
        "totalPublications": stats.totalPublications,
        "totalWithSummary": stats.totalWithSummary
      }`)
      setStatus(result || null)
      setMessage(null)
    } catch (error) {
      setMessage({ tone: 'critical', text: error.message || 'Unable to load cache status.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 30_000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  const handleSearch = useCallback(async () => {
    const term = searchQuery.trim().toLowerCase()
    if (!term) {
      setSearchResults(null)
      return
    }

    setSearching(true)
    try {
      const publications = await fetchSanityQuery(`*[_type == "pubmedCache"][0].publications[]{
        publicationKey,
        pmid,
        doi,
        title,
        journal,
        year,
        laySummary,
        authors
      }`)
      const matches = (publications || []).filter((publication) => {
        return publication.title?.toLowerCase().includes(term) ||
          publication.pmid?.includes(term) ||
          publication.doi?.toLowerCase().includes(term) ||
          publication.journal?.toLowerCase().includes(term) ||
          publication.authors?.some((author) => author?.toLowerCase().includes(term)) ||
          publication.laySummary?.toLowerCase().includes(term)
      }).slice(0, 25)
      setSearchResults(matches)
    } catch (error) {
      setSearchResults([])
      setMessage({ tone: 'critical', text: error.message || 'Search failed.' })
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  const openWorkflow = () => {
    if (typeof window !== 'undefined') {
      window.open(WORKFLOW_URL, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <Card padding={4}>
      <Stack space={5}>
        <Heading as="h1" size={2}>
          <Flex align="center" gap={2}>
            <DatabaseIcon />
            PubMed Cache
          </Flex>
        </Heading>

        <Card padding={4} radius={2} shadow={1} tone="primary">
          <Stack space={3}>
            <Heading as="h2" size={1}>Cache status</Heading>
            {loading ? (
              <Flex align="center" gap={2}><Spinner /><Text size={1}>Loading...</Text></Flex>
            ) : status ? (
              <Stack space={2}>
                <Text size={1}>Last refreshed: {formatDate(status.lastRefreshedAt)}</Text>
                <Flex gap={2} align="center">
                  <Badge tone="primary">{status.totalPublications || 0} publications</Badge>
                  <Badge tone="positive">{status.totalWithSummary || 0} summaries</Badge>
                  {status.refreshInProgress && <Badge tone="caution">Refresh in progress</Badge>}
                </Flex>
              </Stack>
            ) : (
              <Text size={1} muted>No cache found.</Text>
            )}
            <Box>
              <Button tone="primary" text="Open PubMed refresh workflow" onClick={openWorkflow} />
            </Box>
          </Stack>
        </Card>

        <Card padding={4} radius={2} shadow={1}>
          <Stack space={3}>
            <Heading as="h2" size={1}>
              <Flex align="center" gap={2}><SearchIcon />Search publications</Flex>
            </Heading>
            <Flex gap={2}>
              <Box flex={1}>
                <TextInput
                  placeholder="Search by title, PMID, journal, or author"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
                />
              </Box>
              <Button tone="primary" text={searching ? 'Searching...' : 'Search'} onClick={handleSearch} disabled={searching} />
            </Flex>
            {searchResults !== null && (
              <Stack space={3}>
                <Text size={1} muted>{searchResults.length ? `${searchResults.length} result(s)` : 'No results found'}</Text>
                {searchResults.map((publication) => (
                  <Card key={publication.publicationKey || publication.pmid || publication.doi} padding={3} radius={2} tone="transparent">
                    <Stack space={2}>
                      <Text size={1} weight="semibold">{publication.title}</Text>
                      <Text size={0} muted>
                        {publication.journal} | {publication.year} | {publication.pmid ? `PMID ${publication.pmid}` : `DOI ${publication.doi}`}
                      </Text>
                      {publication.laySummary && <Text size={1}>{publication.laySummary}</Text>}
                    </Stack>
                  </Card>
                ))}
              </Stack>
            )}
          </Stack>
        </Card>

        {message && <Card padding={3} radius={2} tone={message.tone}><Text size={1}>{message.text}</Text></Card>}
      </Stack>
    </Card>
  )
}

export const pubmedCacheTool = definePlugin(() => ({
  name: 'pubmed-cache-tool',
  tools: [{ name: 'pubmed-cache', title: 'PubMed Cache', icon: DatabaseIcon, component: PubmedCacheTool }],
}))
