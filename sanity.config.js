import { defineConfig } from 'sanity'
import { deskTool } from 'sanity/desk'
import { visionTool } from '@sanity/vision'
import { schemaTypes } from './sanity/schemas'
import { pubmedCacheRefreshAction } from './sanity/plugins/pubmedCacheRefreshAction'
import { pubmedCacheTool } from './sanity/plugins/pubmedCacheTool'
import { trialSyncAction } from './sanity/plugins/trialSyncAction'
import { pubmedClassificationTool } from './sanity/plugins/pubmedClassificationTool'
import { studyUpdateSendAction } from './sanity/plugins/studyUpdateSendAction'
import { seoRefreshAction } from './sanity/plugins/seoRefreshAction'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET

if (!projectId) {
  throw new Error('Missing NEXT_PUBLIC_SANITY_PROJECT_ID. Set it in the environment.')
}

if (!dataset) {
  throw new Error('Missing NEXT_PUBLIC_SANITY_DATASET. Set it in the environment.')
}

export default defineConfig({
  name: 'kcru-website',
  title: 'KCRU Website',
  projectId,
  dataset,
  plugins: [
    deskTool(),
    visionTool(),
    pubmedCacheRefreshAction(),
    seoRefreshAction(),
    pubmedCacheTool(),
    pubmedClassificationTool(),
    trialSyncAction(),
    studyUpdateSendAction()
  ],
  schema: {
    types: schemaTypes,
  },
})
