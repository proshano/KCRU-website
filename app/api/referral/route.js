import { NextResponse } from 'next/server'
import { sanityFetch, queries, writeClient } from '@/lib/sanity'
import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/escapeHtml'
import { getClientIp } from '@/lib/httpUtils'
import { sanitizeString } from '@/lib/inputUtils'
import { verifyRecaptcha } from '@/lib/recaptcha'
import { claimSecurityRateLimit, getRateLimitResponseDetails } from '@/lib/securityRateLimit'
import { pickReferralTeam, resolveStudyTeams, teamInvestigatorName, teamLabel } from '@/lib/studyTeams'

const MIN_FORM_TIME_MS = 800
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
const MAX_REFERRALS_PER_ORIGIN = 5
const GLOBAL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const MAX_REFERRALS_GLOBAL = 120

const TEAM_ERRORS = {
  none: 'This study is not accepting referrals.',
  choose: 'Choose which study team should follow up.',
  not_found: 'That study team is not accepting referrals. Reload the page and try again.',
}

// The limiter keeps its claims in Sanity like every other public write on the
// site. Without a write token (local development) referrals are not stored
// either, so the limiter is skipped rather than failing every request.
async function enforceRateLimit(headers) {
  if (!writeClient.config().token) return null
  try {
    await claimSecurityRateLimit({
      namespace: 'referral-origin',
      key: getClientIp(headers),
      limit: MAX_REFERRALS_PER_ORIGIN,
      windowMs: RATE_LIMIT_WINDOW_MS,
      minimumIntervalMs: 2000,
    })
    await claimSecurityRateLimit({
      namespace: 'referral-global',
      key: 'all-public-callers',
      limit: MAX_REFERRALS_GLOBAL,
      windowMs: GLOBAL_RATE_LIMIT_WINDOW_MS,
      minimumIntervalMs: 250,
    })
    return null
  } catch (error) {
    const rateLimit = getRateLimitResponseDetails(error)
    if (!rateLimit) {
      console.error('[referral] rate-limit check failed', error)
      return NextResponse.json(
        { error: 'Referrals are temporarily unavailable. Please try again shortly.' },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { error: rateLimit.message },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
    )
  }
}

async function storeReferral({ providerEmail, study, team, headers }) {
  if (!writeClient.config().token) {
    console.warn('SANITY_API_TOKEN missing; skipping studyReferral storage.')
    return null
  }

  const now = new Date().toISOString()
  return writeClient.create({
    _type: 'studyReferral',
    providerEmail,
    study: { _type: 'reference', _ref: study._id },
    studyTitle: study.title,
    team: {
      teamKey: team._key,
      siteId: team.site?._id || '',
      siteName: teamLabel(team),
    },
    status: 'new',
    submittedAt: now,
    meta: {
      ip: getClientIp(headers),
      userAgent: headers.get('user-agent') || ''
    }
  })
}

async function sendReferralNotification({ providerEmail, study, team }) {
  const submittedAt = new Date().toISOString()
  const siteName = teamLabel(team)
  const teamName = siteName ? `${siteName} team` : 'study team'
  const subject = siteName ? `Study Referral - ${study.title} (${siteName} team)` : `Study Referral - ${study.title}`

  const text = [
    `Study Referral Request`,
    '',
    `A healthcare provider has requested to discuss a potential patient referral for this study with the ${teamName}.`,
    '',
    `Study: ${study.title}`,
    siteName ? `Team: ${siteName}` : null,
    `From: ${providerEmail}`,
    `Submitted: ${submittedAt}`,
    '',
    `Reply directly to this email to begin the conversation.`,
    '',
    '—',
    'Sent via londonkidney.ca'
  ].filter((line) => line !== null).join('\n')

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5;">
      <p style="margin: 0 0 16px; font-size: 16px;"><strong>Study Referral Request</strong></p>
      <p style="margin: 0 0 16px;">
        A healthcare provider has requested to discuss a potential patient referral for this study with the ${escapeHtml(teamName)}.
      </p>
      <p style="margin: 0 0 16px;">
        <strong>Study:</strong> ${escapeHtml(study.title)}<br/>
        ${siteName ? `<strong>Team:</strong> ${escapeHtml(siteName)}<br/>` : ''}
        <strong>From:</strong> ${escapeHtml(providerEmail)}<br/>
        <strong>Submitted:</strong> ${escapeHtml(submittedAt)}
      </p>
      <p style="margin: 0 0 16px; padding: 12px; background: #f5f5f5; border-radius: 6px;">
        Reply directly to this email to begin the conversation.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;" />
      <p style="margin: 0; color: #555; font-size: 12px;">Sent via londonkidney.ca</p>
    </div>
  `

  try {
    const result = await sendEmail({
      to: team.contact.email,
      subject,
      text,
      html,
      replyTo: providerEmail
    })

    if (result?.skipped) {
      console.error('Referral email skipped', result)
    }

    return result
  } catch (error) {
    console.error('Failed to send referral email', error)
    return { error: true, message: error.message }
  }
}

export async function POST(request) {
  const headers = request.headers
  let body

  try {
    body = await request.json()
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  const {
    email,
    studySlug,
    teamKey,
    isProvider,
    recaptchaToken,
    honeypot,
    startedAt
  } = body || {}

  // Honeypot check
  if (honeypot) {
    return NextResponse.json({ error: 'Invalid submission' }, { status: 400 })
  }

  const trimmedEmail = sanitizeString(email)
  const trimmedSlug = sanitizeString(studySlug)

  // Validate required fields
  if (!trimmedEmail) {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  if (!trimmedSlug) {
    return NextResponse.json({ error: 'Study not specified.' }, { status: 400 })
  }

  if (!isProvider) {
    return NextResponse.json({ error: 'You must confirm you are a healthcare provider.' }, { status: 400 })
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(trimmedEmail)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  // Timing check (bot protection)
  if (startedAt && Date.now() - Number(startedAt) < MIN_FORM_TIME_MS) {
    return NextResponse.json({ error: 'Please wait a moment before submitting.' }, { status: 400 })
  }

  const rateLimited = await enforceRateLimit(headers)
  if (rateLimited) return rateLimited

  // reCAPTCHA verification
  const recaptchaResult = await verifyRecaptcha(recaptchaToken)
  if (!recaptchaResult.success) {
    return NextResponse.json({ error: 'reCAPTCHA validation failed.' }, { status: 400 })
  }

  // Fetch the study with every team's contact (server-only projection)
  const studyRaw = await sanityFetch(queries.trialCoordinator, { slug: trimmedSlug })
  const study = JSON.parse(JSON.stringify(studyRaw || {}))

  if (!study || !study._id) {
    return NextResponse.json({ error: 'Study not found.' }, { status: 404 })
  }

  // Each team decides whether it takes referrals; the clinician picks the team
  // when more than one does, because referrals are counted per site.
  const { team, error: teamError } = pickReferralTeam(resolveStudyTeams(study), sanitizeString(teamKey))
  if (!team) {
    return NextResponse.json({ error: TEAM_ERRORS[teamError] || TEAM_ERRORS.none }, { status: 400 })
  }

  if (!team.contact?.email) {
    return NextResponse.json({ error: 'No coordinator email configured for this study team.' }, { status: 400 })
  }

  await storeReferral({ providerEmail: trimmedEmail, study, team, headers })

  const sendResult = await sendReferralNotification({ providerEmail: trimmedEmail, study, team })

  if (sendResult?.skipped || sendResult?.error) {
    const reason = sendResult?.reason || sendResult?.message || 'Email failed to send.'
    return NextResponse.json({ error: reason }, { status: 500 })
  }

  const siteName = teamLabel(team)
  return NextResponse.json({
    ok: true,
    team: { key: team._key, siteName, investigator: teamInvestigatorName(team) },
    message: siteName
      ? `Thank you. The ${siteName} team will be in touch shortly.`
      : 'Thank you. The study coordinator will be in touch shortly.'
  })
}

export const dynamic = 'force-dynamic'
