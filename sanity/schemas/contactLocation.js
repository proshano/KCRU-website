const contactLocation = {
  name: 'contactLocation',
  title: 'Locations',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton
  fields: [
    {
      name: 'locations',
      title: 'Locations',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            {
              name: 'name',
              title: 'Location name',
              type: 'string',
              validation: (Rule) => Rule.required()
            },
            {
              name: 'address',
              title: 'Address',
              type: 'text',
              rows: 3
            },
            {
              name: 'phone',
              title: 'Phone',
              type: 'string'
            },
            {
              name: 'fax',
              title: 'Fax',
              type: 'string'
            },
            {
              name: 'email',
              title: 'Email',
              type: 'string',
              validation: (Rule) => Rule.optional().email()
            },
            {
              name: 'note',
              title: 'Note',
              type: 'string',
              description: 'e.g., Hours, building info, or contact instructions'
            },
            {
              name: 'mapUrl',
              title: 'Map or directions link',
              type: 'url'
            }
          ]
        }
      ]
    }
  ],
  preview: {
    select: { locations: 'locations' },
    prepare: ({ locations }) => {
      const items = Array.isArray(locations) ? locations : []
      const count = items.length
      const names = items.map((l) => l?.name).filter(Boolean).slice(0, 3)
      const subtitle = count
        ? `${count} location${count === 1 ? '' : 's'}${names.length ? `: ${names.join(', ')}${count > 3 ? '…' : ''}` : ''}`
        : 'No locations configured'
      return {
        title: 'Locations',
        subtitle
      }
    }
  }
}

export default contactLocation
