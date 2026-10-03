/**
 * Study Referral Schema
 * 
 * Tracks referral requests from healthcare providers for specific studies.
 * The coordinator receives an email and follows up directly with the provider.
 */

const studyReferral = {
  name: 'studyReferral',
  title: 'Study Referrals',
  type: 'document',
  fields: [
    {
      name: 'providerEmail',
      title: 'Provider Email',
      type: 'string',
      validation: Rule => Rule.required().email(),
      description: 'Email address of the referring healthcare provider'
    },
    {
      name: 'study',
      title: 'Study',
      type: 'reference',
      to: [{ type: 'trialSummary' }],
      validation: Rule => Rule.required()
    },
    {
      name: 'studyTitle',
      title: 'Study Title',
      type: 'string',
      readOnly: true,
      description: 'Denormalized for easy viewing in list'
    },
    {
      name: 'team',
      title: 'Study team that received it',
      type: 'object',
      readOnly: true,
      description: 'Set by the referral form from the team the clinician chose.',
      fields: [
        { name: 'teamKey', title: 'Team key', type: 'string' },
        { name: 'siteId', title: 'Site id', type: 'string' },
        { name: 'siteName', title: 'Site', type: 'string' }
      ]
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'New', value: 'new' },
          { title: 'Contacted', value: 'contacted' },
          { title: 'Closed', value: 'closed' }
        ]
      },
      initialValue: 'new'
    },
    {
      name: 'submittedAt',
      title: 'Submitted At',
      type: 'datetime',
      validation: Rule => Rule.required()
    },
    {
      name: 'meta',
      title: 'Meta',
      type: 'object',
      fields: [
        { name: 'ip', title: 'IP Address', type: 'string' },
        { name: 'userAgent', title: 'User Agent', type: 'string' }
      ]
    }
  ],
  preview: {
    select: {
      email: 'providerEmail',
      studyTitle: 'studyTitle',
      status: 'status',
      submittedAt: 'submittedAt',
      siteName: 'team.siteName'
    },
    prepare({ email, studyTitle, status, submittedAt, siteName }) {
      const statusEmoji = {
        new: '🔵',
        contacted: '🟡',
        closed: '✅'
      }
      const date = submittedAt ? new Date(submittedAt).toLocaleDateString() : ''
      return {
        title: `${statusEmoji[status] || '⚪'} ${email}`,
        subtitle: [studyTitle || 'Unknown study', siteName ? `${siteName} team` : '', date].filter(Boolean).join(' • ')
      }
    }
  },
  orderings: [
    {
      title: 'Newest First',
      name: 'submittedDesc',
      by: [{ field: 'submittedAt', direction: 'desc' }]
    },
    {
      title: 'By Status',
      name: 'statusAsc',
      by: [
        { field: 'status', direction: 'asc' },
        { field: 'submittedAt', direction: 'desc' }
      ]
    }
  ]
}

export default studyReferral
