const TRIAGE_OPTIONS = [
  { title: 'Include', value: 'include' },
  { title: 'Maybe', value: 'maybe' },
  { title: 'Exclude', value: 'exclude' },
]

const APPROVAL_OPTIONS = [
  { title: 'Pending review', value: 'pending' },
  { title: 'Approved', value: 'approved' },
  { title: 'Rejected', value: 'rejected' },
]

const TIER_OPTIONS = [
  { title: 'Tier 1', value: 'Tier 1' },
  { title: 'Tier 2', value: 'Tier 2' },
  { title: 'Tier 3', value: 'Tier 3' },
]

const researchDigestPaper = {
  name: 'researchDigestPaper',
  title: 'Research Digest Papers',
  type: 'document',
  fields: [
    {
      name: 'issue',
      title: 'Issue',
      type: 'reference',
      to: [{ type: 'researchDigestIssue' }],
    },
    {
      name: 'issueDate',
      title: 'Issue Date',
      type: 'date',
      description: 'The issue this paper belongs to. A deferred paper moves forward to a later issue when it is finally selected.',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'discoveredDate',
      title: 'Discovered Date',
      type: 'date',
      description: 'The day this paper was first imported. Bounds how long a deferred paper stays eligible for carryover.',
      readOnly: true,
    },
    {
      name: 'carriedOverFrom',
      title: 'Carried Over From',
      type: 'date',
      description: 'Set when a paper was selected for a later issue than the one it was discovered in.',
      readOnly: true,
    },
    {
      name: 'pmid',
      title: 'PMID',
      type: 'string',
    },
    {
      name: 'doi',
      title: 'DOI',
      type: 'string',
    },
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'abstract',
      title: 'Abstract',
      type: 'text',
      rows: 5,
    },
    {
      name: 'authors',
      title: 'Authors',
      type: 'array',
      of: [{ type: 'string' }],
    },
    {
      name: 'publicationTypes',
      title: 'PubMed Publication Types',
      type: 'array',
      of: [{ type: 'string' }],
      readOnly: true,
    },
    {
      name: 'journal',
      title: 'Journal',
      type: 'string',
    },
    {
      name: 'pubDate',
      title: 'Publication Date',
      type: 'string',
    },
    {
      name: 'year',
      title: 'Year',
      type: 'number',
    },
    {
      name: 'url',
      title: 'URL',
      type: 'url',
    },
    {
      name: 'matchedJournalGroups',
      title: 'Matched Journal Groups',
      type: 'array',
      of: [{ type: 'string' }],
      readOnly: true,
    },
    {
      name: 'matchedJournalGroupKeys',
      title: 'Matched Journal Group Keys',
      type: 'array',
      of: [{ type: 'string' }],
      readOnly: true,
    },
    {
      name: 'triageStatus',
      title: 'LLM Triage Status',
      type: 'string',
      options: { list: TRIAGE_OPTIONS },
      initialValue: 'maybe',
    },
    {
      name: 'approvalStatus',
      title: 'Approval Status',
      type: 'string',
      options: { list: APPROVAL_OPTIONS },
      initialValue: 'pending',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'tier',
      title: 'Tier',
      type: 'string',
      options: { list: TIER_OPTIONS },
    },
    {
      name: 'priorityScore',
      title: 'Daily Priority Score',
      type: 'number',
      description: 'Conservative 0-100 estimate of whether this paper belongs in a very small daily inbox.',
      readOnly: true,
      validation: (Rule) => Rule.min(0).max(100),
    },
    {
      name: 'whyItMatters',
      title: 'Why It Matters',
      type: 'text',
      rows: 2,
    },
    {
      name: 'summary',
      title: 'Digest Summary',
      type: 'text',
      rows: 4,
    },
    {
      name: 'topics',
      title: 'Topics',
      type: 'array',
      of: [{ type: 'string' }],
    },
    {
      name: 'triageError',
      title: 'Triage Error',
      type: 'string',
      readOnly: true,
    },
    {
      name: 'autoSelected',
      title: 'Automatically Selected',
      type: 'boolean',
      readOnly: true,
    },
    {
      name: 'autoSelectionStatus',
      title: 'Automatic Selection Status',
      type: 'string',
      options: {
        list: [
          { title: 'Selected', value: 'selected' },
          { title: 'Deferred (still eligible for a later issue)', value: 'deferred' },
          { title: 'Not selected', value: 'not_selected' },
        ],
      },
      readOnly: true,
    },
    {
      name: 'autoSelectionExcluded',
      title: 'Excluded From Automatic Selection',
      type: 'boolean',
      description: 'Set by an exceptional manual rejection so later imports do not reselect this paper.',
      readOnly: true,
    },
    {
      name: 'retrievalWindowDays',
      title: 'Retrieval Window Days',
      type: 'number',
      readOnly: true,
    },
    {
      name: 'retrievedAt',
      title: 'Retrieved At',
      type: 'datetime',
      readOnly: true,
    },
    {
      name: 'createdAt',
      title: 'Created At',
      type: 'datetime',
      readOnly: true,
    },
    {
      name: 'updatedAt',
      title: 'Updated At',
      type: 'datetime',
      readOnly: true,
    },
    {
      name: 'approvedAt',
      title: 'Approved At',
      type: 'datetime',
      readOnly: true,
    },
    {
      name: 'rejectedAt',
      title: 'Rejected At',
      type: 'datetime',
      readOnly: true,
    },
  ],
  preview: {
    select: {
      title: 'title',
      journal: 'journal',
      issueDate: 'issueDate',
      approvalStatus: 'approvalStatus',
      triageStatus: 'triageStatus',
    },
    prepare({ title, journal, issueDate, approvalStatus, triageStatus }) {
      return {
        title: title || 'Untitled paper',
        subtitle: [journal, issueDate, triageStatus, approvalStatus].filter(Boolean).join(' - '),
      }
    },
  },
  orderings: [
    {
      title: 'Retrieved At (newest)',
      name: 'retrievedAtDesc',
      by: [{ field: 'retrievedAt', direction: 'desc' }],
    },
    {
      title: 'Issue Date (newest)',
      name: 'issueDateDesc',
      by: [{ field: 'issueDate', direction: 'desc' }],
    },
  ],
}

export default researchDigestPaper
