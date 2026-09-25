'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import AuthButtons from '@/app/components/AuthButtons'
import { X_MAX_WEIGHTED_LENGTH, formatSocialPostDate, xWeightedLength } from '@/lib/socialPosting'

function formatDateTime(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
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
        <span className="font-semibold">Team members: </span>
        {post.teamMembers?.length ? post.teamMembers.join(', ') : 'Not recorded'}
      </p>
      <p className="text-sm text-gray-700">
        <span className="font-semibold">Published: </span>
        {[formatSocialPostDate(post.publishedAt), post.journal].filter(Boolean).join(' · ')}
      </p>
    </div>
  )
}

function PendingCard({ post, busy, enabled, onAction }) {
  const [text, setText] = useState(post.text || post.proposedText || '')
  const length = xWeightedLength(text)
  const tooLong = length > X_MAX_WEIGHTED_LENGTH
  const empty = !text.trim()

  return (
    <article className="rounded-xl border border-black/10 bg-white p-5 shadow-sm space-y-4">
      <PaperDetails post={post} />

      <div className="space-y-1">
        <label className="text-sm font-semibold text-gray-900" htmlFor={`text-${post._id}`}>Post text</label>
        <textarea
          id={`text-${post._id}`}
          className="w-full rounded-lg border border-black/20 p-3 text-sm"
          rows={4}
          value={text}
          disabled={busy}
          onChange={(event) => setText(event.target.value)}
        />
        <p className={`text-xs ${tooLong ? 'font-semibold text-red-700' : 'text-gray-500'}`}>
          {length} / {X_MAX_WEIGHTED_LENGTH} characters as X counts them (each link counts as 23)
          {tooLong ? ' — too long for X' : ''}
        </p>
      </div>

      {post.lastError && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Last attempt failed ({formatDateTime(post.lastErrorAt)}): {post.lastError}
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded bg-purple px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={busy || !enabled || tooLong || empty}
          onClick={() => onAction(post._id, 'approve', text)}
        >
          Approve
        </button>
        <button
          type="button"
          className="rounded border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
          disabled={busy}
          onClick={() => onAction(post._id, 'skip')}
        >
          Skip
        </button>
        <button
          type="button"
          className="rounded border border-black/20 bg-white px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
          disabled={busy || text === post.proposedText}
          onClick={() => setText(post.proposedText || '')}
        >
          Reset text
        </button>
      </div>
    </article>
  )
}

function InProgressCard({ post }) {
  return (
    <article className="rounded-xl border border-amber-300 bg-amber-50 p-5 shadow-sm space-y-3">
      <PaperDetails post={post} />
      <p className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-gray-800">{post.text}</p>
      <p className="text-sm font-semibold text-amber-900">
        Buffer result unknown — check the Buffer queue before doing anything else.
      </p>
      <p className="text-sm text-amber-900">
        Approved by {post.approvedBy || 'unknown'} on {formatDateTime(post.approvedAt)}. This post is never retried automatically.
        {post.lastError ? ` Last error: ${post.lastError}` : ''}
      </p>
    </article>
  )
}

function RecentCard({ post, busy, onAction }) {
  return (
    <article className="rounded-xl border border-black/10 bg-white p-5 shadow-sm space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PaperDetails post={post} />
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold uppercase text-gray-700">
          {post.status}
        </span>
      </div>
      <p className="whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-800">{post.text}</p>
      {post.status === 'queued' ? (
        <p className="text-sm text-gray-600">
          Queued by {post.approvedBy || 'unknown'} on {formatDateTime(post.queuedAt)}.
          {' '}Buffer scheduled it for {post.dueAt ? formatDateTime(post.dueAt) : 'the next posting slot'}.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-gray-600">
            Skipped by {post.skippedBy || 'unknown'} on {formatDateTime(post.skippedAt)}.
          </p>
          <button
            type="button"
            className="rounded border border-black/20 bg-white px-4 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
            disabled={busy}
            onClick={() => onAction(post._id, 'restore')}
          >
            Restore
          </button>
        </div>
      )}
    </article>
  )
}

export default function SocialPostsClient() {
  const [data, setData] = useState({ enabled: true, pending: [], inProgress: [], recent: [] })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/social/posts', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed to load social media posts.')
      setData(payload)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function act(id, action, text) {
    setBusyId(id)
    setMessage('')
    try {
      const response = await fetch('/api/social/posts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action, ...(action === 'approve' ? { text } : {}) }),
      })
      const payload = await response.json()
      setMessage(payload.message || payload.error || (response.ok ? 'Saved.' : 'The request failed.'))
      await load()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setBusyId('')
    }
  }

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
          New team publications appear here as suggested X posts. Approved posts go to the Buffer queue and are published at the X posting times set in Buffer. Skipped posts are never sent.
        </p>
        <Link className="text-sm font-semibold text-purple hover:underline" href="/admin">Back to Admin Hub</Link>
      </header>

      {!loading && !data.enabled && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Posting to X is switched off in Site Settings (Social Media Posting). Approving is disabled until it is switched back on.
        </p>
      )}
      {message && <p className="rounded-lg border border-black/10 bg-white p-4 text-sm">{message}</p>}
      {loading ? <div className="h-32 animate-pulse rounded-xl bg-white shadow-sm" /> : (
        <>
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Waiting for approval ({data.pending.length})</h2>
            {data.pending.length === 0 ? (
              <p className="rounded-xl border border-black/10 bg-white p-5 text-gray-600">No posts are waiting for approval.</p>
            ) : data.pending.map((post) => (
              <PendingCard
                key={`${post._id}-${post._rev}`}
                post={post}
                busy={busyId === post._id}
                enabled={data.enabled}
                onAction={act}
              />
            ))}
          </section>

          {data.inProgress.length > 0 && (
            <section className="space-y-4">
              <div>
                <h2 className="text-2xl font-semibold">In progress / needs checking ({data.inProgress.length})</h2>
                <p className="text-sm text-gray-500">
                  Buffer may or may not have received these posts. Look for each one in the Buffer queue for the X channel. If it is there, nothing else is needed. If it is not, delete this record in Sanity Studio (Social Media Post) and the paper returns as a pending post after the next daily sync.
                </p>
              </div>
              {data.inProgress.map((post) => <InProgressCard key={post._id} post={post} />)}
            </section>
          )}

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Recent ({data.recent.length})</h2>
            {data.recent.length === 0 ? (
              <p className="rounded-xl border border-black/10 bg-white p-5 text-gray-600">No posts have been queued or skipped yet.</p>
            ) : data.recent.map((post) => (
              <RecentCard key={post._id} post={post} busy={busyId === post._id} onAction={act} />
            ))}
          </section>
        </>
      )}
    </main>
  )
}
