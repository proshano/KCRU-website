import { definePlugin } from 'sanity'

const WORKFLOW_URL =
  process.env.SANITY_STUDIO_PUBMED_WORKFLOW_URL ||
  'https://github.com/proshano/KCRU-website/actions/workflows/pubmed-refresh.yml'

function SeoRefreshAction(props) {
  return {
    ...props,
    label: 'Open SEO refresh workflow',
    onHandle: () => {
      if (typeof window !== 'undefined') {
        window.open(WORKFLOW_URL, '_blank', 'noopener,noreferrer')
      }
      props.onComplete?.()
    },
  }
}

export const seoRefreshAction = definePlugin(() => ({
  name: 'seo-refresh-action',
  document: {
    actions: (previous, context) => {
      if (context.schemaType !== 'siteSettings') return previous
      return [...previous, SeoRefreshAction]
    },
  },
}))
