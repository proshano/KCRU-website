import { defineConfig } from 'sanity'
import { deskTool } from 'sanity/desk'
import { visionTool } from '@sanity/vision'
import { schemaTypes } from './sanity/schemas'
import { pubmedCacheRefreshAction } from './sanity/plugins/pubmedCacheRefreshAction'
import { pubmedCacheTool } from './sanity/plugins/pubmedCacheTool'
import { trialSyncAction } from './sanity/plugins/trialSyncAction'

export default defineConfig({
  name: 'kcru-website',
  title: 'KCRU Website',
  // Fallback values so Studio can start even if env vars aren't loaded
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 't6eeltne',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  plugins: [
    deskTool(),
    visionTool(),
    pubmedCacheRefreshAction(),
    pubmedCacheTool(),
    trialSyncAction()
  ],
  schema: {
    types: schemaTypes,
  },
})
