import { NextResponse } from 'next/server'
import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { sanitizeString } from '@/lib/inputUtils'
import { writeClient } from '@/lib/sanity'
import {
  fetchResearchDigestSettings,
  formatResearchDigestDate,
  importResearchDigestContent,
} from '@/lib/researchDigest'
import { RESEARCH_DIGEST_APPROVAL, RESEARCH_DIGEST_ISSUE_STATUS } from '@/lib/researchDigestConfig'

const CORS_HEADERS = buildCorsHeaders('GET, POST, PATCH, OPTIONS')

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

async function fetchAdminPayload(date) {
  const selectedDate = sanitizeString(date) || formatResearchDigestDate()
  const query = `{
    "issue": *[_type == "researchDigestIssue" && date == $date][0]{
      _id,
      title,
      date,
      "slug": slug.current,
      status,
      intro,
      approvedAt,
      sentAt,
      retrievalWindowDays,
      selectionMode,
      selectedPaperCount
    },
    "issues": *[_type == "researchDigestIssue"] | order(date desc)[0...14]{
      _id,
      title,
      date,
      "slug": slug.current,
      status,
      approvedAt,
      sentAt,
      "pendingPapers": count(*[_type == "researchDigestPaper" && issueDate == ^.date && approvalStatus == "pending"]),
      "approvedPapers": count(*[_type == "researchDigestPaper" && issueDate == ^.date && approvalStatus == "approved"])
    },
    "papers": *[_type == "researchDigestPaper" && issueDate == $date] | order(approvalStatus asc, triageStatus asc, journal asc, title asc) {
      _id,
      issueDate,
      pmid,
      doi,
      title,
      abstract,
      authors,
      publicationTypes,
      journal,
      pubDate,
      year,
      url,
      matchedJournalGroups,
      triageStatus,
      approvalStatus,
      tier,
      priorityScore,
      whyItMatters,
      summary,
      topics,
      triageError,
      autoSelected,
      autoSelectionStatus,
      autoSelectionExcluded,
      retrievedAt,
      approvedAt,
      rejectedAt
    },
    "opportunities": *[_type == "researchOpportunity" && approvalStatus in ["pending", "approved"] && status in ["open", "upcoming"]] | order(approvalStatus asc, deadline asc, title asc)[0...80] {
      _id,
      type,
      status,
      approvalStatus,
      sourceName,
      sourceUrl,
      title,
      description,
      deadline,
      eligibility,
      url,
      topics,
      retrievedAt,
      approvedAt,
      rejectedAt
    },
    "stats": {
      "pendingPapers": count(*[_type == "researchDigestPaper" && approvalStatus == "pending"]),
      "approvedPapersToday": count(*[_type == "researchDigestPaper" && issueDate == $date && approvalStatus == "approved"]),
      "pendingOpportunities": count(*[_type == "researchOpportunity" && approvalStatus == "pending"]),
      "approvedOpenOpportunities": count(*[_type == "researchOpportunity" && approvalStatus == "approved" && status in ["open", "upcoming"]])
    }
  }`
  const payload = await writeClient.fetch(query, { date: selectedDate })
  return { date: selectedDate, ...(payload || {}) }
}

async function patchPaper(body) {
  const id = sanitizeString(body?._id || body?.id)
  if (!id) throw new Error('Missing paper id.')

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
    const [{ settings }, payload] = await Promise.all([
      fetchResearchDigestSettings(),
      fetchAdminPayload(searchParams.get('date')),
    ])
    return NextResponse.json({
      ok: true,
      digestSettings: {
        automaticSelection: settings.automaticSelection,
        maxPapers: settings.maxPapers,
        minPriorityScore: settings.minPriorityScore,
        pilotMode: settings.pilotMode,
      },
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
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot import research digest content.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await request.json().catch(() => ({}))
    if (body?.action !== 'import') {
      return NextResponse.json({ ok: false, error: 'Unsupported action.' }, { status: 400, headers: CORS_HEADERS })
    }
    const { settings } = await fetchResearchDigestSettings()
    const result = await importResearchDigestContent({ settings })
    return NextResponse.json({ ok: true, result }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[research-digest-admin] import failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Research digest import failed.' },
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
    } else {
      return NextResponse.json({ ok: false, error: 'Unsupported update.' }, { status: 400, headers: CORS_HEADERS })
    }

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[research-digest-admin] PATCH failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Research digest update failed.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
