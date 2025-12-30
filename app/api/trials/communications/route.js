import { NextResponse } from 'next/server'
import { sanityFetch, queries } from '@/lib/sanity'
import { generateTrialCommunications } from '@/lib/summaries'
import { sanitizeString } from '@/lib/studySubmissions'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

const DEV_PREVIEW_MODE = process.env.NODE_ENV !== 'production'

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (!header) return ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeString(item)).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/)
      .map((item) => sanitizeString(item))
      .filter(Boolean)
  }
  return []
}

function normalizeNctId(value) {
  return sanitizeString(value).toUpperCase()
}

function pickFirstValue(...values) {
  for (const value of values) {
    const cleaned = sanitizeString(value)
    if (cleaned) return cleaned
  }
  return ''
}

function pickList(primary, fallback) {
  const primaryList = normalizeList(primary)
  if (primaryList.length) return primaryList
  return normalizeList(fallback)
}

async function getCoordinatorSession(token) {
  if (!token) return null
  const session = await sanityFetch(
    `*[_type == "studyCoordinatorSession" && token == $token][0]{ _id, email, expiresAt, revoked }`,
    { token }
  )
  if (!session || session.revoked) return null
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return null
  return session
}

async function getApprovalSession(token) {
  if (!token) return null
  const session = await sanityFetch(
    `*[_type == "studyApprovalSession" && token == $token][0]{ _id, email, expiresAt, revoked }`,
    { token }
  )
  if (!session || session.revoked) return null
  if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) return null
  return session
}

async function requireSession(request) {
  const token = extractToken(request)
  const [coordinator, approval] = await Promise.all([
    getCoordinatorSession(token),
    getApprovalSession(token),
  ])
  if (!coordinator && !approval) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }
  return null
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(request) {
  if (!DEV_PREVIEW_MODE) {
    const auth = await requireSession(request)
    if (auth) return auth
  }

  try {
    const body = await request.json()
    const id = sanitizeString(body?.id)
    const nctId = normalizeNctId(body?.nctId)
    const ctGovData = body?.ctGovData && typeof body.ctGovData === 'object' ? body.ctGovData : {}

    let stored = null
    if (id || nctId) {
      const baseId = id.replace(/^drafts\./, '')
      const draftId = baseId ? `drafts.${baseId}` : ''
      stored = await sanityFetch(
        `*[_type == "trialSummary" && (_id == $id || _id == $draftId || nctId == $nctId)][0]{
          title,
          nctId,
          inclusionCriteria,
          exclusionCriteria,
          ctGovData{
            briefTitle,
            officialTitle,
            eligibilityCriteriaRaw
          }
        }`,
        { id: baseId || id, draftId, nctId }
      )
    }

    const context = {
      title: pickFirstValue(body?.title, stored?.title),
      officialTitle: pickFirstValue(body?.officialTitle, ctGovData?.officialTitle, stored?.ctGovData?.officialTitle),
      briefTitle: pickFirstValue(body?.briefTitle, ctGovData?.briefTitle, stored?.ctGovData?.briefTitle),
      nctId: pickFirstValue(nctId, stored?.nctId),
      inclusionCriteria: pickList(body?.inclusionCriteria, stored?.inclusionCriteria),
      exclusionCriteria: pickList(body?.exclusionCriteria, stored?.exclusionCriteria),
      eligibilityCriteriaRaw: pickFirstValue(
        body?.eligibilityCriteriaRaw,
        ctGovData?.eligibilityCriteriaRaw,
        stored?.ctGovData?.eligibilityCriteriaRaw
      ),
    }

    const hasContext =
      context.title ||
      context.officialTitle ||
      context.briefTitle ||
      context.nctId ||
      context.inclusionCriteria.length ||
      context.eligibilityCriteriaRaw

    if (!hasContext) {
      return NextResponse.json(
        { ok: false, error: 'Provide a study title or eligibility criteria before generating.' },
        { status: 400, headers: CORS_HEADERS }
      )
    }

    const settings = (await sanityFetch(queries.siteSettings)) || {}
    const cleanSetting = (value) => (sanitizeString(value) ? sanitizeString(value) : undefined)
    const options = {
      provider:
        cleanSetting(settings.trialCommunicationsLlmProvider) ||
        cleanSetting(settings.trialSummaryLlmProvider) ||
        cleanSetting(settings.llmProvider),
      model:
        cleanSetting(settings.trialCommunicationsLlmModel) ||
        cleanSetting(settings.trialSummaryLlmModel) ||
        cleanSetting(settings.llmModel),
      apiKey:
        cleanSetting(settings.trialCommunicationsLlmApiKey) ||
        cleanSetting(settings.trialSummaryLlmApiKey) ||
        cleanSetting(settings.llmApiKey),
      titlePrompt: cleanSetting(settings.trialCommunicationsTitlePrompt),
      eligibilityPrompt: cleanSetting(settings.trialCommunicationsEligibilityPrompt),
    }

    const result = await generateTrialCommunications(context, options)

    return NextResponse.json(
      {
        ok: true,
        emailTitle: result?.emailTitle || '',
        emailEligibilitySummary: result?.emailEligibilitySummary || '',
      },
      { headers: CORS_HEADERS }
    )
  } catch (error) {
    console.error('[trial-communications] POST failed', error)
    return NextResponse.json(
      { ok: false, error: error?.message || 'Failed to generate clinical communications.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
