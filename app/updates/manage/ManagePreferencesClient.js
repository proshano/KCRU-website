'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  DELIVERY_STATUS_SUPPRESSED,
  SUBSCRIPTION_STATUS_SUBSCRIBED,
  SUBSCRIPTION_STATUS_UNSUBSCRIBED,
  resolveDeliveryStatus,
  resolveSubscriptionStatus,
} from '@/lib/updateSubscriberStatus'

export default function ManagePreferencesClient({
  roleOptions = [],
  specialtyOptions = [],
  interestAreaOptions = [],
  correspondenceOptions = []
}) {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''

  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState({ type: 'idle', message: '' })

  useEffect(() => {
    let isMounted = true

    async function loadPreferences() {
      if (!token) {
        setStatus({ type: 'error', message: 'Missing preference token.' })
        setLoading(false)
        return
      }

      try {
        const res = await fetch(`/api/updates/manage?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (!res.ok || !data.ok) {
          throw new Error(data?.error || 'Unable to load preferences.')
        }

        if (!isMounted) return

        const subscriber = data.subscriber || {}
        const subscriptionStatus = resolveSubscriptionStatus(subscriber)
        const deliveryStatus = resolveDeliveryStatus(subscriber)

        const interestAreas = subscriber.allTherapeuticAreas ? ['all'] : (subscriber.interestAreas || [])

        setForm({
          name: subscriber.name || '',
          email: subscriber.email || '',
          role: subscriber.role || '',
          specialty: subscriber.specialty || '',
          interestAreas,
          correspondencePreferences: subscriber.correspondencePreferences || ['study_updates', 'newsletter'],
          subscriptionStatus,
          deliveryStatus
        })
      } catch (error) {
        if (!isMounted) return
        setStatus({ type: 'error', message: error.message || 'Unable to load preferences.' })
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadPreferences()

    return () => {
      isMounted = false
    }
  }, [token])

  const toggleInterestArea = (value) => {
    setForm((prev) => {
      if (!prev) return prev
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
      if (!prev) return prev
      const set = new Set(prev.correspondencePreferences || [])
      if (set.has(value)) {
        set.delete(value)
      } else {
        set.add(value)
      }
      return { ...prev, correspondencePreferences: Array.from(set) }
    })
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!form) return

    setStatus({ type: 'idle', message: '' })

    if (!form.role) {
      setStatus({ type: 'error', message: 'Please select a role.' })
      return
    }

    const allTherapeuticAreas = form.interestAreas.includes('all')
    const selectedInterestAreas = allTherapeuticAreas ? [] : form.interestAreas

    if (!allTherapeuticAreas && !selectedInterestAreas.length) {
      setStatus({ type: 'error', message: 'Please select at least one interest area.' })
      return
    }

    if (!form.correspondencePreferences.length) {
      setStatus({ type: 'error', message: 'Please select at least one correspondence option.' })
      return
    }

    setSaving(true)

    try {
      const res = await fetch('/api/updates/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          action: 'update',
          name: form.name,
          role: form.role,
          specialty: form.specialty,
          interestAreas: selectedInterestAreas,
          allTherapeuticAreas,
          correspondencePreferences: form.correspondencePreferences
        })
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Unable to save preferences.')
      }

      setForm((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          subscriptionStatus: data.subscriptionStatus || SUBSCRIPTION_STATUS_SUBSCRIBED,
          deliveryStatus: data.deliveryStatus || prev.deliveryStatus
        }
      })
      setStatus({ type: 'success', message: 'Preferences saved.' })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Unable to save preferences.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleUnsubscribe() {
    if (!token) return

    setSaving(true)
    setStatus({ type: 'idle', message: '' })

    try {
      const res = await fetch('/api/updates/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'unsubscribe' })
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Unable to unsubscribe.')
      }

      setForm((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          subscriptionStatus: data.subscriptionStatus || SUBSCRIPTION_STATUS_UNSUBSCRIBED,
          deliveryStatus: data.deliveryStatus || prev.deliveryStatus
        }
      })
      setStatus({ type: 'success', message: 'You have been unsubscribed.' })
    } catch (error) {
      setStatus({ type: 'error', message: error.message || 'Unable to unsubscribe.' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="bg-white border border-black/[0.06] p-6 shadow-sm animate-pulse h-64" />
  }

  if (!form) {
    return (
      <div className="bg-white border border-black/[0.06] p-6 shadow-sm">
        <p className="text-sm text-red-600">{status.message || 'Unable to load preferences.'}</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-black/[0.06] p-6 shadow-sm space-y-6">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold">Manage preferences</h2>
        <p className="text-sm text-[#666]">Update your email preferences or opt out anytime.</p>
      </div>

      <form className="space-y-6" onSubmit={handleSave}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="block text-base font-semibold text-[#333]">Name</label>
            <input
              type="text"
              className="w-full rounded-md border border-black/10 px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-purple/50"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <label className="block text-base font-semibold text-[#333]">Email</label>
            <input
              type="email"
              className="w-full rounded-md border border-black/10 px-3 py-2.5 text-base bg-gray-50 text-[#555]"
              value={form.email}
              readOnly
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-base font-semibold text-[#333]">Role</label>
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

        {status.type === 'error' && <p className="text-sm text-red-600">{status.message}</p>}
        {status.type === 'success' && <p className="text-sm text-green-700">{status.message}</p>}

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center rounded-md bg-purple px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-purple/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save preferences'}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={handleUnsubscribe}
            className="inline-flex items-center justify-center rounded-md border border-red-200 px-5 py-2.5 text-sm font-semibold text-red-600 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Unsubscribe from all
          </button>
        </div>

        {form.subscriptionStatus === SUBSCRIPTION_STATUS_UNSUBSCRIBED && (
          <p className="text-xs text-[#777]">
            Your email is currently unsubscribed. Save preferences to resubscribe.
          </p>
        )}
        {form.subscriptionStatus === SUBSCRIPTION_STATUS_SUBSCRIBED &&
          form.deliveryStatus === DELIVERY_STATUS_SUPPRESSED && (
            <p className="text-xs text-[#777]">
              Your email is currently suppressed by the team. Updates will resume once re-enabled.
            </p>
          )}
      </form>
    </div>
  )
}
