'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { getTherapeuticAreaLabel } from '@/lib/communicationOptions'

const TOKEN_STORAGE_KEY = 'kcru-admin-token'
const EMAIL_STORAGE_KEY = 'kcru-admin-email'
const LEGACY_TOKEN_KEYS = ['kcru-approval-token', 'kcru-updates-admin-token']
const LEGACY_EMAIL_KEYS = ['kcru-approval-email', 'kcru-updates-admin-email']

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

function statusBadge(status) {
  if (status === 'pending') return 'bg-amber-100 text-amber-800'
  if (status === 'approved') return 'bg-emerald-100 text-emerald-800'
  if (status === 'rejected') return 'bg-red-100 text-red-700'
  if (status === 'superseded') return 'bg-gray-100 text-gray-600'
  return 'bg-gray-100 text-gray-600'
}

function statusLabel(status) {
  if (!status) return 'Unknown'
  return `${status.charAt(0).toUpperCase()}${status.slice(1)}`
}

export default function ApprovalClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const prefersAdmin = pathname.startsWith('/admin')
  const approvalsPath = prefersAdmin ? '/admin/approvals' : '/trials/approvals'
  const approvalsEditPath = `${approvalsPath}/edit`
  const updatesPath = prefersAdmin ? '/admin/updates' : '/updates/admin'
  const [token, setToken] = useState('')
  const [email, setEmail] = useState('')
  const [passcode, setPasscode] = useState('')
  const [sendingCode, setSendingCode] = useState(false)
  const [verifyingCode, setVerifyingCode] = useState(false)
  const [adminEmail, setAdminEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submissions, setSubmissions] = useState([])
  const [meta, setMeta] = useState({ areas: [], researchers: [] })
  const [reviewingId, setReviewingId] = useState('')
  const [reviewingAction, setReviewingAction] = useState('')

  useEffect(() => {
    const queryToken = searchParams.get('token')
    const status = searchParams.get('status')
    const errorMessage = searchParams.get('error')
    const nextParams = new URLSearchParams(searchParams.toString())
    let shouldReplace = false
    if (queryToken) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, queryToken)
      setToken(queryToken)
      nextParams.delete('token')
      shouldReplace = true
    }
    if (status) {
      setError('')
      setSuccess(`Submission ${status === 'approve' ? 'approved' : 'rejected'}.`)
      nextParams.delete('status')
      shouldReplace = true
    }
    if (errorMessage) {
      setSuccess('')
      setError(errorMessage)
      nextParams.delete('error')
      shouldReplace = true
    }
    if (shouldReplace) {
      const nextQuery = nextParams.toString()
      router.replace(nextQuery ? `${approvalsPath}?${nextQuery}` : approvalsPath)
      return
    }
    let stored = sessionStorage.getItem(TOKEN_STORAGE_KEY)
    if (!stored) {
      stored = LEGACY_TOKEN_KEYS.map((key) => sessionStorage.getItem(key)).find(Boolean) || ''
      if (stored) {
        sessionStorage.setItem(TOKEN_STORAGE_KEY, stored)
      }
    }
    if (stored) setToken(stored)
    let storedEmail = sessionStorage.getItem(EMAIL_STORAGE_KEY)
    if (!storedEmail) {
      storedEmail = LEGACY_EMAIL_KEYS.map((key) => sessionStorage.getItem(key)).find(Boolean) || ''
      if (storedEmail) {
        sessionStorage.setItem(EMAIL_STORAGE_KEY, storedEmail)
      }
    }
    if (storedEmail) setEmail(storedEmail)
  }, [approvalsPath, router, searchParams])

  useEffect(() => {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  }, [token])

  useEffect(() => {
    if (email) {
      sessionStorage.setItem(EMAIL_STORAGE_KEY, email)
    } else {
      sessionStorage.removeItem(EMAIL_STORAGE_KEY)
    }
  }, [email])

  const areaMap = useMemo(() => {
    return new Map(
      (meta.areas || []).map((area) => [
        area._id,
        area.shortLabel
          ? `${area.shortLabel} - ${getTherapeuticAreaLabel(area.name)}`
          : getTherapeuticAreaLabel(area.name),
      ])
    )
  }, [meta.areas])

  const researcherMap = useMemo(() => {
    return new Map((meta.researchers || []).map((r) => [r._id, r.name]))
  }, [meta.researchers])

  const pendingCount = useMemo(
    () => submissions.filter((submission) => submission.status === 'pending').length,
    [submissions]
  )

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    sessionStorage.removeItem(EMAIL_STORAGE_KEY)
    LEGACY_TOKEN_KEYS.forEach((key) => sessionStorage.removeItem(key))
    LEGACY_EMAIL_KEYS.forEach((key) => sessionStorage.removeItem(key))
    setToken('')
    setEmail('')
    setPasscode('')
    setSubmissions([])
    setSuccess('')
    setError('')
    setAdminEmail('')
  }, [])

  const loadSubmissions = useCallback(async (activeToken = token) => {
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
  }, [token, handleLogout])

  useEffect(() => {
    if (token) loadSubmissions(token)
  }, [token, loadSubmissions])

  async function handleDecision(submissionId, decision) {
    if (!token) return
    setError('')
    setSuccess('')
    setReviewingId(submissionId)
    setReviewingAction(decision)
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
      const nextStatus = decision === 'approve' ? 'approved' : 'rejected'
      setSubmissions((prev) =>
        prev.map((item) => (item._id === submissionId ? { ...item, status: nextStatus } : item))
      )
      setTimeout(() => {
        loadSubmissions(token)
      }, 800)
    } catch (err) {
      setError(err.message || 'Failed to review submission.')
    } finally {
      setReviewingId('')
      setReviewingAction('')
    }
  }

  async function sendPasscode(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!email) {
      setError('Enter your email.')
      return
    }
    setSendingCode(true)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, scope: 'approvals' }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setSuccess('Passcode sent. Check your email.')
    } catch (err) {
      setError(err.message || 'Failed to send passcode.')
    } finally {
      setSendingCode(false)
    }
  }

  async function verifyPasscode(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    if (!email || !passcode) {
      setError('Enter your email and passcode.')
      return
    }
    setVerifyingCode(true)
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: passcode, scope: 'approvals' }),
      })
      const data = await res.json()
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`)
      }
      setToken(data.token || '')
      setSuccess('Signed in. Loading submissions...')
      setPasscode('')
    } catch (err) {
      setError(err.message || 'Failed to verify passcode.')
    } finally {
      setVerifyingCode(false)
    }
  }

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">Admin Portal</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Study Approvals</h1>
        <p className="text-gray-600 max-w-2xl">
          Review study submissions from coordinators. Approving a submission updates the live studies list.
        </p>
        {token && (
          <div className="flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <span className="text-xs uppercase tracking-wide text-gray-400">Admin links</span>
            <Link href="/admin" className="hover:text-gray-700">
              Admin hub
            </Link>
            <Link href={approvalsPath} className="text-purple font-medium">
              Study approvals
            </Link>
            <Link href={updatesPath} className="hover:text-gray-700">
              Study update emails
            </Link>
          </div>
        )}
      </header>

      {!token && (
        <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4 max-w-xl">
          <div>
            <h2 className="text-lg font-semibold">Approval access</h2>
            <p className="text-sm text-gray-500">
              Use the secure approval link or request a passcode to sign in.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form className="space-y-2" onSubmit={sendPasscode}>
              <label htmlFor="approval-email" className="text-sm font-medium">Work email</label>
              <input
                id="approval-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@lhsc.on.ca"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p className="text-xs text-gray-500">
                We will send a one-time 6-digit code.
              </p>
              <button
                type="submit"
                disabled={sendingCode || !email}
                className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90 disabled:opacity-60"
              >
                {sendingCode ? 'Sending...' : 'Send passcode'}
              </button>
            </form>
            <form className="space-y-2" onSubmit={verifyPasscode}>
              <label htmlFor="approval-passcode" className="text-sm font-medium">Passcode</label>
              <input
                id="approval-passcode"
                type="text"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="6-digit code"
                className="w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple font-mono"
              />
              <p className="text-xs text-gray-500">
                Enter the 6-digit code from your email.
              </p>
              <button
                type="submit"
                disabled={verifyingCode || !email || !passcode}
                className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10 disabled:opacity-60"
              >
                {verifyingCode ? 'Verifying...' : 'Verify passcode'}
              </button>
            </form>
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
              <h2 className="text-lg font-semibold">Latest submissions</h2>
              <p className="text-sm text-gray-500">
                {pendingCount} pending approvals · {submissions.length} latest submissions
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
                : payload.principalInvestigatorName || 'None'
              const isReviewing = reviewingId === submission._id
              const isPending = submission.status === 'pending'
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
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-semibold">{submission.title || 'Untitled study'}</h3>
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${statusBadge(submission.status)}`}>
                          {statusLabel(submission.status)}
                        </span>
                      </div>
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
                    {isPending ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleDecision(submission._id, 'approve')}
                          disabled={isReviewing}
                          className="inline-flex items-center justify-center bg-emerald-600 text-white px-4 py-2 rounded shadow hover:bg-emerald-700 disabled:opacity-60"
                        >
                          {isReviewing && reviewingAction === 'approve' ? 'Approving...' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(submission._id, 'reject')}
                          disabled={isReviewing}
                          className="inline-flex items-center justify-center border border-red-600 text-red-600 px-4 py-2 rounded hover:bg-red-50 disabled:opacity-60"
                        >
                          {isReviewing && reviewingAction === 'reject' ? 'Rejecting...' : 'Reject'}
                        </button>
                        <Link
                          href={`${approvalsEditPath}?submissionId=${submission._id}${token ? `&token=${token}` : ''}`}
                          className="inline-flex items-center justify-center border border-purple text-purple px-4 py-2 rounded hover:bg-purple/10"
                        >
                          Edit
                        </Link>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500">
                        This submission is already {submission.status}.
                      </div>
                    )}
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
                      <p>
                        <span className="font-medium">Short clinical title:</span> {payload.emailTitle || 'None'}
                      </p>
                      <p>
                        <span className="font-medium">Eligibility statement:</span>{' '}
                        {payload.emailEligibilitySummary || 'None'}
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
                No submissions found yet.
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
