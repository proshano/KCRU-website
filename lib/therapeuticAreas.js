import { sanityFetch, queries } from '@/lib/sanity'

export const ALL_THERAPEUTIC_AREAS_VALUE = 'all'

const THERAPEUTIC_AREA_QUERY = queries?.therapeuticAreasMinimal || `
  *[_type == "therapeuticArea" && active == true] | order(order asc, name asc) {
    _id,
    name,
    shortLabel,
    "slug": slug.current
  }
`

export async function fetchTherapeuticAreas(fetcher = sanityFetch) {
  const rows = await fetcher(THERAPEUTIC_AREA_QUERY)
  return Array.isArray(rows) ? rows : []
}

export function formatTherapeuticAreaTitle(area) {
  const name = String(area?.name || '').trim()
  if (!name) return ''
  if (area?.shortLabel) {
    return `${area.shortLabel} - ${name}`
  }
  return name
}

export function buildTherapeuticAreaOptions(areas, { includeAll = true } = {}) {
  const options = (areas || [])
    .map((area) => {
      const title = formatTherapeuticAreaTitle(area)
      if (!title || !area?._id) return null
      return { value: area._id, title }
    })
    .filter(Boolean)

  if (includeAll) {
    options.unshift({ value: ALL_THERAPEUTIC_AREAS_VALUE, title: 'All areas' })
  }
  return options
}

function normalizeAreaKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[–—]/g, '-')
    .replace(/_/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeAreaKeyLoose(value) {
  const base = normalizeAreaKey(value)
  if (!base) return ''
  return base.replace(/\band\b/g, '').replace(/\s+/g, ' ').trim()
}

function normalizeLegacyValue(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeLegacyValueLoose(value) {
  const base = normalizeLegacyValue(value)
  if (!base) return ''
  return base.replace(/_and_/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')
}

export function buildTherapeuticAreaLookup(areas) {
  const byId = new Map()
  const byKey = new Map()

  for (const area of areas || []) {
    if (area?._id) {
      byId.set(area._id, area)
    }
    const nameKey = normalizeAreaKey(area?.name)
    const nameLooseKey = normalizeAreaKeyLoose(area?.name)
    const slugKey = normalizeAreaKey(area?.slug)
    const slugLooseKey = normalizeAreaKeyLoose(area?.slug)
    for (const key of [nameKey, nameLooseKey, slugKey, slugLooseKey]) {
      if (key && !byKey.has(key)) {
        byKey.set(key, area)
      }
    }
  }

  return { byId, byKey }
}

export function resolveTherapeuticAreaIds(values, areas) {
  const { byId, byKey } = buildTherapeuticAreaLookup(areas)
  const seen = new Set()
  const resolved = []
  const items = Array.isArray(values) ? values : []

  for (const item of items) {
    if (!item) continue
    let id = ''
    if (typeof item === 'string') {
      if (item === ALL_THERAPEUTIC_AREAS_VALUE) {
        continue
      }
      if (byId.has(item)) {
        id = item
      } else {
        const key = normalizeAreaKey(item)
        const looseKey = normalizeAreaKeyLoose(item)
        const match = key ? byKey.get(key) : null
        const looseMatch = !match && looseKey ? byKey.get(looseKey) : null
        const resolvedMatch = match || looseMatch
        id = resolvedMatch?._id || ''
      }
    } else if (typeof item === 'object') {
      id = item._ref || item._id || ''
    }

    if (!id || seen.has(id)) continue
    if (!byId.has(id)) continue
    seen.add(id)
    resolved.push(id)
  }

  return resolved
}

export function resolveTherapeuticAreaLegacyValues(ids, areas) {
  const byId = new Map((areas || []).map((area) => [area?._id, area]))
  const seen = new Set()
  const legacyValues = []

  for (const id of ids || []) {
    const area = byId.get(id)
    if (!area) continue
    const source = area?.name || area?.slug
    const candidates = [normalizeLegacyValue(source), normalizeLegacyValueLoose(source)]
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) continue
      seen.add(candidate)
      legacyValues.push(candidate)
    }
  }

  return legacyValues
}

export function buildReferenceList(ids) {
  const unique = Array.from(new Set((ids || []).filter(Boolean)))
  return unique.map((id) => ({ _type: 'reference', _ref: id, _key: id }))
}
