import { Suspense } from 'react'
import StudyManagerClient from '@/app/trials/manage/StudyManagerClient'

export const metadata = {
  title: 'Study Manager | KCRU',
  description: 'Admin access to create and publish studies.',
}

export default function AdminStudiesPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 py-10">
          <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm animate-pulse h-64" />
        </div>
      }
    >
      <StudyManagerClient adminMode />
    </Suspense>
  )
}
