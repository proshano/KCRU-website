/**
 * Therapeutic Area Schema
 * 
 * Categories for classifying trials by clinical focus area.
 * Used for filtering trials and targeting email communications.
 */

import AutoSlugInput from '../components/AutoSlugInput'

export default {
  name: 'therapeuticArea',
  title: 'Therapeutic Areas',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: Rule => Rule.required(),
      description: 'Full name (e.g., "Glomerulonephritis")'
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
      name: 'targetRoles',
      title: 'Target Clinician Roles',
      type: 'array',
      of: [{ type: 'string' }],
      options: {
        list: [
          // General Nephrology
          { title: 'Nephrologist', value: 'nephrologist' },
          { title: 'Nephrology Fellow', value: 'fellow_nephrology' },
          { title: 'Nurse Practitioner', value: 'nurse_practitioner' },
          // Transplant
          { title: 'Transplant Nephrologist', value: 'transplant_nephrologist' },
          { title: 'Transplant Fellow', value: 'fellow_transplant' },
          { title: 'Transplant Clinic Nurse', value: 'nurse_transplant' },
          // GN Clinic
          { title: 'GN Clinic Nephrologist', value: 'nephrologist_gn' },
          { title: 'GN Fellow', value: 'fellow_gn' },
          { title: 'GN Clinic Nurse', value: 'nurse_gn' },
          { title: 'GN Clinic Pharmacist', value: 'pharmacist_gn' },
          // Dialysis
          { title: 'Dialysis Nurse', value: 'nurse_dialysis' },
          // Other
          { title: 'Pharmacist', value: 'pharmacist' },
          { title: 'Dietitian', value: 'dietitian' },
          { title: 'Social Worker', value: 'social_worker' },
          { title: 'Surgeon', value: 'surgeon' }
        ]
      },
      description: 'Which clinician roles should receive emails about trials in this area?'
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
        title: `${icon || ''} ${title}`,
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
