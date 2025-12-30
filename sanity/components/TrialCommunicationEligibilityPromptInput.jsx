import React, { useCallback } from 'react'
import { Card, Stack, Button, Text, Code } from '@sanity/ui'
import { set } from 'sanity'
import { TRIAL_COMMUNICATION_ELIGIBILITY_PROMPT } from '../../lib/summaries.js'

export function TrialCommunicationEligibilityPromptInput(props) {
  const { onChange, renderDefault } = props

  const handleUseDefault = useCallback(() => {
    onChange(set(TRIAL_COMMUNICATION_ELIGIBILITY_PROMPT))
  }, [onChange])

  return (
    <Stack space={3}>
      {renderDefault({
        ...props,
        elementProps: {
          ...props.elementProps,
          placeholder: 'Leave blank to use the built-in default prompt for eligibility statements'
        }
      })}
      <Card padding={3} radius={2} shadow={1} tone="primary" border>
        <Stack space={3}>
          <Text size={1}>
            Leave empty to keep using the default eligibility statement prompt. Click below only if you want to copy
            the default into the field and edit it.
          </Text>
          <Button
            text="Copy default eligibility statement prompt into field"
            mode="ghost"
            tone="primary"
            onClick={handleUseDefault}
          />
          <Card padding={3} radius={2} tone="transparent" border>
            <Stack space={2}>
              <Text size={1} weight="semibold">Default eligibility statement prompt (reference):</Text>
              <Code style={{ whiteSpace: 'pre-wrap' }}>
                {TRIAL_COMMUNICATION_ELIGIBILITY_PROMPT}
              </Code>
            </Stack>
          </Card>
        </Stack>
      </Card>
    </Stack>
  )
}
