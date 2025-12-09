export default {
  name: 'alumnus',
  title: 'Trainee Alumni',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'photo',
      title: 'Photo',
      type: 'image',
      options: { hotspot: true }
    },
    {
      name: 'trainingType',
      title: 'Training Type',
      type: 'string',
      options: {
        list: [
          { title: 'PhD', value: 'phd' },
          { title: 'MSc', value: 'msc' },
          { title: 'Postdoctoral Fellow', value: 'postdoc' },
          { title: 'Clinical Fellow', value: 'clinical_fellow' },
          { title: 'Research Assistant', value: 'ra' },
          { title: 'Undergraduate', value: 'undergrad' }
        ]
      }
    },
    {
      name: 'yearStarted',
      title: 'Year Started',
      type: 'number'
    },
    {
      name: 'yearCompleted',
      title: 'Year Completed',
      type: 'number'
    },
    {
      name: 'thesisTitle',
      title: 'Thesis/Project Title',
      type: 'string'
    },
    {
      name: 'supervisor',
      title: 'Supervisor(s)',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'researcher' }] }]
    },
    {
      name: 'currentPosition',
      title: 'Current Position',
      type: 'string',
      description: 'e.g., "Assistant Professor, University of Toronto"'
    },
    {
      name: 'currentOrganization',
      title: 'Current Organization',
      type: 'string'
    },
    {
      name: 'linkedin',
      title: 'LinkedIn URL',
      type: 'url'
    },
    {
      name: 'testimonial',
      title: 'Testimonial',
      type: 'text',
      rows: 3,
      description: 'Optional quote about their training experience'
    },
    {
      name: 'featured',
      title: 'Featured?',
      type: 'boolean',
      initialValue: false,
      description: 'Show on main training page'
    }
  ],
  orderings: [
    {
      title: 'Most Recent',
      name: 'yearDesc',
      by: [{ field: 'yearCompleted', direction: 'desc' }]
    }
  ],
  preview: {
    select: {
      title: 'name',
      type: 'trainingType',
      year: 'yearCompleted',
      current: 'currentPosition',
      media: 'photo'
    },
    prepare({ title, type, year, current, media }) {
      return {
        title,
        subtitle: `${type?.toUpperCase() || ''} ${year || ''} → ${current || ''}`,
        media
      }
    }
  }
}

