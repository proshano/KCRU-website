import { NextResponse } from 'next/server'
import { getAllowedOutboundUrl } from '@/lib/outboundLinks'

export function GET(request) {
  const { searchParams } = new URL(request.url)
  const rawUrl = searchParams.get('url') || searchParams.get('u')
  const target = getAllowedOutboundUrl(rawUrl)

  if (!target) {
    return new NextResponse('Not found', { status: 404 })
  }

  return NextResponse.redirect(target.toString(), 302)
}

export const dynamic = 'force-dynamic'
