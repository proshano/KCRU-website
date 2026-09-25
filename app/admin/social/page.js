import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'

import AuthButtons from '@/app/components/AuthButtons'
import AuthSessionProvider from '@/app/components/AuthSessionProvider'
import { authOptions } from '@/lib/auth'
import SocialPostsClient from './SocialPostsClient'

export const metadata = {
  title: 'Social Media Posts | KCRU',
  description: 'Approve, edit or skip X posts about new publications.',
}

export default async function SocialPostsPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/admin/social')
  }

  const content = !session?.user?.access?.approvals ? (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold text-[#333]">Access restricted</h1>
      <p className="mt-4 text-base text-[#555]">
        Your account does not have publication approval access.
      </p>
      <div className="mt-6">
        <AuthButtons signInCallbackUrl="/admin/social" signOutCallbackUrl="/login" />
      </div>
    </div>
  ) : <SocialPostsClient />

  return <AuthSessionProvider>{content}</AuthSessionProvider>
}
