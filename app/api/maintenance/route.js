import { NextResponse } from 'next/server'
import { getMaintenanceSettings } from '@/lib/sanity/client'

const CACHE_SECONDS = 60
const CACHE_HEADERS = {
  'Cache-Control': `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 5}`
}

export async function GET() {
  try {
    const settings = await getMaintenanceSettings()
    return NextResponse.json(
      {
        enabled: Boolean(settings?.enabled)
      },
      { headers: CACHE_HEADERS }
    )
  } catch (error) {
    return NextResponse.json({ enabled: false }, { headers: CACHE_HEADERS })
  }
}

export const revalidate = CACHE_SECONDS
