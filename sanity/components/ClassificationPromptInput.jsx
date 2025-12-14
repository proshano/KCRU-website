import React, { useCallback } from 'react'
import { Card, Stack, Button, Text, Code } from '@sanity/ui'
import { set } from 'sanity'
import { DEFAULT_CLASSIFICATION_PROMPT } from '../../lib/classificationPrompt.js'

/**
 * Custom input for the LLM Classification Prompt field.
 * Guidance:
 * - Leave empty to use the built-in default.
 * - Click "Copy default into field" only if you want to edit the default.
 * Shows a reference preview of the default.
 */
export function ClassificationPromptInput(props) {
  const { onChange, renderDefault } = props

  const handleUseDefault = useCallback(() => {
    onChange(set(DEFAULT_CLASSIFICATION_PROMPT))
  }, [onChange])

  return (
    <Stack space={3}>
      {renderDefault({
        ...props,
        elementProps: {
          ...props.elementProps,
          placeholder: 'Leave blank to use the built-in default prompt'
        }
      })}
      <Card padding={3} radius={2} shadow={1} tone="primary" border>
        <Stack space={3}>
          <Text size={1}>
            Leave empty to keep using the default. Click below only if you want to copy
            the default into the field and edit it.
          </Text>
          <Button
            text="Copy default into field"
            mode="ghost"
            tone="primary"
            onClick={handleUseDefault}
          />
          <Card padding={3} radius={2} tone="transparent" border>
            <Stack space={2}>
              <Text size={1} weight="semibold">Default prompt (reference):</Text>
              <Code style={{ whiteSpace: 'pre-wrap' }}>
                {DEFAULT_CLASSIFICATION_PROMPT}
              </Code>
            </Stack>
          </Card>
        </Stack>
      </Card>
    </Stack>
  )
}
