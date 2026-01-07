import Link from 'next/link'
import AuthButtons from '@/app/components/AuthButtons'

export default function LoginPage({ searchParams }) {
  const callbackUrl =
    typeof searchParams?.callbackUrl === 'string' && searchParams.callbackUrl
      ? searchParams.callbackUrl
      : '/protected'
  const errorMessage =
    searchParams?.error === 'AccessDenied'
      ? 'Your account is not on the allowlist. Contact the site administrator if you need access.'
      : null

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold text-[#333]">Sign in</h1>
      <p className="mt-4 text-base text-[#555]">
        Use your LHSC Microsoft account to access protected pages.
      </p>
      {errorMessage && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}
      <div className="mt-6">
        <AuthButtons signInCallbackUrl={callbackUrl} signOutCallbackUrl="/" />
      </div>
      <p className="mt-6 text-sm text-[#777]">
        After signing in, visit <Link href="/protected" className="underline">the protected page</Link>.
      </p>
    </div>
  )
}
