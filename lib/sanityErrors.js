const PERMISSION_PATTERNS = [
  'insufficient permissions',
  'permission "create" required',
  'permission "update" required',
  'permission "delete" required',
  'permission "read" required',
  'permission "write" required',
]

function extractSanityErrorMessage(error) {
  if (!error) return ''
  const description = error?.response?.body?.error?.description
  if (typeof description === 'string' && description.trim()) return description.trim()
  if (typeof error?.message === 'string' && error.message.trim()) return error.message.trim()
  return ''
}

export function getSanityWriteErrorMessage(
  error,
  { fallback = 'Request failed.', context = 'Sign-in' } = {}
) {
  const message = extractSanityErrorMessage(error)
  const normalized = message.toLowerCase()
  const statusCode = error?.statusCode || error?.response?.statusCode
  const isPermissionError =
    statusCode === 401 ||
    statusCode === 403 ||
    PERMISSION_PATTERNS.some((pattern) => normalized.includes(pattern))

  if (isPermissionError) {
    const label = context ? `${context} is temporarily unavailable.` : 'Sign-in is temporarily unavailable.'
    return `${label} Please contact the site administrator.`
  }

  return message || fallback
}
