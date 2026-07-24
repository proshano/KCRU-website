'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

const EMPTY_SETTINGS = {
  publicEnabled: false,
  automaticSelection: true,
  maxPapers: 1,
  minPriorityScore: 75,
  carryoverDays: 7,
  maxOpportunities: 8,
  sendEmpty: false,
  pilotMode: false,
  pilotRecipients: [],
  subjectTemplate: '',
  introText: '',
  emptyIntroText: '',
  outroText: '',
  signature: '',
  llmProvider: '',
  llmModel: '',
}

const EMPTY_PAYLOAD = {
  date: '',
  carryoverFrom: '',
  issue: null,
  history: [],
  papers: [],
  pool: [],
  poolSummary: { total: 0, qualifying: 0, carriedOver: 0, byStatus: {} },
  opportunities: [],
  subscribers: [],
  subscriberCounts: { optedIn: 0, deliverable: 0, unsubscribed: 0, suppressed: 0, neverSent: 0 },
  stats: {},
  warnings: [],
  journalGroups: [],
  opportunitySources: [],
  testing: { enabled: false, recipients: [] },
  settings: EMPTY_SETTINGS,
  digestSettings: EMPTY_SETTINGS,
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'history', label: 'History' },
  { key: 'email', label: 'Email preview' },
  { key: 'subscribers', label: 'Subscribers' },
  { key: 'papers', label: 'Paper review' },
  { key: 'settings', label: 'Settings' },
]

const DISPOSITION_STYLES = {
  selected: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  deferred: 'bg-sky-100 text-sky-900 border-sky-300',
  below_threshold: 'bg-amber-100 text-amber-900 border-amber-300',
  triage_excluded: 'bg-gray-100 text-gray-700 border-gray-300',
  excluded_type: 'bg-gray-100 text-gray-700 border-gray-300',
  missing_copy: 'bg-orange-100 text-orange-900 border-orange-300',
  manually_excluded: 'bg-rose-100 text-rose-900 border-rose-300',
  triage_failed: 'bg-red-100 text-red-900 border-red-300',
}

const ISSUE_STATUS_STYLES = {
  sent: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  approved: 'bg-sky-100 text-sky-900 border-sky-300',
  draft: 'bg-gray-100 text-gray-700 border-gray-300',
}

function formatDateTime(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleString()
}

function formatTime(value) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ResearchDigestAdminClient() {
  const [payload, setPayload] = useState(EMPTY_PAYLOAD)
  const [selectedDate, setSelectedDate] = useState('')
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState({ type: 'idle', text: '' })
  const [paperEdits, setPaperEdits] = useState({})
  const [opportunityEdits, setOpportunityEdits] = useState({})
  const [preview, setPreview] = useState(null)
  const [confirmForceSend, setConfirmForceSend] = useState(false)

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
      setPayload({ ...EMPTY_PAYLOAD, ...data })
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

  async function runAction(action, extra = {}) {
    setWorking(true)
    setMessage({ type: 'idle', text: '' })
    try {
      const res = await fetch('/api/research-digest/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || `${action} failed.`)
      }
      return data
    } finally {
      setWorking(false)
    }
  }

  async function runImport() {
    try {
      const data = await runAction('import')
      const papers = data.result?.papers
      const opportunities = data.result?.opportunities
      const selection = papers?.selection
      setMessage({
        type: 'success',
        text: `Import complete: ${papers?.fetched ?? 0} fetched, ${papers?.created ?? 0} new, ` +
          `${selection?.selected ?? 0} selected from a pool of ${selection?.pool ?? 0}` +
          (opportunities?.created ? `, ${opportunities.created} new opportunities` : '') + '.',
      })
      await load(papers?.issueDate || selectedDate)
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Import failed.' })
    }
  }

  async function runReselect() {
    try {
      const data = await runAction('reselect', { issueDate: selectedDate })
      const result = data.result || {}
      setMessage({
        type: 'success',
        text: result.frozen
          ? `Selection is frozen: the issue is already ${payload.issue?.status || 'approved'}, so nothing was changed.`
          : `Re-selected from a pool of ${result.pool ?? 0}: ${result.eligible ?? 0} eligible, ` +
            `${result.selected ?? 0} selected, ${result.deferred ?? 0} deferred.`,
      })
      await load(selectedDate)
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Re-selection failed.' })
    }
  }

  async function loadPreview(date = selectedDate) {
    try {
      const data = await runAction('preview', { issueDate: date })
      setPreview(data.preview)
      if (!data.preview?.available) {
        setMessage({ type: 'idle', text: data.preview?.reason || 'No preview available.' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Preview failed.' })
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
      return data
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Update failed.' })
      return null
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
        : `Send complete: ${data.stats?.sent || 0} sent, ${data.stats?.skipped || 0} skipped, ${data.stats?.errors || 0} errors.`
      setMessage({ type: data.skipped ? 'idle' : 'success', text: summary })
      setConfirmForceSend(false)
      await load(selectedDate)
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Send failed.' })
    } finally {
      setWorking(false)
    }
  }

  const busy = loading || working

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-6">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">Updates Admin</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Research digest console</h1>
        <p className="text-gray-600 max-w-3xl">
          Everything the automated digest does, without opening Sanity Studio. Weekday imports, paper selection, and
          subscriber delivery run from GitHub Actions on their own; this page shows what happened and lets you change
          the settings that govern it.
        </p>
      </header>

      {payload.warnings?.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 p-4 space-y-1">
          <p className="text-sm font-semibold text-amber-950">Attention</p>
          <ul className="text-sm text-amber-900 list-disc pl-5 space-y-1">
            {payload.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}

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
          <button className="btn-secondary" disabled={busy} onClick={() => load(selectedDate)}>
            Load
          </button>
          <div className="flex-1" />
          <RunControls
            busy={busy}
            issue={payload.issue}
            confirmForceSend={confirmForceSend}
            setConfirmForceSend={setConfirmForceSend}
            onImport={runImport}
            onReselect={runReselect}
            onSend={sendDigest}
          />
        </div>

        {message.text && (
          <p
            className={`text-sm ${
              message.type === 'error'
                ? 'text-red-700'
                : message.type === 'success'
                  ? 'text-emerald-700'
                  : 'text-[#666]'
            }`}
          >
            {message.text}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-6 text-sm">
          <Stat label="Issue status" value={payload.issue?.status || 'No issue'} />
          <Stat label="Shipping papers" value={payload.issue?.selectedPaperCount ?? approvedPaperCount} />
          <Stat label="Carried over" value={payload.issue?.carriedOverPaperCount ?? 0} />
          <Stat label="Pool size" value={payload.poolSummary?.total ?? 0} />
          <Stat label="Deliverable subs" value={payload.subscriberCounts?.deliverable ?? 0} />
          <Stat label="Sent at" value={payload.issue?.sentAt ? formatTime(payload.issue.sentAt) : 'Not sent'} />
        </div>
      </section>

      <nav className="flex flex-wrap gap-1 border-b border-black/10">
        {TABS.map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              tab === item.key
                ? 'border-purple text-purple'
                : 'border-transparent text-[#666] hover:text-[#333]'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="bg-white border border-black/5 p-6 animate-pulse h-64" />
      ) : (
        <>
          {tab === 'overview' && <OverviewTab payload={payload} />}
          {tab === 'pipeline' && <PipelineTab payload={payload} />}
          {tab === 'history' && (
            <HistoryTab
              payload={payload}
              onSelectDate={(date) => {
                setSelectedDate(date)
                load(date)
              }}
            />
          )}
          {tab === 'email' && (
            <EmailTab
              preview={preview}
              busy={busy}
              date={selectedDate || payload.date}
              onLoad={() => loadPreview(selectedDate || payload.date)}
            />
          )}
          {tab === 'subscribers' && <SubscribersTab payload={payload} />}
          {tab === 'papers' && (
            <PapersTab
              payload={payload}
              busy={working}
              paperEdits={paperEdits}
              setPaperEdits={setPaperEdits}
              opportunityEdits={opportunityEdits}
              setOpportunityEdits={setOpportunityEdits}
              patchResource={patchResource}
            />
          )}
          {tab === 'settings' && (
            <SettingsTab
              payload={payload}
              busy={busy}
              onSave={(fields) => patchResource('settings', null, 'save', fields)}
            />
          )}
        </>
      )}
    </main>
  )
}

function RunControls({ busy, issue, confirmForceSend, setConfirmForceSend, onImport, onReselect, onSend }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button className="btn-secondary" disabled={busy} onClick={onImport}>
        Run import
      </button>
      <button className="btn-secondary" disabled={busy} onClick={onReselect}>
        Re-run selection
      </button>
      <button className="btn-primary" disabled={busy || !issue?._id} onClick={() => onSend(false)}>
        Send
      </button>
      {confirmForceSend ? (
        <span className="inline-flex items-center gap-2 bg-red-50 border border-red-300 px-3 py-1.5">
          <span className="text-xs text-red-900">
            Force resends to every opted-in subscriber, including anyone already sent this issue. Sure?
          </span>
          <button
            className="text-xs font-semibold text-red-900 underline"
            disabled={busy}
            onClick={() => onSend(true)}
          >
            Force send
          </button>
          <button className="text-xs text-red-900" onClick={() => setConfirmForceSend(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          className="text-sm text-red-700 underline"
          disabled={busy || !issue?._id}
          onClick={() => setConfirmForceSend(true)}
        >
          Force resend
        </button>
      )}
    </div>
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

function Badge({ status, children, styles = DISPOSITION_STYLES }) {
  return (
    <span className={`inline-block border px-2 py-0.5 text-xs font-semibold ${styles[status] || 'bg-gray-100 text-gray-700 border-gray-300'}`}>
      {children}
    </span>
  )
}

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-3 py-1.5 border-b border-black/5 last:border-0">
      <span className="text-sm text-[#666]">{label}</span>
      <span className="text-sm font-medium break-words">{children}</span>
    </div>
  )
}

function OverviewTab({ payload }) {
  const settings = payload.settings || {}
  const testing = payload.testing || {}

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="bg-white border border-black/5 p-5 space-y-3">
        <h2 className="text-xl font-semibold">How today runs</h2>
        <p className="text-sm text-[#555]">
          {settings.automaticSelection
            ? `Each weekday the importer scans ${payload.journalGroups?.length || 0} journal groups, the LLM scores every ` +
              `candidate 0-100, and the top ${settings.maxPapers} scoring at least ${settings.minPriorityScore} ship ` +
              `automatically. A qualifying paper that loses its slot waits up to ${settings.carryoverDays} days for another.`
            : 'Automatic selection is off. Papers stay pending until approved by hand on the Paper review tab.'}
        </p>
        <div className="pt-2">
          <Field label="Public launch">{settings.publicEnabled ? 'On' : 'Off — public pages hidden'}</Field>
          <Field label="Delivery mode">
            {settings.pilotMode
              ? `Pilot only (${settings.pilotRecipients?.length || 0} recipients)`
              : testing.enabled
                ? `Test mode (${testing.recipients?.length || 0} recipients)`
                : 'All opted-in subscribers'}
          </Field>
          <Field label="Papers per day">{settings.maxPapers} (hard ceiling 3)</Field>
          <Field label="Score threshold">{settings.minPriorityScore} / 100</Field>
          <Field label="Carryover window">{settings.carryoverDays === 0 ? 'Disabled' : `${settings.carryoverDays} days`}</Field>
          <Field label="Send when empty">{settings.sendEmpty ? 'Yes' : 'No'}</Field>
          <Field label="Triage model">{[settings.llmProvider, settings.llmModel].filter(Boolean).join(' / ') || 'Site default'}</Field>
        </div>
      </section>

      <section className="bg-white border border-black/5 p-5 space-y-3">
        <h2 className="text-xl font-semibold">This issue</h2>
        <div>
          <Field label="Date">{payload.date}</Field>
          <Field label="Status">
            <Badge status={payload.issue?.status} styles={ISSUE_STATUS_STYLES}>
              {payload.issue?.status || 'No issue created'}
            </Badge>
          </Field>
          <Field label="Selection mode">{payload.issue?.selectionMode || '—'}</Field>
          <Field label="Papers shipping">{payload.issue?.selectedPaperCount ?? 0}</Field>
          <Field label="Of those, carried over">{payload.issue?.carriedOverPaperCount ?? 0}</Field>
          <Field label="PubMed window">{payload.issue?.retrievalWindowDays ? `${payload.issue.retrievalWindowDays} days` : '—'}</Field>
          <Field label="Carryover pool since">{payload.carryoverFrom || '—'}</Field>
          <Field label="Approved at">{formatDateTime(payload.issue?.approvedAt)}</Field>
          <Field label="Sent at">{formatDateTime(payload.issue?.sentAt)}</Field>
        </div>
      </section>

      <section className="bg-white border border-black/5 p-5 space-y-3">
        <h2 className="text-xl font-semibold">Journal groups scanned</h2>
        <p className="text-sm text-[#666]">
          Broad groups also require kidney terms in the title or abstract. Edit these in Sanity Studio.
        </p>
        <div className="space-y-3">
          {(payload.journalGroups || []).map((group) => (
            <div key={group.key} className="border border-black/5 bg-[#fafafa] p-3">
              <p className="text-sm font-semibold">{group.title}</p>
              <p className="text-xs text-[#666] mt-1">{group.journals.join(' · ')}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border border-black/5 p-5 space-y-3">
        <h2 className="text-xl font-semibold">Corpus totals</h2>
        <div>
          <Field label="Papers ever imported">{payload.stats?.totalPapers ?? 0}</Field>
          <Field label="Currently deferred">{payload.stats?.deferredPapers ?? 0}</Field>
          <Field label="Awaiting manual review">{payload.stats?.pendingPapers ?? 0}</Field>
          <Field label="Pending opportunities">{payload.stats?.pendingOpportunities ?? 0}</Field>
          <Field label="Open approved opportunities">{payload.stats?.approvedOpenOpportunities ?? 0}</Field>
        </div>
      </section>
    </div>
  )
}

function PipelineTab({ payload }) {
  const pool = useMemo(() => payload.pool || [], [payload.pool])
  const summary = payload.poolSummary || {}
  const threshold = payload.settings?.minPriorityScore ?? 75

  const buckets = useMemo(() => {
    const scores = pool.map((paper) => paper.disposition?.score ?? 0)
    return [
      { label: '90-100', count: scores.filter((score) => score >= 90).length },
      { label: `${threshold}-89`, count: scores.filter((score) => score >= threshold && score < 90).length },
      { label: `60-${threshold - 1}`, count: scores.filter((score) => score >= 60 && score < threshold).length },
      { label: '< 60', count: scores.filter((score) => score < 60).length },
    ]
  }, [pool, threshold])

  return (
    <div className="space-y-5">
      <section className="bg-white border border-black/5 p-5 space-y-4">
        <div>
          <h2 className="text-xl font-semibold">Selection pool for {payload.date}</h2>
          <p className="text-sm text-[#666] mt-1">
            Everything imported today plus qualifying papers deferred since {payload.carryoverFrom}. This is exactly
            the set the selector ranks.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-4 text-sm">
          <Stat label="In pool" value={summary.total ?? 0} />
          <Stat label="Qualifying" value={summary.qualifying ?? 0} />
          <Stat label="Carried over" value={summary.carriedOver ?? 0} />
          <Stat label="Threshold" value={`${threshold} / 100`} />
        </div>

        <div>
          <p className="text-xs uppercase tracking-wide text-[#777] mb-2">Score distribution</p>
          <div className="grid gap-2 md:grid-cols-4">
            {buckets.map((bucket) => (
              <div key={bucket.label} className="border border-black/5 bg-[#f8f8f8] px-3 py-2 flex items-baseline justify-between">
                <span className="text-sm text-[#555]">{bucket.label}</span>
                <span className="text-lg font-semibold">{bucket.count}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-[#777] mt-2">
            If the count at or above {threshold} drifts toward zero or toward the whole pool, the threshold or the
            triage prompt needs revisiting rather than the daily volume quietly changing.
          </p>
        </div>
      </section>

      <section className="bg-white border border-black/5 p-5 space-y-3">
        <h2 className="text-lg font-semibold">Every paper, and why</h2>
        {!pool.length && <p className="text-[#666] text-sm">The pool is empty for this date.</p>}
        <div className="space-y-2">
          {pool.map((paper) => (
            <article key={paper._id} className="border border-black/5 p-3 space-y-1.5">
              <div className="flex flex-wrap items-start gap-3 justify-between">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <span className="text-2xl font-bold tabular-nums w-12 shrink-0 text-right">
                    {paper.disposition?.score ?? 0}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium leading-snug">{paper.title || '(untitled)'}</p>
                    <p className="text-xs text-[#666] mt-0.5">
                      {[paper.journal, paper.pubDate || paper.year, paper.tier].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge status={paper.disposition?.status}>{paper.disposition?.label}</Badge>
                  {paper.disposition?.carriedOver && (
                    <span className="text-xs text-[#777]">
                      found {paper.disposition.discoveredDate} · waiting {paper.disposition.daysWaiting}d
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs text-[#555] pl-[3.75rem]">{paper.disposition?.reason}</p>
              {paper.pmid && (
                <p className="text-xs pl-[3.75rem]">
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-purple font-semibold"
                  >
                    PMID {paper.pmid}
                  </a>
                </p>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

function HistoryTab({ payload, onSelectDate }) {
  const history = payload.history || []
  const sentCount = history.filter((issue) => issue.status === 'sent').length
  const emptyCount = history.filter((issue) => !issue.selectedPaperCount).length

  return (
    <section className="bg-white border border-black/5 p-5 space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Recent runs</h2>
        <p className="text-sm text-[#666] mt-1">
          Last {history.length} issues. {sentCount} sent, {emptyCount} with nothing that cleared the threshold.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-black/10">
              <th className="py-2 pr-3 font-semibold">Date</th>
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 font-semibold text-right">Imported</th>
              <th className="py-2 pr-3 font-semibold text-right">Shipped</th>
              <th className="py-2 pr-3 font-semibold text-right">Carried</th>
              <th className="py-2 pr-3 font-semibold">Mode</th>
              <th className="py-2 pr-3 font-semibold">Sent at</th>
              <th className="py-2 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {history.map((issue) => (
              <tr key={issue._id} className="border-b border-black/5 hover:bg-[#fafafa]">
                <td className="py-2 pr-3 font-medium tabular-nums">{issue.date}</td>
                <td className="py-2 pr-3">
                  <Badge status={issue.status} styles={ISSUE_STATUS_STYLES}>{issue.status}</Badge>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-[#666]">{issue.importedPapers ?? 0}</td>
                <td className="py-2 pr-3 text-right tabular-nums font-semibold">{issue.selectedPaperCount ?? 0}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-[#666]">{issue.carriedOverPaperCount ?? 0}</td>
                <td className="py-2 pr-3 text-[#666]">{issue.selectionMode || '—'}</td>
                <td className="py-2 pr-3 text-[#666]">{issue.sentAt ? formatDateTime(issue.sentAt) : '—'}</td>
                <td className="py-2 text-right">
                  <button className="text-xs text-purple font-semibold underline" onClick={() => onSelectDate(issue.date)}>
                    Inspect
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!history.length && <p className="text-[#666] text-sm py-4">No issues have been created yet.</p>}
      </div>
    </section>
  )
}

function EmailTab({ preview, busy, date, onLoad }) {
  const [mode, setMode] = useState('html')
  const loadedFor = useRef(null)

  useEffect(() => {
    if (date && loadedFor.current !== date) {
      loadedFor.current = date
      onLoad()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  return (
    <section className="bg-white border border-black/5 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Email preview for {date}</h2>
          <p className="text-sm text-[#666] mt-1">
            Rendered from the same query and template a real send uses, with a placeholder recipient.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`px-3 py-1.5 text-sm border ${mode === 'html' ? 'bg-purple text-white border-purple' : 'border-black/10'}`}
            onClick={() => setMode('html')}
          >
            HTML
          </button>
          <button
            className={`px-3 py-1.5 text-sm border ${mode === 'text' ? 'bg-purple text-white border-purple' : 'border-black/10'}`}
            onClick={() => setMode('text')}
          >
            Plain text
          </button>
          <button className="btn-secondary" disabled={busy} onClick={onLoad}>
            Refresh
          </button>
        </div>
      </div>

      {!preview && <p className="text-sm text-[#666]">Loading preview…</p>}

      {preview && !preview.available && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 p-3">{preview.reason}</p>
      )}

      {preview?.available && (
        <>
          <div className="grid gap-3 md:grid-cols-4 text-sm">
            <Stat label="Papers" value={preview.paperCount} />
            <Stat label="Opportunities" value={preview.opportunityCount} />
            <Stat label="Would send" value={preview.wouldSend ? 'Yes' : 'No — nothing to send'} />
            <Stat label="Issue status" value={preview.issueStatus} />
          </div>

          <div className="border border-black/10">
            <div className="bg-[#f3f4f6] px-4 py-2 border-b border-black/10">
              <p className="text-xs uppercase tracking-wide text-[#777]">Subject</p>
              <p className="text-sm font-semibold">{preview.subject}</p>
            </div>
            {mode === 'html' ? (
              <iframe
                title="Research digest email preview"
                sandbox=""
                srcDoc={preview.html}
                className="w-full h-[600px] bg-white"
              />
            ) : (
              <pre className="p-4 text-sm whitespace-pre-wrap font-mono bg-white overflow-x-auto">{preview.text}</pre>
            )}
          </div>
        </>
      )}
    </section>
  )
}

function SubscribersTab({ payload }) {
  const counts = payload.subscriberCounts || {}
  const subscribers = payload.subscribers || []

  return (
    <section className="bg-white border border-black/5 p-5 space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Research digest subscribers</h2>
        <p className="text-sm text-[#666] mt-1">
          Everyone who explicitly selected the research digest, including those who later unsubscribed or bounced.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-5 text-sm">
        <Stat label="Opted in" value={counts.optedIn ?? 0} />
        <Stat label="Deliverable" value={counts.deliverable ?? 0} />
        <Stat label="Unsubscribed" value={counts.unsubscribed ?? 0} />
        <Stat label="Suppressed" value={counts.suppressed ?? 0} />
        <Stat label="Never sent" value={counts.neverSent ?? 0} />
      </div>

      {payload.settings?.pilotMode && (
        <div className="bg-sky-50 border border-sky-200 p-3 text-sm text-sky-900">
          Pilot mode is on, so sends go only to: {(payload.settings.pilotRecipients || []).join(', ') || '(none configured)'}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b border-black/10">
              <th className="py-2 pr-3 font-semibold">Email</th>
              <th className="py-2 pr-3 font-semibold">Name</th>
              <th className="py-2 pr-3 font-semibold">Role</th>
              <th className="py-2 pr-3 font-semibold">Subscription</th>
              <th className="py-2 pr-3 font-semibold">Delivery</th>
              <th className="py-2 font-semibold">Last digest</th>
            </tr>
          </thead>
          <tbody>
            {subscribers.map((subscriber) => {
              const inactive = subscriber.subscriptionStatus === 'unsubscribed' || subscriber.deliveryStatus === 'suppressed'
              return (
                <tr key={subscriber._id} className={`border-b border-black/5 ${inactive ? 'text-[#999]' : ''}`}>
                  <td className="py-2 pr-3 font-medium">{subscriber.email}</td>
                  <td className="py-2 pr-3">{subscriber.name || '—'}</td>
                  <td className="py-2 pr-3">{subscriber.role || '—'}</td>
                  <td className="py-2 pr-3">{subscriber.subscriptionStatus || 'unknown'}</td>
                  <td className="py-2 pr-3">{subscriber.deliveryStatus || 'active'}</td>
                  <td className="py-2">{subscriber.lastResearchDigestSentAt ? formatDateTime(subscriber.lastResearchDigestSentAt) : 'never'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {!subscribers.length && <p className="text-[#666] text-sm py-4">Nobody has opted into the research digest yet.</p>}
      </div>
    </section>
  )
}

function SettingsTab({ payload, busy, onSave }) {
  const [form, setForm] = useState(() => ({ ...EMPTY_SETTINGS, ...(payload.settings || {}) }))
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setForm({ ...EMPTY_SETTINGS, ...(payload.settings || {}) })
    setDirty(false)
  }, [payload.settings])

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  function save() {
    const fields = {
      publicEnabled: form.publicEnabled,
      automaticSelection: form.automaticSelection,
      maxPapers: form.maxPapers,
      minPriorityScore: form.minPriorityScore,
      carryoverDays: form.carryoverDays,
      maxOpportunities: form.maxOpportunities,
      sendEmpty: form.sendEmpty,
      pilotMode: form.pilotMode,
      pilotRecipients: Array.isArray(form.pilotRecipients)
        ? form.pilotRecipients
        : String(form.pilotRecipients || '').split(/[,;\n]/),
      subjectTemplate: form.subjectTemplate,
      introText: form.introText,
      emptyIntroText: form.emptyIntroText,
      outroText: form.outroText,
      signature: form.signature,
      llmProvider: form.llmProvider,
      llmModel: form.llmModel,
    }
    onSave(fields)
  }

  return (
    <div className="space-y-5">
      <section className="bg-white border border-black/5 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Settings</h2>
            <p className="text-sm text-[#666] mt-1">
              Writes straight to <code className="text-xs">siteSettings.researchDigest</code>. The 3-paper ceiling and
              30-day carryover cap are enforced on the server whatever you type here.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              disabled={busy || !dirty}
              onClick={() => {
                setForm({ ...EMPTY_SETTINGS, ...(payload.settings || {}) })
                setDirty(false)
              }}
            >
              Reset
            </button>
            <button className="btn-primary" disabled={busy || !dirty} onClick={save}>
              Save settings
            </button>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#777]">Selection</h3>
            <Toggle
              label="Automatic selection"
              hint="Off means nothing ships until approved by hand."
              checked={form.automaticSelection}
              onChange={(value) => update('automaticSelection', value)}
            />
            <NumberField
              label="Max papers per email"
              hint="Hard ceiling of 3, whatever is entered."
              min={1}
              max={3}
              value={form.maxPapers}
              onChange={(value) => update('maxPapers', value)}
            />
            <NumberField
              label="Minimum priority score"
              hint="0-100. Papers below this are never selected."
              min={0}
              max={100}
              value={form.minPriorityScore}
              onChange={(value) => update('minPriorityScore', value)}
            />
            <NumberField
              label="Carryover days"
              hint="0 disables carryover. Capped at 30."
              min={0}
              max={30}
              value={form.carryoverDays}
              onChange={(value) => update('carryoverDays', value)}
            />
            <NumberField
              label="Max opportunities per email"
              hint="Only used when automatic selection is off."
              min={1}
              max={30}
              value={form.maxOpportunities}
              onChange={(value) => update('maxOpportunities', value)}
            />
          </div>

          <div className="space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#777]">Delivery</h3>
            <Toggle
              label="Public launch"
              hint="Off hides public pages and pauses general subscriber delivery."
              checked={form.publicEnabled}
              onChange={(value) => update('publicEnabled', value)}
            />
            <Toggle
              label="Pilot mode"
              hint="Sends only to the pilot recipients below."
              checked={form.pilotMode}
              onChange={(value) => update('pilotMode', value)}
            />
            <Toggle
              label="Send even when empty"
              hint="Sends a digest with no papers rather than skipping the day."
              checked={form.sendEmpty}
              onChange={(value) => update('sendEmpty', value)}
            />
            <label className="grid gap-1">
              <span className="text-sm font-medium">Pilot recipients</span>
              <textarea
                rows={3}
                value={Array.isArray(form.pilotRecipients) ? form.pilotRecipients.join('\n') : form.pilotRecipients || ''}
                onChange={(event) => update('pilotRecipients', event.target.value.split('\n'))}
                className="border border-black/10 px-3 py-2 font-mono text-sm"
                placeholder="one email per line"
              />
              <span className="text-xs text-[#777]">
                Addresses from RESEARCH_DIGEST_PILOT_EMAILS also apply at send time but are not stored here.
              </span>
            </label>
          </div>
        </div>

        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[#777]">Email copy</h3>
          <TextField
            label="Subject template"
            hint="Tokens: {{leadTitle}} {{andMore}} {{date}} {{paperCount}} {{paperNoun}} {{opportunityCount}} {{opportunityNoun}} {{leadTopic}}"
            value={form.subjectTemplate}
            onChange={(value) => update('subjectTemplate', value)}
          />
          <div className="grid gap-4 md:grid-cols-2">
            <TextArea label="Intro text" value={form.introText} onChange={(value) => update('introText', value)} />
            <TextArea
              label="Empty-day intro text"
              value={form.emptyIntroText}
              onChange={(value) => update('emptyIntroText', value)}
            />
            <TextArea label="Closing text" value={form.outroText} onChange={(value) => update('outroText', value)} />
            <TextField label="Signature" value={form.signature} onChange={(value) => update('signature', value)} />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 pt-2">
          <TextField
            label="LLM provider override"
            hint="Blank falls back to the site classification settings."
            value={form.llmProvider}
            onChange={(value) => update('llmProvider', value)}
          />
          <TextField
            label="LLM model override"
            value={form.llmModel}
            onChange={(value) => update('llmModel', value)}
          />
        </div>
      </section>

      <section className="bg-white border border-black/5 p-5 space-y-3">
        <h2 className="text-lg font-semibold">Studio-managed</h2>
        <p className="text-sm text-[#666]">
          Journal groups and opportunity feeds stay in Sanity Studio — they are list-of-object fields where a
          mistyped journal name silently drops a whole source. Saving here never touches them.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-[#777] mb-2">
              Journal groups ({payload.journalGroups?.length || 0})
            </p>
            {(payload.journalGroups || []).map((group) => (
              <p key={group.key} className="text-sm">
                {group.title} <span className="text-[#777]">({group.journals.length})</span>
              </p>
            ))}
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-[#777] mb-2">
              Opportunity feeds ({payload.opportunitySources?.length || 0})
            </p>
            {!(payload.opportunitySources || []).length && <p className="text-sm text-[#777]">None configured.</p>}
            {(payload.opportunitySources || []).map((source) => (
              <p key={source.url} className="text-sm">
                {source.name} <span className="text-[#777]">({source.type})</span>
              </p>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={Boolean(checked)}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1"
      />
      <span>
        <span className="text-sm font-medium block">{label}</span>
        {hint && <span className="text-xs text-[#777]">{hint}</span>}
      </span>
    </label>
  )
}

function NumberField({ label, hint, min, max, value, onChange }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
        className="border border-black/10 px-3 py-2 w-32"
      />
      {hint && <span className="text-xs text-[#777]">{hint}</span>}
    </label>
  )
}

function TextField({ label, hint, value, onChange }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        className="border border-black/10 px-3 py-2"
      />
      {hint && <span className="text-xs text-[#777] break-words">{hint}</span>}
    </label>
  )
}

function TextArea({ label, hint, value, onChange }) {
  return (
    <label className="grid gap-1">
      <span className="text-sm font-medium">{label}</span>
      <textarea
        rows={3}
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        className="border border-black/10 px-3 py-2"
      />
      {hint && <span className="text-xs text-[#777]">{hint}</span>}
    </label>
  )
}

function PapersTab({ payload, busy, paperEdits, setPaperEdits, opportunityEdits, setOpportunityEdits, patchResource }) {
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div>
          <h2 className="text-2xl font-semibold">Papers for {payload.date}</h2>
          <p className="text-sm text-[#666] mt-1">
            {payload.settings?.automaticSelection
              ? 'Automatic selection is on, so these are informational. Rejecting a paper also excludes it from future automatic selection.'
              : 'Automatic selection is off — approve papers here for them to ship.'}
          </p>
        </div>
        {!payload.papers.length && <p className="text-[#666]">No paper candidates for this issue.</p>}
        <div className="space-y-4">
          {payload.papers.map((paper) => (
            <PaperReviewCard
              key={paper._id}
              paper={paper}
              edit={paperEdits[paper._id] || paper}
              setEdit={(next) => setPaperEdits((prev) => ({ ...prev, [paper._id]: next }))}
              disabled={busy}
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
              disabled={busy}
              onSave={() => patchResource('opportunity', item._id, 'save', opportunityEdits[item._id] || item)}
              onApprove={() => patchResource('opportunity', item._id, 'approve', opportunityEdits[item._id] || item)}
              onReject={() => patchResource('opportunity', item._id, 'reject')}
            />
          ))}
        </div>
      </section>
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
            {[paper.journal, paper.pubDate || paper.year, paper.tier, paper.priorityScore != null ? `score ${paper.priorityScore}` : null, paper.triageStatus, paper.approvalStatus, paper.autoSelectionStatus]
              .filter(Boolean)
              .join(' - ')}
          </p>
          {paper.carriedOverFrom && (
            <p className="text-xs text-sky-800">Carried over from {paper.carriedOverFrom}</p>
          )}
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
