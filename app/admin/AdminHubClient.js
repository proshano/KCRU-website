'use client'

import Link from 'next/link'
import { useSession } from 'next-auth/react'
import AuthButtons from '@/app/components/AuthButtons'

const EMPTY_ACCESS = {
  admin: false,
  approvals: false,
  updates: false,
  coordinator: false,
}

const MODULES = [
  {
    key: 'approvals',
    title: 'Study approvals',
    description: 'Review study submissions and approve changes before they go live.',
    href: '/admin/approvals',
    actionLabel: 'Open approvals',
  },
  {
    key: 'studies',
    accessKey: 'approvals',
    title: 'Study manager',
    description: 'Create and edit studies directly (publishes immediately for approval admins).',
    href: '/admin/studies',
    actionLabel: 'Open study manager',
  },
  {
    key: 'updates',
    title: 'Study update emails',
    description: 'Manage study update emails, publication newsletters, and send schedules.',
    href: '/admin/updates',
    actionLabel: 'Open updates',
  },
]

export default function AdminHubClient() {
  const { data: session, status } = useSession()
  const access = session?.user?.access || EMPTY_ACCESS
  const isLoading = status === 'loading'
  const isSignedIn = Boolean(session?.user?.email)
  const hasAdminAccess = Boolean(access.admin)

  return (
    <main className="max-w-[1400px] mx-auto px-6 md:px-12 py-10 space-y-8">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-purple uppercase tracking-wide">Admin Portal</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Admin Hub</h1>
        <p className="text-gray-600 max-w-2xl">
          Sign in with your LHSC account to access admin tools.
        </p>
      </header>

      {isLoading && (
        <div className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm animate-pulse h-32" />
      )}

      {!isSignedIn && !isLoading && (
        <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4 max-w-xl">
          <div>
            <h2 className="text-lg font-semibold">Admin access</h2>
            <p className="text-sm text-gray-500">
              Use your LHSC account to continue.
            </p>
          </div>
          <AuthButtons signInCallbackUrl="/admin" signOutCallbackUrl="/login" />
        </section>
      )}

      {isSignedIn && !hasAdminAccess && (
        <section className="bg-white border border-black/5 rounded-xl p-5 md:p-6 shadow-sm space-y-4 max-w-xl">
          <div>
            <h2 className="text-lg font-semibold">Access restricted</h2>
            <p className="text-sm text-gray-500">
              Your account does not have admin access. Contact the site administrator if you need access.
            </p>
          </div>
          <AuthButtons signInCallbackUrl="/admin" signOutCallbackUrl="/login" />
        </section>
      )}

      {isSignedIn && hasAdminAccess && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Available admin tools</h2>
              <p className="text-sm text-gray-500">
                {session?.user?.email ? `Signed in as ${session.user.email}.` : 'Signed in.'}
              </p>
            </div>
            <AuthButtons signInCallbackUrl="/admin" signOutCallbackUrl="/login" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {MODULES.map((module) => {
              const accessKey = module.accessKey || module.key
              const allowed = Boolean(access.admin || access[accessKey])
              return (
                <article
                  key={module.key}
                  className={`border border-black/5 rounded-xl p-5 md:p-6 shadow-sm ${
                    allowed ? 'bg-white' : 'bg-gray-50 text-gray-500'
                  }`}
                >
                  <div className="space-y-2">
                    <h3 className={`text-xl font-semibold ${allowed ? 'text-gray-900' : 'text-gray-500'}`}>
                      {module.title}
                    </h3>
                    <p className="text-sm">{module.description}</p>
                  </div>
                  <div className="mt-4">
                    {allowed ? (
                      <Link
                        href={module.href}
                        className="inline-flex items-center justify-center bg-purple text-white px-4 py-2 rounded shadow hover:bg-purple/90"
                      >
                        {module.actionLabel}
                      </Link>
                    ) : (
                      <span className="text-xs uppercase tracking-wide text-gray-400">No access</span>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}
    </main>
  )
}
