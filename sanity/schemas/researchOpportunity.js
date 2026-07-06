const TYPE_OPTIONS = [
  { title: 'Grant', value: 'grant' },
  { title: 'Conference', value: 'conference' },
  { title: 'Award', value: 'award' },
  { title: 'Training', value: 'training' },
  { title: 'Other', value: 'other' },
]

const STATUS_OPTIONS = [
  { title: 'Open', value: 'open' },
  { title: 'Upcoming', value: 'upcoming' },
  { title: 'Closed', value: 'closed' },
]

const APPROVAL_OPTIONS = [
  { title: 'Pending review', value: 'pending' },
  { title: 'Approved', value: 'approved' },
  { title: 'Rejected', value: 'rejected' },
]

const researchOpportunity = {
  name: 'researchOpportunity',
  title: 'Research Opportunities',
  type: 'document',
  fields: [
    {
      name: 'type',
      title: 'Type',
      type: 'string',
      options: { list: TYPE_OPTIONS },
      initialValue: 'other',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: { list: STATUS_OPTIONS },
      initialValue: 'open',
      validation: (Rule) => Rule.required(),
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
      name: 'sourceName',
      title: 'Source Name',
      type: 'string',
    },
    {
      name: 'sourceUrl',
      title: 'Source URL',
      type: 'url',
    },
    {
      name: 'sourceId',
      title: 'Source ID',
      type: 'string',
      readOnly: true,
    },
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 4,
    },
    {
      name: 'deadline',
      title: 'Deadline',
      type: 'date',
    },
    {
      name: 'eligibility',
      title: 'Eligibility',
      type: 'text',
      rows: 3,
    },
    {
      name: 'url',
      title: 'Opportunity URL',
      type: 'url',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'topics',
      title: 'Topics',
      type: 'array',
      of: [{ type: 'string' }],
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
      sourceName: 'sourceName',
      type: 'type',
      deadline: 'deadline',
      approvalStatus: 'approvalStatus',
    },
    prepare({ title, sourceName, type, deadline, approvalStatus }) {
      return {
        title: title || 'Untitled opportunity',
        subtitle: [sourceName, type, deadline, approvalStatus].filter(Boolean).join(' - '),
      }
    },
  },
  orderings: [
    {
      title: 'Deadline',
      name: 'deadlineAsc',
      by: [{ field: 'deadline', direction: 'asc' }],
    },
    {
      title: 'Retrieved At (newest)',
      name: 'retrievedAtDesc',
      by: [{ field: 'retrievedAt', direction: 'desc' }],
    },
  ],
}

export default researchOpportunity
