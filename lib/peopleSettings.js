// The email lists staff used to edit in Sanity Studio (who can sign in to the admin tools and
// who gets notification emails), editable at /admin/people. Browser-safe: the portal and
// /api/admin/people share these definitions and rules, so the page never offers a change the
// server would refuse.

export const PEOPLE_LIST_MAX_EMAILS = 200
const MAX_EMAIL_LENGTH = 254
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

// Which admin group may change a setting. Each group looks after its own list; approval admins
// also look after coordinators and the site-wide notification addresses.
export const PEOPLE_SCOPE_LABELS = Object.freeze({
  approvals: 'approval admins',
  updates: 'update email admins',
})

export const PEOPLE_FIELDS = Object.freeze({
  approvalAdmins: {
    kind: 'emailList',
    document: 'siteSettings',
    parent: 'studyApprovals',
    child: 'admins',
    scope: 'approvals',
    keepEditor: true,
    signIn: true,
    title: 'Approval admins',
    description:
      'Approve study changes, publish studies directly, review publication matches and social media posts, and manage the lists on this page marked for approval admins. They also get the emails about new study submissions and publications to review.',
    addedNote: 'They can sign in at /admin within a couple of minutes.',
    removeNote: 'They will lose approval admin access within a couple of minutes.',
  },
  updateAdmins: {
    kind: 'emailList',
    document: 'siteSettings',
    parent: 'studyUpdates',
    child: 'admins',
    scope: 'updates',
    keepEditor: true,
    signIn: true,
    title: 'Update email admins',
    description:
      'Send study update emails and newsletters, manage the mailing list, and run the research digest.',
    addedNote: 'They can sign in at /admin within a couple of minutes.',
    removeNote: 'They will lose update email admin access within a couple of minutes.',
  },
  coordinators: {
    kind: 'emailList',
    document: 'siteSettings',
    parent: 'studyApprovals',
    child: 'coordinatorEmails',
    scope: 'approvals',
    signIn: true,
    title: 'Study coordinators',
    description:
      'Sign in to add and edit studies. Their changes wait for an approval admin before they go live. Approval admins can already do this and do not need to be listed here.',
    addedNote: 'They can sign in at /trials/manage within a couple of minutes.',
    removeNote: 'They will no longer be able to sign in to add or edit studies.',
  },
  socialApprovers: {
    kind: 'emailList',
    document: 'siteSettings',
    parent: 'socialPosting',
    child: 'approverEmails',
    scope: 'approvals',
    fallbackField: 'approvalAdmins',
    title: 'Social media post emails',
    description:
      'Get the email when new publications could be posted on X. Leave empty to send it to the approval admins. Being on this list does not let someone sign in.',
    addedNote: 'They will get the next email about new publications.',
    removeNote: 'They will stop getting these emails.',
  },
  contactRouting: {
    kind: 'routing',
    document: 'contactRouting',
    scope: 'approvals',
    title: 'Contact form',
    description: 'Where messages from the website contact form go, for each reason a visitor can choose.',
  },
  contactEmail: {
    kind: 'email',
    document: 'siteSettings',
    parent: null,
    child: 'contactEmail',
    scope: 'approvals',
    title: 'General contact email',
    description:
      "The unit's general email address. It is listed in the website's search engine and AI summaries, and used for any contact reason without its own address.",
  },
  replyToEmail: {
    kind: 'email',
    document: 'siteSettings',
    parent: null,
    child: 'replyToEmail',
    scope: 'approvals',
    title: 'Reply-to email',
    description:
      "Replies to emails the website sends (newsletters, study updates, notifications) go here. Leave empty to use the website's sending address.",
  },
})

export function getPeopleField(key) {
  return Object.prototype.hasOwnProperty.call(PEOPLE_FIELDS, key) ? PEOPLE_FIELDS[key] : null
}

export function canEditPeopleField(access, key) {
  const field = getPeopleField(key)
  if (!field) return false
  return Boolean(access?.[field.scope])
}

export function normalizeEmailAddress(value) {
  return String(value ?? '').trim().toLowerCase()
}

export function isValidEmailAddress(value) {
  const email = normalizeEmailAddress(value)
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(email)
}

function dedupe(values) {
  return Array.from(new Set(values))
}

// Staff paste addresses from Outlook ("Smith, John <John.Smith@lhsc.on.ca>; ..."), so pull
// out anything shaped like an address and ignore the names around it. Anything containing
// "@" that is not a valid address is reported rather than dropped, so a typo is noticed.
// Apostrophes are not separators: they appear in real addresses (mary.o'brien@...).
export function extractEmailAddresses(text) {
  const emails = []
  const invalid = []
  for (const rawToken of String(text ?? '').split(/[\s,;<>()[\]"]+/)) {
    if (!rawToken.includes('@')) continue
    const token = rawToken.replace(/^mailto:/i, '').replace(/\.+$/, '')
    if (isValidEmailAddress(token)) emails.push(normalizeEmailAddress(token))
    else invalid.push(rawToken)
  }
  return { emails: dedupe(emails), invalid: dedupe(invalid) }
}

// Strict validation for what the server stores: every entry must already be one valid address.
export function validateEmailList(value, { maxEmails = PEOPLE_LIST_MAX_EMAILS } = {}) {
  if (!Array.isArray(value)) {
    return { ok: false, error: 'Send the list as an array of email addresses.' }
  }
  const invalid = value.filter((item) => typeof item !== 'string' || !isValidEmailAddress(item))
  if (invalid.length) {
    const shown = invalid.slice(0, 5).map((item) => `"${String(item)}"`).join(', ')
    return { ok: false, error: `These are not valid email addresses: ${shown}.`, invalid }
  }
  const emails = dedupe(value.map(normalizeEmailAddress))
  if (emails.length > maxEmails) {
    return { ok: false, error: `A list can hold at most ${maxEmails} addresses.` }
  }
  return { ok: true, emails }
}

// Stored lists predate this page and may hold mixed case, blanks or duplicates.
export function normalizeStoredEmailList(value) {
  if (!Array.isArray(value)) return []
  return dedupe(value.map(normalizeEmailAddress).filter(Boolean))
}

export function sameEmailList(a, b) {
  const left = new Set(normalizeStoredEmailList(a))
  const right = new Set(normalizeStoredEmailList(b))
  if (left.size !== right.size) return false
  for (const email of left) if (!right.has(email)) return false
  return true
}

export function describeEmailListChange(previous, next) {
  const before = new Set(normalizeStoredEmailList(previous))
  const after = new Set(normalizeStoredEmailList(next))
  return {
    added: [...after].filter((email) => !before.has(email)),
    removed: [...before].filter((email) => !after.has(email)),
  }
}

export function validateOptionalEmail(value) {
  const email = normalizeEmailAddress(value)
  if (!email) return { ok: true, email: '' }
  if (!isValidEmailAddress(email)) return { ok: false, error: `"${String(value).trim()}" is not a valid email address.` }
  return { ok: true, email }
}

// Contact routing is edited as { [reason key]: email } over the reasons already configured in
// Studio; adding or renaming reasons stays in Studio because the page copy lives there too.
export function validateRoutingEmails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'Send the contact form addresses as { reason: email }.' }
  }
  const emails = {}
  for (const [key, raw] of Object.entries(value)) {
    const email = normalizeEmailAddress(raw)
    if (!email) return { ok: false, error: 'Every contact reason needs an email address.' }
    if (!isValidEmailAddress(email)) {
      return { ok: false, error: `"${String(raw).trim()}" is not a valid email address.` }
    }
    emails[String(key)] = email
  }
  if (!Object.keys(emails).length) return { ok: false, error: 'No contact form addresses were sent.' }
  return { ok: true, emails }
}

// The editor's own session comes from the list they are editing, so dropping themselves would
// lock them out mid-edit and could leave the group with nobody who can sign in to fix it.
export function findEditorLockout(key, nextEmails, editorEmail) {
  const field = getPeopleField(key)
  if (!field?.keepEditor) return null
  const editor = normalizeEmailAddress(editorEmail)
  if (!editor) return 'Your email address is missing from your session. Sign out and back in, then try again.'
  if (normalizeStoredEmailList(nextEmails).includes(editor)) return null
  return `You can't remove your own address from ${field.title.toLowerCase()}, because you would lose access. Ask another of the ${PEOPLE_SCOPE_LABELS[field.scope]} to do it.`
}

export function emailMatchesDomains(email, domains = []) {
  const normalized = normalizeEmailAddress(email)
  return (domains || []).some((domain) => normalized.endsWith(`@${String(domain).toLowerCase()}`))
}

// Addresses outside the sign-in domains can still receive emails, but cannot sign in, which
// is worth a warning on the lists whose only purpose is signing in.
export function findOutsideDomainEmails(emails, domains = []) {
  if (!domains?.length) return []
  return normalizeStoredEmailList(emails).filter((email) => !emailMatchesDomains(email, domains))
}
