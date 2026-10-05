import { NextResponse } from 'next/server'

// The maintenance flag changes rarely and /api/maintenance already caches it for 60
// seconds, so one lookup per instance per minute is as fresh as the route itself and
// spares every other page view the extra round trip. Only a successful answer is kept:
// a failed check lets the request through as before and the next request asks again.
const MAINTENANCE_CACHE_MS = 60 * 1000
let maintenanceState = { enabled: false, checkedAt: 0 }
let maintenancePending = null

// Returns true/false, or null when the route could not answer (non-OK or non-JSON,
// which happens on preview deployments); network errors propagate to the caller.
async function fetchMaintenanceEnabled(origin) {
  const response = await fetch(`${origin}/api/maintenance`, {
    method: 'GET',
    headers: {
      'x-middleware-request': 'true'
    }
  })

  if (!response.ok) {
    console.warn('Maintenance check returned non-OK response', response.status)
    return null
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('application/json')) {
    console.warn('Maintenance check returned non-JSON response')
    return null
  }

  const { enabled } = await response.json()
  return Boolean(enabled)
}

async function isMaintenanceEnabled(origin) {
  if (Date.now() - maintenanceState.checkedAt < MAINTENANCE_CACHE_MS) {
    return maintenanceState.enabled
  }

  if (!maintenancePending) {
    maintenancePending = fetchMaintenanceEnabled(origin)
      .then((enabled) => {
        if (enabled !== null) maintenanceState = { enabled, checkedAt: Date.now() }
        return enabled
      })
      .finally(() => {
        maintenancePending = null
      })
  }

  const enabled = await maintenancePending
  return enabled === true
}

export default async function proxy(request) {
  const isAuthenticated = request.cookies.get('site-auth')?.value === 'authenticated'
  const pathname = request.nextUrl.pathname
  const allowlistedPaths = new Set(['/llms.txt', '/sitemap.xml', '/robots.txt'])
  const isMarkdown = pathname.endsWith('.md') || pathname.startsWith('/markdown/')
  const isAllowlisted = allowlistedPaths.has(pathname) || isMarkdown

  if (pathname.endsWith('.md') && !pathname.startsWith('/markdown/')) {
    const target = new URL(`/markdown${pathname}`, request.url)
    return NextResponse.rewrite(target)
  }

  if (
    pathname === '/under-construction' ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    isAllowlisted
  ) {
    return NextResponse.next()
  }

  if (isAuthenticated) {
    return NextResponse.next()
  }

  try {
    if (await isMaintenanceEnabled(request.nextUrl.origin)) {
      return NextResponse.redirect(new URL('/under-construction', request.url))
    }
  } catch (error) {
    console.error('Error checking maintenance mode:', error)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:avif|bmp|css|eot|gif|ico|jpe?g|js|json|map|md|otf|png|svg|ttf|txt|webmanifest|webp|woff2?|xml)$).*)',
    '/:path*.md'
  ]
}
