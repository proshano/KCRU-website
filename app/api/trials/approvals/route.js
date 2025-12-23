import { NextResponse } from 'next/server'
import { sanityFetch, writeClient } from '@/lib/sanity'
import {
  normalizeStudyPayload,
  sanitizeString,
  slugify,
  ensureUniqueSlug,
  buildPatchFields,
  buildUnsetFields,
  buildReferences,
} from '@/lib/studySubmissions'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

async function getSession(token) {
  if (!token) return null
  const session = await sanityFetch(
    `*[_type == "studyApprovalSession" && token == $token][0]{ _id, email, expiresAt, revoked }`,
    { token }
  )
  if (!session || session.revoked) return null
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return null
  return session
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function GET(request) {
  const token = extractToken(request)
  const session = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  try {
    const [submissionsRaw, areasRaw, researchersRaw, sitesRaw] = await Promise.all([
      sanityFetch(`
        *[_type == "studySubmission" && status == "pending"] | order(submittedAt desc) {
          _id,
          title,
          action,
          status,
          submittedAt,
          submittedBy,
          payload,
          "study": studyRef->{
            _id,
            title,
            "slug": slug.current,
            status,
            nctId
          }
        }
      `),
      sanityFetch(`
        *[_type == "therapeuticArea" && active == true] | order(order asc, name asc) {
          _id,
          name,
          shortLabel
        }
      `),
      sanityFetch(`
        *[_type == "researcher"] | order(name asc) {
          _id,
          name,
          slug
        }
      `),
      sanityFetch(`
        *[_type == "site" && active == true] | order(order asc, name asc) {
          _id,
          name,
          shortName,
          city
        }
      `),
    ])

    return NextResponse.json(
      {
        ok: true,
        adminEmail: session.email,
        submissions: submissionsRaw || [],
        meta: {
          areas: areasRaw || [],
          researchers: researchersRaw || [],
          sites: sitesRaw || [],
        },
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[approvals] GET failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to load submissions.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function PATCH(request) {
  const token = extractToken(request)
  const session = await getSession(token)
  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  if (!writeClient.config().token) {
    return NextResponse.json(
      { ok: false, error: 'SANITY_API_TOKEN missing; cannot approve submissions.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }

  try {
    const body = await request.json()
    const submissionId = sanitizeString(body?.submissionId)
    const decision = sanitizeString(body?.decision)
    if (!submissionId || !decision) {
      return NextResponse.json(
        { ok: false, error: 'Submission id and decision are required.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (!['approve', 'reject'].includes(decision)) {
      return NextResponse.json(
        { ok: false, error: 'Decision must be approve or reject.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const submission = await sanityFetch(
      `*[_type == "studySubmission" && _id == $id][0]{
        _id,
        status,
        action,
        payload,
        "studyId": studyRef._ref
      }`,
      { id: submissionId }
    )

    if (!submission?._id) {
      return NextResponse.json(
        { ok: false, error: 'Submission not found.' },
        { status: 404, headers: CORS_HEADERS }
      )
    }

    if (submission.status !== 'pending') {
      return NextResponse.json(
        { ok: false, error: 'Submission already reviewed.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    if (decision === 'reject') {
      await writeClient
        .patch(submissionId)
        .set({
          status: 'rejected',
          reviewedAt: new Date().toISOString(),
          reviewedBy: session.email,
        })
        .commit({ returnDocuments: false })

      return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
    }

    if (!['create', 'update'].includes(submission.action)) {
      return NextResponse.json(
        { ok: false, error: 'Submission action not recognized.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const normalized = normalizeStudyPayload(submission.payload)
    if (!normalized.title) {
      return NextResponse.json(
        { ok: false, error: 'Submission is missing a study title.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    let approvedStudyId = submission.studyId || null
    if (submission.action === 'create') {
      const baseSlug = slugify(normalized.slug || normalized.title)
      if (!baseSlug) {
        return NextResponse.json(
          { ok: false, error: 'Slug is required to create a study.' },
          { status: 400, headers: CORS_HEADERS }
        )
      }
      const slugValue = await ensureUniqueSlug({ baseSlug, sanityFetch })
      const doc = {
        _type: 'trialSummary',
        title: normalized.title,
        slug: { _type: 'slug', current: slugValue },
        status: normalized.status,
        nctId: normalized.nctId || undefined,
        studyType: normalized.studyType || undefined,
        phase: normalized.phase || undefined,
        conditions: normalized.conditions || [],
        laySummary: normalized.laySummary || null,
        eligibilityOverview: normalized.eligibilityOverview || null,
        inclusionCriteria: normalized.inclusionCriteria || [],
        exclusionCriteria: normalized.exclusionCriteria || [],
        sex: normalized.sex || undefined,
        whatToExpect: normalized.whatToExpect || null,
        duration: normalized.duration || null,
        compensation: normalized.compensation || null,
        sponsorWebsite: normalized.sponsorWebsite || null,
        featured: normalized.featured,
        acceptsReferrals: normalized.acceptsReferrals,
        localContact: normalized.localContact || undefined,
        therapeuticAreas: buildReferences(normalized.therapeuticAreaIds),
        recruitmentSites: buildReferences(normalized.recruitmentSiteIds),
        principalInvestigator: normalized.principalInvestigatorId
          ? { _type: 'reference', _ref: normalized.principalInvestigatorId }
          : undefined,
        ctGovData: normalized.ctGovData || undefined,
      }

      const created = await writeClient.create(doc)
      approvedStudyId = created?._id || null
    } else {
      if (!submission.studyId) {
        return NextResponse.json(
          { ok: false, error: 'Submission missing study reference.' },
          { status: 400, headers: CORS_HEADERS }
        )
      }

      let slugValue = null
      if (normalized.slug || normalized.title) {
        const baseSlug = slugify(normalized.slug || normalized.title)
        if (baseSlug) {
          slugValue = await ensureUniqueSlug({ baseSlug, excludeId: submission.studyId, sanityFetch })
        }
      }

      const fields = buildPatchFields(normalized, slugValue)
      const unset = buildUnsetFields(normalized)
      let patch = writeClient.patch(submission.studyId).set(fields)
      if (unset.length) {
        patch = patch.unset(unset)
      }
      await patch.commit({ returnDocuments: false })
    }

    const reviewPatch = writeClient.patch(submissionId).set({
      status: 'approved',
      reviewedAt: new Date().toISOString(),
      reviewedBy: session.email,
      ...(approvedStudyId
        ? {
            studyRef: { _type: 'reference', _ref: approvedStudyId },
          }
        : {}),
    })
    await reviewPatch.commit({ returnDocuments: false })

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
  } catch (error) {
    console.error('[approvals] PATCH failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to review submission.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
