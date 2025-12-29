'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

const TOKEN_STORAGE_KEY = 'kcru-approval-token'

function formatList(items) {
  if (!items || !items.length) return 'None'
  return items.join(', ')
}

function formatDate(value) {
  if (!value) return 'Unknown'
  try {
    return new Date(value).toLocaleString()
  } catch (err) {
    return value
  }
}

export default function ApprovalClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [token, setToken] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submissions, setSubmissions] = useState([])
  const [meta, setMeta] = useState({ areas: [], researchers: [] })
  const [reviewingId, setReviewingId] = useState('')

  useEffect(() => {
    const queryToken = searchParams.get('token')
    if (queryToken) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, queryToken)
      setToken(queryToken)
      router.replace('/trials/approvals')
      return
    }
    const stored = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    if (stored) setToken(stored)
  }, [router, searchParams])

  useEffect(() => {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  }, [token])

  const areaMap = useMemo(() => {
    return new Map(
      (meta.areas || []).map((area) => [
        area._id,
        area.shortLabel ? `${area.shortLabel} - ${area.name}` : area.name,
      ])
    )
  }, [meta.areas])

  const researcherMap = useMemo(() => {
    return new Map((meta.researchers || []).map((r) => [r._id, r.name]))
  }, [meta.researchers])

  async function loadSubmissions(activeToken = token) {
    if (!activeToken) return
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/trials/approvals', {
        headers: { Authorization: `Bearer ${activeToken}` },
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        if (res.status === 401) {
          handleLogout()
        }
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setSubmissions(data.submissions || [])
      setMeta(data.meta || { areas: [], researchers: [] })
      setAdminEmail(data.adminEmail || '')
    } catch (err) {
      setError(err.message || 'Failed to load submissions.')
      if ((err.message || '').toLowerCase().includes('unauthorized')) {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY)
        setToken('')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token) loadSubmissions(token)
  }, [token])

  async function handleDecision(submissionId, decision) {
    if (!token) return
    setError('')
    setSuccess('')
    setReviewingId(submissionId)
    try {
      const res = await fetch('/api/trials/approvals', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ submissionId, decision }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setSuccess(`Submission ${decision === 'approve' ? 'approved' : 'rejected'}.`)
      await loadSubmissions(token)
    } catch (err) {
      setError(err.message || 'Failed to review submission.')
    } finally {
      setReviewingId('')
    }
  }

  function handleLogout() {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    setToken('')
    setSubmissions([])
    setSuccess('')
    setError('')
    setAdminEmail('')
  }

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">Admin Portal</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Study Approvals</h1>
        <p className="text-gray-600 max-w-2xl">
          Review study submissions from coordinators. Approving a submission updates the live studies list.
        </p>
      </header>

      {!token && (
        <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4 max-w-xl">
          <div>
            <h2 className="text-lg font-semibold">Approval access</h2>
            <p className="text-sm text-gray-500">
              Use the secure approval link sent to admin emails when a study is submitted.
            </p>
          </div>
          {(error || success) && (
            <div className="text-sm">
              {error && <p className="text-red-600">{error}</p>}
              {success && <p className="text-emerald-700">{success}</p>}
            </div>
          )}
        </section>
      )}

      {token && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Pending submissions</h2>
              <p className="text-sm text-gray-500">
                {submissions.length} submissions awaiting review.
              </p>
              {adminEmail && <p className="text-sm text-gray-500">Signed in as {adminEmail}.</p>}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => loadSubmissions(token)}
                disabled={loading}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {loading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex items-center justify-center text-sm text-gray-500 hover:text-gray-700"
              >
                Sign out
              </button>
            </div>
          </div>

          {(error || success) && (
            <div className="text-sm">
              {error && <p className="text-red-600">{error}</p>}
              {success && <p className="text-emerald-700">{success}</p>}
            </div>
          )}

          <div className="space-y-6">
            {submissions.map((submission) => {
              const payload = submission.payload || {}
              const therapeuticNames = (payload.therapeuticAreaIds || []).map((id) => areaMap.get(id) || id)
              const piName = payload.principalInvestigatorId
                ? researcherMap.get(payload.principalInvestigatorId) || payload.principalInvestigatorId
                : 'None'
              return (
                <article
                  key={submission._id}
                  className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-purple font-semibold">
                        {submission.action === 'update' ? 'Update submission' : 'New study submission'}
                      </p>
                      <h3 className="text-xl font-semibold">{submission.title || 'Untitled study'}</h3>
                      <p className="text-sm text-gray-500">
                        Submitted {formatDate(submission.submittedAt)}
                      </p>
                      <p className="text-sm text-gray-500">
                        Submitted by {submission.submittedBy?.email || 'Unknown'}
                      </p>
                      {submission.supersedesCount > 0 && (
                        <p className="text-sm text-amber-600">
                          Supersedes {submission.supersedesCount} earlier pending submission
                          {submission.supersedesCount === 1 ? '' : 's'}.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDecision(submission._id, 'approve')}
                        disabled={reviewingId === submission._id}
                        className="inline-flex items-center justify-center bg-emerald-600 text-white px-4 py-2 rounded shadow hover:bg-emerald-700 disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecision(submission._id, 'reject')}
                        disabled={reviewingId === submission._id}
                        className="inline-flex items-center justify-center border border-red-600 text-red-600 px-4 py-2 rounded hover:bg-red-50 disabled:opacity-60"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  {submission.study && (
                    <div className="rounded-lg border border-black/10 bg-gray-50 p-3 text-sm text-gray-700">
                      <p className="font-medium text-gray-900">Current study</p>
                      <p>
                        {submission.study.title} ({submission.study.status || 'status unknown'})
                      </p>
                      <p className="text-xs text-gray-500">
                        {submission.study.nctId || 'No NCT ID'} - {submission.study.slug || 'no-slug'}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
                    <div>
                      <p className="font-medium text-gray-900">Basics</p>
                      <p>Title: {payload.title || 'None'}</p>
                      <p>Slug: {payload.slug || 'None'}</p>
                      <p>NCT ID: {payload.nctId || 'None'}</p>
                      <p>Status: {payload.status || 'None'}</p>
                      <p>Study type: {payload.studyType || 'None'}</p>
                      <p>Phase: {payload.phase || 'None'}</p>
                      <p>Featured: {payload.featured ? 'Yes' : 'No'}</p>
                      <p>Accepts referrals: {payload.acceptsReferrals ? 'Yes' : 'No'}</p>
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">Sites and people</p>
                      <p>Therapeutic areas: {formatList(therapeuticNames)}</p>
                      <p>Principal investigator: {piName}</p>
                      <p>Study website (if available): {payload.sponsorWebsite || 'None'}</p>
                    </div>
                  </div>

                  <details className="text-sm text-gray-700">
                    <summary className="cursor-pointer font-medium text-gray-900">Descriptions</summary>
                    <div className="mt-3 space-y-2">
                      <p>
                        <span className="font-medium">Clinical summary:</span> {payload.laySummary || 'None'}
                      </p>
                    </div>
                  </details>

                  <details className="text-sm text-gray-700">
                    <summary className="cursor-pointer font-medium text-gray-900">Eligibility criteria</summary>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="font-medium">Inclusion</p>
                        <ul className="list-disc pl-5 space-y-1">
                          {(payload.inclusionCriteria || []).length
                            ? payload.inclusionCriteria.map((item, index) => (
                                <li key={`inc-${index}`}>{item}</li>
                              ))
                            : 'None'}
                        </ul>
                      </div>
                      <div>
                        <p className="font-medium">Exclusion</p>
                        <ul className="list-disc pl-5 space-y-1">
                          {(payload.exclusionCriteria || []).length
                            ? payload.exclusionCriteria.map((item, index) => (
                                <li key={`exc-${index}`}>{item}</li>
                              ))
                            : 'None'}
                        </ul>
                      </div>
                    </div>
                  </details>

                  <details className="text-sm text-gray-700">
                    <summary className="cursor-pointer font-medium text-gray-900">Local contact</summary>
                    <div className="mt-3 space-y-1">
                      <p>Name: {payload.localContact?.name || 'None'}</p>
                      <p>Role: {payload.localContact?.role || 'None'}</p>
                      <p>Email: {payload.localContact?.email || 'None'}</p>
                      <p>Phone: {payload.localContact?.phone || 'None'}</p>
                      <p>Display publicly: {payload.localContact?.displayPublicly ? 'Yes' : 'No'}</p>
                    </div>
                  </details>
                </article>
              )
            })}

            {!submissions.length && (
              <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm text-sm text-gray-600">
                No pending submissions right now.
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
