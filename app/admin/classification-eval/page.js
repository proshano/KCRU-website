import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'

import AuthButtons from '@/app/components/AuthButtons'
import AuthSessionProvider from '@/app/components/AuthSessionProvider'
import { authOptions } from '@/lib/auth'
import ClassificationEvalClient from './ClassificationEvalClient'

export const metadata = {
  title: 'Classification Evaluation | KCRU',
  description: 'Compare the Jev decision model against the current publication classifier.',
}

export default async function ClassificationEvalPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/admin/classification-eval')
  }

  const content = !session?.user?.access?.approvals ? (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-[#333]">Access restricted</h1>
      <p className="mt-4 text-base text-[#555]">
        Your account does not have publication approval access.
      </p>
      <div className="mt-6">
        <AuthButtons signInCallbackUrl="/admin/classification-eval" signOutCallbackUrl="/login" />
      </div>
    </div>
  ) : <ClassificationEvalClient />

  return <AuthSessionProvider>{content}</AuthSessionProvider>
}
