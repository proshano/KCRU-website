import { ROLE_OPTIONS, SPECIALTY_OPTIONS, CORRESPONDENCE_OPTIONS } from '../../lib/communicationOptions'

const SUBSCRIPTION_STATUS_OPTIONS = [
  { title: 'Subscribed', value: 'subscribed' },
  { title: 'Unsubscribed', value: 'unsubscribed' }
]

const DELIVERY_STATUS_OPTIONS = [
  { title: 'Active', value: 'active' },
  { title: 'Suppressed', value: 'suppressed' }
]

const SOURCE_OPTIONS = [
  { title: 'Self signup', value: 'self' },
  { title: 'Admin entry', value: 'admin' }
]

function createToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `token_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function formatList(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 'No preferences'
  return values.map((value) => value || '').filter(Boolean).join(', ')
}

const updateSubscriber = {
  name: 'updateSubscriber',
  title: 'Update Subscribers',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Name',
      type: 'string'
    },
    {
      name: 'email',
      title: 'Email',
      type: 'string',
      validation: (Rule) => Rule.required().email()
    },
    {
      name: 'role',
      title: 'Role',
      type: 'string',
      options: { list: ROLE_OPTIONS },
      validation: (Rule) => Rule.required()
    },
    {
      name: 'specialty',
      title: 'Specialty',
      type: 'string',
      options: { list: SPECIALTY_OPTIONS }
    },
    {
      name: 'practiceSites',
      title: 'Location of practice',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'site' }] }],
      options: { filter: 'active == true' }
    },
    {
      name: 'allTherapeuticAreas',
      title: 'All Therapeutic Areas',
      type: 'boolean',
      description: 'If enabled, the subscriber receives updates for all therapeutic areas.'
    },
    {
      name: 'interestAreas',
      title: 'Therapeutic/Interest Areas',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'therapeuticArea' }] }],
      options: { filter: 'active == true' },
      validation: (Rule) =>
        Rule.custom((value, context) => {
          const wantsStudyUpdates = Array.isArray(context?.document?.correspondencePreferences)
            && context.document.correspondencePreferences.includes('study_updates')
          if (!wantsStudyUpdates) return true
          if (context?.document?.allTherapeuticAreas) return true
          if (!Array.isArray(value) || value.length === 0) {
            return 'Select at least one interest area or enable all areas.'
          }
          return true
        })
    },
    {
      name: 'correspondencePreferences',
      title: 'Correspondence Preferences',
      type: 'array',
      of: [{ type: 'string' }],
      options: { list: CORRESPONDENCE_OPTIONS },
      validation: (Rule) => Rule.required().min(1)
    },
    {
      name: 'subscriptionStatus',
      title: 'Subscription Status',
      type: 'string',
      options: { list: SUBSCRIPTION_STATUS_OPTIONS },
      initialValue: 'subscribed',
      validation: (Rule) => Rule.required()
    },
    {
      name: 'deliveryStatus',
      title: 'Delivery Status',
      type: 'string',
      options: { list: DELIVERY_STATUS_OPTIONS },
      initialValue: 'active',
      validation: (Rule) => Rule.required(),
      hidden: ({ parent }) => parent?.subscriptionStatus === 'unsubscribed'
    },
    {
      name: 'source',
      title: 'Source',
      type: 'string',
      options: { list: SOURCE_OPTIONS },
      initialValue: 'admin'
    },
    {
      name: 'notes',
      title: 'Notes',
      type: 'text',
      rows: 3
    },
    {
      name: 'manageToken',
      title: 'Manage Token',
      type: 'string',
      readOnly: true,
      initialValue: () => createToken(),
      description: 'Used to build the preference management link.'
    },
    {
      name: 'createdAt',
      title: 'Created At',
      type: 'datetime',
      readOnly: true,
      initialValue: () => new Date().toISOString()
    },
    {
      name: 'updatedAt',
      title: 'Updated At',
      type: 'datetime',
      readOnly: true
    },
    {
      name: 'lastStudyUpdateSentAt',
      title: 'Last Study Update Sent',
      type: 'datetime',
      readOnly: true
    },
    {
      name: 'lastPublicationNewsletterSentAt',
      title: 'Last Publication Newsletter Sent',
      type: 'datetime',
      readOnly: true
    },
    {
      name: 'lastNewsletterSentAt',
      title: 'Last Newsletter Sent',
      type: 'datetime',
      readOnly: true
    },
    {
      name: 'unsubscribedAt',
      title: 'Unsubscribed At',
      type: 'datetime',
      readOnly: true
    },
    {
      name: 'consent',
      title: 'Consent',
      type: 'object',
      fields: [
        { name: 'source', title: 'Source', type: 'string' },
        { name: 'timestamp', title: 'Timestamp', type: 'datetime' },
        { name: 'ip', title: 'IP', type: 'string' },
        { name: 'userAgent', title: 'User agent', type: 'string' },
        { name: 'recaptchaScore', title: 'reCAPTCHA score', type: 'number' }
      ]
    }
  ],
  preview: {
    select: {
      name: 'name',
      email: 'email',
      subscriptionStatus: 'subscriptionStatus',
      deliveryStatus: 'deliveryStatus',
      interestAreas: 'interestAreas[]->name',
      allTherapeuticAreas: 'allTherapeuticAreas',
      updatedAt: 'updatedAt'
    },
    prepare({ name, email, subscriptionStatus, deliveryStatus, interestAreas, allTherapeuticAreas, updatedAt }) {
      const title = name || email || 'Unnamed subscriber'
      const date = updatedAt ? new Date(updatedAt).toLocaleDateString() : 'never updated'
      const statusLabel =
        subscriptionStatus === 'unsubscribed'
          ? 'unsubscribed'
          : deliveryStatus || subscriptionStatus || 'unknown'
      const interestLabel = allTherapeuticAreas ? 'All areas' : formatList(interestAreas)
      return {
        title,
        subtitle: `${email || 'no email'} • ${statusLabel} • ${interestLabel} • ${date}`
      }
    }
  },
  orderings: [
    {
      title: 'Updated At (desc)',
      name: 'updatedAtDesc',
      by: [{ field: 'updatedAt', direction: 'desc' }]
    },
    {
      title: 'Email',
      name: 'emailAsc',
      by: [{ field: 'email', direction: 'asc' }]
    }
  ]
}

export default updateSubscriber
