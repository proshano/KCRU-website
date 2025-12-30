const contactSubmission = {
  name: 'contactSubmission',
  title: 'Contact Submission',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'email',
      title: 'Contact email',
      type: 'string',
      validation: (Rule) => Rule.required().email(),
    },
    {
      name: 'reasonKey',
      title: 'Reason key',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'reasonLabel',
      title: 'Reason label',
      type: 'string',
    },
    {
      name: 'message',
      title: 'Message / notes',
      type: 'text',
      rows: 6,
    },
    {
      name: 'oceanUrl',
      title: 'OceanMD referral link used',
      type: 'url',
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'New', value: 'new' },
          { title: 'In review', value: 'in_review' },
          { title: 'Closed', value: 'closed' },
        ],
      },
      initialValue: 'new',
    },
    {
      name: 'submittedAt',
      title: 'Submitted at',
      type: 'datetime',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'meta',
      title: 'Meta',
      type: 'object',
      fields: [
        { name: 'ip', title: 'IP', type: 'string' },
        { name: 'userAgent', title: 'User agent', type: 'string' },
      ],
    },
  ],
}

export default contactSubmission

