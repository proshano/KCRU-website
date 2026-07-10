const STATUS_OPTIONS = [
  { title: 'Draft', value: 'draft' },
  { title: 'Approved for send/publication', value: 'approved' },
  { title: 'Sent', value: 'sent' },
]

const researchDigestIssue = {
  name: 'researchDigestIssue',
  title: 'Research Digest Issues',
  type: 'document',
  fields: [
    {
      name: 'date',
      title: 'Digest Date',
      type: 'date',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'date' },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: { list: STATUS_OPTIONS },
      initialValue: 'draft',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'intro',
      title: 'Intro',
      type: 'text',
      rows: 3,
    },
    {
      name: 'retrievalWindowDays',
      title: 'Retrieval Window Days',
      type: 'number',
      readOnly: true,
    },
    {
      name: 'selectionMode',
      title: 'Selection Mode',
      type: 'string',
      options: {
        list: [
          { title: 'Automated', value: 'automated' },
          { title: 'Manual', value: 'manual' },
        ],
      },
      readOnly: true,
    },
    {
      name: 'selectedPaperCount',
      title: 'Selected Paper Count',
      type: 'number',
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
      name: 'sentAt',
      title: 'Sent At',
      type: 'datetime',
      readOnly: true,
    },
  ],
  preview: {
    select: {
      title: 'title',
      date: 'date',
      status: 'status',
    },
    prepare({ title, date, status }) {
      return {
        title: title || date || 'Research digest',
        subtitle: [date, status].filter(Boolean).join(' - '),
      }
    },
  },
  orderings: [
    {
      title: 'Date (newest)',
      name: 'dateDesc',
      by: [{ field: 'date', direction: 'desc' }],
    },
  ],
}

export default researchDigestIssue
