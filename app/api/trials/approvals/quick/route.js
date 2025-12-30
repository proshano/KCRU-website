import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import { sanitizeString } from '@/lib/studySubmissions'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { handleRejectedSubmission, reviewSubmission } from '@/lib/studyApprovals'
import { extractBearerToken } from '@/lib/httpUtils'

const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
const APPROVAL_BASE_URL = `${SITE_BASE_URL}/admin/approvals`

async function getSession(token) {
  return getScopedAdminSession(token, { scope: 'approvals' })
}

export async function GET(request) {
  const url = new URL(request.url)
  const token = sanitizeString(url.searchParams.get('token'))
  const submissionId = sanitizeString(url.searchParams.get('submissionId'))
  const decision = sanitizeString(url.searchParams.get('decision'))

  if (!token || !submissionId || !decision) {
    return NextResponse.redirect(
      `${APPROVAL_BASE_URL}?error=${encodeURIComponent('Missing approval details.')}`
    )
  }

  const { session, error, status } = await getSession(token || extractBearerToken(request))
  if (!session) {
    const message = status === 403 ? error : 'Approval session expired or invalid.'
    return NextResponse.redirect(
      `${APPROVAL_BASE_URL}?error=${encodeURIComponent(message)}`
    )
  }

  if (!writeClient.config().token) {
    return NextResponse.redirect(
      `${APPROVAL_BASE_URL}?token=${encodeURIComponent(token)}&error=${encodeURIComponent('Server is missing approval credentials.')}`
    )
  }

  if (!['approve', 'reject'].includes(decision)) {
    return NextResponse.redirect(
      `${APPROVAL_BASE_URL}?token=${encodeURIComponent(token)}&error=${encodeURIComponent('Decision must be approve or reject.')}`
    )
  }

  try {
    const result = await reviewSubmission({
      submissionId,
      decision,
      sessionEmail: session.email,
      sanityFetch,
      writeClient,
    })

    if (!result.ok) {
      return NextResponse.redirect(
        `${APPROVAL_BASE_URL}?token=${encodeURIComponent(token)}&error=${encodeURIComponent(result.error || 'Failed to review submission.')}`
      )
    }

    if (decision === 'reject') {
      try {
        await handleRejectedSubmission({ submission: result.submission, sanityFetch, writeClient })
      } catch (error) {
        console.error('[approvals-quick] rejection email failed', error)
      }
    }

    return NextResponse.redirect(
      `${APPROVAL_BASE_URL}?token=${encodeURIComponent(token)}&status=${encodeURIComponent(decision)}`
    )
  } catch (error) {
    return NextResponse.redirect(
      `${APPROVAL_BASE_URL}?token=${encodeURIComponent(token)}&error=${encodeURIComponent(error?.message || 'Failed to review submission.')}`
    )
  }
}

export const dynamic = 'force-dynamic'
