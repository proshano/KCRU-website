export default {
  name: 'referralInfo',
  title: 'Referral Information (For Physicians)',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // Singleton
  fields: [
    {
      name: 'headline',
      title: 'Headline',
      type: 'string',
      description: 'e.g., "Refer a Patient"'
    },
    {
      name: 'introduction',
      title: 'Introduction',
      type: 'text',
      rows: 3
    },
    {
      name: 'clinicalServices',
      title: 'Clinical Services',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'service', title: 'Service', type: 'string' },
            { name: 'description', title: 'Description', type: 'text', rows: 2 },
            { name: 'referralCriteria', title: 'Referral Criteria', type: 'text', rows: 2 }
          ]
        }
      ]
    },
    {
      name: 'researchReferrals',
      title: 'Research Referrals',
      type: 'text',
      rows: 3,
      description: 'Info about referring patients for research studies'
    },
    {
      name: 'howToRefer',
      title: 'How to Refer',
      type: 'array',
      of: [{ type: 'block' }],
      description: 'Step-by-step referral process'
    },
    {
      name: 'referralFax',
      title: 'Referral Fax Number',
      type: 'string'
    },
    {
      name: 'referralPhone',
      title: 'Referral Phone Number',
      type: 'string'
    },
    {
      name: 'referralEmail',
      title: 'Referral Email',
      type: 'string'
    },
    {
      name: 'referralFormUrl',
      title: 'Referral Form URL',
      type: 'url',
      description: 'Link to downloadable referral form if applicable'
    },
    {
      name: 'referralForm',
      title: 'Referral Form (PDF)',
      type: 'file',
      options: {
        accept: '.pdf'
      }
    },
    {
      name: 'urgentReferrals',
      title: 'Urgent Referral Instructions',
      type: 'text',
      rows: 3
    },
    {
      name: 'geographicArea',
      title: 'Geographic Area Served',
      type: 'string',
      description: 'e.g., "Southwestern Ontario"'
    }
  ]
}

