'use client'

import { useState, useRef } from 'react'
import Script from 'next/script'

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value || '')
}

export default function ReferralForm({ 
  acceptsReferrals, 
  studySlug, 
  studyTitle, 
  coordinatorEmail,
  recaptchaSiteKey 
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [isProvider, setIsProvider] = useState(false)
  const [honeypot, setHoneypot] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [captchaReady, setCaptchaReady] = useState(!recaptchaSiteKey)
  const startTimeRef = useRef(Date.now())

  const canSubmit = isValidEmail(email) && isProvider && !loading
  const isEnabled = acceptsReferrals && coordinatorEmail

  async function getRecaptchaToken() {
    if (!recaptchaSiteKey) return null
    if (!captchaReady || typeof window === 'undefined' || !window.grecaptcha?.execute) {
      throw new Error('Captcha is still loading. Please try again.')
    }

    return new Promise((resolve, reject) => {
      window.grecaptcha.ready(async () => {
        try {
          const token = await window.grecaptcha.execute(recaptchaSiteKey, { action: 'referral' })
          resolve(token)
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setStatus({ type: 'idle', message: '' })

    if (!isValidEmail(email)) {
      setStatus({ type: 'error', message: 'Please enter a valid email address.' })
      return
    }

    if (!isProvider) {
      setStatus({ type: 'error', message: 'You must confirm you are a healthcare provider.' })
      return
    }

    setLoading(true)

    try {
      const recaptchaToken = await getRecaptchaToken()

      const res = await fetch('/api/referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          studySlug,
          isProvider,
          recaptchaToken,
          honeypot,
          startedAt: startTimeRef.current
        })
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Unable to submit right now.')
      }

      setStatus({
        type: 'success',
        message: data.message || 'Thank you. The study coordinator will be in touch shortly.'
      })
      setEmail('')
      setIsProvider(false)
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Unable to submit right now.' })
    } finally {
      setLoading(false)
    }
  }

  function handleClose() {
    setIsOpen(false)
    setStatus({ type: 'idle', message: '' })
  }

  // Disabled state - not accepting referrals
  if (!isEnabled) {
    return (
      <button
        disabled
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-200 text-gray-500 font-medium rounded-lg cursor-not-allowed"
      >
        Not accepting referrals
      </button>
    )
  }

  // Success state - show confirmation
  if (status.type === 'success') {
    return (
      <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
        <div className="flex items-start gap-3">
          <span className="text-emerald-600 text-lg">✓</span>
          <div>
            <p className="font-medium text-emerald-800">{status.message}</p>
            <button
              onClick={handleClose}
              className="mt-2 text-sm text-emerald-700 underline underline-offset-2 hover:text-emerald-900"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Collapsed state - show button
  if (!isOpen) {
    return (
      <button
        onClick={() => {
          setIsOpen(true)
          startTimeRef.current = Date.now()
        }}
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple text-white font-medium rounded-lg hover:bg-purple/90 transition"
      >
        Refer a patient
      </button>
    )
  }

  // Expanded state - show form
  return (
    <div className="mt-4 p-4 bg-white border border-gray-200 rounded-lg shadow-sm">
      {recaptchaSiteKey && (
        <Script
          src={`https://www.google.com/recaptcha/api.js?render=${recaptchaSiteKey}`}
          strategy="afterInteractive"
          onLoad={() => setCaptchaReady(true)}
        />
      )}

      <p className="text-sm text-gray-600 mb-4">
        Enter your email and our study coordinator will contact you within 1-2 business days to discuss the referral. 
        This keeps patient information off the website.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="referral-email" className="block text-sm font-medium text-gray-700 mb-1">
            Your email address
          </label>
          <input
            id="referral-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple/50 focus:border-purple"
            placeholder="you@institution.org"
            autoComplete="email"
            required
          />
        </div>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isProvider}
            onChange={(e) => setIsProvider(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-purple focus:ring-purple/50"
          />
          <span className="text-sm text-gray-700">
            I am a healthcare provider
          </span>
        </label>

        {/* Honeypot field */}
        <div className="hidden">
          <label>
            Leave this empty
            <input
              type="text"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
            />
          </label>
        </div>

        {status.type === 'error' && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {status.message}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="inline-flex items-center justify-center rounded-md bg-purple px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple/90 disabled:cursor-not-allowed disabled:opacity-50 transition"
          >
            {loading ? 'Submitting…' : 'Submit'}
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
