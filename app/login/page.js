import { headers } from 'next/headers'
import AuthButtons from '@/app/components/AuthButtons'

const DEFAULT_CALLBACK = '/'

function resolveCallbackUrl(value, requestHeaders) {
  if (typeof value === 'string') {
    if (value.startsWith('/') && !value.startsWith('//')) {
      return value === '/login' ? DEFAULT_CALLBACK : value
    }
    try {
      const url = new URL(value)
      const host = requestHeaders.get('host')
      if (host && url.host === host) {
        const path = `${url.pathname}${url.search}${url.hash}` || DEFAULT_CALLBACK
        return path === '/login' ? DEFAULT_CALLBACK : path
      }
      const nextAuthUrl = process.env.NEXTAUTH_URL
      if (nextAuthUrl) {
        const baseUrl = new URL(nextAuthUrl)
        if (url.origin === baseUrl.origin) {
          const path = `${url.pathname}${url.search}${url.hash}` || DEFAULT_CALLBACK
          return path === '/login' ? DEFAULT_CALLBACK : path
        }
      }
    } catch {
      return ''
    }
  }
  return ''
}

export default function LoginPage({ searchParams }) {
  const requestHeaders = headers()
  const callbackUrl =
    resolveCallbackUrl(searchParams?.callbackUrl, requestHeaders) ||
    resolveCallbackUrl(requestHeaders.get('referer'), requestHeaders) ||
    DEFAULT_CALLBACK
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
