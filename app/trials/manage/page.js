import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import AuthButtons from '@/app/components/AuthButtons'
import { authOptions } from '@/lib/auth'
import StudyManagerClient from './StudyManagerClient'

export const metadata = {
  title: 'Study Coordinator | KCRU',
  description: 'Coordinator-facing study manager for adding and editing active studies.',
}

export default async function TrialsManagePage() {
  const session = await getServerSession(authOptions)
  const access = session?.user?.access

  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/trials/manage')
  }

  if (!access?.coordinator) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-2xl font-semibold text-[#333]">Access restricted</h1>
        <p className="mt-4 text-base text-[#555]">
          Your account does not have coordinator access.
        </p>
        <div className="mt-6">
          <AuthButtons signInCallbackUrl="/trials/manage" signOutCallbackUrl="/login" />
        </div>
      </div>
    )
  }

  return <StudyManagerClient />
}
