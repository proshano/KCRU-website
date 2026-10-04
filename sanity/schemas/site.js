const site = {
  name: 'site',
  title: 'Research Site',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Site Name',
      type: 'string',
      validation: Rule => Rule.required(),
      description: 'e.g., "University Hospital"'
    },
    {
      name: 'shortName',
      title: 'Short Name',
      type: 'string',
      description: 'e.g., "UH"'
    },
    {
      name: 'type',
      title: 'Site Type',
      type: 'string',
      options: {
        list: [
          { title: 'Academic Hospital', value: 'academic_hospital' },
          { title: 'Community Hospital', value: 'community_hospital' },
          { title: 'Dialysis Centre', value: 'dialysis_centre' },
          { title: 'Private Clinic', value: 'private_clinic' },
          { title: 'University', value: 'university' },
          { title: 'Research Institute', value: 'research_institute' }
        ]
      }
    },
    {
      name: 'city',
      title: 'City',
      type: 'string'
    },
    {
      name: 'province',
      title: 'Province/State',
      type: 'string'
    },
    {
      name: 'capabilities',
      title: 'Site Capabilities',
      type: 'array',
      of: [{ type: 'string' }],
      options: { layout: 'tags' },
      description: 'e.g., "Phase I-IV trials", "Hemodialysis", "PD", "Biobanking"'
    },
    {
      name: 'patientVolume',
      title: 'Patient Volume',
      type: 'object',
      fields: [
        { name: 'description', title: 'Description', type: 'string' },
        { name: 'hemodialysis', title: 'Hemodialysis Patients', type: 'number' },
        { name: 'peritoneal', title: 'Peritoneal Dialysis Patients', type: 'number' },
        { name: 'ckd', title: 'CKD Patients', type: 'number' },
        { name: 'transplant', title: 'Transplant Patients', type: 'number' }
      ]
    },
    {
      name: 'coordinatesStudies',
      title: 'Coordinates studies',
      type: 'boolean',
      initialValue: false,
      description:
        'This site runs studies with its own principal investigators, coordinators and startup fees (for example Victoria Hospital or University Hospital). A study has one team per coordinating site.'
    },
    {
      name: 'recruitsPatients',
      title: 'Patients can be enrolled here',
      type: 'boolean',
      initialValue: false,
      description:
        'Patients can be seen and enrolled for studies at this location (for example Westmount / Kidney Care Centre). Separate from who coordinates the study.'
    },
    {
      name: 'active',
      title: 'Active Site?',
      type: 'boolean',
      initialValue: true
    },
    {
      name: 'order',
      title: 'Display Order',
      type: 'number'
    }
  ],
  orderings: [
    {
      title: 'Display Order',
      name: 'orderAsc',
      by: [{ field: 'order', direction: 'asc' }]
    }
  ],
  preview: {
    select: {
      title: 'name',
      type: 'type',
      city: 'city',
      active: 'active',
      coordinatesStudies: 'coordinatesStudies',
      recruitsPatients: 'recruitsPatients'
    },
    prepare({ title, type, city, active, coordinatesStudies, recruitsPatients }) {
      const roles = [coordinatesStudies && 'coordinates studies', recruitsPatients && 'enrols patients'].filter(Boolean)
      return {
        title: active ? title : `${title} (inactive)`,
        subtitle: [type?.replace('_', ' '), city, roles.join(', ')].filter(Boolean).join(' • ')
      }
    }
  }
}

export default site
