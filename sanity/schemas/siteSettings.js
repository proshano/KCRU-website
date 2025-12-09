export default {
  name: 'siteSettings',
  title: 'Site Settings',
  type: 'document',
  // Singleton - only one instance
  __experimental_actions: ['update', 'publish'],
  fields: [
    {
      name: 'unitName',
      title: 'Research Unit Name',
      type: 'string',
      validation: Rule => Rule.required()
    },
    {
      name: 'tagline',
      title: 'Tagline',
      type: 'string'
    },
    {
      name: 'description',
      title: 'About / Description',
      type: 'text',
      rows: 4
    },
    {
      name: 'logo',
      title: 'Logo',
      type: 'image'
    },
    {
      name: 'contactEmail',
      title: 'Contact Email',
      type: 'string'
    },
    {
      name: 'phone',
      title: 'Phone',
      type: 'string'
    },
    {
      name: 'address',
      title: 'Address',
      type: 'text',
      rows: 3
    },
    {
      name: 'institutionAffiliation',
      title: 'Institution Affiliation',
      type: 'string',
      description: 'e.g., Western University, London Health Sciences Centre'
    },
    {
      name: 'socialLinks',
      title: 'Social Media Links',
      type: 'object',
      fields: [
        { name: 'twitter', title: 'Twitter/X', type: 'url' },
        { name: 'linkedin', title: 'LinkedIn', type: 'url' },
        { name: 'github', title: 'GitHub', type: 'url' },
        { name: 'youtube', title: 'YouTube', type: 'url' }
      ]
    },
    {
      name: 'pubmedAffiliation',
      title: 'PubMed Affiliation Search Term',
      type: 'string',
      description: 'Used for fetching unit publications, e.g., "Lilibeth Caberto Kidney Clinical Research Unit"'
    }
  ]
}

