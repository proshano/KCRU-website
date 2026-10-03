'use client'

import { useState } from 'react'
import {
  TEAM_STATUS_OPTIONS,
  coordinatingSites,
  createEmptyTeam,
  createTeamKey,
  recruitingSites,
  siteLabel,
} from '@/lib/studyTeams'

const PI_OTHER_VALUE = '__other__'

const inputClass =
  'w-full border border-black/10 px-3 py-2 rounded focus:outline-none focus:ring-2 focus:ring-purple'
const selectClass =
  'w-full border border-black/10 px-3 py-2 rounded bg-white focus:outline-none focus:ring-2 focus:ring-purple'

function withError(baseClass, hasError) {
  return hasError ? `${baseClass.replace('focus:ring-purple', 'focus:ring-red-500')} border-red-300` : baseClass
}

/**
 * The "Study teams" and "Recruitment locations" cards shared by the Study
 * Manager and the approval editor. Teams are in payload shape (see
 * lib/studyTeams.js); validation messages come from validateSiteTeams so the
 * form and the API say the same thing.
 */
export default function StudyTeamsFieldset({
  idPrefix,
  teams,
  onChange,
  sites,
  researchers,
  errors = [],
  recruitmentSiteIds = [],
  onRecruitmentChange,
}) {
  const [otherSelected, setOtherSelected] = useState({})
  const list = Array.isArray(teams) ? teams : []
  const coordinating = coordinatingSites(sites)
  const recruiting = recruitingSites(sites)
  const usedSiteIds = new Set(list.map((team) => team.siteId).filter(Boolean))
  const canAddTeam = coordinating.some((site) => !usedSiteIds.has(site._id))
  const siteById = new Map((sites || []).map((site) => [site._id, site]))
  const researcherById = new Map((researchers || []).map((researcher) => [researcher._id, researcher]))

  function errorFor(teamKey, field) {
    return errors.find((error) => error.teamKey === teamKey && error.field === field)?.message || ''
  }

  function updateTeam(key, updater) {
    onChange(list.map((team) => (team._key === key ? updater(team) : team)))
  }

  function updateContact(key, field, value) {
    updateTeam(key, (team) => ({ ...team, contact: { ...team.contact, [field]: value } }))
  }

  function addTeam() {
    onChange([...list, createEmptyTeam(createTeamKey())])
  }

  function removeTeam(team) {
    const site = siteById.get(team.siteId)
    if (site && !window.confirm(`Remove the ${siteLabel(site)} team from this study?`)) return
    onChange(list.filter((item) => item._key !== team._key))
  }

  function choosePrincipalInvestigator(team, value) {
    if (value === PI_OTHER_VALUE) {
      setOtherSelected((prev) => ({ ...prev, [team._key]: true }))
      updateTeam(team._key, (current) => ({ ...current, principalInvestigatorId: '' }))
      return
    }
    setOtherSelected((prev) => ({ ...prev, [team._key]: false }))
    const researcher = researcherById.get(value)
    updateTeam(team._key, (current) => {
      const next = { ...current, principalInvestigatorId: value || '', principalInvestigatorName: '' }
      // A PI's primary site is the default for a team that has not picked one yet.
      const defaultSite = researcher?.primarySiteId
      if (!current.siteId && defaultSite && coordinating.some((site) => site._id === defaultSite) && !usedSiteIds.has(defaultSite)) {
        next.siteId = defaultSite
      }
      return next
    })
  }

  function toggleRecruitmentSite(siteId) {
    const current = Array.isArray(recruitmentSiteIds) ? recruitmentSiteIds : []
    onRecruitmentChange(current.includes(siteId) ? current.filter((id) => id !== siteId) : [...current, siteId])
  }

  const listError = errors.find((error) => error.field === 'siteTeams')?.message || ''

  return (
    <>
      <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-5">
        <div>
          <h3 className="text-lg font-semibold">Study Teams</h3>
          <p className="text-sm text-gray-500">
            One team for each site that coordinates this study. Each team has its own principal investigator and
            contact, says whether it is enrolling yet, and decides whether it takes referrals. Most studies have one
            team; a study run from both Victoria Hospital and University Hospital has two.
          </p>
          {!coordinating.length && (
            <p className="mt-2 text-sm text-amber-700">
              No coordinating sites are set up yet. An admin marks them in Sanity under Research Site, &quot;Coordinates
              studies&quot;.
            </p>
          )}
          {listError && <p className="mt-2 text-sm text-red-600">{listError}</p>}
        </div>

        {list.map((team, index) => {
          const site = siteById.get(team.siteId)
          const heading = site ? `Team ${index + 1} · ${siteLabel(site)}` : `Team ${index + 1}`
          const piSelection =
            team.principalInvestigatorId ||
            (otherSelected[team._key] || team.principalInvestigatorName ? PI_OTHER_VALUE : '')
          const siteError = errorFor(team._key, 'siteId')
          const piError = errorFor(team._key, 'principalInvestigator')
          const emailError = errorFor(team._key, 'contact.email')
          const fieldId = (name) => `${idPrefix}-team-${team._key}-${name}`

          return (
            <fieldset key={team._key} className="rounded-lg border border-black/10 p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <legend className="text-sm font-semibold text-[#222]">{heading}</legend>
                <button
                  type="button"
                  onClick={() => removeTeam(team)}
                  disabled={list.length <= 1}
                  className="text-xs text-gray-500 hover:text-red-700 disabled:opacity-40 disabled:hover:text-gray-500"
                >
                  Remove team
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor={fieldId('site')} className="text-sm font-medium">Coordinating site</label>
                  <select
                    id={fieldId('site')}
                    value={team.siteId}
                    onChange={(e) => updateTeam(team._key, (current) => ({ ...current, siteId: e.target.value }))}
                    className={withError(selectClass, Boolean(siteError))}
                    aria-invalid={siteError ? 'true' : 'false'}
                    aria-describedby={siteError ? fieldId('site-error') : undefined}
                  >
                    <option value="">Select a site</option>
                    {coordinating.map((option) => (
                      <option
                        key={option._id}
                        value={option._id}
                        disabled={option._id !== team.siteId && usedSiteIds.has(option._id)}
                      >
                        {siteLabel(option)}
                      </option>
                    ))}
                  </select>
                  {siteError ? (
                    <p id={fieldId('site-error')} className="text-xs text-red-600">{siteError}</p>
                  ) : (
                    <p className="text-xs text-gray-500">The site whose coordinators run this study locally.</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label htmlFor={fieldId('status')} className="text-sm font-medium">Team status</label>
                  <select
                    id={fieldId('status')}
                    value={team.status}
                    onChange={(e) => updateTeam(team._key, (current) => ({ ...current, status: e.target.value }))}
                    className={selectClass}
                  >
                    {TEAM_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500">
                    Each site starts up on its own. A team that is not yet enrolling is shown as starting soon and
                    takes no referrals.
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor={fieldId('pi')} className="text-sm font-medium">Principal investigator</label>
                <select
                  id={fieldId('pi')}
                  value={piSelection}
                  onChange={(e) => choosePrincipalInvestigator(team, e.target.value)}
                  className={withError(selectClass, Boolean(piError))}
                  aria-invalid={piError ? 'true' : 'false'}
                  aria-describedby={piError ? fieldId('pi-error') : undefined}
                >
                  <option value="">Select a PI</option>
                  {(researchers || []).map((researcher) => (
                    <option key={researcher._id} value={researcher._id}>
                      {researcher.name}
                    </option>
                  ))}
                  <option value={PI_OTHER_VALUE}>Other (not listed)</option>
                </select>
                {piSelection === PI_OTHER_VALUE && (
                  <div className="space-y-1 pt-1">
                    <label htmlFor={fieldId('pi-name')} className="text-sm font-medium">PI name</label>
                    <input
                      id={fieldId('pi-name')}
                      type="text"
                      value={team.principalInvestigatorName}
                      onChange={(e) =>
                        updateTeam(team._key, (current) => ({ ...current, principalInvestigatorName: e.target.value }))
                      }
                      placeholder="Enter PI name"
                      className={withError(inputClass, Boolean(piError))}
                      autoFocus
                    />
                    <p className="text-xs text-gray-500">Use this when the PI is not in the researcher list.</p>
                  </div>
                )}
                {piError && (
                  <p id={fieldId('pi-error')} className="text-xs text-red-600">{piError}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label htmlFor={fieldId('contact-name')} className="text-sm font-medium">Contact name</label>
                  <input
                    id={fieldId('contact-name')}
                    type="text"
                    value={team.contact.name}
                    onChange={(e) => updateContact(team._key, 'name', e.target.value)}
                    placeholder="Jane Doe"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor={fieldId('contact-role')} className="text-sm font-medium">Contact role</label>
                  <input
                    id={fieldId('contact-role')}
                    type="text"
                    value={team.contact.role}
                    onChange={(e) => updateContact(team._key, 'role', e.target.value)}
                    placeholder="Study coordinator"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor={fieldId('contact-email')} className="text-sm font-medium">Contact email</label>
                  <input
                    id={fieldId('contact-email')}
                    type="email"
                    value={team.contact.email}
                    onChange={(e) => updateContact(team._key, 'email', e.target.value)}
                    placeholder="contact@lhsc.on.ca"
                    className={withError(inputClass, Boolean(emailError))}
                    aria-invalid={emailError ? 'true' : 'false'}
                    aria-describedby={emailError ? fieldId('contact-email-error') : undefined}
                  />
                  {emailError && (
                    <p id={fieldId('contact-email-error')} className="text-xs text-red-600">{emailError}</p>
                  )}
                </div>
                <div className="space-y-1">
                  <label htmlFor={fieldId('contact-phone')} className="text-sm font-medium">Contact phone</label>
                  <input
                    id={fieldId('contact-phone')}
                    type="text"
                    value={team.contact.phone}
                    onChange={(e) => updateContact(team._key, 'phone', e.target.value)}
                    placeholder="555-555-5555"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-6 text-sm text-gray-700">
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(team.contact.displayPublicly)}
                    onChange={(e) => updateContact(team._key, 'displayPublicly', e.target.checked)}
                    className="h-4 w-4"
                  />
                  Display contact publicly
                </label>
                <label className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(team.acceptsReferrals)}
                    onChange={(e) =>
                      updateTeam(team._key, (current) => ({ ...current, acceptsReferrals: e.target.checked }))
                    }
                    className="h-4 w-4"
                  />
                  Accepts referrals
                </label>
              </div>
              <p className="text-xs text-gray-500">
                The contact receives referral emails for this team. It appears on the public study page only when
                &quot;Display contact publicly&quot; is checked. &quot;Accepts referrals&quot; shows the referral option for this team
                and needs a contact email.
              </p>
            </fieldset>
          )
        })}

        <button
          type="button"
          onClick={addTeam}
          disabled={!canAddTeam}
          className="inline-flex items-center gap-2 rounded border border-dashed border-black/15 px-3 py-2 text-sm text-gray-600 hover:border-purple hover:text-purple disabled:opacity-50 disabled:hover:border-black/15 disabled:hover:text-gray-600"
        >
          + Add a team at another site
        </button>
      </div>

      <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-lg font-semibold">Recruitment Locations</h3>
          <p className="text-sm text-gray-500">
            Where patients can be seen and enrolled for this study. This is separate from who coordinates it: a
            University Hospital study can enrol patients at Victoria Hospital or Westmount.
          </p>
        </div>
        <div role="group" aria-label="Recruitment locations" className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {recruiting.map((site) => (
            <label key={site._id} className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={(recruitmentSiteIds || []).includes(site._id)}
                onChange={() => toggleRecruitmentSite(site._id)}
                className="h-4 w-4"
              />
              <span>{siteLabel(site)}</span>
            </label>
          ))}
          {!recruiting.length && (
            <p className="text-xs text-gray-500">
              No recruitment locations are set up yet. An admin marks them in Sanity under Research Site, &quot;Patients
              can be enrolled here&quot;.
            </p>
          )}
        </div>
      </div>
    </>
  )
}
