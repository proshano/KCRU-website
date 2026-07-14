import { normalizeList } from './inputUtils.js'

export function normalizeAllowedAudienceFilter(values, allowedValues) {
  const requested = normalizeList(values)
  const accepted = requested.filter((value) => allowedValues.has(value))
  return {
    values: accepted,
    invalidValues: requested.filter((value) => !allowedValues.has(value)),
  }
}
