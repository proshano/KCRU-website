import AutoSlugInput from '../components/AutoSlugInput'

export default {
  name: 'researcher',
  title: 'Researcher',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Full Name',
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'slug',
      title: 'URL Slug',
      type: 'slug',
      options: { source: 'name' },
      components: { input: AutoSlugInput },
      validation: Rule => Rule.required(),
      description: 'Auto-generated from name'
    },
    {
      name: 'role',
      title: 'Role/Title',
      type: 'string',
      description: 'e.g., Principal Investigator, Research Associate, PhD Student'
    },
    {
      name: 'category',
      title: 'Category',
      type: 'string',
      options: {
        list: [
          { title: 'Clinical Investigator', value: 'clinical' },
          { title: 'PhD Scientist', value: 'phd' },
          { title: 'Research Staff', value: 'staff' }
        ]
      },
      initialValue: 'clinical',
      description: 'Clinical Investigator, PhD Scientist, or Research Staff (coordinators/assistants).'
    },
    {
      name: 'photo',
      title: 'Photo',
      type: 'image',
      options: { hotspot: true }
    },
    {
      name: 'email',
      title: 'Email',
      type: 'string'
    },
    {
      name: 'bio',
      title: 'Biography',
      type: 'text',
      rows: 4
    },
    {
      name: 'pubmedQuery',
      title: 'PubMed Search Query',
      type: 'string',
      description: 'Use full PubMed syntax (Boolean + field tags). Examples: \n- Smith J[Author] AND ("Western University"[Affiliation] OR "University of Western Ontario"[Affiliation])\n- ("Doe J"[Author] OR "Doe John"[Author]) AND London[Affiliation] AND 2020:2025[dp]\nTip: combine OR variants for institution names; include [Author]/[Affiliation]/[dp] for date ranges.'
    },
    {
      name: 'researchTags',
      title: 'Research Tags',
      type: 'array',
      of: [{ type: 'string' }],
      validation: Rule => Rule.max(4).unique(),
      description: 'Shown on the Team page (max 4). Drag to reorder.'
    },
    {
      name: 'orcid',
      title: 'ORCID',
      type: 'string'
    },
    {
      name: 'twitter',
      title: 'Twitter/X Handle',
      type: 'string'
    },
    {
      name: 'linkedin',
      title: 'LinkedIn URL',
      type: 'url'
    },
    {
      name: 'order',
      title: 'Display Order',
      type: 'number',
      description: 'Lower numbers appear first'
    }
  ],
  orderings: [
    {
      title: 'Display Order',
      name: 'orderAsc',
      by: [{ field: 'order', direction: 'asc' }]
    }
  ]
}
