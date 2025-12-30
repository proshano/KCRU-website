import { NextRequest, NextResponse } from 'next/server'
import { getMaintenanceSettings } from '@/lib/sanity/client'

export async function POST(request) {
  const { password } = await request.json()

  try {
    const settings = await getMaintenanceSettings()
    const configuredPassword = String(settings?.password || '').trim()
    if (!configuredPassword) {
      console.warn('[maintenance] password not configured')
      return NextResponse.json({ success: false, error: 'Maintenance password not configured' }, { status: 500 })
    }

    const submittedPassword = typeof password === 'string' ? password : ''
    if (submittedPassword === configuredPassword) {
      const response = NextResponse.json({ success: true })

      response.cookies.set('site-auth', 'authenticated', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 60 * 60 * 24 * 7,
        path: '/'
      })

      return response
    }

    return NextResponse.json({ success: false }, { status: 401 })
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 })
  }
}

export const revalidate = 0
