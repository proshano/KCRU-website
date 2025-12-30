const pageContent = {
  name: 'pageContent',
  title: 'Page Content',
  type: 'document',
  // Singleton - only one instance
  __experimental_actions: ['update', 'publish'],
  groups: [
    { name: 'studies', title: 'Studies Page' },
    { name: 'team', title: 'Team Page' },
    { name: 'publications', title: 'Publications Page' },
    { name: 'news', title: 'News Page' },
    { name: 'contact', title: 'Contact Page' },
    { name: 'training', title: 'Training Page' },
  ],
  fieldsets: [
    { name: 'studiesSet', title: 'Studies page (/trials)', options: { collapsible: true, collapsed: false } },
    { name: 'teamSet', title: 'Team page (/team)', options: { collapsible: true, collapsed: true } },
    { name: 'publicationsSet', title: 'Publications page (/publications)', options: { collapsible: true, collapsed: true } },
    { name: 'newsSet', title: 'News page (/news)', options: { collapsible: true, collapsed: true } },
    { name: 'contactSet', title: 'Contact page (/contact)', options: { collapsible: true, collapsed: true } },
    { name: 'trainingSet', title: 'Training page (/training)', options: { collapsible: true, collapsed: true } },
  ],
  fields: [
    // Studies Page
    {
      name: 'studiesEyebrow',
      title: 'Eyebrow Text',
      type: 'string',
      group: 'studies',
      fieldset: 'studiesSet',
      description: 'Appears above the title on the Studies page (/trials).',
      initialValue: 'Clinical Research'
    },
    {
      name: 'studiesTitle',
      title: 'Page Title',
      type: 'string',
      group: 'studies',
      fieldset: 'studiesSet',
      description: 'Main heading on the Studies page (/trials).',
      initialValue: 'Active Studies'
    },
    {
      name: 'studiesDescription',
      title: 'Description',
      type: 'text',
      rows: 3,
      group: 'studies',
      fieldset: 'studiesSet',
      description: 'Subtext under the heading on the Studies page (/trials).',
      initialValue: 'The details on this site are oriented to healthcare providers. Please contact us if you have questions about eligibility for your patients.'
    },

    // Team Page
    {
      name: 'teamEyebrow',
      title: 'Eyebrow Text',
      type: 'string',
      group: 'team',
      fieldset: 'teamSet',
      description: 'Small label above the title on the Team page (/team).',
      initialValue: 'Our Team'
    },
    {
      name: 'teamTitle',
      title: 'Page Title',
      type: 'string',
      group: 'team',
      fieldset: 'teamSet',
      description: 'Optional main title (leave blank to show only eyebrow)',
      initialValue: 'Our Team'
    },
    {
      name: 'teamDescription',
      title: 'Description',
      type: 'text',
      rows: 3,
      group: 'team',
      fieldset: 'teamSet',
      description: 'Optional subtext below the title on the Team page (/team).',
      initialValue: 'Meet the people behind our research and operations.'
    },

    // Publications Page
    {
      name: 'publicationsTitle',
      title: 'Title Template',
      type: 'string',
      group: 'publications',
      fieldset: 'publicationsSet',
      description: 'Use {count} and {year} as placeholders. E.g., "{count} publications since {year}"',
      initialValue: '{count} publications since {year}'
    },
    {
      name: 'publicationsDescription',
      title: 'Description',
      type: 'text',
      rows: 3,
      group: 'publications',
      fieldset: 'publicationsSet',
      description: 'Optional subtext under the heading on the Publications page (/publications).',
      initialValue: ''
    },

    // News Page
    {
      name: 'newsEyebrow',
      title: 'Eyebrow Text',
      type: 'string',
      group: 'news',
      fieldset: 'newsSet',
      description: 'Small label above the title on the News page (/news).',
      initialValue: 'Latest Updates'
    },
    {
      name: 'newsTitle',
      title: 'Page Title',
      type: 'string',
      group: 'news',
      fieldset: 'newsSet',
      initialValue: 'News'
    },
    {
      name: 'newsDescription',
      title: 'Description',
      type: 'text',
      rows: 3,
      group: 'news',
      fieldset: 'newsSet',
      description: 'Optional subtext below the title on the News page (/news).',
      initialValue: ''
    },

    // Contact Page
    {
      name: 'contactTitle',
      title: 'Page Title',
      type: 'string',
      group: 'contact',
      fieldset: 'contactSet',
      description: 'Main heading on the Contact page (/contact).',
      initialValue: 'Contact us'
    },
    {
      name: 'contactDescription',
      title: 'Description',
      type: 'text',
      rows: 3,
      group: 'contact',
      fieldset: 'contactSet',
      description: 'Optional subtext below the heading on the Contact page (/contact).',
      initialValue: ''
    },
    {
      name: 'contactLocationsTitle',
      title: 'Locations Section Title',
      type: 'string',
      group: 'contact',
      fieldset: 'contactSet',
      description: 'Heading for the Locations sidebar on the Contact page (/contact).',
      initialValue: 'Locations'
    },

    // Training Page
    {
      name: 'trainingEyebrow',
      title: 'Eyebrow Text',
      type: 'string',
      group: 'training',
      fieldset: 'trainingSet',
      description: 'Small label above the title on the Training page (/training).',
      initialValue: 'Join Our Team'
    },
    {
      name: 'trainingTitle',
      title: 'Page Title',
      type: 'string',
      group: 'training',
      fieldset: 'trainingSet',
      initialValue: 'Opportunities'
    },
    {
      name: 'trainingDescription',
      title: 'Description',
      type: 'text',
      rows: 3,
      group: 'training',
      fieldset: 'trainingSet',
      description: 'Subtext under the heading on the Training page (/training).',
      initialValue: 'Open roles, how to apply, and highlights from past trainees.'
    },
  ],
  preview: {
    prepare() {
      return {
        title: 'Page Content',
        subtitle: 'Headers and descriptions for all pages'
      }
    }
  }
}

export default pageContent
