import { NextResponse } from 'next/server'

export default async function proxy(request) {
  const isAuthenticated = request.cookies.get('site-auth')?.value === 'authenticated'
  const pathname = request.nextUrl.pathname
  const allowlistedPaths = new Set(['/llms.txt', '/sitemap.xml', '/robots.txt'])
  const isMarkdown = pathname.endsWith('.md') || pathname.startsWith('/markdown/')
  const isAllowlisted = allowlistedPaths.has(pathname) || isMarkdown

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
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
