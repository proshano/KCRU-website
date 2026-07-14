import { definePlugin } from 'sanity'

const WORKFLOW_URL =
  process.env.SANITY_STUDIO_STUDY_UPDATE_WORKFLOW_URL ||
  'https://github.com/proshano/KCRU-website/actions/workflows/study-email.yml'

function StudyUpdateSendAction(props) {
  return {
    ...props,
    label: 'Open study update workflow',
    onHandle: () => {
      if (typeof window !== 'undefined') {
        window.open(WORKFLOW_URL, '_blank', 'noopener,noreferrer')
      }
      props.onComplete?.()
    },
  }
}

export const studyUpdateSendAction = definePlugin(() => ({
  name: 'study-update-send-action',
  document: {
    actions: (previous, context) => {
      if (context.schemaType !== 'siteSettings') return previous
      return [...previous, StudyUpdateSendAction]
    },
  },
}))
