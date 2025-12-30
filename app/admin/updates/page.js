import { Suspense } from 'react'
import UpdatesAdminClient from '@/app/updates/admin/UpdatesAdminClient'

export const metadata = {
  title: 'Study Update Admin | KCRU',
  description: 'Manage study update emails and send schedules.',
}

export default function AdminUpdatesPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 py-10">
          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm animate-pulse h-64" />
        </div>
      }
    >
      <UpdatesAdminClient />
    </Suspense>
  )
}
