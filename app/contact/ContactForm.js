'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Script from 'next/script'

function isValidEmail(value) {
  return /\S+@\S+\.\S+/.test(value || '')
}

export default function ContactForm({ options = [], recaptchaSiteKey }) {
  const searchParams = useSearchParams()
  const initialReason = searchParams.get('reason') || ''
  
  const [form, setForm] = useState({
    name: '',
    email: '',
    reasonKey: '',
    message: ''
  })
  
  // Set initial reason from URL query parameter
  useEffect(() => {
    if (initialReason && options.some(opt => opt.key === initialReason)) {
      setForm(prev => ({ ...prev, reasonKey: initialReason }))
    }
  }, [initialReason, options])
  const [attachment, setAttachment] = useState(null)
  const [honeypot, setHoneypot] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState({ type: 'idle', message: '' })
  const [captchaReady, setCaptchaReady] = useState(!recaptchaSiteKey)
  const startTimeRef = useRef(Date.now())

  useEffect(() => {
    if (!recaptchaSiteKey) return
    if (typeof window !== 'undefined' && window.grecaptcha?.execute) {
      setCaptchaReady(true)
    }
  }, [recaptchaSiteKey])

  const selectedOption = useMemo(() => options.find((opt) => opt.key === form.reasonKey) || null, [form.reasonKey, options])

  const requiresMessage = selectedOption ? !selectedOption.showOceanLink : false
  const messagePlaceholder =
    selectedOption?.messagePlaceholder ||
    'Add a short note so we can route this quickly.'

  const successMessage =
    status.type === 'success'
      ? status.message ||
        (selectedOption?.showOceanLink
          ? 'Thanks — please use the referral link below.'
          : 'Thanks for reaching out. We will respond soon.')
      : ''

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }))
  }

  async function getRecaptchaToken() {
    if (!recaptchaSiteKey) return null
    if (!captchaReady || typeof window === 'undefined' || !window.grecaptcha?.execute) {
      throw new Error('Captcha is still loading. Please try again.')
    }

    return new Promise((resolve, reject) => {
      window.grecaptcha.ready(async () => {
        try {
          const token = await window.grecaptcha.execute(recaptchaSiteKey, { action: 'contact' })
          resolve(token)
        } catch (err) {
          reject(err)
        }
      })
    })
  }

  async function toBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result || ''
        const base64 = String(result).split(',').pop()
        resolve(base64)
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  function handleFileChange(event) {
    const file = event.target.files?.[0]
    if (!file) {
      setAttachment(null)
      return
    }
    if (file.type !== 'application/pdf') {
      setStatus({ type: 'error', message: 'Only PDF files are accepted.' })
      setAttachment(null)
      return
    }
    const maxBytes = 6 * 1024 * 1024
    if (file.size > maxBytes) {
      setStatus({ type: 'error', message: 'File must be under 6MB.' })
      setAttachment(null)
      return
    }
    setStatus({ type: 'idle', message: '' })
    setAttachment(file)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setStatus({ type: 'idle', message: '' })

    const name = form.name.trim()
    const email = form.email.trim()
    const message = form.message.trim()
    const currentOption = options.find((opt) => opt.key === form.reasonKey) || null

    if (!name || !email || !form.reasonKey || !currentOption) {
      setStatus({ type: 'error', message: 'Please complete the required fields.' })
      return
    }

    if (!isValidEmail(email)) {
      setStatus({ type: 'error', message: 'Please enter a valid email address.' })
      return
    }

    if (currentOption && !currentOption.showOceanLink && !message) {
      setStatus({ type: 'error', message: 'Please include a brief message.' })
      return
    }

    setLoading(true)

    try {
      const recaptchaToken = await getRecaptchaToken()
      let attachmentPayload = null

      if (currentOption && currentOption.key === 'training' && attachment) {
        const base64 = await toBase64(attachment)
        attachmentPayload = {
          filename: attachment.name,
          contentType: attachment.type,
          base64
        }
      }

      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          reasonKey: form.reasonKey,
          message: currentOption && !currentOption.showOceanLink ? message : '',
          recaptchaToken,
          honeypot,
          startedAt: startTimeRef.current,
          ...(attachmentPayload ? { attachment: attachmentPayload } : {})
        })
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Unable to submit right now.')
      }

      setStatus({
        type: 'success',
        message: data.successMessage,
        showOceanLink: data.showOceanLink,
        oceanUrl: data.oceanUrl
      })

      setForm((prev) => ({
        ...prev,
        name,
        email,
        message: requiresMessage ? '' : prev.message
      }))
      setAttachment(null)
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Unable to submit right now.' })
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

      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-base font-semibold text-[#333]">
              Name<span className="text-purple">*</span>
            </label>
            <input
              type="text"
              className="w-full rounded-md border border-black/10 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-purple/50"
              value={form.name}
              onChange={handleChange('name')}
              autoComplete="name"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block text-base font-semibold text-[#333]">
              Contact email<span className="text-purple">*</span>
            </label>
            <input
              type="email"
              className="w-full rounded-md border border-black/10 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-purple/50"
              value={form.email}
              onChange={handleChange('email')}
              autoComplete="email"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
            <label className="block text-base font-semibold text-[#333]">
              Reason for contacting<span className="text-purple">*</span>
            </label>
          <select
            className="w-full rounded-md border border-black/10 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-purple/50 bg-white"
            value={form.reasonKey}
            onChange={handleChange('reasonKey')}
            required
          >
            <option value="" disabled>
              Select a reason
            </option>
            {options.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
          {selectedOption?.description && (
            <p className="text-sm text-[#666]">{selectedOption.description}</p>
          )}
        </div>

        {selectedOption && (
          <div className="space-y-2">
            <label className="block text-base font-semibold text-[#333]">
              {selectedOption.showOceanLink ? 'Referral via OceanMD' : 'How can we help?'}
              {!selectedOption.showOceanLink && <span className="text-purple">*</span>}
            </label>

            {selectedOption.showOceanLink ? (
              <div className="rounded-md border border-purple/30 bg-purple/5 px-4 py-3 text-base text-[#333]">
                <p className="font-semibold text-[#1a1a1a]">Use our referral link</p>
                <p className="mt-1 text-[#555]">
                  Share your contact email above, then continue to the OceanMD referral service.
                </p>
                {status?.oceanUrl && (
                  <a
                    href={status.oceanUrl}
                    className="mt-3 inline-flex items-center gap-2 text-purple font-semibold underline underline-offset-2"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open referral link
                  </a>
                )}
              </div>
            ) : (
              <textarea
                className="w-full rounded-md border border-black/10 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-purple/50 min-h-[120px]"
                value={form.message}
                onChange={handleChange('message')}
                placeholder={messagePlaceholder}
                required={requiresMessage}
              />
            )}

            {selectedOption.key === 'training' && (
              <div className="space-y-2">
                <label className="block text-base font-semibold text-[#333]">Upload CV (PDF only)</label>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileChange}
                  className="text-base text-[#555]"
                />
                {attachment && (
                  <p className="text-xs text-[#666]">Attached: {attachment.name}</p>
                )}
                <p className="text-sm text-[#777]">Max 6MB. PDF only.</p>
              </div>
            )}
          </div>
        )}

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

        {status.type === 'success' && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800 space-y-2">
            <p className="font-semibold">{successMessage}</p>
            {status.showOceanLink && status.oceanUrl && (
              <a
                href={status.oceanUrl}
                className="inline-flex items-center gap-2 rounded-md bg-purple px-3 py-2 text-sm font-semibold text-white"
                target="_blank"
                rel="noreferrer"
              >
                Go to OceanMD
              </a>
            )}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center rounded-md bg-purple px-5 py-2.5 text-base font-semibold text-white shadow-sm hover:bg-purple/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? 'Sending…' : 'Submit'}
          </button>
          <p className="text-sm text-[#777]">
            We will use your email to follow up about this inquiry.
          </p>
        </div>
      </form>
    </div>
  )
}







