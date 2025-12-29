import { ROLE_OPTIONS, TOPIC_OPTIONS } from '../../lib/communicationOptions'

const STATUS_OPTIONS = [
  { title: 'Active', value: 'active' },
  { title: 'Unsubscribed', value: 'unsubscribed' }
]

const SOURCE_OPTIONS = [
  { title: 'Self signup', value: 'self' },
  { title: 'Admin entry', value: 'admin' }
]

const TOPIC_LABELS = new Map(TOPIC_OPTIONS.map((topic) => [topic.value, topic.title]))

function createToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `token_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
}

function formatList(values = []) {
  if (!Array.isArray(values) || values.length === 0) return 'No preferences'
  return values.map((value) => TOPIC_LABELS.get(value) || value).join(', ')
}

export default {
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
      name: 'roles',
      title: 'Roles',
      type: 'array',
      of: [{ type: 'string' }],
      options: { list: ROLE_OPTIONS },
      validation: (Rule) => Rule.required().min(1)
    },
    {
      name: 'therapeuticAreas',
      title: 'Therapeutic Areas',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'therapeuticArea' }] }],
      validation: (Rule) => Rule.required().min(1)
    },
    {
      name: 'topics',
      title: 'Updates',
      type: 'array',
      of: [{ type: 'string' }],
      options: { list: TOPIC_OPTIONS },
      validation: (Rule) => Rule.required().min(1)
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: { list: STATUS_OPTIONS },
      initialValue: 'active'
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
      status: 'status',
      topics: 'topics',
      updatedAt: 'updatedAt'
    },
    prepare({ name, email, status, topics, updatedAt }) {
      const title = name || email || 'Unnamed subscriber'
      const date = updatedAt ? new Date(updatedAt).toLocaleDateString() : 'never updated'
      return {
        title,
        subtitle: `${email || 'no email'} • ${status || 'unknown'} • ${formatList(topics)} • ${date}`
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
