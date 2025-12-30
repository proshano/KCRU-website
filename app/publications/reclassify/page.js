'use client'

import { useState } from 'react'
import { DEFAULT_CLASSIFICATION_PROMPT } from '@/lib/classificationPrompt'

const providers = [
  { label: 'Default (settings)', value: '' },
  { label: 'OpenRouter', value: 'openrouter' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Together', value: 'together' },
  { label: 'Groq', value: 'groq' },
  { label: 'Ollama', value: 'ollama' },
  { label: 'Anthropic', value: 'anthropic' },
]

export default function ReclassifyPage() {
  const [token, setToken] = useState('')
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState(20)
  const [pmids, setPmids] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [clearExisting, setClearExisting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [response, setResponse] = useState(null)

  function parsePmids(text) {
    return text
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter(Boolean)
  }

  async function runReclassify(e) {
    e.preventDefault()
    setError('')
    setResponse(null)
    if (!token) {
      setError('Provide the auth token (Authorization: Bearer ...).')
      return
    }
    setLoading(true)
    try {
      const pmidsList = parsePmids(pmids)
      const res = await fetch('/api/pubmed/reclassify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          count,
          pmids: pmidsList.length ? pmidsList : undefined,
          clear: clearExisting,
          prompt: prompt.trim() || undefined,
          provider: provider || undefined,
          model: model.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setResponse(data)
    } catch (err) {
      setError(err.message || 'Reclassify failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="max-w-6xl mx-auto px-6 md:px-10 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">Reclassify Publications</h1>
        <p className="text-sm text-gray-600">
          Runs classification only, using cached publications and lay summaries; writes classifications to a separate
          Sanity document. No PubMed fetch and no summary regeneration.
        </p>
      </header>

      <form className="space-y-4 bg-white border border-black/5 p-6 shadow-sm" onSubmit={runReclassify}>
        <div className="space-y-1">
          <label className="text-sm font-medium">Auth token (required)</label>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Bearer token (preview/refresh token)"
            className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
            autoComplete="off"
          />
          <p className="text-xs text-gray-500">Uses PUBMED_PREVIEW_TOKEN (or PUBMED_REFRESH_TOKEN fallback).</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Count (1–200, ignored if PMIDs provided)</label>
            <input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
            />
            <p className="text-xs text-gray-500">
              By default, only unclassified publications are selected; provide PMIDs or enable &ldquo;Clear existing&rdquo; to re-run classified items.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Provider override</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple"
            >
              {providers.map((p) => (
                <option key={p.value || 'default'} value={p.value}>{p.label}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500">Leave blank to use site settings.</p>
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Model override</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g., openrouter/gpt-4o-mini"
              className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">LLM API key override (optional)</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="If provided, overrides site settings/env"
            className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">PMIDs (optional, comma/space separated)</label>
          <textarea
            value={pmids}
            onChange={(e) => setPmids(e.target.value)}
            rows={3}
            placeholder="Provide specific PMIDs to reclassify; leave blank to use most recent by year."
            className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple font-mono text-sm"
          />
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={clearExisting}
              onChange={(e) => setClearExisting(e.target.checked)}
              className="h-4 w-4"
            />
            Clear existing classifications for these PMIDs before reclassifying
          </label>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Classification prompt (optional override)</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={10}
            placeholder="Leave blank to use current setting; paste a test prompt here to override."
            className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple font-mono text-sm"
          />
          <details className="text-xs text-gray-600">
            <summary className="cursor-pointer text-purple font-medium">Show default prompt</summary>
            <pre className="whitespace-pre-wrap mt-2 p-3 bg-gray-50 border border-black/5 rounded">
              {DEFAULT_CLASSIFICATION_PROMPT}
            </pre>
          </details>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? 'Reclassifying...' : 'Run reclassification'}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      </form>

      {response && (
        <section className="space-y-3">
          <div className="text-sm text-gray-700 space-y-1">
            <div>Provider: {response.provider || 'default (settings)'}</div>
            <div>Model: {response.model || 'default (settings)'}</div>
            <div>Items classified: {response.count}</div>
            {response.selection && (
              <>
                <div>
                  Selected: {response.selection.selectedCount} · Skipped already classified:{' '}
                  {response.selection.skippedAlreadyClassified || 0}
                </div>
                {response.selection.appliedMissingOnly && (
                  <div>Mode: unclassified items only (use Clear existing to re-run everything).</div>
                )}
                <div className="text-xs text-gray-500">
                  Missing: {response.selection.missingCount || 0} · Stale: {response.selection.staleCount || 0} · Errored: {response.selection.erroredCount || 0}
                  {response.selection.cacheGeneratedAt && (
                    <> · Cache refreshed at: {new Date(response.selection.cacheGeneratedAt).toLocaleString()}</>
                  )}
                </div>
              </>
            )}
            {response.message && <div>{response.message}</div>}
          </div>
          <div className="text-sm">
            <details>
              <summary className="cursor-pointer text-purple font-medium">Prompt used</summary>
              <pre className="whitespace-pre-wrap mt-2 p-3 bg-gray-50 border border-black/5 rounded text-xs">
                {response.usedPrompt}
              </pre>
            </details>
            {response.selection?.targetPreview?.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-purple font-medium">
                  Target preview ({Math.min(response.selection.targetPreview.length, 10)} of {response.selection.selectedCount})
                </summary>
                <div className="mt-2 space-y-1 text-xs text-gray-700">
                  {response.selection.targetPreview.slice(0, 10).map((t) => (
                    <div key={t.pmid}>
                      {t.pmid} · {t.year || 'n/a'} · {t.title}
                    </div>
                  ))}
                  {response.selection.targetPreview.length > 10 && <div>…truncated preview</div>}
                </div>
              </details>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
