export const RESEARCH_DIGEST_PREF = 'research_digest'

export const RESEARCH_DIGEST_TIMEZONE = process.env.RESEARCH_DIGEST_TIMEZONE || process.env.CRON_TIMEZONE || 'America/Toronto'

export const RESEARCH_DIGEST_APPROVAL = Object.freeze({
  pending: 'pending',
  approved: 'approved',
  rejected: 'rejected',
})

export const RESEARCH_DIGEST_ISSUE_STATUS = Object.freeze({
  draft: 'draft',
  approved: 'approved',
  sent: 'sent',
})

export const RESEARCH_DIGEST_TRIAGE = Object.freeze({
  include: 'include',
  maybe: 'maybe',
  exclude: 'exclude',
})

export const RESEARCH_OPPORTUNITY_TYPES = Object.freeze({
  grant: 'grant',
  conference: 'conference',
  award: 'award',
  training: 'training',
  other: 'other',
})

export const DEFAULT_RESEARCH_DIGEST_JOURNAL_GROUPS = Object.freeze([
  {
    key: 'general_medicine',
    title: 'General high-impact medicine',
    journals: [
      'The New England Journal of Medicine',
      'Lancet',
      'JAMA',
      'BMJ',
      'Annals of Internal Medicine',
      'JAMA Internal Medicine',
      'Nature Medicine',
      'PLOS Medicine',
    ],
  },
  {
    key: 'kidney_nephrology',
    title: 'Kidney/nephrology',
    journals: [
      'Journal of the American Society of Nephrology',
      'Kidney International',
      'Clinical Journal of the American Society of Nephrology',
      'American Journal of Kidney Diseases',
      'Nephrology Dialysis Transplantation',
      'Kidney360',
      'Kidney Medicine',
      'Clinical Kidney Journal',
      'American Journal of Nephrology',
      'BMC Nephrology',
    ],
  },
  {
    key: 'dialysis_krt',
    title: 'Dialysis and kidney replacement therapy',
    journals: [
      'Peritoneal Dialysis International',
      'Hemodialysis International',
      'Seminars in Dialysis',
      'Blood Purification',
      'Therapeutic Apheresis and Dialysis',
      'Journal of Vascular Access',
    ],
  },
  {
    key: 'transplantation',
    title: 'Transplantation',
    journals: [
      'American Journal of Transplantation',
      'Transplantation',
      'Transplant International',
      'Clinical Transplantation',
      'Pediatric Transplantation',
    ],
  },
  {
    key: 'adjacent_high_yield',
    title: 'Adjacent high-yield areas',
    journals: [
      'Circulation',
      'European Heart Journal',
      'Diabetes Care',
      'The Lancet Diabetes & Endocrinology',
      'JAMA Network Open',
      'JAMA Surgery',
      'Annals of Surgery',
      'British Journal of Anaesthesia',
      'Anesthesiology',
    ],
  },
])

export const DEFAULT_RESEARCH_DIGEST_SETTINGS = Object.freeze({
  subjectTemplate: 'KCRU kidney research digest - {{date}}',
  introText: 'Here is the approved kidney research digest for {{date}}.',
  emptyIntroText: 'There are no approved research digest items to send today.',
  outroText: '',
  signature: 'London Kidney Clinical Research',
  maxPapers: 10,
  maxOpportunities: 8,
  sendEmpty: false,
  requireIssueApproval: true,
  pilotMode: true,
  pilotRecipients: [],
})

function normalizeEmailList(values) {
  const raw = Array.isArray(values) ? values : String(values || '').split(/[,;\n]/)
  const emails = raw
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  return Array.from(new Set(emails))
}

export function normalizeResearchDigestSettings(settings = {}) {
  const maxPapers = Number(settings?.maxPapers)
  const maxOpportunities = Number(settings?.maxOpportunities)

  return {
    ...DEFAULT_RESEARCH_DIGEST_SETTINGS,
    ...settings,
    maxPapers: Number.isFinite(maxPapers) && maxPapers > 0
      ? Math.min(Math.round(maxPapers), 30)
      : DEFAULT_RESEARCH_DIGEST_SETTINGS.maxPapers,
    maxOpportunities: Number.isFinite(maxOpportunities) && maxOpportunities > 0
      ? Math.min(Math.round(maxOpportunities), 30)
      : DEFAULT_RESEARCH_DIGEST_SETTINGS.maxOpportunities,
    sendEmpty: Boolean(settings?.sendEmpty),
    requireIssueApproval: settings?.requireIssueApproval !== false,
    pilotMode: settings?.pilotMode !== false,
    pilotRecipients: normalizeEmailList([
      ...(Array.isArray(settings?.pilotRecipients) ? settings.pilotRecipients : []),
      ...normalizeEmailList(process.env.RESEARCH_DIGEST_PILOT_EMAILS),
    ]),
  }
}

export function getResearchDigestJournalGroups(settings = {}) {
  const configured = Array.isArray(settings?.journalGroups) ? settings.journalGroups : []
  const groups = configured
    .map((group, index) => ({
      key: String(group?.key || group?.title || `group_${index + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, ''),
      title: String(group?.title || group?.name || '').trim(),
      journals: Array.isArray(group?.journals)
        ? group.journals.map((journal) => String(journal || '').trim()).filter(Boolean)
        : [],
    }))
    .filter((group) => group.title && group.journals.length)

  return groups.length ? groups : DEFAULT_RESEARCH_DIGEST_JOURNAL_GROUPS.map((group) => ({ ...group }))
}

export function getResearchDigestOpportunitySources(settings = {}) {
  const sources = Array.isArray(settings?.opportunitySources) ? settings.opportunitySources : []
  return sources
    .map((source) => ({
      name: String(source?.name || '').trim(),
      url: String(source?.url || '').trim(),
      type: String(source?.type || RESEARCH_OPPORTUNITY_TYPES.other).trim(),
      enabled: source?.enabled !== false,
      topics: Array.isArray(source?.topics)
        ? source.topics.map((topic) => String(topic || '').trim()).filter(Boolean)
        : [],
    }))
    .filter((source) => source.enabled && source.name && /^https?:\/\//i.test(source.url))
}
