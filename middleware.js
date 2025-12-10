import { NextResponse } from 'next/server'

export async function middleware(request) {
  const isAuthenticated = request.cookies.get('site-auth')?.value === 'authenticated'

  if (
    request.nextUrl.pathname === '/under-construction' ||
    request.nextUrl.pathname.startsWith('/_next') ||
    request.nextUrl.pathname.startsWith('/api')
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
