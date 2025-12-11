import { NextResponse } from 'next/server'
import { requestCancel, getLockInfo, clearLock } from '@/lib/pubmedCache'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN || ''

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  if (AUTH_TOKEN) {
    const token = extractToken(request)
    if (token !== AUTH_TOKEN) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
    }
  }

  try {
    await requestCancel()
    await clearLock()
    const lock = await getLockInfo()
    return NextResponse.json({
      ok: true,
      message: 'Cancellation requested and lock cleared',
      lock,
    }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[pubmed] cancel endpoint failed', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Cancel failed' }, { status: 500, headers: CORS_HEADERS })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
