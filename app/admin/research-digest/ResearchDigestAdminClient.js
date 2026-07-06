'use client'

import { useEffect, useMemo, useState } from 'react'

const EMPTY_PAYLOAD = {
  date: '',
  issue: null,
  issues: [],
  papers: [],
  opportunities: [],
  stats: {},
}

export default function ResearchDigestAdminClient() {
  const [payload, setPayload] = useState(EMPTY_PAYLOAD)
  const [selectedDate, setSelectedDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState({ type: 'idle', text: '' })
  const [paperEdits, setPaperEdits] = useState({})
  const [opportunityEdits, setOpportunityEdits] = useState({})

  const approvedPaperCount = useMemo(
    () => payload.papers.filter((paper) => paper.approvalStatus === 'approved').length,
    [payload.papers]
  )

  async function load(date = selectedDate) {
    setLoading(true)
    setMessage({ type: 'idle', text: '' })
    try {
      const qs = date ? `?date=${encodeURIComponent(date)}` : ''
      const res = await fetch(`/api/research-digest/admin${qs}`)
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Failed to load research digest.')
      }
      setPayload(data)
      setSelectedDate(data.date || date || '')
      setPaperEdits(Object.fromEntries((data.papers || []).map((paper) => [paper._id, paper])))
      setOpportunityEdits(Object.fromEntries((data.opportunities || []).map((item) => [item._id, item])))
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Failed to load research digest.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runImport() {
    setWorking(true)
    setMessage({ type: 'idle', text: '' })
    try {
      const res = await fetch('/api/research-digest/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import' }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Import failed.')
      }
      const papers = data.result?.papers
      const opportunities = data.result?.opportunities
      setMessage({
        type: 'success',
        text: `Import complete: ${papers?.created || 0} new papers and ${opportunities?.created || 0} new opportunities.`,
      })
      await load(data.result?.papers?.issueDate || selectedDate)
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Import failed.' })
    } finally {
      setWorking(false)
    }
  }

  async function patchResource(resource, id, action, fields = {}) {
    setWorking(true)
    setMessage({ type: 'idle', text: '' })
    try {
      const res = await fetch('/api/research-digest/admin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource, id, action, fields }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Update failed.')
      }
      setMessage({ type: 'success', text: 'Saved.' })
      await load(selectedDate)
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Update failed.' })
    } finally {
      setWorking(false)
    }
  }

  async function sendDigest(force = false) {
    if (!payload.issue?._id) return
    setWorking(true)
    setMessage({ type: 'idle', text: '' })
    try {
      const res = await fetch('/api/updates/research-digest/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueDate: payload.issue.date, force }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Send failed.')
      }
      const summary = data.skipped
        ? `Send skipped: ${data.reason}`
        : `Send complete: ${data.stats?.sent || 0} sent, ${data.stats?.errors || 0} errors.`
      setMessage({ type: data.skipped ? 'idle' : 'success', text: summary })
      await load(selectedDate)
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Send failed.' })
    } finally {
      setWorking(false)
    }
  }

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">Updates Admin</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Research digest review</h1>
        <p className="text-gray-600 max-w-3xl">
          Import PubMed and opportunity candidates, approve the daily issue, and send the approved digest to subscribers.
        </p>
      </header>

      <section className="bg-white border border-black/5 p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className="text-sm font-medium">Issue date</span>
            <input
              type="date"
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="border border-black/10 px-3 py-2"
            />
          </label>
          <button className="btn-secondary" disabled={loading || working} onClick={() => load(selectedDate)}>
            Load
          </button>
          <button className="btn-primary" disabled={loading || working} onClick={runImport}>
            Import candidates
          </button>
          {payload.issue?._id && (
            <>
              <button
                className="btn-secondary"
                disabled={working}
                onClick={() => patchResource('issue', payload.issue._id, 'approve')}
              >
                Approve issue
              </button>
              <button className="btn-secondary" disabled={working} onClick={() => sendDigest(false)}>
                Send approved digest
              </button>
            </>
          )}
        </div>

        {message.text && (
          <p className={`text-sm ${message.type === 'error' ? 'text-red-700' : message.type === 'success' ? 'text-emerald-700' : 'text-[#666]'}`}>
            {message.text}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-4 text-sm">
          <Stat label="Issue status" value={payload.issue?.status || 'No issue'} />
          <Stat label="Approved papers" value={approvedPaperCount} />
          <Stat label="Pending papers" value={payload.stats?.pendingPapers || 0} />
          <Stat label="Pending opportunities" value={payload.stats?.pendingOpportunities || 0} />
        </div>
      </section>

      {loading ? (
        <div className="bg-white border border-black/5 p-6 animate-pulse h-64" />
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Papers for {payload.date}</h2>
            {!payload.papers.length && <p className="text-[#666]">No paper candidates for this issue.</p>}
            <div className="space-y-4">
              {payload.papers.map((paper) => (
                <PaperReviewCard
                  key={paper._id}
                  paper={paper}
                  edit={paperEdits[paper._id] || paper}
                  setEdit={(next) => setPaperEdits((prev) => ({ ...prev, [paper._id]: next }))}
                  disabled={working}
                  onSave={() => patchResource('paper', paper._id, 'save', paperEdits[paper._id] || paper)}
                  onApprove={() => patchResource('paper', paper._id, 'approve', paperEdits[paper._id] || paper)}
                  onReject={() => patchResource('paper', paper._id, 'reject')}
                />
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Grant and conference opportunities</h2>
            {!payload.opportunities.length && <p className="text-[#666]">No pending or approved opportunities.</p>}
            <div className="grid gap-4 md:grid-cols-2">
              {payload.opportunities.map((item) => (
                <OpportunityReviewCard
                  key={item._id}
                  item={item}
                  edit={opportunityEdits[item._id] || item}
                  setEdit={(next) => setOpportunityEdits((prev) => ({ ...prev, [item._id]: next }))}
                  disabled={working}
                  onSave={() => patchResource('opportunity', item._id, 'save', opportunityEdits[item._id] || item)}
                  onApprove={() => patchResource('opportunity', item._id, 'approve', opportunityEdits[item._id] || item)}
                  onReject={() => patchResource('opportunity', item._id, 'reject')}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </main>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-[#f8f8f8] border border-black/5 p-3">
      <p className="text-xs uppercase tracking-wide text-[#777]">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  )
}

function PaperReviewCard({ paper, edit, setEdit, disabled, onSave, onApprove, onReject }) {
  return (
    <article className="bg-white border border-black/5 p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-4xl">
          <h3 className="text-lg font-semibold">{paper.title}</h3>
          <p className="text-sm text-[#666]">
            {[paper.journal, paper.pubDate || paper.year, paper.tier, paper.triageStatus, paper.approvalStatus]
              .filter(Boolean)
              .join(' - ')}
          </p>
          {paper.matchedJournalGroups?.length > 0 && (
            <p className="text-xs text-[#777]">Matched: {paper.matchedJournalGroups.join(', ')}</p>
          )}
          {paper.triageError && <p className="text-xs text-amber-700">Triage warning: {paper.triageError}</p>}
        </div>
        {paper.pmid && (
          <a href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`} target="_blank" rel="noreferrer" className="text-sm text-purple font-semibold">
            PMID {paper.pmid}
          </a>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-[160px_1fr]">
        <label className="grid gap-1">
          <span className="text-sm font-medium">Tier</span>
          <select
            value={edit.tier || 'Tier 3'}
            onChange={(event) => setEdit({ ...edit, tier: event.target.value })}
            className="border border-black/10 px-3 py-2"
          >
            <option>Tier 1</option>
            <option>Tier 2</option>
            <option>Tier 3</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Why it matters</span>
          <input
            value={edit.whyItMatters || ''}
            onChange={(event) => setEdit({ ...edit, whyItMatters: event.target.value })}
            className="border border-black/10 px-3 py-2"
          />
        </label>
      </div>

      <label className="grid gap-1">
        <span className="text-sm font-medium">Summary</span>
        <textarea
          value={edit.summary || ''}
          onChange={(event) => setEdit({ ...edit, summary: event.target.value })}
          rows={3}
          className="border border-black/10 px-3 py-2"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={disabled} onClick={onSave}>Save edits</button>
        <button className="btn-primary" disabled={disabled} onClick={onApprove}>Approve</button>
        <button className="btn-secondary" disabled={disabled} onClick={onReject}>Reject</button>
      </div>
    </article>
  )
}

function OpportunityReviewCard({ item, edit, setEdit, disabled, onSave, onApprove, onReject }) {
  return (
    <article className="bg-white border border-black/5 p-5 space-y-3">
      <p className="text-xs uppercase tracking-wide text-[#777]">
        {[item.sourceName, item.type, item.approvalStatus].filter(Boolean).join(' - ')}
      </p>
      <label className="grid gap-1">
        <span className="text-sm font-medium">Title</span>
        <input
          value={edit.title || ''}
          onChange={(event) => setEdit({ ...edit, title: event.target.value })}
          className="border border-black/10 px-3 py-2"
        />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-sm font-medium">Type</span>
          <select
            value={edit.type || 'other'}
            onChange={(event) => setEdit({ ...edit, type: event.target.value })}
            className="border border-black/10 px-3 py-2"
          >
            <option value="grant">Grant</option>
            <option value="conference">Conference</option>
            <option value="award">Award</option>
            <option value="training">Training</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Deadline</span>
          <input
            type="date"
            value={edit.deadline || ''}
            onChange={(event) => setEdit({ ...edit, deadline: event.target.value })}
            className="border border-black/10 px-3 py-2"
          />
        </label>
      </div>
      <label className="grid gap-1">
        <span className="text-sm font-medium">Description</span>
        <textarea
          value={edit.description || ''}
          onChange={(event) => setEdit({ ...edit, description: event.target.value })}
          rows={3}
          className="border border-black/10 px-3 py-2"
        />
      </label>
      <label className="grid gap-1">
        <span className="text-sm font-medium">URL</span>
        <input
          value={edit.url || ''}
          onChange={(event) => setEdit({ ...edit, url: event.target.value })}
          className="border border-black/10 px-3 py-2"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={disabled} onClick={onSave}>Save edits</button>
        <button className="btn-primary" disabled={disabled} onClick={onApprove}>Approve</button>
        <button className="btn-secondary" disabled={disabled} onClick={onReject}>Reject</button>
      </div>
    </article>
  )
}
