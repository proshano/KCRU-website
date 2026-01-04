import AdminPasswordInput from '../components/AdminPasswordInput'

const adminCredential = {
  name: 'adminCredential',
  title: 'Admin Credentials',
  type: 'document',
  fields: [
    {
      name: 'email',
      title: 'Admin Email',
      type: 'string',
      validation: Rule =>
        Rule.required().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, { name: 'email' })
    },
    {
      name: 'passwordHash',
      title: 'Admin Password',
      type: 'string',
      description: 'Set or replace the admin password hash for this email.',
      components: {
        input: AdminPasswordInput
      }
    },
    {
      name: 'disabled',
      title: 'Disabled',
      type: 'boolean',
      description: 'Disable password sign-in for this email.',
      initialValue: false
    }
  ],
  preview: {
    select: {
      email: 'email',
      disabled: 'disabled',
      passwordHash: 'passwordHash'
    },
    prepare({ email, disabled, passwordHash }) {
      const status = disabled ? 'disabled' : 'active'
      const passwordStatus = passwordHash ? 'password set' : 'no password'
      return {
        title: email || 'Unknown admin',
        subtitle: `${status} · ${passwordStatus}`
      }
    }
  }
}

export default adminCredential
