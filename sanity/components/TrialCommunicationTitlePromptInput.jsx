import React, { useCallback } from 'react'
import { Card, Stack, Button, Text, Code } from '@sanity/ui'
import { set } from 'sanity'
import { TRIAL_COMMUNICATION_TITLE_PROMPT } from '../../lib/summaries.js'

export function TrialCommunicationTitlePromptInput(props) {
  const { onChange, renderDefault } = props

  const handleUseDefault = useCallback(() => {
    onChange(set(TRIAL_COMMUNICATION_TITLE_PROMPT))
  }, [onChange])

  return (
    <Stack space={3}>
      {renderDefault({
        ...props,
        elementProps: {
          ...props.elementProps,
          placeholder: 'Leave blank to use the built-in default prompt for short clinical titles'
        }
      })}
      <Card padding={3} radius={2} shadow={1} tone="primary" border>
        <Stack space={3}>
          <Text size={1}>
            Leave empty to keep using the default short clinical title prompt. Click below only if you want to copy
            the default into the field and edit it.
          </Text>
          <Button
            text="Copy default short clinical title prompt into field"
            mode="ghost"
            tone="primary"
            onClick={handleUseDefault}
          />
          <Card padding={3} radius={2} tone="transparent" border>
            <Stack space={2}>
              <Text size={1} weight="semibold">Default short clinical title prompt (reference):</Text>
              <Code style={{ whiteSpace: 'pre-wrap' }}>
                {TRIAL_COMMUNICATION_TITLE_PROMPT}
              </Code>
            </Stack>
          </Card>
        </Stack>
      </Card>
    </Stack>
  )
}
