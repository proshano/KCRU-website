'use client'

import { useCallback, useEffect } from 'react'
import { Stack, TextInput, Text, Card } from '@sanity/ui'
import { set, unset, useFormValue } from 'sanity'

// Generate a URL-friendly slug from text
function slugify(text) {
  if (!text) return ''
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

/**
 * Auto-generating slug input that updates when the source field changes.
 * Use with options: { source: 'title' } or { source: 'name' }
 */
export default function AutoSlugInput(props) {
  const { value, onChange, schemaType, readOnly } = props
  
  // Get the source field name from schema options
  const sourceField = schemaType?.options?.source || 'title'
  
  // Watch the source field value
  const sourceValue = useFormValue([sourceField])
  
  // Current slug value
  const currentSlug = value?.current || ''
  
  // Auto-generate slug when source changes and slug is empty or matches old auto-generated pattern
  useEffect(() => {
    if (readOnly) return
    if (!sourceValue) return
    
    const newSlug = slugify(sourceValue)
    
    // Only auto-update if:
    // 1. Current slug is empty, OR
    // 2. Current slug exactly matches what would be generated from source (hasn't been manually edited)
    if (!currentSlug || currentSlug === newSlug) {
      // Already up to date
      return
    }
    
    // If slug is empty, auto-generate
    if (!currentSlug) {
      onChange(set({ _type: 'slug', current: newSlug }))
    }
  }, [sourceValue, currentSlug, readOnly, onChange])
  
  // Auto-generate on first render if empty
  useEffect(() => {
    if (!currentSlug && sourceValue && !readOnly) {
      const newSlug = slugify(sourceValue)
      if (newSlug) {
        onChange(set({ _type: 'slug', current: newSlug }))
      }
    }
  }, []) // Only run once on mount
  
  const handleChange = useCallback((event) => {
    const inputValue = event.currentTarget.value
    if (inputValue) {
      onChange(set({ _type: 'slug', current: slugify(inputValue) }))
    } else {
      onChange(unset())
    }
  }, [onChange])
  
  const handleGenerateClick = useCallback(() => {
    if (sourceValue) {
      onChange(set({ _type: 'slug', current: slugify(sourceValue) }))
    }
  }, [sourceValue, onChange])
  
  return (
    <Stack space={2}>
      <TextInput
        value={currentSlug}
        onChange={handleChange}
        readOnly={readOnly}
        placeholder="auto-generated-from-title"
      />
      {!currentSlug && sourceValue && (
        <Text size={1} muted>
          Slug will be auto-generated: <strong>{slugify(sourceValue)}</strong>
        </Text>
      )}
      {currentSlug && (
        <Text size={1} muted>
          URL: .../{currentSlug}
        </Text>
      )}
    </Stack>
  )
}






