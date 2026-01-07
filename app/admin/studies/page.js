import { Suspense } from 'react'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import AuthButtons from '@/app/components/AuthButtons'
import { authOptions } from '@/lib/auth'
import StudyManagerClient from '@/app/trials/manage/StudyManagerClient'

export const metadata = {
  title: 'Study Manager | KCRU',
  description: 'Admin access to create and publish studies.',
}

export default async function AdminStudiesPage() {
  const session = await getServerSession(authOptions)
  const access = session?.user?.access

  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/admin/studies')
  }

  if (!access?.admin) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-[#333]">Access restricted</h1>
        <p className="mt-4 text-base text-[#555]">
          Your account does not have admin access.
        </p>
        <div className="mt-6">
          <AuthButtons signInCallbackUrl="/admin/studies" signOutCallbackUrl="/login" />
        </div>
      </div>
    )
  }

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
