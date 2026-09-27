'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import AuthButtons from '@/app/components/AuthButtons'
import {
  PEOPLE_FIELDS,
  PEOPLE_SCOPE_LABELS,
  extractEmailAddresses,
  findOutsideDomainEmails,
  normalizeEmailAddress,
  validateOptionalEmail,
} from '@/lib/peopleSettings'
import SubscriberManager from './SubscriberManager'
import {
  CARD,
  INPUT,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SMALL_BUTTON,
  StatusMessage,
  requestJson,
} from './ui'

const TABS = [
  { id: 'mailing-list', label: 'Mailing list' },
  { id: 'sign-in', label: 'Sign-in access' },
  { id: 'notifications', label: 'Notification emails' },
]

function readOnlyNote(key) {
  return `Only ${PEOPLE_SCOPE_LABELS[PEOPLE_FIELDS[key].scope]} can change this.`
}

function CopyButton({ emails }) {
  const [copied, setCopied] = useState(false)
  if (!emails.length) return null
  async function copy() {
    try {
      // Semicolons, so the list pastes straight into an Outlook To: line.
      await navigator.clipboard.writeText(emails.join('; '))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button type="button" className={SMALL_BUTTON} onClick={copy}>
      {copied ? 'Copied' : 'Copy addresses'}
    </button>
  )
}

// Each add or remove saves straight away, so nothing is lost by forgetting a Save button.
function EmailListCard({ fieldKey, list, editorEmail, signInDomains, canWrite, onSave, emptyNote }) {
  const field = PEOPLE_FIELDS[fieldKey]
  const [input, setInput] = useState('')
  const [status, setStatus] = useState(null)
  const [busy, setBusy] = useState(false)
  const editable = canWrite && list.canEdit
  const editor = normalizeEmailAddress(editorEmail)
  const outside = new Set(field.signIn ? findOutsideDomainEmails(list.emails, signInDomains) : [])
  const inputId = `${fieldKey}-add`

  async function commit(next, successMessage) {
    setBusy(true)
    setStatus(null)
    const result = await onSave(fieldKey, next, list.emails)
    setBusy(false)
    setStatus(result.ok ? { type: 'success', message: successMessage } : { type: 'error', message: result.error })
    return result.ok
  }

  async function add(event) {
    event.preventDefault()
    const { emails, invalid } = extractEmailAddresses(input)
    if (invalid.length) {
      setStatus({ type: 'error', message: `These don't look like email addresses: ${invalid.join(', ')}` })
      return
    }
    if (!emails.length) {
      setStatus({ type: 'error', message: 'Type or paste an email address first.' })
      return
    }
    const fresh = emails.filter((email) => !list.emails.includes(email))
    if (!fresh.length) {
      setStatus({ type: 'success', message: 'Already on the list.' })
      setInput('')
      return
    }
    const outsideFresh = field.signIn ? findOutsideDomainEmails(fresh, signInDomains) : []
    const warning = outsideFresh.length
      ? ` Note: ${outsideFresh.join(', ')} ${outsideFresh.length === 1 ? 'is' : 'are'} not a hospital address, so ${outsideFresh.length === 1 ? 'they' : 'these people'} can't sign in.`
      : ''
    const saved = await commit(
      [...list.emails, ...fresh],
      `Added ${fresh.join(', ')}. ${field.addedNote || ''}${warning}`.trim()
    )
    if (saved) setInput('')
  }

  async function remove(email) {
    if (!window.confirm(`Remove ${email} from ${field.title.toLowerCase()}? ${field.removeNote || ''}`.trim())) return
    await commit(list.emails.filter((item) => item !== email), `Removed ${email}.`)
  }

  return (
    <section className={`${CARD} space-y-4`} aria-labelledby={`${fieldKey}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <h3 id={`${fieldKey}-title`} className="text-lg font-semibold text-gray-900">
            {field.title} <span className="text-sm font-normal text-gray-500">({list.emails.length})</span>
          </h3>
          <p className="text-sm text-gray-600">{field.description}</p>
        </div>
        <CopyButton emails={list.emails} />
      </div>

      {list.emails.length ? (
        <ul className="divide-y divide-black/5 rounded-lg border border-black/10">
          {list.emails.map((email) => {
            const isEditor = email === editor
            const locked = field.keepEditor && isEditor
            return (
              <li key={email} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0 space-x-2">
                  <span className="break-all text-sm text-gray-900">{email}</span>
                  {isEditor && (
                    <span className="rounded-full bg-purple/10 px-2 py-0.5 text-xs font-semibold text-purple">You</span>
                  )}
                  {outside.has(email) && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                      Can&apos;t sign in: not a hospital address
                    </span>
                  )}
                </div>
                {editable && (
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    disabled={busy || locked}
                    title={locked ? 'You cannot remove yourself. Ask another admin in this group.' : undefined}
                    onClick={() => remove(email)}
                  >
                    Remove
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-black/15 px-3 py-3 text-sm text-gray-600">
          {emptyNote || 'Nobody is on this list yet.'}
        </p>
      )}

      {editable ? (
        <form className="space-y-2" onSubmit={add}>
          <label htmlFor={inputId} className="text-sm font-medium text-gray-800">
            Add people
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id={inputId}
              type="text"
              inputMode="email"
              autoComplete="off"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="name@lhsc.on.ca"
              className={INPUT}
            />
            <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
              {busy ? 'Saving...' : 'Add'}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            You can paste several addresses at once, including straight from an Outlook To: line.
          </p>
        </form>
      ) : (
        <p className="text-xs text-gray-500">{canWrite ? readOnlyNote(fieldKey) : 'Saving is unavailable on this server.'}</p>
      )}
      <StatusMessage status={status} />
    </section>
  )
}

function ContactRoutingCard({ routing, canWrite, onSave }) {
  const baseline = Object.fromEntries(routing.options.map((option) => [option.key, option.email]))
  const baselineKey = JSON.stringify(baseline)
  const [values, setValues] = useState(baseline)
  const [syncedKey, setSyncedKey] = useState(baselineKey)
  const [status, setStatus] = useState(null)
  // After a save or reload the form restarts from what is stored, keeping its status message.
  if (syncedKey !== baselineKey) {
    setSyncedKey(baselineKey)
    setValues(baseline)
  }
  const [busy, setBusy] = useState(false)
  const editable = canWrite && routing.canEdit
  const changed = routing.options.some((option) => normalizeEmailAddress(values[option.key]) !== option.email)

  async function save(event) {
    event.preventDefault()
    for (const option of routing.options) {
      const result = validateOptionalEmail(values[option.key])
      if (!result.ok || !result.email) {
        setStatus({ type: 'error', message: `${option.label}: ${result.ok ? 'enter an email address.' : result.error}` })
        return
      }
    }
    setBusy(true)
    setStatus(null)
    const result = await onSave('contactRouting', values, baseline)
    setBusy(false)
    setStatus(result.ok ? { type: 'success', message: 'Contact form addresses saved.' } : { type: 'error', message: result.error })
  }

  const field = PEOPLE_FIELDS.contactRouting
  return (
    <section className={`${CARD} space-y-4`} aria-labelledby="contact-routing-title">
      <div className="max-w-3xl space-y-1">
        <h3 id="contact-routing-title" className="text-lg font-semibold text-gray-900">{field.title}</h3>
        <p className="text-sm text-gray-600">{field.description}</p>
        <p className="text-xs text-gray-500">
          The reasons themselves (their wording and order) are still edited in Sanity Studio under Contact Routing &amp; Emails.
        </p>
      </div>
      {!routing.exists || !routing.options.length ? (
        <p className="text-sm text-gray-600">No contact reasons are set up yet. Add them in Sanity Studio first.</p>
      ) : (
        <form className="space-y-3" onSubmit={save}>
          {routing.options.map((option) => (
            <div key={option.key} className="grid gap-1 sm:grid-cols-[minmax(0,14rem)_1fr] sm:items-center sm:gap-4">
              <label htmlFor={`routing-${option.key}`} className="text-sm font-medium text-gray-800">
                {option.label}
              </label>
              <input
                id={`routing-${option.key}`}
                type="email"
                value={values[option.key] || ''}
                onChange={(event) => setValues((current) => ({ ...current, [option.key]: event.target.value }))}
                disabled={!editable}
                className={`${INPUT} disabled:bg-gray-50 disabled:text-gray-600`}
              />
            </div>
          ))}
          {editable ? (
            <div className="flex flex-wrap gap-3">
              <button type="submit" className={PRIMARY_BUTTON} disabled={busy || !changed}>
                {busy ? 'Saving...' : 'Save contact form addresses'}
              </button>
              {changed && (
                <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => setValues(baseline)}>
                  Undo changes
                </button>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-500">{canWrite ? readOnlyNote('contactRouting') : 'Saving is unavailable on this server.'}</p>
          )}
        </form>
      )}
      <StatusMessage status={status} />
    </section>
  )
}

function SingleEmailField({ fieldKey, value, canWrite, onSave }) {
  const field = PEOPLE_FIELDS[fieldKey]
  const [input, setInput] = useState(value.email)
  const [syncedEmail, setSyncedEmail] = useState(value.email)
  const [status, setStatus] = useState(null)
  if (syncedEmail !== value.email) {
    setSyncedEmail(value.email)
    setInput(value.email)
  }
  const [busy, setBusy] = useState(false)
  const editable = canWrite && value.canEdit
  const changed = normalizeEmailAddress(input) !== value.email

  async function save(event) {
    event.preventDefault()
    const result = validateOptionalEmail(input)
    if (!result.ok) {
      setStatus({ type: 'error', message: result.error })
      return
    }
    setBusy(true)
    setStatus(null)
    const saved = await onSave(fieldKey, result.email, value.email)
    setBusy(false)
    setStatus(saved.ok ? { type: 'success', message: result.email ? 'Saved.' : 'Cleared.' } : { type: 'error', message: saved.error })
  }

  return (
    <form className="space-y-2" onSubmit={save}>
      <label htmlFor={`${fieldKey}-input`} className="text-sm font-semibold text-gray-900">{field.title}</label>
      <p className="text-sm text-gray-600">{field.description}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id={`${fieldKey}-input`}
          type="email"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={!editable}
          placeholder="Not set"
          className={`${INPUT} disabled:bg-gray-50 disabled:text-gray-600`}
        />
        {editable && (
          <button type="submit" className={PRIMARY_BUTTON} disabled={busy || !changed}>
            {busy ? 'Saving...' : 'Save'}
          </button>
        )}
      </div>
      {!editable && (
        <p className="text-xs text-gray-500">{canWrite ? readOnlyNote(fieldKey) : 'Saving is unavailable on this server.'}</p>
      )}
      <StatusMessage status={status} />
    </form>
  )
}

function OnOffBadge({ on }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
        on ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'
      }`}
    >
      {on ? 'On' : 'Off'}
    </span>
  )
}

function OtherListsCard({ testing, digestPilot, access }) {
  return (
    <section className={`${CARD} space-y-4`} aria-labelledby="other-lists-title">
      <div className="max-w-3xl space-y-1">
        <h3 id="other-lists-title" className="text-lg font-semibold text-gray-900">Test and pilot lists</h3>
        <p className="text-sm text-gray-600">
          These lists only matter while their switch is on, so they are edited next to that switch.
        </p>
      </div>
      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
          Update email test mode <OnOffBadge on={testing.enabled} />
        </p>
        <p className="text-sm text-gray-600">
          While on, study updates and newsletters go only to {testing.recipients.length}{' '}
          {testing.recipients.length === 1 ? 'test address' : 'test addresses'}
          {testing.recipients.length ? `: ${testing.recipients.join(', ')}` : ''}.
        </p>
        {access.updates && (
          <Link href="/admin/updates" className="text-sm font-semibold text-purple hover:underline">
            Edit on the Update emails page
          </Link>
        )}
      </div>
      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-gray-900">
          Research digest pilot <OnOffBadge on={digestPilot.enabled} />
        </p>
        <p className="text-sm text-gray-600">
          While on, the research digest goes only to {digestPilot.recipients.length}{' '}
          {digestPilot.recipients.length === 1 ? 'pilot address' : 'pilot addresses'}
          {digestPilot.recipients.length ? `: ${digestPilot.recipients.join(', ')}` : ''}
          {digestPilot.serverRecipientCount
            ? `, plus ${digestPilot.serverRecipientCount} set on the server`
            : ''}
          .
        </p>
        {access.updates && (
          <Link href="/admin/research-digest" className="text-sm font-semibold text-purple hover:underline">
            Edit on the Research digest page
          </Link>
        )}
      </div>
    </section>
  )
}

function SignInTab({ data, onSave }) {
  const domains = data.signInDomains.map((domain) => `@${domain}`).join(', ')
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-black/10 bg-gray-50 p-4 text-sm text-gray-700 space-y-2">
        <p>
          People sign in with their hospital Microsoft account. Only addresses ending in {domains} can sign in, and
          only if they are on one of the lists below. Changes take effect within a couple of minutes.
        </p>
        <p className="text-xs text-gray-500">
          The allowed domains are changed in Sanity Studio (Site Settings, Study Approvals, Coordinator Email Domains).
        </p>
      </div>
      {['approvalAdmins', 'updateAdmins', 'coordinators'].map((key) => (
        <EmailListCard
          key={key}
          fieldKey={key}
          list={data.lists[key]}
          editorEmail={data.adminEmail}
          signInDomains={data.signInDomains}
          canWrite={data.canWrite}
          onSave={onSave}
        />
      ))}
    </div>
  )
}

function NotificationsTab({ data, onSave }) {
  const approvalAdmins = data.lists.approvalAdmins.emails
  return (
    <div className="space-y-6">
      <EmailListCard
        fieldKey="socialApprovers"
        list={data.lists.socialApprovers}
        editorEmail={data.adminEmail}
        signInDomains={data.signInDomains}
        canWrite={data.canWrite}
        onSave={onSave}
        emptyNote={`Nobody is listed, so this email goes to the approval admins${
          approvalAdmins.length ? `: ${approvalAdmins.join(', ')}` : ''
        }.`}
      />
      <ContactRoutingCard
        routing={data.contactRouting}
        canWrite={data.canWrite}
        onSave={onSave}
      />
      <section className={`${CARD} space-y-6`} aria-label="Website email addresses">
        {['contactEmail', 'replyToEmail'].map((key) => (
          <SingleEmailField
            key={key}
            fieldKey={key}
            value={data[key]}
            canWrite={data.canWrite}
            onSave={onSave}
          />
        ))}
      </section>
      <OtherListsCard testing={data.testing} digestPilot={data.digestPilot} access={data.access} />
      <p className="text-sm text-gray-600">
        Emails about new study submissions and publications to review go to the approval admins listed under Sign-in access.
      </p>
    </div>
  )
}

export default function PeopleAdminClient({ access: sessionAccess = {} }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [tab, setTab] = useState('')

  const load = useCallback(async () => {
    try {
      const payload = await requestJson('/api/admin/people')
      setData(payload)
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

  // A link such as /admin/people#sign-in opens that tab.
  useEffect(() => {
    const fromHash = window.location.hash.replace('#', '')
    if (TABS.some((item) => item.id === fromHash)) setTab(fromHash)
  }, [])

  const saveField = useCallback(async (field, value, previous) => {
    try {
      const payload = await requestJson('/api/admin/people', { method: 'PATCH', body: { field, value, previous } })
      setData(payload)
      return { ok: true }
    } catch (error) {
      if (error.status === 409) {
        await load()
        return { ok: false, error: `${error.message} The latest version is now showing.` }
      }
      return { ok: false, error: error.message }
    }
  }, [load])

  const access = data?.access || sessionAccess
  const activeTab = tab || (access.updates ? 'mailing-list' : 'sign-in')
  function selectTab(id) {
    setTab(id)
    window.history.replaceState(null, '', `#${id}`)
  }

  return (
    <main className="mx-auto max-w-6xl space-y-8 px-6 py-10 md:px-12">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-purple">Admin Portal</p>
            <h1 className="text-3xl font-bold tracking-tight">People &amp; email lists</h1>
          </div>
          <AuthButtons signInCallbackUrl="/admin/people" signOutCallbackUrl="/login" />
        </div>
        <p className="max-w-3xl text-gray-600">
          Manage who is on the mailing list, who can sign in to post and approve studies, and who gets notification
          emails. Changes save straight to the website, so you don&apos;t need Sanity Studio for these.
        </p>
        <Link className="text-sm font-semibold text-purple hover:underline" href="/admin">
          Back to Admin Hub
        </Link>
      </header>

      <div role="tablist" aria-label="People and email lists" className="flex flex-wrap gap-2 border-b border-black/10">
        {TABS.map((item) => {
          const selected = activeTab === item.id
          return (
            <button
              key={item.id}
              id={`tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`panel-${item.id}`}
              onClick={() => selectTab(item.id)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                selected ? 'border-purple text-purple' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {loadError && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{loadError}</p>
      )}
      {data && !data.canWrite && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          This server has no Sanity write token (SANITY_API_TOKEN), so the lists are shown read-only.
        </p>
      )}

      {/* Every panel stays mounted, so switching tabs keeps searches and unsaved edits. */}
      <div role="tabpanel" id="panel-mailing-list" aria-labelledby="tab-mailing-list" hidden={activeTab !== 'mailing-list'}>
        {access.updates ? (
          <SubscriberManager />
        ) : (
          <p className={`${CARD} text-sm text-gray-600`}>
            The mailing list is managed by update email admins. Ask one of them if someone needs to be added or removed.
          </p>
        )}
      </div>
      {['sign-in', 'notifications'].map((id) => (
        <div key={id} role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} hidden={activeTab !== id}>
          {loading ? (
            <div className="h-48 animate-pulse rounded-xl bg-white shadow-sm" />
          ) : data ? (
            id === 'sign-in' ? <SignInTab data={data} onSave={saveField} /> : <NotificationsTab data={data} onSave={saveField} />
          ) : null}
        </div>
      ))}
    </main>
  )
}
