/**
 * Therapeutic Area Schema
 * 
 * Categories for classifying trials by clinical focus area.
 * Used for filtering trials and targeting email communications.
 */

import AutoSlugInput from '../components/AutoSlugInput'

const therapeuticArea = {
  name: 'therapeuticArea',
  title: 'Therapeutic Areas',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Therapeutic Area',
      type: 'string',
      validation: Rule => Rule.required(),
      description: 'Canonical label used for study tags and filters.'
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
      name: 'shortLabel',
      title: 'Short Label',
      type: 'string',
      description: 'Abbreviated label for tags (e.g., "GN")'
    },
    {
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 2,
      description: 'Brief description of this therapeutic area'
    },
    {
      name: 'icon',
      title: 'Icon',
      type: 'string',
      description: 'Emoji or icon character (e.g., "🫘")'
    },
    {
      name: 'color',
      title: 'Color',
      type: 'string',
      description: 'Hex color for badges (e.g., "#5d2ea5")'
    },
    {
      name: 'order',
      title: 'Display Order',
      type: 'number',
      description: 'Lower numbers appear first'
    },
    {
      name: 'active',
      title: 'Active',
      type: 'boolean',
      initialValue: true,
      description: 'Whether this area is currently in use'
    }
  ],
  preview: {
    select: {
      title: 'name',
      shortLabel: 'shortLabel',
      icon: 'icon',
      active: 'active'
    },
    prepare({ title, shortLabel, icon, active }) {
      return {
        title: `${icon || ''} ${title || ''}`.trim(),
        subtitle: `${shortLabel || ''} ${active === false ? '(inactive)' : ''}`
      }
    }
  },
  orderings: [
    {
      title: 'Display Order',
      name: 'orderAsc',
      by: [{ field: 'order', direction: 'asc' }]
    },
    {
      title: 'Name',
      name: 'nameAsc',
      by: [{ field: 'name', direction: 'asc' }]
    }
  ]
}

export default therapeuticArea
