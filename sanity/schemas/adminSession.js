const adminSession = {
  name: 'adminSession',
  title: 'Admin Sessions',
  type: 'document',
  fields: [
    {
      name: 'email',
      title: 'Email',
      type: 'string'
    },
    {
      name: 'token',
      title: 'Token',
      type: 'string'
    },
    {
      name: 'codeHash',
      title: 'Code Hash',
      type: 'string'
    },
    {
      name: 'codeExpiresAt',
      title: 'Code Expires At',
      type: 'datetime'
    },
    {
      name: 'codeUsedAt',
      title: 'Code Used At',
      type: 'datetime'
    },
    {
      name: 'createdAt',
      title: 'Created At',
      type: 'datetime'
    },
    {
      name: 'expiresAt',
      title: 'Expires At',
      type: 'datetime'
    },
    {
      name: 'revoked',
      title: 'Revoked',
      type: 'boolean',
      initialValue: false
    }
  ],
  preview: {
    select: {
      email: 'email',
      expiresAt: 'expiresAt',
      revoked: 'revoked'
    },
    prepare({ email, expiresAt, revoked }) {
      const date = expiresAt ? new Date(expiresAt).toLocaleString() : 'no expiry'
      return {
        title: email || 'Unknown admin',
        subtitle: `${revoked ? 'revoked' : 'active'} - expires ${date}`
      }
    }
  },
  orderings: [
    {
      title: 'Created At (desc)',
      name: 'createdAtDesc',
      by: [{ field: 'createdAt', direction: 'desc' }]
    }
  ]
}

export default adminSession
