import {
  normalizeStudyPayload,
  slugify,
  ensureUniqueSlug,
  buildPatchFields,
  buildUnsetFields,
  buildReferences,
} from '@/lib/studySubmissions'

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

    return { ok: true }
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
      inclusionCriteria: normalized.inclusionCriteria || [],
      exclusionCriteria: normalized.exclusionCriteria || [],
      sponsorWebsite: normalized.sponsorWebsite || null,
      featured: normalized.featured,
      acceptsReferrals: normalized.acceptsReferrals,
      localContact: normalized.localContact || undefined,
      therapeuticAreas: buildReferences(normalized.therapeuticAreaIds),
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

  return { ok: true }
}
