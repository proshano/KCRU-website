import React, { useCallback } from 'react'
import { Card, Stack, Button, Text, Code } from '@sanity/ui'
import { set } from 'sanity'
import { TRIAL_SUMMARY_SYSTEM_PROMPT } from '../../lib/summaries.js'

export function TrialSummaryPromptInput(props) {
  const { onChange, renderDefault } = props

  const handleUseDefault = useCallback(() => {
    onChange(set(TRIAL_SUMMARY_SYSTEM_PROMPT))
  }, [onChange])

  return (
    <Stack space={3}>
      {renderDefault({
        ...props,
        elementProps: {
          ...props.elementProps,
          placeholder: 'Leave blank to use the built-in default prompt for trial summaries'
        }
      })}
      <Card padding={3} radius={2} shadow={1} tone="primary" border>
        <Stack space={3}>
          <Text size={1}>
            Leave empty to keep using the default trial summary prompt. Click below only if you want to copy
            the default into the field and edit it.
          </Text>
          <Button
            text="Copy default trial summary prompt into field"
            mode="ghost"
            tone="primary"
            onClick={handleUseDefault}
          />
          <Card padding={3} radius={2} tone="transparent" border>
            <Stack space={2}>
              <Text size={1} weight="semibold">Default trial summary prompt (reference):</Text>
              <Code style={{ whiteSpace: 'pre-wrap' }}>
                {TRIAL_SUMMARY_SYSTEM_PROMPT}
              </Code>
            </Stack>
          </Card>
        </Stack>
      </Card>
    </Stack>
  )
}
