import { sanityFetch, queries, client as sanityClient, writeClient as sanityWriteClient } from './sanity.js'
import { readCache } from './pubmedCache.js'
import { classifyPublication } from './summaries.js'
import { DEFAULT_CLASSIFICATION_PROMPT } from './classificationPrompt.js'

export function clamp(n, min, max) {
  if (Number.isNaN(n)) return min
  return Math.max(min, Math.min(max, n))
}

function sortByYearDesc(a, b) {
  return (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0)
}

function normalizePmids(pmids = []) {
  return pmids.map(String).filter(Boolean)
}

export async function fetchExistingClassifications(pmids = []) {
  if (!pmids.length) return new Map()
  const pmidsStr = normalizePmids(pmids)
  const pmidsNum = pmidsStr.map((p) => Number(p)).filter(Number.isFinite)
  const docs = await sanityClient.fetch(
    `*[_type == "pubmedClassification" && (pmid in $pmids || pmid in $pmidsNum)]{
      pmid,
      _id,
      status,
      runAt
    }`,
    { pmids: pmidsStr, pmidsNum }
  )
  const map = new Map()
  for (const d of docs || []) {
    const key = d?.pmid ? String(d.pmid) : ''
    if (key) map.set(key, { id: d._id, status: d.status || null, runAt: d.runAt || null })
  }
  return map
}

export async function fetchExistingClassificationMap(pmids = []) {
  const docs = await fetchExistingClassifications(pmids)
  const map = new Map()
  for (const [pmid, info] of docs.entries()) {
    if (info?.id) map.set(pmid, info.id)
  }
  return map
}

export async function upsertClassifications(entries = [], meta = {}, existingIdMap = null) {
  const tx = sanityWriteClient.transaction()
  const existingMap = existingIdMap || await fetchExistingClassificationMap(entries.map((e) => e.pmid).filter(Boolean))

  for (const entry of entries) {
    if (!entry.pmid) continue
    const doc = {
      _type: 'pubmedClassification',
      pmid: entry.pmid,
      title: entry.title || null,
      topics: entry.topics || [],
      studyDesign: entry.studyDesign || [],
      methodologicalFocus: entry.methodologicalFocus || [],
      exclude: Boolean(entry.exclude),
      summary: entry.summary || null,
      promptText: meta.promptText || null,
      promptVersion: meta.promptVersion || null,
      provider: meta.provider || null,
      model: meta.model || null,
      runAt: new Date().toISOString(),
      status: entry.error ? 'error' : 'ok',
      error: entry.error || null,
    }
    const existingId = existingMap.get(entry.pmid)
    if (existingId) {
      const patchDoc = { ...doc }
      delete patchDoc._type
      tx.patch(existingId, { set: patchDoc })
    } else {
      tx.create(doc)
    }
  }

  return tx.commit()
}

export async function deleteClassifications(pmids = []) {
  if (!pmids.length) return
  const pmidsStr = normalizePmids(pmids)
  const pmidsNum = pmidsStr.map((p) => Number(p)).filter(Number.isFinite)
  await sanityWriteClient.delete({
    query: `*[_type == "pubmedClassification" && (pmid in $pmids || pmid in $pmidsNum)]._id`,
    params: { pmids: pmidsStr, pmidsNum },
  })
}

export async function runPubmedReclassification(options = {}) {
  const all = options?.all === true
  const requestedCount = clamp(Number(options?.count ?? options?.requestedCount ?? 10), 1, 5000)
  const overridePrompt = typeof options?.prompt === 'string'
    ? options.prompt.trim()
    : typeof options?.overridePrompt === 'string'
      ? options.overridePrompt.trim()
      : ''
  const pmidsFilter = normalizePmids(Array.isArray(options?.pmids) ? options.pmids : [])
  const clearExisting = options?.clear === true || options?.clearExisting === true
  const batchSize = clamp(Number(options?.batchSize ?? 50), 1, 200)
  const delayMs = clamp(Number(options?.delayMs ?? 0), 0, 60000)
  const yearFilter = options?.year ? String(options.year).trim() : ''
  const dryRun = options?.dryRun === true

  const settings = options?.settings || (await sanityFetch(queries.siteSettings)) || {}
  const cache = options?.cache || await readCache()
  if (!cache?.publications?.length) {
    throw new Error('No cached publications. Refresh cache first.')
  }

  const classificationPrompt = overridePrompt || settings.llmClassificationPrompt || DEFAULT_CLASSIFICATION_PROMPT
  const provider = options?.provider || settings.llmClassificationProvider || settings.llmProvider || 'openrouter'
  const model = options?.model || settings.llmClassificationModel || settings.llmModel || undefined
  const apiKey = options?.apiKey || settings.llmClassificationApiKey || settings.llmApiKey || undefined
  const systemPrompt = settings.llmSystemPrompt || undefined
  const concurrency = clamp(
    Number(options?.concurrency || settings.llmConcurrency || 1),
    1,
    20
  )
  const cacheGeneratedAtTs = cache?.generatedAt ? Date.parse(cache.generatedAt) : null

  const publications = (cache.publications || []).filter((p) => p?.pmid && p?.title)
  const sortedPublications = [...publications]
    .sort(sortByYearDesc)
    .filter((pub) => !yearFilter || String(pub?.year || '') === yearFilter)

  let candidates = pmidsFilter.length
    ? sortedPublications.filter((p) => pmidsFilter.includes(String(p.pmid)))
    : sortedPublications

  if (!candidates.length) {
    throw new Error('No publications selected/found.')
  }

  const appliedMissingOnly = !pmidsFilter.length && !all && !clearExisting
  const initialCandidateCount = candidates.length
  let existingClassifications = null
  let skippedAlreadyClassified = 0
  let missingCount = 0
  let erroredCount = 0
  let staleCount = 0

  if (appliedMissingOnly) {
    existingClassifications = await fetchExistingClassifications(candidates.map((c) => c.pmid))
    candidates = candidates.filter((pub) => {
      const existing = existingClassifications.get(String(pub.pmid))
      if (existing) {
        if (existing.status === 'error') {
          erroredCount += 1
          return true
        }
        const runAtTs = existing.runAt ? Date.parse(existing.runAt) : null
        const isStale = cacheGeneratedAtTs && runAtTs && runAtTs < cacheGeneratedAtTs
        if (isStale || !runAtTs) {
          staleCount += 1
        }
        skippedAlreadyClassified += 1
        return false
      }
      missingCount += 1
      return true
    })
  }

  if (!pmidsFilter.length && !all) {
    candidates = candidates.slice(0, requestedCount)
  }

  const selection = {
    appliedMissingOnly,
    requestedCount,
    totalAvailable: publications.length,
    yearFilter: yearFilter || null,
    pmidsProvided: pmidsFilter.length,
    initialCandidateCount,
    skippedAlreadyClassified,
    missingCount,
    erroredCount,
    staleCount,
    selectedCount: candidates.length,
    cacheGeneratedAt: cache?.generatedAt || null,
    targetPmids: candidates.map((c) => c.pmid),
    targetPreview: candidates.slice(0, 20).map((c) => ({
      pmid: c.pmid,
      title: c.title,
      year: c.year || null,
    })),
  }

  if (!candidates.length) {
    return {
      count: 0,
      usedPrompt: classificationPrompt,
      provider,
      model,
      selection,
      dryRun,
      message: appliedMissingOnly ? 'No unclassified publications found.' : 'No publications selected.',
    }
  }

  if (dryRun) {
    return {
      count: 0,
      usedPrompt: classificationPrompt,
      provider,
      model,
      selection,
      dryRun: true,
      message: 'Dry run only. No classifications were written.',
    }
  }

  if (clearExisting) {
    await deleteClassifications(candidates.map((c) => c.pmid))
  }

  const existingIdMap = !clearExisting && existingClassifications
    ? new Map(
      [...existingClassifications.entries()]
        .filter(([, info]) => info?.id)
        .map(([pmid, info]) => [pmid, info.id])
    )
    : null

  const meta = { promptText: classificationPrompt, promptVersion: null, provider, model }
  let processed = 0

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize)
    const entries = []

    for (let j = 0; j < batch.length; j += concurrency) {
      const chunk = batch.slice(j, j + concurrency)
      const results = await Promise.all(
        chunk.map(async (pub) => {
          try {
            const classification = await classifyPublication(
              {
                title: pub.title,
                abstract: pub.abstract || '',
                laySummary: pub.laySummary || ''
              },
              {
                provider,
                model,
                apiKey,
                systemPrompt,
                classificationPrompt,
                debug: false
              }
            )
            return {
              pmid: pub.pmid,
              title: pub.title || null,
              summary: pub.laySummary || null,
              topics: classification.topics || [],
              studyDesign: classification.studyDesign || [],
              methodologicalFocus: classification.methodologicalFocus || [],
              exclude: Boolean(classification.exclude),
              error: null
            }
          } catch (err) {
            return {
              pmid: pub.pmid,
              title: pub.title || null,
              summary: pub.laySummary || null,
              topics: [],
              studyDesign: [],
              methodologicalFocus: [],
              exclude: false,
              error: err?.message || 'Classification failed'
            }
          }
        })
      )
      entries.push(...results)
    }

    await upsertClassifications(entries, meta, existingIdMap)
    processed += entries.length

    if (delayMs > 0 && i + batchSize < candidates.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }

  return {
    count: processed,
    usedPrompt: classificationPrompt,
    provider,
    model,
    selection,
    dryRun: false,
  }
}
