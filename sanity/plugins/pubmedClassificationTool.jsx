import { useState, useCallback } from 'react'
import { definePlugin } from 'sanity'
import {
  Card,
  Stack,
  Text,
  Button,
  Code,
  Heading,
  Flex,
  Badge,
  Box,
  TextArea,
  TextInput,
  Switch,
  Select,
} from '@sanity/ui'
import { TagIcon } from '@sanity/icons'
import { DEFAULT_CLASSIFICATION_PROMPT } from '../../lib/classificationPrompt.js'

const BASE_URL = process.env.SANITY_STUDIO_API_URL || 'http://localhost:3000'
const PREVIEW_URL = process.env.SANITY_STUDIO_PUBMED_CLASSIFY_PREVIEW_URL || `${BASE_URL}/api/pubmed/classify-preview`
const RECLASSIFY_URL = process.env.SANITY_STUDIO_PUBMED_RECLASSIFY_URL || `${BASE_URL}/api/pubmed/reclassify`
const AUTH_TOKEN =
  process.env.SANITY_STUDIO_PUBMED_REFRESH_TOKEN ||
  process.env.SANITY_STUDIO_PUBMED_PREVIEW_TOKEN ||
  ''

const providerOptions = [
  { label: 'Default (settings)', value: '' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Together', value: 'together' },
  { label: 'Groq', value: 'groq' },
  { label: 'Ollama', value: 'ollama' },
  { label: 'Anthropic', value: 'anthropic' },
]

function ClassificationTool() {
  // shared inputs
  const [prompt, setPrompt] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [pmids, setPmids] = useState('')

  // preview
  const [previewCount, setPreviewCount] = useState(10)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewMsg, setPreviewMsg] = useState(null)
  const [previewResult, setPreviewResult] = useState(null)

  // reclassify
  const [classifyCount, setClassifyCount] = useState(20)
  const [clearExisting, setClearExisting] = useState(false)
  const [classifyLoading, setClassifyLoading] = useState(false)
  const [classifyMsg, setClassifyMsg] = useState(null)

  const headers = {
    'Content-Type': 'application/json',
    ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
  }

  const parsePmids = useCallback((text) => {
    return text
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter(Boolean)
  }, [])

  const runPreview = async () => {
    setPreviewLoading(true)
    setPreviewMsg(null)
    setPreviewResult(null)
    try {
      const res = await fetch(PREVIEW_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          count: previewCount,
          pmids: parsePmids(pmids),
          prompt: prompt.trim() || undefined,
          provider: provider || undefined,
          model: model.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Preview failed')
      }
      setPreviewResult(data)
      setPreviewMsg({ tone: 'positive', text: `Previewed ${data.count} items` })
    } catch (err) {
      setPreviewMsg({ tone: 'critical', text: err.message || 'Preview failed' })
    } finally {
      setPreviewLoading(false)
    }
  }

  const runReclassify = async () => {
    setClassifyLoading(true)
    setClassifyMsg(null)
    try {
      const res = await fetch(RECLASSIFY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          count: classifyCount,
          pmids: parsePmids(pmids),
          clear: clearExisting,
          prompt: prompt.trim() || undefined,
          provider: provider || undefined,
          model: model.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || 'Reclassify failed')
      }
      setClassifyMsg({ tone: 'positive', text: `Classified ${data.count} items` })
    } catch (err) {
      setClassifyMsg({ tone: 'critical', text: err.message || 'Reclassify failed' })
    } finally {
      setClassifyLoading(false)
    }
  }

  const cardStyle = { background: '#ffffff', border: '1px solid #e5e7eb', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }
  const inputStyle = { background: '#ffffff', color: '#111827', border: '1px solid #d1d5db' }
  const textareaStyle = { ...inputStyle, minHeight: '120px' }

  return (
    <Card padding={4} style={{ background: '#f8fafc' }}>
      <Stack space={5}>
        <Heading as="h1" size={2}>
          <Flex align="center" gap={2}>
            <TagIcon />
            Classification
          </Flex>
        </Heading>

        <Card padding={4} radius={2} shadow={1} style={cardStyle}>
          <Stack space={3}>
            <Text size={1}>
              Controls for previewing and writing classifications using cached publications (no PubMed fetch, no summary regeneration).
              Server token is used automatically (PUBMED_REFRESH_TOKEN / PUBMED_PREVIEW_TOKEN).
            </Text>
            <Text size={1} weight="semibold">Inputs</Text>
            <Stack space={3}>
              <Flex gap={3} wrap="wrap">
                <Box style={{ minWidth: 200, flex: 1 }}>
                  <Text size={1} muted>Provider override</Text>
                  <Select
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    style={inputStyle}
                  >
                    {providerOptions.map((p) => (
                      <option key={p.value || 'default'} value={p.value}>{p.label}</option>
                    ))}
                  </Select>
                </Box>
                <Box style={{ minWidth: 200, flex: 1 }}>
                  <Text size={1} muted>Model override</Text>
                  <TextInput
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g., openrouter/gpt-4o-mini"
                    style={inputStyle}
                  />
                </Box>
                <Box style={{ minWidth: 200, flex: 1 }}>
                  <Text size={1} muted>API key override (optional)</Text>
                  <TextInput
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Optional; overrides classification key/env"
                    style={inputStyle}
                  />
                </Box>
              </Flex>
              <Box>
                <Text size={1} muted>PMIDs (optional; comma/space separated)</Text>
                <TextArea
                  rows={2}
                  value={pmids}
                  onChange={(e) => setPmids(e.target.value)}
                  placeholder="If empty, operates on most recent by year."
                  style={inputStyle}
                />
              </Box>
              <Box>
                <Text size={1} muted>Classification prompt (optional override)</Text>
                <TextArea
                  rows={8}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Leave blank to use current setting; paste a test prompt to override."
                  style={textareaStyle}
                />
                <details style={{ marginTop: '0.5rem' }}>
                  <summary style={{ cursor: 'pointer', color: '#1f2937', fontSize: 12, fontWeight: 600 }}>Show default prompt</summary>
                  <Card padding={3} radius={2} tone="transparent" style={{ marginTop: '0.5rem', background: '#ffffff', border: '1px solid #e5e7eb', maxHeight: 320, overflow: 'auto' }}>
                    <Text size={1} style={{ whiteSpace: 'pre-wrap', color: '#1f2937' }}>
                      {DEFAULT_CLASSIFICATION_PROMPT}
                    </Text>
                  </Card>
                </details>
              </Box>
            </Stack>
          </Stack>
        </Card>

        <Card padding={4} radius={2} shadow={1} style={cardStyle}>
          <Stack space={3}>
            <Heading as="h2" size={1}>Preview (no writes)</Heading>
            <Flex gap={3} align="center">
              <Box style={{ minWidth: 140 }}>
                <Text size={1} muted>Count (1–50)</Text>
                <TextInput
                  type="number"
                  value={previewCount}
                  onChange={(e) => setPreviewCount(Number(e.target.value))}
                  min={1}
                  max={50}
                  style={inputStyle}
                />
              </Box>
              <Button
                tone="primary"
                text={previewLoading ? 'Previewing...' : 'Run preview'}
                onClick={runPreview}
                disabled={previewLoading}
              />
            </Flex>
            {previewMsg && (
              <Card padding={3} radius={2} tone={previewMsg.tone}>
                <Text size={1}>{previewMsg.text}</Text>
              </Card>
            )}
            {previewResult?.results?.length > 0 && (
              <Stack space={3}>
                <Text size={1} muted>Prompt used:</Text>
                <Card padding={3} radius={2} tone="transparent" style={{ background: '#ffffff', border: '1px solid #e5e7eb' }}>
                  <Code style={{ whiteSpace: 'pre-wrap', color: '#111827' }}>{previewResult.usedPrompt}</Code>
                </Card>
                <Card padding={3} radius={2} tone="transparent" style={{ border: '1px solid #e5e7eb', background: '#ffffff' }}>
                  <Stack space={3}>
                    {previewResult.results.map((r) => (
                      <Card key={r.pmid} padding={3} radius={2} tone="transparent" style={{ background: '#fff', border: '1px solid #f1f5f9' }}>
                        <Stack space={2}>
                          <Flex justify="space-between" align="center">
                            <Text size={1} weight="semibold">{r.title}</Text>
                            {r.exclude && <Badge tone="critical" style={{ textTransform: 'lowercase' }}>exclude: true</Badge>}
                          </Flex>
                          <Text size={0} muted>PMID {r.pmid} · {r.year || 'n/a'} · abstract {r.abstractChars} chars</Text>
                          {r.summary && (
                            <Card padding={2} radius={1} tone="positive" style={{ background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                              <Text size={1} style={{ color: '#0f172a' }}>{r.summary}</Text>
                            </Card>
                          )}
                          <Text size={0}><strong>Topics:</strong> {r.topics?.join(', ') || '—'}</Text>
                          <Text size={0}><strong>Study design:</strong> {r.studyDesign?.join(', ') || '—'}</Text>
                          <Text size={0}><strong>Methodological focus:</strong> {r.methodologicalFocus?.join(', ') || '—'}</Text>
                        </Stack>
                      </Card>
                    ))}
                  </Stack>
                </Card>
              </Stack>
            )}
          </Stack>
        </Card>

        <Card padding={4} radius={2} shadow={1} style={cardStyle}>
          <Stack space={3}>
            <Heading as="h2" size={1}>Reclassify (writes to pubmedClassification)</Heading>
            <Flex gap={3} align="center">
              <Box style={{ minWidth: 140 }}>
                <Text size={1} muted>Count (1–200, ignored if PMIDs provided)</Text>
                <TextInput
                  type="number"
                  value={classifyCount}
                  onChange={(e) => setClassifyCount(Number(e.target.value))}
                  min={1}
                  max={200}
                  style={inputStyle}
                />
              </Box>
              <Flex align="center" gap={2}>
                <Switch
                  checked={clearExisting}
                  onChange={(e) => setClearExisting(e.target.checked)}
                  id="clear-existing"
                />
                <Text size={1} htmlFor="clear-existing">Clear existing classifications first</Text>
              </Flex>
              <Button
                tone="primary"
                text={classifyLoading ? 'Reclassifying...' : 'Run reclassification'}
                onClick={runReclassify}
                disabled={classifyLoading}
              />
            </Flex>
            {classifyMsg && (
              <Card padding={3} radius={2} tone={classifyMsg.tone}>
                <Text size={1}>{classifyMsg.text}</Text>
              </Card>
            )}
          </Stack>
        </Card>
      </Stack>
    </Card>
  )
}

export const pubmedClassificationTool = definePlugin(() => ({
  name: 'pubmed-classification-tool',
  tools: [
    {
      name: 'pubmed-classification',
      title: 'Classification',
      icon: TagIcon,
      component: ClassificationTool,
    },
  ],
}))
