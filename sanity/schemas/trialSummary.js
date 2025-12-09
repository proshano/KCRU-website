export default {
  name: 'trialSummary',
  title: 'Trial Summary (Patient-Facing)',
  type: 'document',
  fields: [
    {
      name: 'nctId',
      title: 'NCT ID',
      type: 'string',
      validation: Rule => Rule.regex(/^NCT\d{8}$/, {
        name: 'NCT format',
        invert: false
      }),
      description: 'e.g., NCT12345678 (optional for non-registered studies)'
    },
    {
      name: 'title',
      title: 'Patient-Friendly Title',
      type: 'string',
      description: 'Plain language title (not the official title)',
      validation: Rule => Rule.required()
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title' },
      validation: Rule => Rule.required()
    },
    {
      name: 'status',
      title: 'Recruitment Status',
      type: 'string',
      options: {
        list: [
          { title: 'Recruiting', value: 'recruiting' },
          { title: 'Coming Soon', value: 'coming_soon' },
          { title: 'Closed', value: 'closed' }
        ]
      }
    },
    {
      name: 'coordinatorEmail',
      title: 'Coordinator Email',
      type: 'string',
      validation: Rule => Rule.required().email(),
      description: 'Inquiries will be sent here. Not displayed publicly.'
    },
    {
      name: 'condition',
      title: 'Condition Being Studied',
      type: 'string',
      description: 'In plain language, e.g., "Kidney disease requiring dialysis"'
    },
    {
      name: 'purpose',
      title: 'What is this study about?',
      type: 'text',
      rows: 4,
      description: 'Explain in simple terms what the study is testing'
    },
    {
      name: 'whoCanJoin',
      title: 'Who can join?',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Plain-language eligibility criteria'
    },
    {
      name: 'whoCannotJoin',
      title: 'Who cannot join?',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'Key exclusion criteria in plain language'
    },
    {
      name: 'whatToExpect',
      title: 'What to expect',
      type: 'text',
      rows: 4,
      description: 'What participation involves (visits, procedures, time commitment)'
    },
    {
      name: 'duration',
      title: 'How long does participation last?',
      type: 'string'
    },
    {
      name: 'compensation',
      title: 'Compensation/Reimbursement',
      type: 'string',
      description: 'e.g., "Parking costs covered" or "Honorarium provided"'
    },
    {
      name: 'principalInvestigator',
      title: 'Principal Investigator',
      type: 'reference',
      to: [{ type: 'researcher' }]
    },
    {
      name: 'featured',
      title: 'Featured on homepage?',
      type: 'boolean',
      initialValue: false
    }
  ],
  preview: {
    select: {
      title: 'title',
      status: 'status',
      nctId: 'nctId'
    },
    prepare({ title, status, nctId }) {
      const statusEmoji = {
        recruiting: '🟢',
        coming_soon: '🟡',
        closed: '⚫'
      }
      return {
        title: `${statusEmoji[status] || ''} ${title}`,
        subtitle: nctId || 'No NCT ID'
      }
    }
  }
}

