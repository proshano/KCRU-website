import { NextResponse } from 'next/server'
import { client as sanityClient, writeClient as sanityWriteClient, sanityFetch, queries } from '@/lib/sanity'
import { generateLaySummary } from '@/lib/summaries'

const AUTH_TOKEN = process.env.PUBMED_REFRESH_TOKEN || ''
const CACHE_DOC_ID = 'pubmedCache'
const CACHE_DOC_TYPE = 'pubmedCache'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

function extractToken(request) {
  const header = request.headers.get('authorization') || ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  return header
}

/**
 * DELETE - Remove a publication from the cache by PMID
 */
export async function DELETE(request) {
  if (AUTH_TOKEN) {
    const token = extractToken(request)
    if (token !== AUTH_TOKEN) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
    }
  }

  try {
    const { searchParams } = new URL(request.url)
    const pmid = searchParams.get('pmid')
    
    if (!pmid) {
      return NextResponse.json({ ok: false, error: 'Missing pmid parameter' }, { status: 400, headers: CORS_HEADERS })
    }

    // Get current cache
    const cache = await sanityClient.fetch(`*[_type == "pubmedCache" && _id == "pubmedCache"][0]`)
    if (!cache) {
      return NextResponse.json({ ok: false, error: 'No cache found' }, { status: 404, headers: CORS_HEADERS })
    }

    // Filter out the publication
    const filteredPubs = (cache.publications || []).filter(p => p.pmid !== pmid)
    
    if (filteredPubs.length === cache.publications?.length) {
      return NextResponse.json({ ok: false, error: 'Publication not found in cache' }, { status: 404, headers: CORS_HEADERS })
    }

    // Update cache in Sanity using createOrReplace for reliability
    const updatedDoc = {
      ...cache,
      _id: CACHE_DOC_ID,
      _type: CACHE_DOC_TYPE,
      publications: filteredPubs,
      stats: {
        ...cache.stats,
        totalPublications: filteredPubs.length,
        totalWithSummary: filteredPubs.filter(p => p.laySummary).length,
      },
    }
    await sanityWriteClient.createOrReplace(updatedDoc)

    return NextResponse.json({ 
      ok: true, 
      message: `Deleted publication ${pmid}`,
      remaining: filteredPubs.length 
    }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[pubmed] delete publication failed', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Delete failed' }, { status: 500, headers: CORS_HEADERS })
  }
}

/**
 * POST - Regenerate summary for a specific publication
 */
export async function POST(request) {
  console.log('[pubmed/publication] POST request received')
  
  if (AUTH_TOKEN) {
    const token = extractToken(request)
    if (token !== AUTH_TOKEN) {
      console.log('[pubmed/publication] Unauthorized - token mismatch')
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
    }
  }

  try {
    const body = await request.json()
    const pmid = body?.pmid
    console.log('[pubmed/publication] Regenerating summary for PMID:', pmid)
    
    if (!pmid) {
      return NextResponse.json({ ok: false, error: 'Missing pmid' }, { status: 400, headers: CORS_HEADERS })
    }

    // Get current cache
    const cache = await sanityClient.fetch(`*[_type == "pubmedCache" && _id == "pubmedCache"][0]`)
    if (!cache) {
      return NextResponse.json({ ok: false, error: 'No cache found' }, { status: 404, headers: CORS_HEADERS })
    }

    // Find the publication
    const pubIndex = (cache.publications || []).findIndex(p => p.pmid === pmid)
    if (pubIndex === -1) {
      return NextResponse.json({ ok: false, error: 'Publication not found in cache' }, { status: 404, headers: CORS_HEADERS })
    }

    const pub = cache.publications[pubIndex]
    
    if (!pub.abstract || pub.abstract.length < 50) {
      return NextResponse.json({ ok: false, error: 'Publication has no abstract - cannot generate summary' }, { status: 400, headers: CORS_HEADERS })
    }

    // Fetch settings from Sanity
    const settings = (await sanityFetch(queries.siteSettings)) || {}
    const provider = settings.llmProvider || 'openrouter'
    const model = settings.llmModel || undefined
    const apiKey = settings.llmApiKey || undefined
    
    console.log('[pubmed/publication] Using LLM settings:', { provider, model: model || '(default)' })

    // Generate new summary using settings
    const result = await generateLaySummary(pub.title, pub.abstract, {
      provider,
      model,
      apiKey,
      meta: { pmid: pub.pmid },
      debug: true
    })

    if (!result?.summary) {
      return NextResponse.json({ ok: false, error: 'Failed to generate summary' }, { status: 500, headers: CORS_HEADERS })
    }

    // Update the publication in the cache
    const updatedPubs = [...cache.publications]
    updatedPubs[pubIndex] = {
      ...pub,
      laySummary: result.summary,
      topics: result.topics || pub.topics || [],
      studyDesign: result.studyDesign || pub.studyDesign || [],
      methodologicalFocus: result.methodologicalFocus || pub.methodologicalFocus || [],
    }

    // Save to Sanity using createOrReplace for reliability
    const updatedDoc = {
      ...cache,
      _id: CACHE_DOC_ID,
      _type: CACHE_DOC_TYPE,
      publications: updatedPubs,
      stats: {
        ...cache.stats,
        totalWithSummary: updatedPubs.filter(p => p.laySummary).length,
      },
    }
    console.log('[pubmed/publication] Saving updated cache to Sanity...')
    await sanityWriteClient.createOrReplace(updatedDoc)
    console.log('[pubmed/publication] Successfully saved to Sanity')

    return NextResponse.json({ 
      ok: true, 
      pmid,
      summary: result.summary,
      topics: result.topics,
      studyDesign: result.studyDesign,
      methodologicalFocus: result.methodologicalFocus,
    }, { headers: CORS_HEADERS })
  } catch (err) {
    console.error('[pubmed] regenerate summary failed', err)
    return NextResponse.json({ ok: false, error: err?.message || 'Regenerate failed' }, { status: 500, headers: CORS_HEADERS })
  }
}

export const revalidate = 0
export const dynamic = 'force-dynamic'




