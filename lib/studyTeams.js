/**
 * Study teams.
 *
 * A study is coordinated by one or more teams, one per coordinating site
 * (Victoria Hospital, University Hospital). Each team has its own principal
 * investigator, coordinator contact, enrolment status and referral switch.
 * Where patients are seen is a separate list on the study (`recruitmentSites`).
 *
 * Two shapes travel through the code:
 *
 * - Document shape: what the GROQ projections in lib/sanity.js return, with the
 *   site and PI dereferenced. Pages, emails and the referral route read it
 *   through `resolveStudyTeams()`.
 * - Payload shape: what the Study Manager, the approval editor, submissions and
 *   drafts carry (`siteId`, `principalInvestigatorId`). The API and the forms
 *   read it through `resolvePayloadTeams()`.
 *
 * Both resolvers synthesize one team from the legacy single PI and contact
 * fields when a record predates teams, so no consumer reads those fields
 * directly. Team `_key`s are opaque; a team's identity is its site reference.
 *
 * Browser-safe: no server imports. The portal pages import this module.
 */

export const DEFAULT_TEAM_STATUS = 'enrolling'
export const LEGACY_TEAM_KEY = 'legacy'

export const TEAM_STATUS_OPTIONS = [
  { value: 'enrolling', label: 'Enrolling' },
  { value: 'not_yet_enrolling', label: 'Not yet enrolling' },
  { value: 'closed', label: 'Closed' },
]

const TEAM_STATUS_VALUES = new Set(TEAM_STATUS_OPTIONS.map((option) => option.value))
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function clean(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function safeKey(value) {
  const cleaned = clean(value)
  return KEY_PATTERN.test(cleaned) ? cleaned : ''
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values.map(clean).filter(Boolean)))
}

export function normalizeTeamStatus(value, fallback = DEFAULT_TEAM_STATUS) {
  const cleaned = clean(value)
  return TEAM_STATUS_VALUES.has(cleaned) ? cleaned : fallback
}

export function teamStatusLabel(value) {
  const match = TEAM_STATUS_OPTIONS.find((option) => option.value === normalizeTeamStatus(value))
  return match ? match.label : ''
}

// A study that predates teams has one implied team whose enrolment follows the
// study's own status.
export function teamStatusFromStudyStatus(studyStatus) {
  const status = clean(studyStatus)
  if (status === 'recruiting') return 'enrolling'
  if (status === 'coming_soon') return 'not_yet_enrolling'
  return 'closed'
}

export function isTeamEnrolling(team) {
  return normalizeTeamStatus(team?.status) === 'enrolling'
}

export function emptyContact() {
  return { name: '', role: '', email: '', phone: '', displayPublicly: false }
}

export function cleanContact(contact) {
  const source = contact && typeof contact === 'object' ? contact : {}
  return {
    name: clean(source.name),
    role: clean(source.role),
    email: clean(source.email),
    phone: clean(source.phone),
    displayPublicly: source.displayPublicly === true,
  }
}

export function isContactEmpty(contact) {
  const cleaned = cleanContact(contact)
  return !cleaned.name && !cleaned.role && !cleaned.email && !cleaned.phone && !cleaned.displayPublicly
}

export function hasContactEmail(contact) {
  return Boolean(clean(contact?.email))
}

// ---------------------------------------------------------------------------
// Sites
// ---------------------------------------------------------------------------

export function coordinatingSites(sites) {
  return (Array.isArray(sites) ? sites : []).filter((site) => site?.coordinatesStudies === true)
}

export function recruitingSites(sites) {
  return (Array.isArray(sites) ? sites : []).filter((site) => site?.recruitsPatients === true)
}

export function siteLabel(site) {
  return clean(site?.name) || clean(site?.shortName)
}

export function siteShortLabel(site) {
  return clean(site?.shortName) || clean(site?.name)
}

function findSite(sites, siteId) {
  if (!siteId) return null
  return (Array.isArray(sites) ? sites : []).find((site) => site?._id === siteId) || null
}

function findResearcher(researchers, id) {
  if (!id) return null
  return (Array.isArray(researchers) ? researchers : []).find((researcher) => researcher?._id === id) || null
}

// ---------------------------------------------------------------------------
// Payload shape (forms, API, submissions, drafts)
// ---------------------------------------------------------------------------

// A fresh opaque key for a team panel added in the browser.
export function createTeamKey() {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
  return `team-${random}`
}

export function createEmptyTeam(key) {
  return {
    _key: safeKey(key) || 'team-1',
    siteId: '',
    status: DEFAULT_TEAM_STATUS,
    principalInvestigatorId: '',
    principalInvestigatorName: '',
    contact: emptyContact(),
    acceptsReferrals: false,
  }
}

export function normalizePayloadTeam(raw, index = 0, fallbackStatus = DEFAULT_TEAM_STATUS) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const siteId = clean(source.siteId)
  const principalInvestigatorId = clean(source.principalInvestigatorId)
  return {
    _key: safeKey(source._key) || (siteId ? `site-${siteId}` : `team-${index + 1}`),
    siteId,
    status: normalizeTeamStatus(source.status, fallbackStatus),
    principalInvestigatorId,
    principalInvestigatorName: principalInvestigatorId ? '' : clean(source.principalInvestigatorName),
    contact: cleanContact(source.contact),
    acceptsReferrals: source.acceptsReferrals === true,
  }
}

// The single PI and contact a record carried before teams existed, as one team.
export function legacyPayloadTeam(record) {
  if (!record || typeof record !== 'object') return null
  const principalInvestigatorId = clean(record.principalInvestigatorId)
  const principalInvestigatorName = clean(record.principalInvestigatorName)
  const contact = cleanContact(record.localContact)
  const acceptsReferrals = record.acceptsReferrals === true
  if (!principalInvestigatorId && !principalInvestigatorName && isContactEmpty(contact) && !acceptsReferrals) {
    return null
  }
  return normalizePayloadTeam(
    {
      _key: LEGACY_TEAM_KEY,
      status: teamStatusFromStudyStatus(record.status),
      principalInvestigatorId,
      principalInvestigatorName,
      contact,
      acceptsReferrals,
    },
    0
  )
}

export function resolvePayloadTeams(record) {
  if (!record || typeof record !== 'object') return []
  if (Array.isArray(record.siteTeams) && record.siteTeams.length) {
    const fallbackStatus = teamStatusFromStudyStatus(record.status)
    return record.siteTeams
      .filter(Boolean)
      .map((team, index) => normalizePayloadTeam(team, index, fallbackStatus))
  }
  const legacy = legacyPayloadTeam(record)
  return legacy ? [legacy] : []
}

export function normalizeRecruitmentSiteIds(values) {
  return uniqueStrings(values)
}

// Returns [{ teamKey, field, message }]; empty when the teams are valid. The
// Study Manager shows each message beside its field, the API returns the first.
export function validateSiteTeams(teams, { sites } = {}) {
  const list = Array.isArray(teams) ? teams.filter(Boolean) : []
  if (!list.length) {
    return [{ teamKey: null, field: 'siteTeams', message: 'Add at least one study team.' }]
  }
  const allowedSites = Array.isArray(sites) ? new Set(coordinatingSites(sites).map((site) => site._id)) : null
  const seenSites = new Set()
  const errors = []
  for (const team of list) {
    const teamKey = team._key
    if (!team.siteId) {
      errors.push({ teamKey, field: 'siteId', message: 'Choose the coordinating site.' })
    } else if (allowedSites && !allowedSites.has(team.siteId)) {
      errors.push({ teamKey, field: 'siteId', message: 'Choose a site that coordinates studies.' })
    } else if (seenSites.has(team.siteId)) {
      errors.push({ teamKey, field: 'siteId', message: 'Each site can have only one team.' })
    } else {
      seenSites.add(team.siteId)
    }
    if (!team.principalInvestigatorId && !team.principalInvestigatorName) {
      errors.push({
        teamKey,
        field: 'principalInvestigator',
        message: 'Select a principal investigator or choose Other and enter a name.',
      })
    }
    if (team.acceptsReferrals && !hasContactEmail(team.contact)) {
      errors.push({
        teamKey,
        field: 'contact.email',
        message: 'Add a contact email before this team can accept referrals.',
      })
    }
  }
  return errors
}

export function formatTeamError(error, teams, sites) {
  if (!error) return ''
  if (!error.teamKey) return error.message
  const list = Array.isArray(teams) ? teams : []
  const index = list.findIndex((team) => team?._key === error.teamKey)
  const team = index >= 0 ? list[index] : null
  const site = findSite(sites, team?.siteId)
  const name = site ? `Team ${index + 1} (${siteLabel(site)})` : `Team ${index >= 0 ? index + 1 : '?'}`
  return `${name}: ${error.message}`
}

// Plain-language description of a payload team for the approvals list, the
// approval email and the Study Manager list.
export function describePayloadTeam(team, { sites, researchers } = {}) {
  const normalized = normalizePayloadTeam(team)
  const site = findSite(sites, normalized.siteId)
  const researcher = findResearcher(researchers, normalized.principalInvestigatorId)
  const contact = normalized.contact
  const contactParts = [
    contact.name ? (contact.role ? `${contact.name} (${contact.role})` : contact.name) : '',
    contact.email,
    contact.phone,
  ].filter(Boolean)
  return {
    key: normalized._key,
    siteId: normalized.siteId,
    siteName: site ? siteLabel(site) : '',
    siteShortName: site ? siteShortLabel(site) : '',
    piName: researcher?.name || normalized.principalInvestigatorName || '',
    status: normalized.status,
    statusLabel: teamStatusLabel(normalized.status),
    contactLine: contactParts.join(', '),
    displayPublicly: contact.displayPublicly,
    acceptsReferrals: normalized.acceptsReferrals,
  }
}

// One line per team for the approvals list and the approval email.
export function summarizePayloadTeam(team, index, context = {}) {
  const described = describePayloadTeam(team, context)
  const label = described.siteName ? `${described.siteName} team` : `Team ${index + 1} (no coordinating site)`
  const summary = [
    `PI: ${described.piName || 'None'}`,
    described.statusLabel,
    described.contactLine ? `Contact: ${described.contactLine}` : 'No contact',
    `Contact public: ${described.displayPublicly ? 'Yes' : 'No'}`,
    `Accepts referrals: ${described.acceptsReferrals ? 'Yes' : 'No'}`,
  ].join(' | ')
  return { label, summary, ...described }
}

export function recruitmentSiteLabels(siteIds, sites) {
  return normalizeRecruitmentSiteIds(siteIds)
    .map((id) => siteLabel(findSite(sites, id)))
    .filter(Boolean)
}

export function teamDisplayName(team, sites) {
  const site = findSite(sites, team?.siteId)
  return site ? `${siteLabel(site)} team` : 'team without a coordinating site'
}

// Sanity array items for `trialSummary.siteTeams`.
export function payloadTeamsToSanity(teams) {
  return (Array.isArray(teams) ? teams : []).map((raw, index) => {
    const team = normalizePayloadTeam(raw, index)
    const item = {
      _key: team._key,
      _type: 'siteTeam',
      status: team.status,
      acceptsReferrals: team.acceptsReferrals,
    }
    if (team.siteId) item.site = { _type: 'reference', _ref: team.siteId }
    if (team.principalInvestigatorId) {
      item.principalInvestigator = { _type: 'reference', _ref: team.principalInvestigatorId }
    } else if (team.principalInvestigatorName) {
      item.principalInvestigatorName = team.principalInvestigatorName
    }
    if (!isContactEmpty(team.contact)) item.contact = team.contact
    return item
  })
}

// ---------------------------------------------------------------------------
// Change summary for approvers: what a submission changes on the current study
// ---------------------------------------------------------------------------

const STUDY_FIELD_LABELS = [
  ['title', 'title'],
  ['slug', 'URL slug'],
  ['nctId', 'NCT ID'],
  ['status', 'recruitment status'],
  ['studyType', 'study type'],
  ['phase', 'phase'],
  ['therapeuticAreaIds', 'therapeutic areas'],
  ['laySummary', 'clinical summary'],
  ['emailTitle', 'short clinical title'],
  ['emailEligibilitySummary', 'eligibility statement'],
  ['inclusionCriteria', 'inclusion criteria'],
  ['exclusionCriteria', 'exclusion criteria'],
  ['sponsorWebsite', 'study website'],
  ['featured', 'featured on homepage'],
  ['recruitmentSiteIds', 'recruitment locations'],
]

const SET_FIELDS = new Set(['therapeuticAreaIds', 'recruitmentSiteIds'])

const TEAM_FIELD_LABELS = [
  [(team) => team.status, 'status'],
  [(team) => `${team.principalInvestigatorId}|${team.principalInvestigatorName}`, 'principal investigator'],
  [(team) => team.contact.name, 'contact name'],
  [(team) => team.contact.role, 'contact role'],
  [(team) => team.contact.email, 'contact email'],
  [(team) => team.contact.phone, 'contact phone'],
  [(team) => team.contact.displayPublicly, 'contact shown publicly'],
  [(team) => team.acceptsReferrals, 'accepts referrals'],
]

function comparable(value, asSet) {
  if (Array.isArray(value)) {
    const items = value.map(clean)
    return JSON.stringify(asSet ? [...items].sort() : items)
  }
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return clean(value)
}

function matchTeam(team, candidates) {
  if (team.siteId) {
    const bySite = candidates.find((candidate) => candidate.siteId && candidate.siteId === team.siteId)
    if (bySite) return bySite
  }
  return candidates.find((candidate) => candidate._key === team._key) || null
}

/**
 * Lists what `proposed` changes relative to `current`, both in normalized
 * payload shape (see normalizeStudyPayload in lib/studySubmissions.js). Team
 * lines come first so an approver sees a cross-team edit at a glance. Returns
 * [] when nothing differs.
 */
export function summarizeStudyChanges(current, proposed, { sites } = {}) {
  const before = current && typeof current === 'object' ? current : {}
  const after = proposed && typeof proposed === 'object' ? proposed : {}
  const beforeTeams = resolvePayloadTeams(before)
  const afterTeams = resolvePayloadTeams(after)
  const lines = []

  for (const team of afterTeams) {
    const previous = matchTeam(team, beforeTeams)
    const name = teamDisplayName(team, sites)
    if (!previous) {
      lines.push(`Adds the ${name}`)
      continue
    }
    const changed = TEAM_FIELD_LABELS
      .filter(([read]) => comparable(read(previous)) !== comparable(read(team)))
      .map(([, label]) => label)
    if (changed.length) {
      lines.push(`${name[0].toUpperCase()}${name.slice(1)}: ${changed.join(', ')}`)
    }
  }
  for (const team of beforeTeams) {
    if (!matchTeam(team, afterTeams)) {
      lines.push(`Removes the ${teamDisplayName(team, sites)}`)
    }
  }

  const changedFields = STUDY_FIELD_LABELS
    .filter(([field]) => comparable(before[field], SET_FIELDS.has(field)) !== comparable(after[field], SET_FIELDS.has(field)))
    .map(([, label]) => label)
  if (changedFields.length) {
    lines.push(`Changes ${changedFields.join(', ')}`)
  }
  return lines
}

// ---------------------------------------------------------------------------
// Document shape (pages, emails, referral route)
// ---------------------------------------------------------------------------

function normalizeDocTeam(team, index, fallbackStatus) {
  const source = team && typeof team === 'object' ? team : {}
  const contact = source.contact && typeof source.contact === 'object' ? cleanContact(source.contact) : null
  const acceptsReferrals = source.acceptsReferrals === true
  return {
    _key: safeKey(source._key) || `team-${index + 1}`,
    status: normalizeTeamStatus(source.status, fallbackStatus),
    site: source.site && typeof source.site === 'object' ? source.site : null,
    principalInvestigator:
      source.principalInvestigator && typeof source.principalInvestigator === 'object' && source.principalInvestigator.name
        ? source.principalInvestigator
        : null,
    principalInvestigatorName: clean(source.principalInvestigatorName),
    contact,
    acceptsReferrals,
    // Computed in GROQ for public projections, where a hidden contact's email
    // is not returned; otherwise from the contact itself.
    canReceiveReferrals: source.canReceiveReferrals === true || (acceptsReferrals && hasContactEmail(contact)),
  }
}

function legacyDocTeam(study) {
  const hasLegacy =
    (study.principalInvestigator && typeof study.principalInvestigator === 'object') ||
    clean(study.principalInvestigatorName) ||
    (study.localContact && typeof study.localContact === 'object') ||
    study.acceptsReferrals === true
  if (!hasLegacy) return null
  return {
    _key: LEGACY_TEAM_KEY,
    site: null,
    principalInvestigator: study.principalInvestigator,
    principalInvestigatorName: study.principalInvestigatorName,
    contact: study.localContact,
    acceptsReferrals: study.acceptsReferrals,
    canReceiveReferrals: study.legacyCanReceiveReferrals,
  }
}

export function resolveStudyTeams(study) {
  if (!study || typeof study !== 'object') return []
  const fallbackStatus = teamStatusFromStudyStatus(study.status)
  if (Array.isArray(study.siteTeams) && study.siteTeams.length) {
    return study.siteTeams.filter(Boolean).map((team, index) => normalizeDocTeam(team, index, fallbackStatus))
  }
  if (study.legacyTeam && typeof study.legacyTeam === 'object') {
    return [normalizeDocTeam({ ...study.legacyTeam, _key: LEGACY_TEAM_KEY }, 0, fallbackStatus)]
  }
  const legacy = legacyDocTeam(study)
  return legacy ? [normalizeDocTeam(legacy, 0, fallbackStatus)] : []
}

export function teamLabel(team) {
  return siteLabel(team?.site)
}

export function teamShortLabel(team) {
  return siteShortLabel(team?.site)
}

export function teamInvestigatorName(team) {
  return clean(team?.principalInvestigator?.name) || clean(team?.principalInvestigatorName)
}

// One entry per team with a named PI, in team order.
export function listTeamInvestigators(teams) {
  return (Array.isArray(teams) ? teams : [])
    .map((team) => {
      const name = teamInvestigatorName(team)
      if (!name) return null
      const researcher = team.principalInvestigator || null
      return {
        key: team._key,
        name,
        slug: researcher?.slug?.current || (typeof researcher?.slug === 'string' ? researcher.slug : ''),
        photo: researcher?.photo || null,
        siteName: teamLabel(team),
        status: team.status,
      }
    })
    .filter(Boolean)
}

export function teamCanReceiveReferrals(team) {
  return Boolean(team) && isTeamEnrolling(team) && team.canReceiveReferrals === true
}

export function teamsAcceptingReferrals(teams) {
  return (Array.isArray(teams) ? teams : []).filter(teamCanReceiveReferrals)
}

export function studyAcceptsReferrals(study) {
  return teamsAcceptingReferrals(resolveStudyTeams(study)).length > 0
}

// The contact to show on public pages: only when the team chose to display it.
export function publicTeamContact(team) {
  const contact = team?.contact
  if (!contact || contact.displayPublicly !== true) return null
  const cleaned = cleanContact(contact)
  if (!cleaned.name && !cleaned.email && !cleaned.phone) return null
  return cleaned
}

// "Amit Garg, University Hospital team": the investigator the clinician knows
// first, then the site, because referrals are counted per site.
export function referralOptionLabel(team) {
  const name = teamInvestigatorName(team) || 'Study team'
  const site = teamLabel(team)
  return site ? `${name}, ${site} team` : name
}

// Which team receives a referral. `teamKey` is required once more than one
// team accepts referrals; a key never routes to a team that is not accepting.
export function pickReferralTeam(teams, teamKey) {
  const accepting = teamsAcceptingReferrals(teams)
  const key = clean(teamKey)
  if (!accepting.length) return { team: null, error: 'none' }
  if (key) {
    const team = accepting.find((candidate) => candidate._key === key)
    return team ? { team, error: null } : { team: null, error: 'not_found' }
  }
  if (accepting.length === 1) return { team: accepting[0], error: null }
  return { team: null, error: 'choose' }
}

export function recruitmentSiteNames(study) {
  const sites = Array.isArray(study?.recruitmentSites) ? study.recruitmentSites : []
  return sites.map((site) => siteLabel(site)).filter(Boolean)
}
