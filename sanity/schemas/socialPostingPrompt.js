// Singleton at fixed _id "socialPostingPrompt". Edited only at /admin/social, so it is
// separate from siteSettings: a portal save must never collide with an unrelated Studio
// draft of siteSettings. Every field is read-only in Studio for that same reason.
const socialPostingPrompt = {
  name: 'socialPostingPrompt',
  title: 'Social Post Drafting Prompt',
  type: 'document',
  fields: [
    {
      name: 'systemPrompt',
      title: 'System prompt',
      type: 'text',
      readOnly: true,
      description: 'Edited at /admin/social',
    },
    {
      name: 'updatedBy',
      title: 'Updated by',
      type: 'string',
      readOnly: true,
      description: 'Edited at /admin/social',
    },
    {
      name: 'updatedAt',
      title: 'Updated at',
      type: 'datetime',
      readOnly: true,
      description: 'Edited at /admin/social',
    },
  ],
  preview: {
    select: { updatedBy: 'updatedBy', updatedAt: 'updatedAt' },
    prepare({ updatedBy, updatedAt }) {
      return {
        title: 'Social Post Drafting Prompt',
        subtitle: updatedBy ? `Last changed by ${updatedBy} on ${updatedAt || 'unknown date'}` : 'Using the default prompt',
      }
    },
  },
}

export default socialPostingPrompt
