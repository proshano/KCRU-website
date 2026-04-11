import { sendEmail } from '@/lib/email'
import { escapeHtml } from '@/lib/escapeHtml'
import {
  normalizeStudyPayload,
  sanitizeString,
  slugify,
  ensureUniqueSlug,
  buildPatchFields,
  buildUnsetFields,
  buildReferences,
} from '@/lib/studySubmissions'

const SITE_BASE_URL = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/$/, '')
const MANAGE_BASE_URL = `${SITE_BASE_URL}/trials/manage`

function buildDraftData(payload, studyId) {
  const normalized = normalizeStudyPayload(payload || {})
  return {
    ...normalized,
    id: sanitizeString(studyId),
    studyType: normalized.studyType || '',
    phase: normalized.phase || '',
    principalInvestigatorId: normalized.principalInvestigatorId || '',
  }
}

async function upsertDraft({ email, data, sanityFetch, writeClient }) {
  const savedAt = new Date().toISOString()
  const title = sanitizeString(data?.title) || 'Untitled study'
  const existing = await sanityFetch(
    `*[_type == "studyDraft" && email == $email] | order(savedAt desc)[0]{ _id }`,
    { email }
  )

  if (existing?._id) {
    await writeClient
      .patch(existing._id)
      .set({ savedAt, title, email, data })
      .commit({ returnDocuments: false })
    return
  }

  await writeClient.create({
    _type: 'studyDraft',
    email,
    savedAt,
    title,
    data,
  })
}

function buildRejectionEmail({ submissionId, title, submittedAt, submittedByEmail }) {
  const cleanedTitle = sanitizeString(title) || 'Untitled study'
  const cleanedSubmitter = sanitizeString(submittedByEmail) || 'Unknown'
  const subject = `Study submission rejected: ${cleanedTitle}`
  const submittedAtLabel = submittedAt ? new Date(submittedAt).toLocaleString() : 'Unknown'
  const safeTitle = escapeHtml(cleanedTitle)
  const safeSubmissionId = escapeHtml(submissionId || 'Unknown')
  const safeSubmittedAt = escapeHtml(submittedAtLabel)
  const safeSubmitter = escapeHtml(cleanedSubmitter)
  const text = [
    'Your study submission was rejected by an admin.',
    '',
    `Submission ID: ${submissionId || 'Unknown'}`,
    `Study title: ${cleanedTitle}`,
    `Submitted at: ${submittedAtLabel}`,
    '',
    'We saved your submission as a draft. To edit and resubmit:',
    `1) Open the Study Manager: ${MANAGE_BASE_URL}`,
    '2) Sign in with your LHSC email and choose "Restore draft".',
  ].join('\n')

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; font-size: 14px; color: #111; line-height: 1.5;">
      <p style="margin: 0 0 12px;"><strong>Your study submission was rejected.</strong></p>
      <p style="margin: 0 0 12px; color: #444;">
        <strong>Study title:</strong> ${safeTitle}<br />
        <strong>Submission ID:</strong> ${safeSubmissionId}<br />
        <strong>Submitted at:</strong> ${safeSubmittedAt}<br />
        <strong>Submitted by:</strong> ${safeSubmitter}
      </p>
      <p style="margin: 0 0 12px;">We saved your submission as a draft. Open the Study Manager to edit and resubmit:</p>
      <p style="margin: 0;">
        <a href="${MANAGE_BASE_URL}" style="display: inline-block; padding: 10px 16px; background: #4f46e5; color: #fff; text-decoration: none; border-radius: 6px;">
          Open Study Manager
        </a>
      </p>
      <p style="margin: 12px 0 0; color: #555;">After signing in, choose <strong>Restore draft</strong>.</p>
    </div>
  `

  return { subject, text, html }
}

export async function handleRejectedSubmission({ submission, sanityFetch, writeClient }) {
  const submittedByEmail = sanitizeString(submission?.submittedBy?.email)
  if (!submittedByEmail) {
    return { skipped: true, reason: 'missing_submitter_email' }
  }

  const payload = submission?.payload || {}
  const data = buildDraftData(payload, submission?.studyId)
  await upsertDraft({ email: submittedByEmail, data, sanityFetch, writeClient })

  const { subject, text, html } = buildRejectionEmail({
    submissionId: submission?._id,
    title: payload?.title,
    submittedAt: submission?.submittedAt,
    submittedByEmail,
  })

  return sendEmail({ to: submittedByEmail, subject, text, html })
}

export async function reviewSubmission({
  submissionId,
  decision,
  sessionEmail,
  sanityFetch,
  writeClient,
}) {
  const submission = await sanityFetch(
    `*[_type == "studySubmission" && _id == $id][0]{
      _id,
      status,
      action,
      submittedAt,
      submittedBy,
      payload,
      "studyId": studyRef._ref
    }`,
    { id: submissionId }
  )

  if (!submission?._id) {
    return { ok: false, status: 404, error: 'Submission not found.' }
  }

  if (submission.status !== 'pending') {
    return { ok: false, status: 400, error: 'Submission already reviewed.' }
  }

  if (decision === 'reject') {
    await writeClient
      .patch(submissionId)
      .set({
        status: 'rejected',
        reviewedAt: new Date().toISOString(),
        reviewedBy: sessionEmail,
      })
      .commit({ returnDocuments: false })

    return { ok: true, submission }
  }

  if (submission.action === 'update' && submission.studyId) {
    const latestPending = await sanityFetch(
      `*[_type == "studySubmission" && status == "pending" && studyRef._ref == $studyId] | order(submittedAt desc)[0]{ _id }`,
      { studyId: submission.studyId }
    )
    if (latestPending?._id && latestPending._id !== submissionId) {
      return {
        ok: false,
        status: 409,
        error: 'A newer submission is pending for this study. Approve the most recent submission.',
      }
    }
  }

  if (!['create', 'update'].includes(submission.action)) {
    return { ok: false, status: 400, error: 'Submission action not recognized.' }
  }

  const normalized = normalizeStudyPayload(submission.payload)
  if (!normalized.title) {
    return { ok: false, status: 400, error: 'Submission is missing a study title.' }
  }
  if (!normalized.principalInvestigatorId && !normalized.principalInvestigatorName) {
    return { ok: false, status: 400, error: 'Submission is missing a principal investigator.' }
  }

  let approvedStudyId = submission.studyId || null
  if (submission.action === 'create') {
    const baseSlug = slugify(normalized.slug || normalized.title)
    if (!baseSlug) {
      return { ok: false, status: 400, error: 'Slug is required to create a study.' }
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
      laySummary: normalized.laySummary || null,
      emailTitle: normalized.emailTitle || null,
      emailEligibilitySummary: normalized.emailEligibilitySummary || null,
      inclusionCriteria: normalized.inclusionCriteria || [],
      exclusionCriteria: normalized.exclusionCriteria || [],
      sponsorWebsite: normalized.sponsorWebsite || null,
      featured: normalized.featured,
      acceptsReferrals: normalized.acceptsReferrals,
      localContact: normalized.localContact || undefined,
      therapeuticAreas: buildReferences(normalized.therapeuticAreaIds),
      principalInvestigatorName: normalized.principalInvestigatorName || undefined,
      principalInvestigator: normalized.principalInvestigatorId
        ? { _type: 'reference', _ref: normalized.principalInvestigatorId }
        : undefined,
      ctGovData: normalized.ctGovData || undefined,
    }

    const created = await writeClient.create(doc)
    approvedStudyId = created?._id || null
  } else {
    if (!submission.studyId) {
      return { ok: false, status: 400, error: 'Submission missing study reference.' }
    }

    let slugValue = null
    if (normalized.slug || normalized.title) {
      const baseSlug = slugify(normalized.slug || normalized.title)
      if (baseSlug) {
        slugValue = await ensureUniqueSlug({
          baseSlug,
          excludeId: submission.studyId,
          sanityFetch,
        })
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
    reviewedBy: sessionEmail,
    ...(approvedStudyId
      ? {
          studyRef: { _type: 'reference', _ref: approvedStudyId },
        }
      : {}),
  })
  await reviewPatch.commit({ returnDocuments: false })

  return { ok: true, submission }
}
