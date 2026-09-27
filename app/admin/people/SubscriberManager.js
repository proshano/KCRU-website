'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { CORRESPONDENCE_OPTIONS, ROLE_OPTIONS, SPECIALTY_OPTIONS } from '@/lib/communicationOptions'
import { SUBSCRIBER_STATUS_OPTIONS } from '@/lib/subscriberAdmin'
import {
  CARD,
  DANGER_BUTTON,
  INPUT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SMALL_BUTTON,
  StatusMessage,
  formatDate,
  requestJson,
} from './ui'

const PAGE_SIZE = 5000
const RENDER_STEP = 100
const STUDY_UPDATES = 'study_updates'
const RESEARCH_DIGEST = 'research_digest'
const API = '/api/updates/admin/subscribers'

const ROLE_LABELS = new Map(ROLE_OPTIONS.map((option) => [option.value, option.title]))
const SPECIALTY_LABELS = new Map(SPECIALTY_OPTIONS.map((option) => [option.value, option.title]))
const EMAIL_TYPE_LABELS = new Map([
  ['newsletter', 'News & publications'],
  [RESEARCH_DIGEST, 'Research digest'],
  [STUDY_UPDATES, 'Study updates'],
])
const STATUS_TITLES = new Map(SUBSCRIBER_STATUS_OPTIONS.map((option) => [option.value, option.title]))
const STATUS_STYLES = {
  active: 'bg-emerald-100 text-emerald-800',
  suppressed: 'bg-amber-100 text-amber-800',
  unsubscribed: 'bg-gray-200 text-gray-700',
}

const EMPTY_OPTIONS = { therapeuticAreas: [], sites: [], researchDigestPublic: false }
const EMPTY_FORM = {
  name: '',
  email: '',
  role: '',
  specialty: '',
  correspondencePreferences: [],
  allTherapeuticAreas: false,
  interestAreas: [],
  practiceSites: [],
  notes: '',
  status: 'active',
}

function formFromSubscriber(subscriber) {
  return {
    name: subscriber.name,
    email: subscriber.email,
    role: subscriber.role,
    specialty: subscriber.specialty,
    correspondencePreferences: subscriber.correspondencePreferences,
    allTherapeuticAreas: subscriber.allTherapeuticAreas,
    interestAreas: subscriber.interestAreaIds,
    practiceSites: subscriber.practiceSiteIds,
    notes: subscriber.notes,
    status: subscriber.status,
  }
}

// Interest areas only apply to study updates, as on the public signup form.
function toPayload(form) {
  const wantsStudyUpdates = form.correspondencePreferences.includes(STUDY_UPDATES)
  return {
    name: form.name,
    email: form.email,
    role: form.role,
    specialty: form.specialty,
    correspondencePreferences: form.correspondencePreferences,
    allTherapeuticAreas: wantsStudyUpdates && form.allTherapeuticAreas,
    interestAreas: wantsStudyUpdates && !form.allTherapeuticAreas ? form.interestAreas : [],
    practiceSites: form.practiceSites,
    notes: form.notes,
    status: form.status,
  }
}

function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = [...(a || [])].sort()
    const right = [...(b || [])].sort()
    return left.length === right.length && left.every((value, index) => value === right[index])
  }
  return (a ?? '') === (b ?? '')
}

// Edits send only what changed, so an old record with a gap elsewhere can still be updated.
function changedFields(before, after) {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => !sameValue(before[key], value)))
}

// Names come from the public signup form, so neutralize anything a spreadsheet would run.
function csvCell(value) {
  let text = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function describeAreas(subscriber, areaTitles) {
  if (!subscriber.correspondencePreferences.includes(STUDY_UPDATES)) return ''
  if (subscriber.allTherapeuticAreas) return 'All areas'
  const titles = subscriber.interestAreaIds.map((id) => areaTitles.get(id)).filter(Boolean)
  return titles.join(', ') || 'None chosen'
}

function downloadCsv(rows, areaTitles) {
  const header = ['Name', 'Email', 'Status', 'Role', 'Specialty', 'Emails', 'Interest areas', 'Notes', 'Added', 'Last updated']
  const lines = [header, ...rows.map((subscriber) => [
    subscriber.name,
    subscriber.email,
    STATUS_TITLES.get(subscriber.status),
    ROLE_LABELS.get(subscriber.role) || subscriber.role,
    SPECIALTY_LABELS.get(subscriber.specialty) || subscriber.specialty,
    subscriber.correspondencePreferences.map((value) => EMAIL_TYPE_LABELS.get(value) || value).join('; '),
    describeAreas(subscriber, areaTitles),
    subscriber.notes,
    formatDate(subscriber.createdAt),
    formatDate(subscriber.updatedAt),
  ])]
  const csv = lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')
  // The byte-order mark makes Excel read accented names correctly.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `mailing-list-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function CheckboxGroup({ legend, hint, options, selected, onToggle, disabled }) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-gray-800">{legend}</legend>
      {hint && <p className="text-xs text-gray-500">{hint}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={selected.includes(option.value)}
              disabled={disabled}
              onChange={() => onToggle(option.value)}
            />
            <span>{option.title}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function SubscriberForm({ mode, subscriber, options, busy, status, onSubmit, onCancel, onDelete, onShowExisting }) {
  const [form, setForm] = useState(() => (subscriber ? formFromSubscriber(subscriber) : EMPTY_FORM))
  const [consent, setConsent] = useState(false)
  const isAdd = mode === 'add'
  const resubscribing = !isAdd && subscriber.status === 'unsubscribed' && form.status !== 'unsubscribed'
  const wantsStudyUpdates = form.correspondencePreferences.includes(STUDY_UPDATES)
  const idPrefix = isAdd ? 'new-subscriber' : `subscriber-${subscriber._id}`

  const emailTypeOptions = CORRESPONDENCE_OPTIONS.map((option) => ({
    value: option.value,
    title:
      option.value === RESEARCH_DIGEST && !options.researchDigestPublic
        ? `${option.title} (not launched yet: only pilot recipients get it)`
        : option.title,
  }))

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function toggle(key, value) {
    setForm((current) => {
      const values = new Set(current[key])
      if (values.has(value)) values.delete(value)
      else values.add(value)
      return { ...current, [key]: Array.from(values) }
    })
  }

  function submit(event) {
    event.preventDefault()
    onSubmit(toPayload(form), { consentConfirmed: consent })
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-purple/30 bg-purple/5 p-4 md:p-5">
      <h3 className="text-lg font-semibold text-gray-900">
        {isAdd ? 'Add someone to the mailing list' : `Edit ${subscriber.email}`}
      </h3>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-name`} className="text-sm font-medium text-gray-800">Name</label>
          <input
            id={`${idPrefix}-name`}
            type="text"
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            className={INPUT}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-email`} className="text-sm font-medium text-gray-800">Email (required)</label>
          <input
            id={`${idPrefix}-email`}
            type="email"
            required
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            className={INPUT}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-role`} className="text-sm font-medium text-gray-800">Role (required)</label>
          <select
            id={`${idPrefix}-role`}
            required
            value={form.role}
            onChange={(event) => update('role', event.target.value)}
            className={INPUT}
          >
            <option value="">Choose a role</option>
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.title}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idPrefix}-specialty`} className="text-sm font-medium text-gray-800">Specialty</label>
          <select
            id={`${idPrefix}-specialty`}
            value={form.specialty}
            onChange={(event) => update('specialty', event.target.value)}
            className={INPUT}
          >
            <option value="">Not specified</option>
            {SPECIALTY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.title}</option>
            ))}
          </select>
        </div>
      </div>

      <CheckboxGroup
        legend="Emails they get (choose at least one)"
        options={emailTypeOptions}
        selected={form.correspondencePreferences}
        onToggle={(value) => toggle('correspondencePreferences', value)}
      />

      {wantsStudyUpdates && (
        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm font-medium text-gray-800">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={form.allTherapeuticAreas}
              onChange={(event) => update('allTherapeuticAreas', event.target.checked)}
            />
            <span>Study updates for all interest areas</span>
          </label>
          {!form.allTherapeuticAreas && (
            <CheckboxGroup
              legend="Interest areas for study updates (choose at least one)"
              options={options.therapeuticAreas}
              selected={form.interestAreas}
              onToggle={(value) => toggle('interestAreas', value)}
            />
          )}
        </div>
      )}

      {options.sites.length > 0 && (
        <CheckboxGroup
          legend="Location of practice (optional)"
          options={options.sites}
          selected={form.practiceSites}
          onToggle={(value) => toggle('practiceSites', value)}
        />
      )}

      <div className="space-y-1">
        <label htmlFor={`${idPrefix}-notes`} className="text-sm font-medium text-gray-800">Notes (only admins see these)</label>
        <textarea
          id={`${idPrefix}-notes`}
          rows={2}
          value={form.notes}
          onChange={(event) => update('notes', event.target.value)}
          className={INPUT}
        />
      </div>

      {!isAdd && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-800">Status</legend>
          {SUBSCRIBER_STATUS_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name={`${idPrefix}-status`}
                className="mt-0.5 h-4 w-4"
                checked={form.status === option.value}
                onChange={() => update('status', option.value)}
              />
              <span>
                <span className="font-semibold">{option.title}.</span> {option.description}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {(isAdd || resubscribing) && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <input
            type="checkbox"
            required
            className="mt-0.5 h-4 w-4"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            {isAdd
              ? 'This person agreed to receive these emails (for example, they asked in person or by email).'
              : 'This person asked to receive emails again after unsubscribing.'}
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {busy ? 'Saving...' : isAdd ? 'Add to mailing list' : 'Save changes'}
        </button>
        <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        {!isAdd && (
          <button type="button" className={`${DANGER_BUTTON} sm:ml-auto`} disabled={busy} onClick={onDelete}>
            Delete permanently
          </button>
        )}
      </div>
      <StatusMessage status={status} />
      {status?.existingEmail && onShowExisting && (
        <button type="button" className={SECONDARY_BUTTON} onClick={() => onShowExisting(status.existingEmail)}>
          Show their record
        </button>
      )}
    </form>
  )
}

function SubscriberRow({ subscriber, areaTitles, onEdit, editing, canWrite }) {
  const details = [
    ROLE_LABELS.get(subscriber.role) || subscriber.role || 'Role not set',
    SPECIALTY_LABELS.get(subscriber.specialty),
  ].filter(Boolean)
  const emailTypes = subscriber.correspondencePreferences.map((value) => EMAIL_TYPE_LABELS.get(value) || value)
  const areas = describeAreas(subscriber, areaTitles)
  return (
    <div className="flex flex-col gap-2 py-3 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0 space-y-0.5">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900">{subscriber.name || 'No name'}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[subscriber.status]}`}>
            {STATUS_TITLES.get(subscriber.status)}
          </span>
        </p>
        <p className="break-all text-sm text-gray-800">{subscriber.email || 'No email'}</p>
        <p className="text-xs text-gray-500">{details.join(' · ')}</p>
        <p className="text-xs text-gray-500">
          Gets: {emailTypes.length ? emailTypes.join(', ') : 'nothing chosen'}
          {areas ? ` · Study areas: ${areas}` : ''}
        </p>
        {subscriber.notes && <p className="text-xs italic text-gray-500">Note: {subscriber.notes}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {subscriber.updatedAt && (
          <span className="text-xs text-gray-500">Updated {formatDate(subscriber.updatedAt)}</span>
        )}
        <button type="button" className={SMALL_BUTTON} onClick={onEdit} aria-expanded={editing} disabled={!canWrite}>
          {editing ? 'Close' : 'Edit'}
        </button>
      </div>
    </div>
  )
}

export default function SubscriberManager() {
  const [items, setItems] = useState([])
  const [options, setOptions] = useState(EMPTY_OPTIONS)
  const [canWrite, setCanWrite] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [visibleCount, setVisibleCount] = useState(RENDER_STEP)
  const [editor, setEditor] = useState(null)
  const [busy, setBusy] = useState(false)
  const [formStatus, setFormStatus] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let all = []
      let total = 0
      let nextOptions = EMPTY_OPTIONS
      let nextCanWrite = true
      do {
        const payload = await requestJson(`${API}?offset=${all.length}&limit=${PAGE_SIZE}`)
        all = all.concat(payload.items || [])
        total = payload.total || 0
        nextOptions = payload.options || EMPTY_OPTIONS
        nextCanWrite = payload.canWrite !== false
        if (!payload.items?.length) break
      } while (all.length < total)
      setItems(all)
      setOptions(nextOptions)
      setCanWrite(nextCanWrite)
      setLoadError('')
    } catch (error) {
      setLoadError(error.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const areaTitles = useMemo(
    () => new Map(options.therapeuticAreas.map((option) => [option.value, option.title])),
    [options.therapeuticAreas]
  )

  const counts = useMemo(() => {
    const result = { all: items.length, active: 0, suppressed: 0, unsubscribed: 0 }
    for (const item of items) result[item.status] += 1
    return result
  }, [items])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items.filter((subscriber) => {
      if (statusFilter !== 'all' && subscriber.status !== statusFilter) return false
      if (typeFilter !== 'all' && !subscriber.correspondencePreferences.includes(typeFilter)) return false
      if (!query) return true
      return [
        subscriber.name,
        subscriber.email,
        ROLE_LABELS.get(subscriber.role),
        SPECIALTY_LABELS.get(subscriber.specialty),
        subscriber.notes,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    })
  }, [items, search, statusFilter, typeFilter])

  function openEditor(next) {
    setEditor(next)
    setFormStatus(null)
    setNotice(null)
  }

  async function submitForm(payload, { consentConfirmed }) {
    setBusy(true)
    setFormStatus(null)
    try {
      if (editor.mode === 'add') {
        const result = await requestJson(API, {
          method: 'POST',
          body: { subscriber: payload, consentConfirmed },
        })
        setItems((current) => [result.subscriber, ...current])
        setEditor(null)
        setNotice({ type: 'success', message: `Added ${result.subscriber.email} to the mailing list.` })
      } else {
        const subscriber = items.find((item) => item._id === editor.id)
        const changes = changedFields(toPayload(formFromSubscriber(subscriber)), payload)
        if (!Object.keys(changes).length) {
          setEditor(null)
          setNotice({ type: 'success', message: 'Nothing had changed, so nothing was saved.' })
          return
        }
        const result = await requestJson(API, {
          method: 'PATCH',
          body: { id: subscriber._id, rev: subscriber._rev, changes, consentConfirmed },
        })
        setItems((current) => current.map((item) => (item._id === subscriber._id ? result.subscriber : item)))
        setEditor(null)
        setNotice({ type: 'success', message: `Saved changes to ${result.subscriber.email}.` })
      }
    } catch (error) {
      if (error.payload?.code === 'duplicate') {
        setFormStatus({ type: 'error', message: error.message, existingEmail: payload.email })
      } else if (error.status === 409 || error.status === 404) {
        setEditor(null)
        setNotice({ type: 'error', message: `${error.message} The list has been reloaded.` })
        await load()
      } else {
        setFormStatus({ type: 'error', message: error.message })
      }
    } finally {
      setBusy(false)
    }
  }

  // After a duplicate add: filter the list down to that person and open their record.
  function showExisting(email) {
    const target = String(email || '').trim().toLowerCase()
    const match = items.find((item) => item.email.toLowerCase() === target)
    setSearch(target)
    setStatusFilter('all')
    setTypeFilter('all')
    setVisibleCount(RENDER_STEP)
    openEditor(match ? { mode: 'edit', id: match._id } : null)
  }

  async function deleteSubscriber() {
    const subscriber = items.find((item) => item._id === editor?.id)
    if (!subscriber) return
    const confirmed = window.confirm(
      `Delete ${subscriber.email} permanently?\n\nThis removes their details and preferences. To stop emails but keep a record that they opted out, set their status to Unsubscribed instead.`
    )
    if (!confirmed) return
    setBusy(true)
    try {
      await requestJson(`${API}?id=${encodeURIComponent(subscriber._id)}`, { method: 'DELETE' })
      setItems((current) => current.filter((item) => item._id !== subscriber._id))
      setEditor(null)
      setNotice({ type: 'success', message: `Deleted ${subscriber.email}.` })
    } catch (error) {
      setFormStatus({ type: 'error', message: error.message })
    } finally {
      setBusy(false)
    }
  }

  const visible = filtered.slice(0, visibleCount)

  return (
    <section className={`${CARD} space-y-5`} aria-labelledby="mailing-list-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <h2 id="mailing-list-title" className="text-xl font-semibold text-gray-900">Mailing list</h2>
          <p className="text-sm text-gray-600">
            Everyone who gets study updates, newsletters or the research digest. People can also change their own
            choices with the link at the bottom of every email.
          </p>
          <p className="text-sm text-gray-500">
            {counts.all} in total: {counts.active} active, {counts.suppressed} suppressed, {counts.unsubscribed} unsubscribed.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={PRIMARY_BUTTON}
            disabled={!canWrite || loading}
            onClick={() => openEditor({ mode: 'add' })}
          >
            Add subscriber
          </button>
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={!filtered.length}
            onClick={() => downloadCsv(filtered, areaTitles)}
          >
            Download list (CSV)
          </button>
        </div>
      </div>

      {!canWrite && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This server has no Sanity write token, so the mailing list is read-only here.
        </p>
      )}
      <StatusMessage status={notice} />

      {editor?.mode === 'add' && (
        <SubscriberForm
          mode="add"
          options={options}
          busy={busy}
          status={formStatus}
          onSubmit={submitForm}
          onCancel={() => setEditor(null)}
          onShowExisting={showExisting}
        />
      )}

      <div className="flex flex-col gap-3 md:flex-row">
        <label className="sr-only" htmlFor="subscriber-search">Search the mailing list</label>
        <input
          id="subscriber-search"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setVisibleCount(RENDER_STEP)
          }}
          placeholder="Search by name, email, role, specialty or note"
          className={`${INPUT} md:flex-1`}
        />
        <label className="sr-only" htmlFor="subscriber-status-filter">Status</label>
        <select
          id="subscriber-status-filter"
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value)
            setVisibleCount(RENDER_STEP)
          }}
          className={`${INPUT} md:w-48`}
        >
          <option value="all">All statuses</option>
          {SUBSCRIBER_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.title}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="subscriber-type-filter">Email type</label>
        <select
          id="subscriber-type-filter"
          value={typeFilter}
          onChange={(event) => {
            setTypeFilter(event.target.value)
            setVisibleCount(RENDER_STEP)
          }}
          className={`${INPUT} md:w-56`}
        >
          <option value="all">All email types</option>
          {Array.from(EMAIL_TYPE_LABELS, ([value, title]) => (
            <option key={value} value={value}>{title}</option>
          ))}
        </select>
      </div>

      {loadError && <p className="text-sm text-red-700">{loadError}</p>}
      {loading ? (
        <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Showing {visible.length} of {filtered.length}
            {filtered.length !== items.length ? ` matching (${items.length} in total)` : ''}.
          </p>
          <ul className="divide-y divide-black/5 border-y border-black/5">
            {visible.map((subscriber) => {
              const editing = editor?.mode === 'edit' && editor.id === subscriber._id
              return (
                <li key={subscriber._id}>
                  <SubscriberRow
                    subscriber={subscriber}
                    areaTitles={areaTitles}
                    editing={editing}
                    canWrite={canWrite}
                    onEdit={() => openEditor(editing ? null : { mode: 'edit', id: subscriber._id })}
                  />
                  {editing && (
                    <div className="pb-4">
                      <SubscriberForm
                        key={subscriber._rev}
                        mode="edit"
                        subscriber={subscriber}
                        options={options}
                        busy={busy}
                        status={formStatus}
                        onSubmit={submitForm}
                        onCancel={() => setEditor(null)}
                        onDelete={deleteSubscriber}
                      />
                    </div>
                  )}
                </li>
              )
            })}
            {!visible.length && (
              <li className="py-6 text-center text-sm text-gray-500">
                {items.length ? 'Nobody matches your search.' : 'The mailing list is empty.'}
              </li>
            )}
          </ul>
          {filtered.length > visible.length && (
            <button
              type="button"
              className={SECONDARY_BUTTON}
              onClick={() => setVisibleCount((count) => count + RENDER_STEP)}
            >
              Show more
            </button>
          )}
        </>
      )}
    </section>
  )
}
