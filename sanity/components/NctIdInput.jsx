import { TextInput, Stack, Text, Card, Flex } from '@sanity/ui'
import { useCallback } from 'react'
import { set, unset } from 'sanity'

/**
 * Custom input component for NCT ID field
 * Provides validation feedback and link to ClinicalTrials.gov
 */
export default function NctIdInput(props) {
  const { value, onChange, id, readOnly, onBlur, onFocus } = props
  
  const isValid = value && /^NCT\d{8}$/i.test(value)
  const ctGovUrl = isValid ? `https://clinicaltrials.gov/study/${value.toUpperCase()}` : null

  const handleChange = useCallback((event) => {
    const newValue = event.currentTarget.value.toUpperCase()
    onChange(newValue ? set(newValue) : unset())
  }, [onChange])

  return (
    <Stack space={3}>
      <TextInput
        id={id}
        value={value || ''}
        onChange={handleChange}
        onBlur={onBlur}
        onFocus={onFocus}
        readOnly={readOnly}
        placeholder="NCT12345678"
      />
      
      {value && (
        <Card padding={3} radius={2} tone={isValid ? 'positive' : 'caution'}>
          <Stack space={2}>
            <Flex align="center" gap={2}>
              <Text size={1} weight="medium">
                {isValid ? '✓ Valid NCT ID' : '⚠ Enter NCT followed by 8 digits'}
              </Text>
              {ctGovUrl && (
                <Text size={1}>
                  <a 
                    href={ctGovUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    style={{ color: 'inherit' }}
                  >
                    View on ClinicalTrials.gov ↗
                  </a>
                </Text>
              )}
            </Flex>
            {isValid && (
              <Text size={1} muted>
                👆 Click <strong>"Fetch from ClinicalTrials.gov"</strong> button above to import study details
              </Text>
            )}
          </Stack>
        </Card>
      )}
    </Stack>
  )
}
