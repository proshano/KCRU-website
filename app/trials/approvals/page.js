import { Suspense } from 'react'
import ApprovalClient from './ApprovalClient'

export const metadata = {
  title: 'Study Approvals | KCRU',
  description: 'Approve or reject study submissions.',
}

export default function TrialsApprovalsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 py-10">
          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm animate-pulse h-64" />
        </div>
      }
    >
      <ApprovalClient />
    </Suspense>
  )
}
