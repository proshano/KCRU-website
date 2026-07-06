import { NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronUtils'
import {
  fetchResearchDigestSettings,
  importResearchDigestContent,
  isWeekdayInTimeZone,
} from '@/lib/researchDigest'
import { RESEARCH_DIGEST_TIMEZONE } from '@/lib/researchDigestConfig'

const CRON_SECRET = process.env.CRON_SECRET || ''

export async function GET(request) {
  if (!CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (!isCronAuthorized(request, CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }
  if (!isWeekdayInTimeZone(new Date(), RESEARCH_DIGEST_TIMEZONE)) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'Research digest import runs on weekdays only.' })
  }

  try {
    const { settings } = await fetchResearchDigestSettings()
    const result = await importResearchDigestContent({ settings })
    return NextResponse.json({ ok: true, result, timezone: RESEARCH_DIGEST_TIMEZONE })
  } catch (error) {
    console.error('[research-digest-import] failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Research digest import failed.' },
      { status: 500 }
    )
  }
}

export async function POST(request) {
  if (!CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (!isCronAuthorized(request, CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const { settings } = await fetchResearchDigestSettings()
    const result = await importResearchDigestContent({ settings, dryRun: Boolean(body?.dryRun) })
    return NextResponse.json({ ok: true, result, dryRun: Boolean(body?.dryRun) })
  } catch (error) {
    console.error('[research-digest-import] POST failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Research digest import failed.' },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic'
