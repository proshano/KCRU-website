const contactRouting = {
  name: 'contactRouting',
  title: 'Contact Routing & Emails',
  type: 'document',
  __experimental_actions: ['update', 'publish'], // singleton
  fields: [
    {
      name: 'options',
      title: 'Contact reasons (with routing)',
      type: 'array',
      validation: (Rule) => Rule.required().min(1),
      of: [
        {
          type: 'object',
          fields: [
            {
              name: 'key',
              title: 'Key',
              type: 'string',
              description: 'Stable key used in the app (e.g., referral, industry, training, donation, website-feedback). Use website-feedback for Privacy/Accessibility links.',
              validation: (Rule) => Rule.required().regex(/^[a-z0-9-]+$/, {
                name: 'slug',
                invert: false,
              }),
            },
            {
              name: 'label',
              title: 'Label',
              type: 'string',
              validation: (Rule) => Rule.required(),
            },
            {
              name: 'description',
              title: 'Short description (optional)',
              type: 'text',
              rows: 2,
            },
            {
              name: 'email',
              title: 'Target email',
              type: 'string',
              validation: (Rule) => Rule.required().email(),
            },
            {
              name: 'showOceanLink',
              title: 'Use OceanMD referral link (no message box)',
              type: 'boolean',
              initialValue: false,
              description: 'If enabled, the form will show the OceanMD link instead of a message box.',
            },
            {
              name: 'oceanUrl',
              title: 'OceanMD referral link',
              type: 'url',
              hidden: ({ parent }) => !parent?.showOceanLink,
            },
            {
              name: 'messagePlaceholder',
              title: 'Message placeholder (optional)',
              type: 'string',
            },
            {
              name: 'successMessage',
              title: 'Custom success message (optional)',
              type: 'string',
            },
          ],
        },
      ],
    },
  ],
  preview: {
    select: {
      options: 'options'
    },
    prepare: ({ options }) => {
      const items = Array.isArray(options) ? options : []
      const count = items.length
      const labels = items
        .map((o) => o?.label)
        .filter(Boolean)
        .slice(0, 3)
      const labelPreview = labels.join(', ')
      return {
        title: 'Contact Routing & Emails',
        subtitle: count
          ? `${count} reason${count === 1 ? '' : 's'}${labelPreview ? `: ${labelPreview}${count > 3 ? '…' : ''}` : ''}`
          : 'No reasons configured'
      }
    }
  }
}

export default contactRouting
