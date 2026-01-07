import { getServerSession } from 'next-auth/next'
import { redirect } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import AuthButtons from '@/app/components/AuthButtons'

export default async function ProtectedPage() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.email) {
    redirect('/login')
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold text-[#333]">Protected area</h1>
      <p className="mt-4 text-base text-[#555]">
        You are signed in as {session.user.name || session.user.email}.
      </p>
      <div className="mt-6">
        <AuthButtons />
      </div>
    </div>
  )
}
