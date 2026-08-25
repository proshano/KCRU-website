'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import AuthButtons from '@/app/components/AuthButtons'

function formatDate(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function evidenceLines(review) {
  const evidence = review.evidence || {}
  const lines = [review.holdReason].filter(Boolean)
  if (evidence.matchedAuthor) lines.push(`Matched author: ${evidence.matchedAuthor}`)
  if (evidence.nameKind) lines.push(`Name form: ${evidence.nameKind}`)
  if (evidence.affiliationMatches?.length) {
    lines.push(`Known affiliation: ${evidence.affiliationMatches.join('; ')}`)
  }
  lines.push(`Recurring PubMed-confirmed coauthors: ${Number(evidence.recurringCoauthorCount) || 0}`)
  if (evidence.recurringCoauthors?.length) {
    lines.push(`Recurring coauthors: ${evidence.recurringCoauthors.join(', ')}`)
  }
  if (evidence.matchedOrcid) lines.push(`Candidate ORCID: ${evidence.matchedOrcid}`)
  if (evidence.queryPaths?.length) lines.push(`Discovery paths: ${evidence.queryPaths.join(', ')}`)
  return lines
}

function ReviewCard({ review, busy, onDecision }) {
  const researcherName = review.researcherName || review.researcherDetails?.name || 'Unknown researcher'
  const doiUrl = review.doi ? `https://doi.org/${encodeURI(review.doi)}` : null
  return (
    <article className="rounded-xl border border-black/10 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-purple">{researcherName}</p>
          <h3 className="mt-1 text-lg font-semibold text-gray-900">{review.title}</h3>
        </div>
        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold uppercase text-gray-700">
          {review.status}
        </span>
      </div>

      <dl className="grid gap-2 text-sm text-gray-700">
        <div><dt className="font-semibold inline">Authors: </dt><dd className="inline">{review.authors?.join(', ') || 'Not available'}</dd></div>
        <div><dt className="font-semibold inline">Journal/year: </dt><dd className="inline">{[review.journal, review.year].filter(Boolean).join(', ') || 'Not available'}</dd></div>
        <div>
          <dt className="font-semibold inline">DOI/PMID: </dt>
          <dd className="inline">
            {doiUrl ? <a className="text-purple underline" href={doiUrl} target="_blank" rel="noreferrer">{review.doi}</a> : review.pmid || review.publicationKey}
          </dd>
        </div>
        <div><dt className="font-semibold inline">Sources: </dt><dd className="inline">{review.discoverySources?.join(', ') || 'Not available'}</dd></div>
      </dl>

      <div className="rounded-lg bg-gray-50 p-4">
        <p className="text-sm font-semibold text-gray-900">Why review was required</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
          {evidenceLines(review).map((line) => <li key={line}>{line}</li>)}
        </ul>
      </div>

      {review.status !== 'pending' && (
        <p className="text-xs text-gray-500">
          Last reviewed by {review.reviewedBy || 'unknown reviewer'} on {formatDate(review.reviewedAt)}. Decisions can be reversed below.
        </p>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="rounded bg-purple px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={busy || review.status === 'approved'}
          onClick={() => onDecision(review._id, 'approved')}
        >
          Approve
        </button>
        <button
          type="button"
          className="rounded border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50"
          disabled={busy || review.status === 'rejected'}
          onClick={() => onDecision(review._id, 'rejected')}
        >
          Reject
        </button>
      </div>
    </article>
  )
}

export default function PublicationAttributionReviewClient() {
  const [data, setData] = useState({ pending: [], decisions: [], counts: {} })
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/publications/attribution-review', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed to load reviews.')
      setData(payload)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function decide(reviewId, decision) {
    setBusyId(reviewId)
    setMessage('')
    try {
      const response = await fetch('/api/publications/attribution-review', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, decision }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed to save the decision.')
      setMessage(`Attribution ${decision}. The public publication cache will update on the next scheduled refresh.`)
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
            <h1 className="text-3xl font-bold tracking-tight">Publication attribution review</h1>
          </div>
          <AuthButtons signInCallbackUrl="/admin/publications" signOutCallbackUrl="/login" />
        </div>
        <p className="max-w-3xl text-gray-600">
          Review researcher links that could not be confirmed automatically. Approvals publish on the next scheduled publication refresh; rejections remain researcher-specific.
        </p>
        <Link className="text-sm font-semibold text-purple hover:underline" href="/admin">Back to Admin Hub</Link>
      </header>

      {message && <p className="rounded-lg border border-black/10 bg-white p-4 text-sm">{message}</p>}
      {loading ? <div className="h-32 animate-pulse rounded-xl bg-white shadow-sm" /> : (
        <>
          <section className="space-y-4">
            <div>
              <h2 className="text-2xl font-semibold">Pending candidates ({data.pending.length})</h2>
              <p className="text-sm text-gray-500">Pending links remain hidden from public researcher attribution.</p>
            </div>
            {data.pending.length === 0 ? (
              <p className="rounded-xl border border-black/10 bg-white p-5 text-gray-600">No publication attributions are waiting for review.</p>
            ) : data.pending.map((review) => (
              <ReviewCard key={review._id} review={review} busy={busyId === review._id} onDecision={decide} />
            ))}
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-semibold">Recent decisions ({data.decisions.length})</h2>
            {data.decisions.map((review) => (
              <ReviewCard key={review._id} review={review} busy={busyId === review._id} onDecision={decide} />
            ))}
          </section>
        </>
      )}
    </main>
  )
}
