'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function ManagePreferencesClient({ roleOptions = [], therapeuticAreas = [] }) {
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

        setForm({
          name: data.subscriber?.name || '',
          email: data.subscriber?.email || '',
          roles: data.subscriber?.roles || [],
          topics: data.subscriber?.topics || [],
          therapeuticAreaIds: data.subscriber?.therapeuticAreaIds || [],
          status: data.subscriber?.status || 'active'
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

  const toggleMultiSelect = (field, value) => {
    setForm((prev) => {
      if (!prev) return prev
      const set = new Set(prev[field])
      if (set.has(value)) {
        set.delete(value)
      } else {
        set.add(value)
      }
      return { ...prev, [field]: Array.from(set) }
    })
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!form) return

    setStatus({ type: 'idle', message: '' })

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

    setSaving(true)

    try {
      const res = await fetch('/api/updates/manage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          action: 'update',
          name: form.name,
          roles: form.roles,
          topics: form.topics,
          therapeuticAreaIds: form.therapeuticAreaIds
        })
      })

      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data?.error || 'Unable to save preferences.')
      }

      setForm((prev) => ({ ...prev, status: 'active' }))
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

      setForm((prev) => (prev ? { ...prev, status: 'unsubscribed' } : prev))
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
          <label className="block text-base font-semibold text-[#333]">Update types</label>
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
          <label className="block text-base font-semibold text-[#333]">Roles</label>
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
          <label className="block text-base font-semibold text-[#333]">Therapeutic areas</label>
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

        {form.status === 'unsubscribed' && (
          <p className="text-xs text-[#777]">
            Your email is currently unsubscribed. Save preferences to resubscribe.
          </p>
        )}
      </form>
    </div>
  )
}
