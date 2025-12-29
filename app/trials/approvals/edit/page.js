import { Suspense } from 'react'
import ApprovalEditClient from './ApprovalEditClient'

export const metadata = {
  title: 'Edit Submission | KCRU',
  description: 'Edit a pending study submission before approval.',
}

export default function ApprovalEditPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 py-10">
          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm animate-pulse h-64" />
        </div>
      }
    >
      <ApprovalEditClient />
    </Suspense>
  )
}
