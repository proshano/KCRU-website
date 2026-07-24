import { NextResponse } from 'next/server'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { sanitizeString } from '@/lib/inputUtils'
import { writeClient } from '@/lib/sanity'
import { requireSanityDocumentType } from '@/lib/sanityDocumentType'
import { buildResearchDigestEmail } from '@/lib/researchDigestEmailTemplate'
import {
  fetchResearchDigestIssueBundle,
  fetchResearchDigestSettings,
  formatResearchDigestDate,
  getCarryoverStartDate,
  importResearchDigestContent,
  reselectAutomatedDigestIssue,
} from '@/lib/researchDigest'
import {
  buildDigestSettingsPatch,
  buildResearchDigestAdminQuery,
  describePoolPaperDisposition,
  findDigestSettingsWarnings,
  summarizeDigestPoolDispositions,
  summarizeDigestSubscribers,
} from '@/lib/researchDigestAdminView'
import {
  RESEARCH_DIGEST_APPROVAL,
  RESEARCH_DIGEST_ISSUE_STATUS,
  getResearchDigestJournalGroups,
  getResearchDigestOpportunitySources,
} from '@/lib/researchDigestConfig'
import { normalizeUpdateEmailTesting } from '@/lib/updateEmailTesting'

const CORS_HEADERS = buildCorsHeaders('GET, POST, PATCH, OPTIONS')
const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(
  /\/$/,
  ''
)
const ADMIN_PAYLOAD_QUERY = buildResearchDigestAdminQuery()

async function getSession(request) {
  const sessionAccess = await getSessionAccess()
  if (sessionAccess) {
    if (hasRequiredAccess(sessionAccess.access, { updates: true })) {
      return { session: { email: sessionAccess.email }, status: 200 }
    }
    return { session: null, error: 'Not authorized for research digest updates.', status: 403 }
  }

  const token = extractBearerToken(request)
  return getScopedAdminSession(token, { scope: 'updates' })
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return []
  return values.map((value) => sanitizeString(value)).filter(Boolean).slice(0, 12)
}

async function fetchAdminPayload(date, settings) {
  const selectedDate = sanitizeString(date) || formatResearchDigestDate()
  const carryoverFrom = getCarryoverStartDate(selectedDate, settings.carryoverDays)
  const payload = await writeClient.fetch(ADMIN_PAYLOAD_QUERY, { issueDate: selectedDate, carryoverFrom })
  const pool = (payload?.pool || []).map((paper) => ({
    ...paper,
    disposition: describePoolPaperDisposition(paper, settings, { issueDate: selectedDate }),
  }))

  return {
    date: selectedDate,
    carryoverFrom,
    ...(payload || {}),
    pool,
    poolSummary: summarizeDigestPoolDispositions(pool.map((paper) => paper.disposition)),
    subscriberCounts: summarizeDigestSubscribers(payload?.subscribers || []),
  }
}

async function patchPaper(body) {
  const id = sanitizeString(body?._id || body?.id)
  if (!id) throw new Error('Missing paper id.')
  await requireSanityDocumentType({
    fetch: writeClient.fetch.bind(writeClient),
    id,
    expectedType: 'researchDigestPaper',
    label: 'Paper',
  })

  const now = new Date().toISOString()
  const fields = body?.fields || {}
  const patch = {
    updatedAt: now,
  }

  if (body?.action === 'approve') {
    patch.approvalStatus = RESEARCH_DIGEST_APPROVAL.approved
    patch.approvedAt = now
    patch.rejectedAt = null
    patch.autoSelectionExcluded = false
  } else if (body?.action === 'reject') {
    patch.approvalStatus = RESEARCH_DIGEST_APPROVAL.rejected
    patch.rejectedAt = now
    patch.autoSelectionExcluded = true
  } else if (body?.action === 'pending') {
    patch.approvalStatus = RESEARCH_DIGEST_APPROVAL.pending
    patch.approvedAt = null
    patch.rejectedAt = null
    patch.autoSelectionExcluded = false
  }

  if ('summary' in fields) patch.summary = sanitizeString(fields.summary)
  if ('whyItMatters' in fields) patch.whyItMatters = sanitizeString(fields.whyItMatters)
  if ('tier' in fields) patch.tier = sanitizeString(fields.tier) || 'Tier 3'
  if ('topics' in fields) patch.topics = normalizeStringList(fields.topics)

  await writeClient.patch(id).set(patch).commit({ returnDocuments: false })
}

async function patchOpportunity(body) {
  const id = sanitizeString(body?._id || body?.id)
  if (!id) throw new Error('Missing opportunity id.')
  await requireSanityDocumentType({
    fetch: writeClient.fetch.bind(writeClient),
    id,
    expectedType: 'researchOpportunity',
    label: 'Opportunity',
  })

  const now = new Date().toISOString()
  const fields = body?.fields || {}
  const patch = { updatedAt: now }

  if (body?.action === 'approve') {
    patch.approvalStatus = RESEARCH_DIGEST_APPROVAL.approved
    patch.approvedAt = now
    patch.rejectedAt = null
  } else if (body?.action === 'reject') {
    patch.approvalStatus = RESEARCH_DIGEST_APPROVAL.rejected
    patch.rejectedAt = now
  } else if (body?.action === 'pending') {
    patch.approvalStatus = RESEARCH_DIGEST_APPROVAL.pending
    patch.approvedAt = null
    patch.rejectedAt = null
  }

  for (const key of ['title', 'description', 'deadline', 'eligibility', 'url', 'type', 'status']) {
    if (key in fields) patch[key] = sanitizeString(fields[key]) || null
  }
  if ('topics' in fields) patch.topics = normalizeStringList(fields.topics)

  await writeClient.patch(id).set(patch).commit({ returnDocuments: false })
}

async function approveIssue(body) {
  const id = sanitizeString(body?._id || body?.id)
  if (!id) throw new Error('Missing issue id.')
  await requireSanityDocumentType({
    fetch: writeClient.fetch.bind(writeClient),
    id,
    expectedType: 'researchDigestIssue',
    label: 'Issue',
  })
  const now = new Date().toISOString()
  await writeClient
    .patch(id)
    .set({
      status: RESEARCH_DIGEST_ISSUE_STATUS.approved,
      approvedAt: now,
      updatedAt: now,
    })
    .commit({ returnDocuments: false })
}

// The only write path to siteSettings in the app, so it is deliberately narrow: it reads the
// stored researchDigest object, merges the form-owned keys over it, and writes that one field.
async function patchSettings(body) {
  const current = await writeClient.fetch(`*[_type == "siteSettings"][0]{ _id, researchDigest }`)
  if (!current?._id) {
    throw new Error('No siteSettings document exists yet. Create one in Sanity Studio first.')
  }

  const next = buildDigestSettingsPatch(body?.fields || {}, current.researchDigest || {})
  await writeClient
    .patch(current._id)
    .set({ researchDigest: next })
    .commit({ returnDocuments: false })

  return next
}

async function buildEmailPreview(issueDate, settingsPayload) {
  const settings = settingsPayload.settings
  const bundle = await fetchResearchDigestIssueBundle({
    issueDate,
    maxPapers: settings.maxPapers,
    maxOpportunities: settings.maxOpportunities,
    automaticSelection: settings.automaticSelection,
  })

  if (!bundle?.issue?._id) {
    return { available: false, reason: `No research digest issue exists for ${issueDate}.` }
  }

  const papers = Array.isArray(bundle.papers) ? bundle.papers : []
  const opportunities = Array.isArray(bundle.opportunities) ? bundle.opportunities : []
  const email = buildResearchDigestEmail({
    // A placeholder recipient: the real send personalizes the greeting and manage link per
    // subscriber, and no real manage token should ever be rendered into a diagnostics page.
    subscriber: { name: 'Sample Subscriber', manageToken: 'PREVIEW-TOKEN-NOT-REAL' },
    issue: { ...bundle.issue, slug: bundle.issue.slug || bundle.issue.date },
    papers,
    opportunities,
    settings,
    siteBaseUrl: SITE_BASE_URL,
  })

  return {
    available: true,
    issueDate,
    issueStatus: bundle.issue.status,
    sentAt: bundle.issue.sentAt || null,
    paperCount: papers.length,
    opportunityCount: opportunities.length,
    wouldSend: papers.length > 0 || opportunities.length > 0 || Boolean(settings.sendEmpty),
    subject: email.subject,
    html: email.html,
    text: email.text,
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const { session, error, status } = await getSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  try {
    const { searchParams } = new URL(request.url)
    const settingsPayload = await fetchResearchDigestSettings()
    const { settings } = settingsPayload
    const testing = normalizeUpdateEmailTesting(settingsPayload.testing)
    const payload = await fetchAdminPayload(searchParams.get('date'), settings)

    return NextResponse.json({
      ok: true,
      // Kept for the existing banners; `settings` below is the full picture.
      digestSettings: {
        publicEnabled: settings.publicEnabled,
        automaticSelection: settings.automaticSelection,
        maxPapers: settings.maxPapers,
        minPriorityScore: settings.minPriorityScore,
        carryoverDays: settings.carryoverDays,
        pilotMode: settings.pilotMode,
      },
      settings,
      testing: { enabled: testing.enabled, recipients: testing.recipients },
      journalGroups: getResearchDigestJournalGroups(settings),
      opportunitySources: getResearchDigestOpportunitySources(settings),
      warnings: findDigestSettingsWarnings(settings, {
        subscriberCounts: payload.subscriberCounts,
        testing,
      }),
      ...payload,
    }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[research-digest-admin] GET failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load research digest admin data.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function POST(request) {
  const { session, error, status } = await getSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot run research digest actions.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    const action = sanitizeString(body?.action)
    const settingsPayload = await fetchResearchDigestSettings()

    if (action === 'import') {
      const result = await importResearchDigestContent({ settings: settingsPayload.settings })
      return NextResponse.json({ ok: true, action, result }, { headers: CORS_HEADERS })
    }

    if (action === 'reselect') {
      const issueDate = sanitizeString(body?.issueDate) || formatResearchDigestDate()
      const result = await reselectAutomatedDigestIssue({
        settings: settingsPayload.settings,
        issueDate,
      })
      return NextResponse.json({ ok: true, action, result }, { headers: CORS_HEADERS })
    }

    if (action === 'preview') {
      const issueDate = sanitizeString(body?.issueDate) || formatResearchDigestDate()
      const preview = await buildEmailPreview(issueDate, settingsPayload)
      return NextResponse.json({ ok: true, action, preview }, { headers: CORS_HEADERS })
    }

    return NextResponse.json({ ok: false, error: 'Unsupported action.' }, { status: 400, headers: CORS_HEADERS })
  } catch (error) {
    console.error('[research-digest-admin] POST failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Research digest action failed.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function PATCH(request) {
  const { session, error, status } = await getSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot update research digest content.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await request.json()
    if (body?.resource === 'paper') {
      await patchPaper(body)
    } else if (body?.resource === 'opportunity') {
      await patchOpportunity(body)
    } else if (body?.resource === 'issue' && body?.action === 'approve') {
      await approveIssue(body)
    } else if (body?.resource === 'settings') {
      const settings = await patchSettings(body)
      return NextResponse.json({ ok: true, settings }, { headers: CORS_HEADERS })
    } else {
      return NextResponse.json({ ok: false, error: 'Unsupported update.' }, { status: 400, headers: CORS_HEADERS })
    }

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[research-digest-admin] PATCH failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Research digest update failed.' },
      { status: error?.statusCode || 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
