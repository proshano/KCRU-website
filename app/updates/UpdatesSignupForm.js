'use client'

import { useRef, useState } from 'react'
import Script from 'next/script'

function isValidEmail(value) {
  return /\S+@\S+\.\S+/.test(value || '')
}

export default function UpdatesSignupForm({ roleOptions = [], therapeuticAreas = [], recaptchaSiteKey }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    roles: [],
    therapeuticAreaIds: [],
    topics: ['study_updates', 'publication_updates']
  })
  const [honeypot, setHoneypot] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState({ type: 'idle', message: '', manageUrl: '' })
  const [captchaReady, setCaptchaReady] = useState(!recaptchaSiteKey)
  const startTimeRef = useRef(Date.now())

  const toggleMultiSelect = (field, value) => {
    setForm((prev) => {
      const set = new Set(prev[field])
      if (set.has(value)) {
        set.delete(value)
      } else {
        set.add(value)
      }
      return { ...prev, [field]: Array.from(set) }
    })
  }

  async function getRecaptchaToken() {
    if (!recaptchaSiteKey) return null
    if (!captchaReady || typeof window === 'undefined' || !window.grecaptcha?.execute) {
      throw new Error('Captcha is still loading. Please try again.')
    }

    return new Promise((resolve, reject) => {
      window.grecaptcha.ready(async () => {
        try {
          const token = await window.grecaptcha.execute(recaptchaSiteKey, { action: 'updates_signup' })
          resolve(token)
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setStatus({ type: 'idle', message: '', manageUrl: '' })

    const name = form.name.trim()
    const email = form.email.trim()

    if (!email) {
      setStatus({ type: 'error', message: 'Email is required.' })
      return
    }

    if (!isValidEmail(email)) {
      setStatus({ type: 'error', message: 'Please enter a valid email address.' })
      return
    }

    if (!form.roles.length) {
      setStatus({ type: 'error', message: 'Please select at least one role.' })
      return
    }

    if (!form.topics.length) {
      setStatus({ type: 'error', message: 'Please select at least one update type.' })
      return
    }

    if (!form.therapeuticAreaIds.length) {
      setStatus({ type: 'error', message: 'Please select at least one therapeutic area.' })
      return
    }

    setLoading(true)

    try {
      const recaptchaToken = await getRecaptchaToken()

      const res = await fetch('/api/updates/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          roles: form.roles,
          therapeuticAreaIds: form.therapeuticAreaIds,
          topics: form.topics,
          recaptchaToken,
          honeypot,
          startedAt: startTimeRef.current
        })
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Unable to subscribe right now.')
      }

      const origin = typeof window !== 'undefined' ? window.location.origin : ''
      const manageUrl = data.manageToken
        ? `${origin}/updates/manage?token=${encodeURIComponent(data.manageToken)}`
        : ''

      setStatus({
        type: 'success',
        message: data.created ? 'You are subscribed for updates.' : 'Your preferences have been updated.',
        manageUrl
      })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Unable to subscribe right now.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white border border-black/[0.06] p-6 shadow-sm">
      {recaptchaSiteKey && (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${recaptchaSiteKey}`}
          strategy="afterInteractive"
          onLoad={() => setCaptchaReady(true)}
        />
      )}

      <form className="space-y-6" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-base font-semibold text-[#333]">Name</label>
            <input
              type="text"
              className="w-full rounded-md border border-black/10 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-purple/50"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              autoComplete="name"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-base font-semibold text-[#333]">
              Email<span className="text-purple">*</span>
            </label>
            <input
              type="email"
              className="w-full rounded-md border border-black/10 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-purple/50"
              value={form.email}
              onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
              autoComplete="email"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-base font-semibold text-[#333]">
            Update types<span className="text-purple">*</span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.topics.includes('study_updates')}
                onChange={() => toggleMultiSelect('topics', 'study_updates')}
              />
              Study updates
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={form.topics.includes('publication_updates')}
                onChange={() => toggleMultiSelect('topics', 'publication_updates')}
              />
              Publication updates
            </label>
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-base font-semibold text-[#333]">
            Roles<span className="text-purple">*</span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {roleOptions.map((role) => (
              <label key={role.value} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.roles.includes(role.value)}
                  onChange={() => toggleMultiSelect('roles', role.value)}
                />
                {role.title}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-base font-semibold text-[#333]">
            Therapeutic areas<span className="text-purple">*</span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {therapeuticAreas.map((area) => (
              <label key={area._id} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.therapeuticAreaIds.includes(area._id)}
                  onChange={() => toggleMultiSelect('therapeuticAreaIds', area._id)}
                />
                <span>
                  {area.shortLabel ? `${area.shortLabel} - ` : ''}
                  {area.name}
                </span>
              </label>
            ))}
            {!therapeuticAreas.length && (
              <p className="text-xs text-gray-500">No therapeutic areas are configured yet.</p>
            )}
          </div>
        </div>

        <label className="hidden">
          Leave this field empty
          <input type="text" value={honeypot} onChange={(event) => setHoneypot(event.target.value)} />
        </label>

        {status.type === 'error' && <p className="text-sm text-red-600">{status.message}</p>}
        {status.type === 'success' && (
          <div className="space-y-2">
            <p className="text-sm text-green-700">{status.message}</p>
            {status.manageUrl && (
              <p className="text-xs text-[#555]">
                Manage your preferences anytime at{' '}
                <a className="text-purple font-semibold hover:underline" href={status.manageUrl}>
                  this link
                </a>
                .
              </p>
            )}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center rounded-md bg-purple px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? 'Submitting...' : 'Sign up for updates'}
        </button>
      </form>
    </div>
  )
}
