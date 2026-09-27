// Shared styles and helpers for the /admin/people components.

export const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded bg-purple px-4 py-2 text-sm font-semibold text-white hover:bg-purple/90 disabled:opacity-50'
export const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded border border-black/20 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50'
export const DANGER_BUTTON =
  'inline-flex items-center justify-center rounded border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50'
export const SMALL_BUTTON =
  'inline-flex items-center justify-center rounded border border-black/15 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50'
export const INPUT =
  'w-full rounded border border-black/15 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple'
export const CARD = 'rounded-xl border border-black/10 bg-white p-5 shadow-sm md:p-6'

export function StatusMessage({ status }) {
  if (!status?.message) return null
  const tone =
    status.type === 'error' ? 'text-red-700' : status.type === 'warning' ? 'text-amber-800' : 'text-emerald-700'
  return (
    <p role="status" className={`text-sm ${tone}`}>
      {status.message}
    </p>
  )
}

export function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString()
}

// Throws an Error carrying the HTTP status and parsed body when the request fails.
export async function requestJson(url, { method = 'GET', body } = {}) {
  const response = await fetch(url, {
    method,
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error || `The request failed (${response.status}).`)
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}
