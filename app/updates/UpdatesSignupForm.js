'use client'

import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'

const STUDY_UPDATES_VALUE = 'study_updates'
const NEWSLETTER_VALUE = 'newsletter'
const ALL_AREAS_VALUE = 'all'

const ROLE_WITH_SPECIALTY = new Set([
  'physician',
  'nurse_practitioner',
  'physician_assistant',
  'fellow_resident_specialty'
])

const ROLE_WITH_STUDY_UPDATES = new Set([
  'research_staff',
  'physician',
  'nurse_practitioner',
  'physician_assistant',
  'fellow_resident_specialty',
  'nurse',
  'clinical_coordinator',
  'pharmacist'
])

const CORRESPONDENCE_HELPER_TEXT = {
  [STUDY_UPDATES_VALUE]:
    'Each month, we send a list of studies that are actively looking for patient referrals, with an easy email link to refer someone directly. Many clinical trials struggle to find eligible patients, and most patients are never offered the chance to participate in research. We are trying to fix that by making it easy for clinicians and research staff to know what is available.',
  [NEWSLETTER_VALUE]: 'We send occasional news and updates about publications from our team.'
}

const PATIENT_POPULATION_LABEL_OVERRIDES = {
  'genetic kidney disease': 'Other genetic kidney disease'
}

const PATIENT_POPULATION_COLUMN_ORDER = {
  left: [
    'pre-dialysis ckd',
    'glomerulonephritis',
    'hemodialysis',
    'peritoneal dialysis',
    'transplant - eligibility and preparation',
    'transplant - perioperative',
    'transplant - post-transplant care'
  ],
  right: [
    'dialysis vascular access',
    'onconephrology',
    'acute kidney injury',
    'perioperative care (non-transplant)',
    'polycystic kidney disease',
    'genetic kidney disease'
  ]
}

function normalizeLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
}

function isValidEmail(value) {
  return /\S+@\S+\.\S+/.test(value || '')
}

export default function UpdatesSignupForm({
  roleOptions = [],
  specialtyOptions = [],
  interestAreaOptions = [],
  practiceSiteOptions = [],
  correspondenceOptions = [],
  recaptchaSiteKey
}) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    role: '',
    specialty: '',
    practiceSites: [],
    interestAreas: [],
    correspondencePreferences: [NEWSLETTER_VALUE]
  })
  const [errors, setErrors] = useState({})
  const [honeypot, setHoneypot] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState({ type: 'idle', message: '', manageUrl: '' })
  const [captchaReady, setCaptchaReady] = useState(!recaptchaSiteKey)
  const startTimeRef = useRef(Date.now())
  const hasCorrespondenceSelection = form.correspondencePreferences.length > 0
  const isSubmitDisabled =
    loading || (recaptchaSiteKey && !captchaReady) || !hasCorrespondenceSelection

  const showSpecialty = ROLE_WITH_SPECIALTY.has(form.role)
  const showStudyUpdatesOption = ROLE_WITH_STUDY_UPDATES.has(form.role)
  const showPatientPopulations =
    form.correspondencePreferences.includes(STUDY_UPDATES_VALUE) && interestAreaOptions.length > 0

  const normalizedInterestAreas = interestAreaOptions.map((option) => {
    const key = normalizeLabel(option.title)
    const override = PATIENT_POPULATION_LABEL_OVERRIDES[key]
    return { ...option, title: override || option.title, _key: key }
  })
  const interestAreaLookup = new Map(normalizedInterestAreas.map((option) => [option._key, option]))
  const allAreaOption = normalizedInterestAreas.find((option) => option.value === ALL_AREAS_VALUE) || null
  const selectableAreas = normalizedInterestAreas.filter((option) => option.value !== ALL_AREAS_VALUE)
  const leftColumn = PATIENT_POPULATION_COLUMN_ORDER.left
    .map((key) => interestAreaLookup.get(key))
    .filter(Boolean)
  const rightColumn = PATIENT_POPULATION_COLUMN_ORDER.right
    .map((key) => interestAreaLookup.get(key))
    .filter(Boolean)
  const usedAreaValues = new Set([...leftColumn, ...rightColumn].map((option) => option.value))
  const remainingAreas = selectableAreas.filter((option) => !usedAreaValues.has(option.value))
  const patientPopulationColumns = [leftColumn, rightColumn.concat(remainingAreas)]
  if (allAreaOption) {
    patientPopulationColumns[0].unshift(allAreaOption)
  }
  const interestAreaValues = interestAreaOptions.map((option) => option.value)

  const visibleCorrespondenceOptions = correspondenceOptions.filter((option) => {
    if (option.value === NEWSLETTER_VALUE) return true
    if (option.value === STUDY_UPDATES_VALUE) return showStudyUpdatesOption
    return false
  })

  useEffect(() => {
    if (!recaptchaSiteKey) return
    if (typeof window !== 'undefined' && window.grecaptcha?.execute) {
      setCaptchaReady(true)
    }
  }, [recaptchaSiteKey])

  const handleRoleChange = (event) => {
    const nextRole = event.target.value
    setForm((prev) => {
      const nextCorrespondence = ROLE_WITH_STUDY_UPDATES.has(nextRole)
        ? Array.from(new Set([...prev.correspondencePreferences, STUDY_UPDATES_VALUE]))
        : prev.correspondencePreferences.filter((value) => value !== STUDY_UPDATES_VALUE)
      const next = {
        ...prev,
        role: nextRole,
        specialty: ROLE_WITH_SPECIALTY.has(nextRole) ? prev.specialty : '',
        correspondencePreferences: nextCorrespondence,
        practiceSites: ROLE_WITH_STUDY_UPDATES.has(nextRole) ? prev.practiceSites : [],
        interestAreas: ROLE_WITH_STUDY_UPDATES.has(nextRole) ? prev.interestAreas : []
      }
      return next
    })
    setErrors((prev) => ({ ...prev, role: '', correspondencePreferences: '', interestAreas: '' }))
  }

  const toggleInterestArea = (value) => {
    setForm((prev) => {
      const set = new Set(prev.interestAreas)
      if (value === ALL_AREAS_VALUE) {
        if (set.has(ALL_AREAS_VALUE)) {
          set.delete(ALL_AREAS_VALUE)
          return { ...prev, interestAreas: Array.from(set) }
        }
        return { ...prev, interestAreas: interestAreaValues }
      }

      if (set.has(value)) {
        set.delete(value)
      } else {
        set.add(value)
      }

      if (set.has(ALL_AREAS_VALUE) && !set.has(value)) {
        set.delete(ALL_AREAS_VALUE)
      }

      return { ...prev, interestAreas: Array.from(set) }
    })
    setErrors((prev) => ({ ...prev, interestAreas: '' }))
  }

  const toggleCorrespondence = (value) => {
    setForm((prev) => {
      const set = new Set(prev.correspondencePreferences || [])
      if (set.has(value)) {
        set.delete(value)
      } else {
        set.add(value)
      }
      const next = {
        ...prev,
        correspondencePreferences: Array.from(set)
      }

      if (!set.has(STUDY_UPDATES_VALUE)) {
        next.interestAreas = []
      }

      return next
    })
    setErrors((prev) => ({ ...prev, correspondencePreferences: '', interestAreas: '' }))
  }

  const togglePracticeSite = (value) => {
    setForm((prev) => {
      const set = new Set(prev.practiceSites)
      if (set.has(value)) {
        set.delete(value)
      } else {
        set.add(value)
      }
      return { ...prev, practiceSites: Array.from(set) }
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

    const nextErrors = {}

    if (!email) {
      nextErrors.email = 'Email is required.'
    } else if (!isValidEmail(email)) {
      nextErrors.email = 'Please enter a valid email address.'
    }

    if (!form.role) {
      nextErrors.role = 'Please select a role.'
    }

    if (!form.correspondencePreferences.length) {
      nextErrors.correspondencePreferences = 'Please select at least one correspondence option.'
    }

    if (showPatientPopulations && form.interestAreas.length === 0) {
      nextErrors.interestAreas = 'Please select at least one patient population.'
    }

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors)
      return
    }

    setErrors({})
    setLoading(true)

    try {
      const recaptchaToken = await getRecaptchaToken()

      const allTherapeuticAreas = form.interestAreas.includes(ALL_AREAS_VALUE)
      const selectedInterestAreas = allTherapeuticAreas
        ? []
        : form.interestAreas.filter((value) => value !== ALL_AREAS_VALUE)

      const res = await fetch('/api/updates/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          role: form.role,
          specialty: form.specialty,
          practiceSites: form.practiceSites,
          interestAreas: selectedInterestAreas,
          allTherapeuticAreas,
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
              onChange={(event) => {
                setForm((prev) => ({ ...prev, email: event.target.value }))
                setErrors((prev) => ({ ...prev, email: '' }))
              }}
              autoComplete="email"
              required
            />
            {errors.email && <p className="text-sm text-red-600">{errors.email}</p>}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-base font-semibold text-[#333]">
            Role<span className="text-purple">*</span>
          </label>
          <select
            className="w-full rounded-md border border-black/10 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-purple/50 bg-white"
            value={form.role}
            onChange={handleRoleChange}
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
          {errors.role && <p className="text-sm text-red-600">{errors.role}</p>}
        </div>

        {showSpecialty && (
          <div className="space-y-2">
            <label className="block text-base font-semibold text-[#333]">Specialty</label>
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
        )}

        <div className="space-y-2">
          <label className="block text-base font-semibold text-[#333]">
            Correspondence preferences<span className="text-purple">*</span>
          </label>
          <div className="flex flex-col gap-3 text-sm">
            {visibleCorrespondenceOptions.map((option) => (
              <label key={option.value} className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0"
                  checked={form.correspondencePreferences.includes(option.value)}
                  onChange={() => toggleCorrespondence(option.value)}
                />
                <span className="space-y-1">
                  <span className="block font-medium text-sm">{option.title}</span>
                  <span className="block text-xs text-[#666]">
                    {CORRESPONDENCE_HELPER_TEXT[option.value]}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {errors.correspondencePreferences && (
            <p className="text-sm text-red-600">{errors.correspondencePreferences}</p>
          )}
        </div>

        {showPatientPopulations && (
          <div className="space-y-2">
            <div className="space-y-1">
              <p className="block text-base font-semibold text-[#333]">
                Patient populations<span className="text-purple">*</span>
              </p>
              <p className="text-sm text-[#666]">
                Select the patient populations relevant to your practice so we can send you the right opportunities.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 sm:gap-x-10">
              {patientPopulationColumns.map((column, columnIndex) => (
                <div key={columnIndex} className="space-y-3">
                  {column.map((area) => (
                    <label key={area.value} className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 shrink-0"
                        checked={form.interestAreas.includes(area.value)}
                        onChange={() => toggleInterestArea(area.value)}
                      />
                      <span className="leading-snug">{area.title}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
            {errors.interestAreas && <p className="text-sm text-red-600">{errors.interestAreas}</p>}
          </div>
        )}

        {practiceSiteOptions.length > 0 && showStudyUpdatesOption && (
          <div className="space-y-2">
            <label className="block text-base font-semibold text-[#333]">Location of practice</label>
            <div className="grid gap-3 sm:grid-cols-2 sm:gap-x-8">
              {practiceSiteOptions.map((site) => (
                <label key={site.value} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0"
                    checked={form.practiceSites.includes(site.value)}
                    onChange={() => togglePracticeSite(site.value)}
                  />
                  <span className="leading-snug">{site.title}</span>
                </label>
              ))}
            </div>
          </div>
        )}

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
            disabled={isSubmitDisabled}
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
