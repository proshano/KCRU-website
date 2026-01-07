"use client"

import { signIn, signOut, useSession } from 'next-auth/react'

export default function AuthButtons({
  className = '',
  signInCallbackUrl = '/',
  signOutCallbackUrl = '/'
}) {
  const { data: session, status } = useSession()
  const isLoading = status === 'loading'
  const isSignedIn = Boolean(session?.user?.email)

  return (
    <div className={`flex flex-wrap items-center gap-3 ${className}`.trim()}>
      {isSignedIn ? (
        <>
          <span className="text-sm text-[#555]">
            Signed in as {session.user.name || session.user.email}
          </span>
          <button
            type="button"
            className="rounded-md border border-purple px-4 py-2 text-sm font-semibold text-purple transition hover:bg-purple/10 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => signOut({ callbackUrl: signOutCallbackUrl })}
            disabled={isLoading}
          >
            Sign out
          </button>
        </>
      ) : (
          <button
            type="button"
            className="rounded-md bg-purple px-4 py-2 text-sm font-semibold text-white transition hover:bg-purple/90 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => signIn('azure-ad', { callbackUrl: signInCallbackUrl })}
            disabled={isLoading}
          >
            Sign in with LHSC
          </button>
      )}
    </div>
  )
}
