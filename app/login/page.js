import AuthButtons from '@/app/components/AuthButtons'

export default function LoginPage({ searchParams }) {
  const callbackUrl =
    typeof searchParams?.callbackUrl === 'string' && searchParams.callbackUrl
      ? searchParams.callbackUrl
      : '/'
  const errorMessage =
    searchParams?.error === 'AccessDenied'
      ? 'Your account is not on the allowlist. Contact the site administrator if you need access.'
      : null

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold text-[#333]">Sign in</h1>
      <p className="mt-4 text-base text-[#555]">
        Use your LHSC account to access coordinator and admin tools.
      </p>
      {errorMessage && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </p>
      )}
      <div className="mt-6">
        <AuthButtons signInCallbackUrl={callbackUrl} signOutCallbackUrl="/" />
      </div>
    </div>
  )
}
