import ApprovalClient from './ApprovalClient'

export const metadata = {
  title: 'Study Approvals | KCRU',
  description: 'Approve or reject study submissions.',
}

export default function TrialsApprovalsPage() {
  return <ApprovalClient />
}
