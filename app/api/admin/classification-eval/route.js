import { NextResponse } from 'next/server'

import { getScopedAdminSession } from '@/lib/adminSessions'
import { getSessionAccess, hasRequiredAccess } from '@/lib/authAccess'
import {
  DEFAULT_EVAL_COUNT,
  MAX_EVAL_ROUTE_COUNT,
  deleteClassificationEvalRun,
  fetchClassificationEvalRun,
  fetchPublicationClassificationSettings,
  listClassificationEvalRuns,
  patchPublicationClassificationSettings,
  runClassificationEval,
} from '@/lib/classificationEval'
import { CLASSIFICATION_BACKENDS } from '@/lib/classificationSettings'
import { DECISION_MODELS, DECISION_MODEL_KEYS, isDecisionModelKey } from '@/lib/decisionModels'
import { buildCorsHeaders, extractBearerToken } from '@/lib/httpUtils'
import { sanitizeString } from '@/lib/inputUtils'
import { describeDecisionModelConfig } from '@/lib/jevClassifier'
import { writeClient } from '@/lib/sanity'

const CORS_HEADERS = buildCorsHeaders('GET, POST, OPTIONS')

// Publication classification sits with the publication tools, so the same approval-admin
// access that reviews attributions can run and read evaluations.
async function getSession(request) {
  const sessionAccess = await getSessionAccess()
  if (sessionAccess) {
    if (hasRequiredAccess(sessionAccess.access, { approvals: true })) {
      return { session: { email: sessionAccess.email }, status: 200 }
    }
    return { session: null, error: 'Not authorized for classification evaluation.', status: 403 }
  }

  const token = extractBearerToken(request)
  return getScopedAdminSession(token, { scope: 'approvals' })
}

// Each decision model's route and whether the server holds its credential, for the page's
// model picker. An invalid JEV_TRANSPORT puts its error on Jev's entry instead.
function describeModels() {
  return DECISION_MODELS.map((entry) => {
    try {
      return { ...describeDecisionModelConfig(entry.key), error: null }
    } catch (error) {
      return {
        decisionModel: entry.key,
        label: entry.label,
        transport: null,
        model: null,
        endpoint: null,
        hasApiKey: false,
        apiKeyEnvVar: null,
        error: error?.message || String(error),
      }
    }
  })
}

function missingCredentialResponse(decisionModel) {
  const config = describeModels().find((entry) => entry.decisionModel === decisionModel)
  if (config?.hasApiKey) return null
  const fix = config?.apiKeyEnvVar ? ` Set ${config.apiKeyEnvVar} first.` : config?.error ? ` ${config.error}` : ''
  return NextResponse.json(
    { ok: false, error: `No credential for ${config?.label || decisionModel} is configured on the server, so every paper would fall back to the chat model.${fix}` },
    { status: 400, headers: CORS_HEADERS }
  )
}

function readDecisionModel(body) {
  return sanitizeString(body?.decisionModel).toLowerCase()
}

function unknownDecisionModelResponse() {
  return NextResponse.json(
    { ok: false, error: `Decision model must be one of: ${DECISION_MODEL_KEYS.join(', ')}.` },
    { status: 400, headers: CORS_HEADERS }
  )
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
    const url = new URL(request.url)
    const requestedRunId = sanitizeString(url.searchParams.get('run'))
    const [runs, production] = await Promise.all([
      listClassificationEvalRuns(writeClient),
      fetchPublicationClassificationSettings(writeClient),
    ])
    const runId = requestedRunId || runs[0]?._id || null
    const run = runId ? await fetchClassificationEvalRun(writeClient, runId) : null
    return NextResponse.json(
      { ok: true, adminEmail: session.email, models: describeModels(), production, runs, run },
      { headers: CORS_HEADERS }
    )
  } catch (requestError) {
    console.error('[classification-eval] GET failed', requestError)
    return NextResponse.json(
      { ok: false, error: requestError?.message || 'Failed to load classification evaluations.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export async function POST(request) {
  const { session, error, status } = await getSession(request)
  if (!session) {
    return NextResponse.json({ ok: false, error }, { status, headers: CORS_HEADERS })
  }

  let body = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body.' }, { status: 400, headers: CORS_HEADERS })
  }

  const action = sanitizeString(body?.action) || 'run'

  try {
    if (action === 'delete') {
      const runId = sanitizeString(body?.runId)
      if (!runId) {
        return NextResponse.json({ ok: false, error: 'Missing runId.' }, { status: 400, headers: CORS_HEADERS })
      }
      await deleteClassificationEvalRun(writeClient, runId)
      return NextResponse.json({ ok: true, deleted: runId }, { headers: CORS_HEADERS })
    }

    if (action === 'apply-thresholds') {
      const thresholds = body?.thresholds && typeof body.thresholds === 'object' ? body.thresholds : null
      if (!thresholds) {
        return NextResponse.json({ ok: false, error: 'Missing thresholds.' }, { status: 400, headers: CORS_HEADERS })
      }
      // The run's model, so the page can warn when production uses a different one.
      const decisionModel = readDecisionModel(body)
      const production = await patchPublicationClassificationSettings(writeClient, {
        thresholds,
        thresholdsSource: `${sanitizeString(body?.source) || 'classification evaluation'} by ${session.email}`,
        thresholdsDecisionModel: isDecisionModelKey(decisionModel) ? decisionModel : null,
      })
      return NextResponse.json({ ok: true, production }, { headers: CORS_HEADERS })
    }

    if (action === 'set-backend') {
      const backend = sanitizeString(body?.backend).toLowerCase()
      if (!CLASSIFICATION_BACKENDS.includes(backend)) {
        return NextResponse.json({ ok: false, error: 'Backend must be "chat" or "jev".' }, { status: 400, headers: CORS_HEADERS })
      }
      if (backend === 'jev') {
        const { decisionModel } = await fetchPublicationClassificationSettings(writeClient)
        const refusal = missingCredentialResponse(decisionModel)
        if (refusal) return refusal
      }
      const production = await patchPublicationClassificationSettings(writeClient, {
        backend,
        backendUpdatedBy: session.email,
      })
      return NextResponse.json({ ok: true, production }, { headers: CORS_HEADERS })
    }

    if (action === 'set-decision-model') {
      const decisionModel = readDecisionModel(body)
      if (!isDecisionModelKey(decisionModel)) return unknownDecisionModelResponse()
      // Only refused when it would take effect: with the chat classifier the choice waits,
      // and switching the classifier checks the credential again.
      const { backend } = await fetchPublicationClassificationSettings(writeClient)
      if (backend === 'jev') {
        const refusal = missingCredentialResponse(decisionModel)
        if (refusal) return refusal
      }
      const production = await patchPublicationClassificationSettings(writeClient, {
        decisionModel,
        backendUpdatedBy: session.email,
      })
      return NextResponse.json({ ok: true, production }, { headers: CORS_HEADERS })
    }

    if (action !== 'run') {
      return NextResponse.json({ ok: false, error: 'Unsupported action.' }, { status: 400, headers: CORS_HEADERS })
    }

    const decisionModel = readDecisionModel(body)
    if (decisionModel && !isDecisionModelKey(decisionModel)) return unknownDecisionModelResponse()

    // The route runs inside a request; larger samples belong in the script
    // (npm run eval:jev-classification), which has no execution-time ceiling.
    const count = Math.min(MAX_EVAL_ROUTE_COUNT, Math.max(1, Number(body?.count) || DEFAULT_EVAL_COUNT))
    const result = await runClassificationEval({
      count,
      seed: body?.seed,
      concurrency: body?.concurrency,
      label: sanitizeString(body?.label) || undefined,
      year: sanitizeString(body?.year) || undefined,
      decisionModel: decisionModel || undefined,
      requestedBy: session.email,
    })
    const runs = await listClassificationEvalRuns(writeClient)
    return NextResponse.json({ ok: true, run: result.run, runs }, { headers: CORS_HEADERS })
  } catch (requestError) {
    console.error('[classification-eval] POST failed', requestError)
    return NextResponse.json(
      { ok: false, error: requestError?.message || 'Classification evaluation failed.' },
      { status: 500, headers: CORS_HEADERS }
    )
  }
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60
