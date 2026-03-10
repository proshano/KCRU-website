import { NextResponse } from 'next/server'

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
    const response = await fetch(`${request.nextUrl.origin}/api/maintenance`, {
      method: 'GET',
      headers: {
        'x-middleware-request': 'true'
      }
    })

    if (!response.ok) {
      console.warn('Maintenance check returned non-OK response', response.status)
      return NextResponse.next()
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.toLowerCase().includes('application/json')) {
      console.warn('Maintenance check returned non-JSON response')
      return NextResponse.next()
    }

    const { enabled } = await response.json()

    if (enabled) {
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
