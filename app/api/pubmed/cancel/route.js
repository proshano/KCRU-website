import { NextResponse } from 'next/server'
import { requestCancel, getLockInfo } from '@/lib/pubmedCache'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN || ''

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

export async function POST(request) {
  if (AUTH_TOKEN) {
    const token = extractToken(request)
    if (token !== AUTH_TOKEN) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    await requestCancel()
    const lock = await getLockInfo()
    return NextResponse.json({
      ok: true,
      message: 'Cancellation requested',
      lock,
    })
  } catch (err) {
    console.error('[pubmed] cancel endpoint failed', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Cancel failed' }, { status: 500 })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'
