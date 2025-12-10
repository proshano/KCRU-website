import { NextResponse } from 'next/server'
import { getMaintenanceSettings } from '@/lib/sanity/client'

export async function GET() {
  try {
    const settings = await getMaintenanceSettings()
    return NextResponse.json({
      enabled: settings?.enabled || false
    })
  } catch (error) {
    return NextResponse.json({ enabled: false })
  }
}

export const revalidate = 0
