'use client'

import { useRef, useState } from 'react'
import Script from 'next/script'

function isValidEmail(value) {
  return /\S+@\S+\.\S+/.test(value || '')
}

export default function UpdatesSignupForm({
  roleOptions = [],
  specialtyOptions = [],
  interestAreaOptions = [],
  correspondenceOptions = [],
  recaptchaSiteKey
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: '',
    specialty: '',
    interestAreas: [],
    correspondencePreferences: ['study_updates', 'newsletter']
  })
  const [honeypot, setHoneypot] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState({ type: 'idle', message: '', manageUrl: '' })
  const [captchaReady, setCaptchaReady] = useState(!recaptchaSiteKey)
  const startTimeRef = useRef(Date.now())

  const toggleInterestArea = (value) => {
    setForm((prev) => {
      const set = new Set(prev.interestAreas)
      if (set.has(value)) {
        set.delete(value)
      } else {
        set.add(value)
      }

      if (set.has('all') && value !== 'all') {
        set.delete('all')
      }

      if (value === 'all' && set.has('all')) {
        return { ...prev, interestAreas: ['all'] }
      }

      return { ...prev, interestAreas: Array.from(set) }
    })
  }

  const toggleCorrespondence = (value) => {
    setForm((prev) => {
      const set = new Set(prev.correspondencePreferences || [])
      if (set.has(value)) {
        set.delete(value)
      } else {
        set.add(value)
      }
      return { ...prev, correspondencePreferences: Array.from(set) }
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

    if (!form.role) {
      setStatus({ type: 'error', message: 'Please select a role.' })
      return
    }

    if (!form.interestAreas.length) {
      setStatus({ type: 'error', message: 'Please select at least one interest area.' })
      return
    }

    if (!form.correspondencePreferences.length) {
      setStatus({ type: 'error', message: 'Please select at least one correspondence option.' })
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
          role: form.role,
          specialty: form.specialty,
          interestAreas: form.interestAreas,
          correspondencePreferences: form.correspondencePreferences,
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
            Role<span className="text-purple">*</span>
          </label>
          <select
            className="w-full rounded-md border border-black/10 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-purple/50 bg-white"
            value={form.role}
            onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}
            required
          >
            <option value="" disabled>
              Select a role
            </option>
            {roleOptions.map((role) => (
              <option key={role.value} value={role.value}>
                {role.title}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="block text-base font-semibold text-[#333]">
            Specialty
          </label>
          <select
            className="w-full rounded-md border border-black/10 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-purple/50 bg-white"
            value={form.specialty}
            onChange={(event) => setForm((prev) => ({ ...prev, specialty: event.target.value }))}
          >
            <option value="">Select a specialty (optional)</option>
            {specialtyOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.title}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="block text-base font-semibold text-[#333]">
            Correspondence preferences<span className="text-purple">*</span>
          </label>
          <div className="flex flex-col gap-3 text-sm">
            {correspondenceOptions.map((option) => (
              <label key={option.value} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0"
                  checked={form.correspondencePreferences.includes(option.value)}
                  onChange={() => toggleCorrespondence(option.value)}
                />
                <span className="leading-relaxed">{option.title}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-base font-semibold text-[#333]">
            Therapeutic/Interest areas<span className="text-purple">*</span>
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            {interestAreaOptions.map((area) => (
              <label key={area.value} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.interestAreas.includes(area.value)}
                  onChange={() => toggleInterestArea(area.value)}
                />
                {area.title}
              </label>
            ))}
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

        <div className="space-y-2">
          <button
            type="submit"
            disabled={loading || (recaptchaSiteKey && !captchaReady)}
            className="inline-flex items-center justify-center rounded-md bg-purple px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Submitting...' : 'Sign up for updates'}
          </button>
          {recaptchaSiteKey && !captchaReady && (
            <p className="text-xs text-[#777]">Loading spam protection...</p>
          )}
        </div>
      </form>
    </div>
  )
}
