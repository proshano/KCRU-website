import { Suspense } from 'react'
import AdminHubClient from './AdminHubClient'

export const metadata = {
  title: 'Admin Hub | KCRU',
  description: 'Access KCRU admin tools with a single sign-in.',
}

export default function AdminHubPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 py-10">
          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm animate-pulse h-64" />
        </div>
      }
    >
      <AdminHubClient />
    </Suspense>
  )
}
