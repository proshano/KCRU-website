import { Suspense } from 'react'
import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import AuthButtons from '@/app/components/AuthButtons'
import AuthSessionProvider from '@/app/components/AuthSessionProvider'
import { authOptions } from '@/lib/auth'
import ResearchDigestAdminClient from './ResearchDigestAdminClient'

export const metadata = {
  title: 'Research Digest Review | KCRU',
  description: 'Review and send the KCRU kidney research digest.',
}

export default async function ResearchDigestAdminPage() {
  const session = await getServerSession(authOptions)
  const access = session?.user?.access

  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/admin/research-digest')
  }

  const content = !access?.admin && !access?.updates ? (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-[#333]">Access restricted</h1>
      <p className="mt-4 text-base text-[#555]">
        Your account does not have access to update email tools.
      </p>
      <div className="mt-6">
        <AuthButtons signInCallbackUrl="/admin/research-digest" signOutCallbackUrl="/login" />
      </div>
    </div>
  ) : (
    <Suspense
      fallback={
        <div className="max-w-[1400px] mx-auto px-6 md:px-12 py-10">
          <div className="bg-white border border-black/5 p-5 md:p-6 shadow-sm animate-pulse h-64" />
        </div>
      }
    >
      <ResearchDigestAdminClient />
    </Suspense>
  )

  return (
    <AuthSessionProvider>
      {content}
    </AuthSessionProvider>
  )
}
