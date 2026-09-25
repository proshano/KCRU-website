// Written by /api/social/dispatch and /admin/social. Every field is read-only
// here because the portal and the Buffer lock depend on these values.
const socialPost = {
  name: 'socialPost',
  title: 'Social Media Post',
  type: 'document',
  fields: [
    { name: 'network', title: 'Network', type: 'string', readOnly: true },
    { name: 'guid', title: 'Feed GUID', type: 'string', readOnly: true },
    { name: 'title', title: 'Paper title', type: 'string', readOnly: true },
    { name: 'link', title: 'Paper link', type: 'url', readOnly: true },
    { name: 'journal', title: 'Journal', type: 'string', readOnly: true },
    { name: 'publishedAt', title: 'Publication date', type: 'datetime', readOnly: true },
    { name: 'teamMembers', title: 'Team members', type: 'array', of: [{ type: 'string' }], readOnly: true },
    { name: 'proposedText', title: 'Suggested post text', type: 'text', readOnly: true },
    { name: 'text', title: 'Post text', type: 'text', readOnly: true },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Seeded (already in the feed when posting started)', value: 'seeded' },
          { title: 'Pending approval', value: 'pending' },
          { title: 'Sending to Buffer', value: 'sending' },
          { title: 'Queued in Buffer', value: 'queued' },
          { title: 'Skipped', value: 'skipped' },
        ],
      },
      readOnly: true,
    },
    { name: 'createdAt', title: 'Created', type: 'datetime', readOnly: true },
    { name: 'lastNotifiedAt', title: 'Last notified', type: 'datetime', readOnly: true },
    { name: 'notificationCount', title: 'Notification count', type: 'number', readOnly: true },
    { name: 'approvedBy', title: 'Approved by', type: 'string', readOnly: true },
    { name: 'approvedAt', title: 'Approved at', type: 'datetime', readOnly: true },
    { name: 'skippedBy', title: 'Skipped by', type: 'string', readOnly: true },
    { name: 'skippedAt', title: 'Skipped at', type: 'datetime', readOnly: true },
    { name: 'bufferPostId', title: 'Buffer post ID', type: 'string', readOnly: true },
    { name: 'bufferChannelId', title: 'Buffer channel ID', type: 'string', readOnly: true },
    { name: 'dueAt', title: 'Scheduled by Buffer for', type: 'datetime', readOnly: true },
    { name: 'queuedAt', title: 'Queued at', type: 'datetime', readOnly: true },
    { name: 'lastError', title: 'Last error', type: 'text', readOnly: true },
    { name: 'lastErrorAt', title: 'Last error at', type: 'datetime', readOnly: true },
  ],
  orderings: [
    { title: 'Newest first', name: 'createdAtDesc', by: [{ field: 'createdAt', direction: 'desc' }] },
  ],
  preview: {
    select: { title: 'title', status: 'status' },
    prepare({ title, status }) {
      return { title: title || 'Social media post', subtitle: status || 'pending' }
    },
  },
}

export default socialPost
