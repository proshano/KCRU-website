import AutoSlugInput from '../components/AutoSlugInput'

const traineeOpportunity = {
  name: 'traineeOpportunity',
  title: 'Trainee Opportunity',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Position Title',
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'slug',
      title: 'URL Slug',
      type: 'slug',
      options: { source: 'title' },
      components: { input: AutoSlugInput },
      description: 'Auto-generated from title'
    },
    {
      name: 'type',
      title: 'Position Type',
      type: 'string',
      options: {
        list: [
          { title: 'PhD Student', value: 'phd' },
          { title: 'MSc Student', value: 'msc' },
          { title: 'Postdoctoral Fellow', value: 'postdoc' },
          { title: 'Clinical Fellow', value: 'clinical_fellow' },
          { title: 'Research Assistant', value: 'ra' },
          { title: 'Summer Student', value: 'summer' },
          { title: 'Undergraduate Thesis', value: 'undergrad' },
          { title: 'Visiting Scholar', value: 'visiting' }
        ]
      }
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Open', value: 'open' },
          { title: 'Closed', value: 'closed' },
          { title: 'Always Accepting Inquiries', value: 'ongoing' }
        ]
      },
      initialValue: 'open'
    },
    {
      name: 'supervisor',
      title: 'Supervisor(s)',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'researcher' }] }]
    },
    {
      name: 'description',
      title: 'Description',
      type: 'array',
      of: [{ type: 'block' }]
    },
    {
      name: 'researchArea',
      title: 'Research Area',
      type: 'string',
      description: 'e.g., "Clinical trials methodology", "Health services research"'
    },
    {
      name: 'qualifications',
      title: 'Qualifications',
      type: 'array',
      of: [{ type: 'string' }]
    },
    {
      name: 'funding',
      title: 'Funding Available?',
      type: 'string',
      description: 'e.g., "Fully funded for 4 years", "Student must secure own funding"'
    },
    {
      name: 'startDate',
      title: 'Start Date',
      type: 'string',
      description: 'e.g., "September 2025" or "Flexible"'
    },
    {
      name: 'deadline',
      title: 'Application Deadline',
      type: 'date'
    },
    {
      name: 'howToApply',
      title: 'How to Apply',
      type: 'text',
      rows: 4
    },
    {
      name: 'contactEmail',
      title: 'Contact Email',
      type: 'string'
    }
  ],
  preview: {
    select: {
      title: 'title',
      type: 'type',
      status: 'status'
    },
    prepare({ title, type, status }) {
      const statusIndicator = status === 'open' ? '🟢' : status === 'ongoing' ? '🔵' : '⚫'
      return {
        title: `${statusIndicator} ${title}`,
        subtitle: type
      }
    }
  }
}

export default traineeOpportunity
