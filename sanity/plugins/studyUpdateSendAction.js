import { useState } from 'react'
import { definePlugin } from 'sanity'
import { useToast } from '@sanity/ui'

const SEND_URL =
  process.env.SANITY_STUDIO_STUDY_UPDATE_SEND_URL || 'http://localhost:3000/api/updates/study-email/dispatch'
const AUTH_TOKEN = process.env.SANITY_STUDIO_STUDY_UPDATE_SEND_TOKEN || ''

function StudyUpdateSendAction(props) {
  const toast = useToast()
  const [isRunning, setIsRunning] = useState(false)

  async function handleSend() {
    setIsRunning(true)
    try {
      const res = await fetch(SEND_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
        },
        body: JSON.stringify({ trigger: 'sanity-action' }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const msg = data?.error || `Request failed (${res.status})`
        throw new Error(msg)
      }

      const stats = data?.stats || {}
      const sent = Number(stats.sent || 0)
      const total = Number(stats.total || 0)
      const errors = Number(stats.errors || 0)

      toast.push({
        status: errors ? 'warning' : 'success',
        title: errors ? 'Study updates sent with errors' : 'Study updates sent',
        description: `${sent} of ${total} delivered${errors ? ` • ${errors} failed` : ''}`,
      })
    } catch (err) {
      console.error('Study update send failed', err)
      toast.push({
        status: 'error',
        title: 'Send failed',
        description: err.message || 'Unable to send study update emails',
      })
    } finally {
      setIsRunning(false)
      props.onComplete?.()
    }
  }

  return {
    ...props,
    label: isRunning ? 'Sending...' : 'Send study updates now',
    tone: 'primary',
    disabled: isRunning,
    onHandle: handleSend,
  }
}

export const studyUpdateSendAction = definePlugin(() => ({
  name: 'study-update-send-action',
  document: {
    actions: (prev, context) => {
      if (context.schemaType !== 'siteSettings') return prev
      return [...prev, StudyUpdateSendAction]
    },
  },
}))
