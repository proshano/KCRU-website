'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import AuthButtons from '@/app/components/AuthButtons'
import {
  BUFFER_UNKNOWN_MESSAGE,
  SOCIAL_POST_PROMPT_MAX_LENGTH,
  X_MAX_WEIGHTED_LENGTH,
  formatSocialPostDate,
  validateSocialPostPrompt,
  xWeightedLength,
} from '@/lib/socialPosting'

const EMPTY_PROMPT = {
  custom: null,
  defaultPrompt: '',
  effective: '',
  isCustom: false,
  updatedBy: null,
  updatedAt: null,
  rev: null,
}

const EMPTY_DATA = {
  enabled: true,
  teamLabel: '',
  prompt: EMPTY_PROMPT,
  available: [],
  drafts: [],
  queued: [],
  needsChecking: [],
  published: [],
  dismissed: [],
}

const PRIMARY_BUTTON = 'rounded bg-purple px-4 py-2 text-sm font-semibold text-white disabled:opacity-50'
const SECONDARY_BUTTON = 'rounded border border-black/20 bg-white px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50'
const DANGER_BUTTON = 'rounded border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50'

function formatDateTime(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function describeGeneratedBy(generatedBy) {
  if (generatedBy === 'template') return 'Built from the standard template because the AI draft was not available.'
  if (String(generatedBy || '').startsWith('llm:')) return `AI draft (${generatedBy.slice(4)}). Check it against the paper before queueing.`
  return 'Suggested text from an earlier version of this page.'
}

function PaperDetails({ post }) {
  return (
    <div className="space-y-1">
      <h3 className="text-lg font-semibold text-gray-900">
        {post.link ? (
          <a className="hover:underline" href={post.link} target="_blank" rel="noreferrer">{post.title}</a>
        ) : post.title}
      </h3>
      <p className="text-sm text-gray-700">
        <span className="font-semibold">Published: </span>
        {[post.journal, formatSocialPostDate(post.publishedAt)].filter(Boolean).join(' · ')}
      </p>
      <p className="text-sm text-gray-700">
        <span className="font-semibold">Team members: </span>
        {post.teamMembers?.length ? post.teamMembers.join(', ') : 'Not recorded'}
        {post.hasOtherAuthors ? ' · plus other authors' : ''}
      </p>
    </div>
  )
}

function LaySummary({ text }) {
  const [expanded, setExpanded] = useState(false)
  if (!text) return <p className="text-sm italic text-gray-500">No lay summary recorded.</p>
  return (
    <div className="space-y-1">
      <p className={`text-sm text-gray-700 ${expanded ? '' : 'line-clamp-3'}`}>
        <span className="font-semibold">Lay summary: </span>{text}
      </p>
      <button
        type="button"
        className="text-xs font-semibold text-purple hover:underline"
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? 'Show less' : 'Show full summary'}
      </button>
    </div>
  )
}

function ErrorNote({ post, label = 'Last attempt failed' }) {
  if (!post.lastError) return null
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {label}{post.lastErrorAt ? ` (${formatDateTime(post.lastErrorAt)})` : ''}: {post.lastError}
    </p>
  )
}

function Card({ tone = 'default', children }) {
  const tones = {
    default: 'border-black/10 bg-white',
    warning: 'border-amber-300 bg-amber-50',
  }
  return <article className={`space-y-4 rounded-xl border p-5 shadow-sm ${tones[tone]}`}>{children}</article>
}

function AvailableCard({ post, busyAction, enabled, onAction }) {
  const busy = Boolean(busyAction)
  return (
    <Card>
      <PaperDetails post={post} />
      <LaySummary text={post.laySummary} />
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={busy || !enabled}
          onClick={() => onAction(post._id, 'draft')}
        >
          {busyAction === 'draft' ? 'Writing draft… (about 10 seconds)' : 'Create post'}
        </button>
        <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => onAction(post._id, 'dismiss')}>
          Not posting
        </button>
      </div>
    </Card>
  )
}

function DraftCard({ post, busyAction, enabled, edit, onEdit, onAction }) {
  const busy = Boolean(busyAction)
  const text = edit ?? post.text ?? ''
  const length = xWeightedLength(text)
  const tooLong = length > X_MAX_WEIGHTED_LENGTH
  const empty = !text.trim()
  const unsaved = edit !== undefined && edit !== (post.text ?? '')
  const edited = unsaved || (post.text ?? '') !== (post.proposedText ?? '')

  function regenerate() {
    if (edited && !window.confirm('Replace your edited text with a new AI draft? Your changes will be lost.')) return
    onAction(post._id, 'regenerate')
  }

  return (
    <Card>
      <PaperDetails post={post} />
      <LaySummary text={post.laySummary} />

      <div className="space-y-1">
        <label className="text-sm font-semibold text-gray-900" htmlFor={`text-${post._id}`}>Post text</label>
        <textarea
          id={`text-${post._id}`}
          className="w-full rounded-lg border border-black/20 p-3 text-sm"
          rows={5}
          value={text}
          disabled={busy}
          onChange={(event) => onEdit(post._id, event.target.value)}
        />
        <p className={`text-xs ${tooLong ? 'font-semibold text-red-700' : 'text-gray-500'}`}>
          {length} / {X_MAX_WEIGHTED_LENGTH} characters as X counts them (each link counts as 23)
          {tooLong ? ' — too long for X' : ''}
          {unsaved ? ' · unsaved changes' : ''}
        </p>
        <p className="text-xs text-gray-500">
          {describeGeneratedBy(post.generatedBy)}
          {post.draftedBy ? ` Drafted by ${post.draftedBy} on ${formatDateTime(post.draftedAt)}.` : ''}
        </p>
      </div>

      <ErrorNote post={post} />

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={busy || !enabled || tooLong || empty}
          onClick={() => onAction(post._id, 'queue', text)}
        >
          {busyAction === 'queue' ? 'Queueing…' : 'Queue in Buffer'}
        </button>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={busy || !unsaved || tooLong || empty}
          onClick={() => onAction(post._id, 'save', text)}
        >
          {busyAction === 'save' ? 'Saving…' : 'Save draft'}
        </button>
        <button type="button" className={SECONDARY_BUTTON} disabled={busy || !enabled} onClick={regenerate}>
          {busyAction === 'regenerate' ? 'Writing new draft…' : 'Regenerate'}
        </button>
        <button type="button" className={DANGER_BUTTON} disabled={busy} onClick={() => onAction(post._id, 'discard')}>
          Discard draft
        </button>
        <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => onAction(post._id, 'dismiss')}>
          Not posting
        </button>
      </div>
    </Card>
  )
}

function QueuedCard({ post, busyAction, onAction }) {
  function undo() {
    if (!window.confirm('Remove this post from the Buffer queue? It goes back to your drafts so you can edit or requeue it.')) return
    onAction(post._id, 'undo')
  }
  return (
    <Card>
      <PaperDetails post={post} />
      <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-800">{post.text}</p>
      <p className="text-sm text-gray-600">
        Scheduled for <span className="font-semibold">{post.dueAt ? formatDateTime(post.dueAt) : 'the next Buffer posting slot'}</span>.
        {' '}Queued by {post.queuedBy || post.approvedBy || 'unknown'} on {formatDateTime(post.queuedAt)}.
      </p>
      <ErrorNote post={post} label="Buffer reported" />
      <div className="flex flex-wrap gap-3">
        <button type="button" className={DANGER_BUTTON} disabled={Boolean(busyAction)} onClick={undo}>
          {busyAction === 'undo' ? 'Undoing…' : 'Undo'}
        </button>
      </div>
    </Card>
  )
}

function NeedsCheckingCard({ post }) {
  const removing = post.status === 'removing'
  return (
    <Card tone="warning">
      <PaperDetails post={post} />
      <p className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-gray-800">{post.text}</p>
      <p className="text-sm font-semibold text-amber-900">{BUFFER_UNKNOWN_MESSAGE}.</p>
      <p className="text-sm text-amber-900">
        {removing
          ? 'The website asked Buffer to remove this post but did not get a clear answer. If it is still in the Buffer queue and you do not want it published, delete it there.'
          : `The website asked Buffer to queue this post${post.queuedBy ? ` for ${post.queuedBy}` : ''} but did not get a clear answer. If it is in the Buffer queue, it will be published at its slot unless you delete it there.`}
        {' '}This is never retried automatically. To clear this record, delete it in Sanity Studio (Social Media Post); if the paper is still in the publications feed, it comes back under new publications after the next daily sync.
      </p>
      <ErrorNote post={post} label="Last error" />
    </Card>
  )
}

function PublishedCard({ post }) {
  return (
    <Card>
      <PaperDetails post={post} />
      <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-800">{post.text}</p>
      <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
        <span>Published on X {post.sentAt ? `on ${formatDateTime(post.sentAt)}` : ''}.</span>
        {post.externalLink && (
          <a className="font-semibold text-purple hover:underline" href={post.externalLink} target="_blank" rel="noreferrer">
            View on X
          </a>
        )}
      </div>
    </Card>
  )
}

function DismissedCard({ post, busyAction, onAction }) {
  return (
    <Card>
      <PaperDetails post={post} />
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-600">
          Marked as not posting by {post.dismissedBy || 'unknown'} on {formatDateTime(post.dismissedAt)}.
        </p>
        <button type="button" className={SECONDARY_BUTTON} disabled={Boolean(busyAction)} onClick={() => onAction(post._id, 'restore')}>
          {busyAction === 'restore' ? 'Restoring…' : 'Restore'}
        </button>
      </div>
    </Card>
  )
}

function DraftingInstructionsSection({ prompt, teamLabel, busy, onSave, onReset }) {
  const [expanded, setExpanded] = useState(false)
  const [text, setText] = useState(prompt.effective)
  // Resync the editor only when the stored doc actually changed (a new rev), so an
  // unrelated action elsewhere on the page (which reloads everything) never clobbers
  // instructions the approver is mid-way through editing.
  const [syncedRev, setSyncedRev] = useState(prompt.rev)
  if (prompt.rev !== syncedRev) {
    setSyncedRev(prompt.rev)
    setText(prompt.effective)
  }

  const validation = validateSocialPostPrompt(text)
  const unchanged = text === prompt.effective
  const busySaving = busy === 'saveprompt'
  const busyResetting = busy === 'resetprompt'

  function handleReset() {
    if (!window.confirm('Reset the drafting instructions to the default? Your custom instructions will be lost.')) return
    onReset(prompt.rev)
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
        onClick={() => setExpanded((value) => !value)}
      >
        <span>
          <span className="text-lg font-semibold text-gray-900">Drafting instructions (AI prompt)</span>
          <span className="ml-2 text-sm text-gray-500">
            {prompt.isCustom ? 'Custom' : 'Default'}
            {prompt.updatedBy ? ` · last changed by ${prompt.updatedBy} on ${formatDateTime(prompt.updatedAt)}` : ''}
          </span>
        </span>
        <span className="text-sm font-semibold text-purple">{expanded ? 'Hide' : 'Edit'}</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-3">
          <label className="text-sm font-semibold text-gray-900" htmlFor="social-post-prompt">System prompt</label>
          <textarea
            id="social-post-prompt"
            className="w-full rounded-lg border border-black/20 p-3 font-mono text-xs"
            rows={14}
            value={text}
            disabled={Boolean(busy)}
            onChange={(event) => setText(event.target.value)}
          />
          <p className={`text-xs ${validation.ok ? 'text-gray-500' : 'font-semibold text-red-700'}`}>
            {text.length} / {SOCIAL_POST_PROMPT_MAX_LENGTH} characters
            {!validation.ok ? ` — ${validation.error}` : ''}
          </p>
          <p className="text-xs text-gray-500">
            The paper title, {teamLabel || 'London Kidney'} investigators, whether there are other (non-team)
            authors, lay summary and length limit are added automatically, and the paper link is appended after the
            text. Every draft is checked for all investigator names, no first person (&quot;our&quot;,
            &quot;we&quot;), no journal name and X&apos;s length limit. A draft that fails twice uses the simple
            template instead. Changes apply to the next Create post or Regenerate; existing drafts are not changed.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={Boolean(busy) || !validation.ok || unchanged}
              onClick={() => onSave(text, prompt.rev)}
            >
              {busySaving ? 'Saving…' : 'Save instructions'}
            </button>
            {prompt.isCustom && (
              <button type="button" className={DANGER_BUTTON} disabled={Boolean(busy)} onClick={handleReset}>
                {busyResetting ? 'Resetting…' : 'Reset to default'}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

function Section({ title, count, description, empty, children }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">{title} ({count})</h2>
        {description && <p className="text-sm text-gray-500">{description}</p>}
      </div>
      {count === 0 ? <p className="rounded-xl border border-black/10 bg-white p-5 text-gray-600">{empty}</p> : children}
    </section>
  )
}

export default function SocialPostsClient() {
  const [data, setData] = useState(EMPTY_DATA)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState({ id: '', action: '' })
  const [message, setMessage] = useState('')
  // Unsaved draft edits by post id, kept across reloads until saved or replaced.
  const [edits, setEdits] = useState({})

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/social/posts', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed to load social media posts.')
      setData({ ...EMPTY_DATA, ...payload })
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function editDraft(id, text) {
    setEdits((current) => ({ ...current, [id]: text }))
  }

  async function act(id, action, text) {
    setBusy({ id, action })
    setMessage('')
    try {
      const response = await fetch('/api/social/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, ...(text !== undefined ? { text } : {}) }),
      })
      const payload = await response.json()
      setMessage(payload.message || payload.error || (response.ok ? 'Saved.' : 'The request failed.'))
      if (payload.ok) {
        setEdits((current) => {
          const next = { ...current }
          delete next[id]
          return next
        })
      }
      await load()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy({ id: '', action: '' })
    }
  }

  async function actPrompt(action, extra) {
    setBusy({ id: 'prompt', action })
    setMessage('')
    try {
      const response = await fetch('/api/social/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      })
      const payload = await response.json()
      setMessage(payload.message || payload.error || (response.ok ? 'Saved.' : 'The request failed.'))
      await load()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusy({ id: '', action: '' })
    }
  }

  const busyActionFor = (id) => (busy.id === id ? busy.action : '')

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10 md:px-12">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-purple">Admin Portal</p>
            <h1 className="text-3xl font-bold tracking-tight">Social media posts</h1>
          </div>
          <AuthButtons signInCallbackUrl="/admin/social" signOutCallbackUrl="/login" />
        </div>
        <p className="max-w-3xl text-gray-600">
          New team publications appear here. Nothing is posted unless you create a post and queue it in Buffer.
          Queued posts go out at your Buffer posting times for X, and you can undo them until Buffer publishes them.
        </p>
        <Link className="text-sm font-semibold text-purple hover:underline" href="/admin">Back to Admin Hub</Link>
      </header>

      {!loading && !data.enabled && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Offering new publications for X posts is switched off in Site Settings (Social Media Posting). New papers are not added, and posts cannot be drafted or queued until it is switched back on. Queued posts can still be undone.
        </p>
      )}
      {data.bufferStatusWarning && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">{data.bufferStatusWarning}</p>
      )}
      {message && <p className="rounded-lg border border-black/10 bg-white p-4 text-sm">{message}</p>}
      {!loading && (
        <DraftingInstructionsSection
          prompt={data.prompt}
          teamLabel={data.teamLabel}
          busy={busyActionFor('prompt')}
          onSave={(text, rev) => actPrompt('saveprompt', { text, rev })}
          onReset={(rev) => actPrompt('resetprompt', { rev })}
        />
      )}
      {loading ? <div className="h-32 animate-pulse rounded-xl bg-white shadow-sm" /> : (
        <>
          <Section
            title="New publications"
            count={data.available.length}
            description="Create a post for the papers you want to share. Papers you leave here are never posted."
            empty="No new publications are waiting."
          >
            {data.available.map((post) => (
              <AvailableCard
                key={post._id}
                post={post}
                busyAction={busyActionFor(post._id)}
                enabled={data.enabled}
                onAction={act}
              />
            ))}
          </Section>

          <Section
            title="Drafts"
            count={data.drafts.length}
            description="Edit the text, then queue it in Buffer. Drafts are never posted until you queue them."
            empty="No drafts."
          >
            {data.drafts.map((post) => (
              <DraftCard
                key={post._id}
                post={post}
                busyAction={busyActionFor(post._id)}
                enabled={data.enabled}
                edit={edits[post._id]}
                onEdit={editDraft}
                onAction={act}
              />
            ))}
          </Section>

          <Section
            title="Queued in Buffer"
            count={data.queued.length}
            description="These go out at the scheduled time. Undo moves a post back to your drafts."
            empty="Nothing is queued."
          >
            {data.queued.map((post) => (
              <QueuedCard key={post._id} post={post} busyAction={busyActionFor(post._id)} onAction={act} />
            ))}
          </Section>

          {data.needsChecking.length > 0 && (
            <Section
              title="Needs checking"
              count={data.needsChecking.length}
              description="Buffer did not give a clear answer for these posts. Look for each one in the Buffer queue for the X channel."
            >
              {data.needsChecking.map((post) => <NeedsCheckingCard key={post._id} post={post} />)}
            </Section>
          )}

          <Section title="Posted" count={data.published.length} empty="Nothing has been published on X yet.">
            {data.published.map((post) => <PublishedCard key={post._id} post={post} />)}
          </Section>

          <Section title="Not posting" count={data.dismissed.length} empty="No papers are marked as not posting.">
            {data.dismissed.map((post) => (
              <DismissedCard key={post._id} post={post} busyAction={busyActionFor(post._id)} onAction={act} />
            ))}
          </Section>
        </>
      )}
    </main>
  )
}
