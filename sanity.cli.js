import { defineCliConfig } from 'sanity/cli'
import { loadEnvFiles } from './sanity/env.js'

loadEnvFiles()

const projectId = process.env.SANITY_STUDIO_PROJECT_ID
const dataset = process.env.SANITY_STUDIO_DATASET

if (!projectId) {
  throw new Error('Missing SANITY_STUDIO_PROJECT_ID. Set it in the environment.')
}

if (!dataset) {
  throw new Error('Missing SANITY_STUDIO_DATASET. Set it in the environment.')
}

// CLI config so `sanity deploy` knows which project/dataset to target.
export default defineCliConfig({
  api: {
    projectId,
    dataset
  },
  // Configure Vite to handle prismjs module resolution
  vite: {
    resolve: {
      alias: {
        // Handle prismjs module resolution for refractor compatibility
        'prismjs/components/prism-core': 'prismjs',
      },
    },
    optimizeDeps: {
      include: ['prismjs'],
    },
  }
  // Uncomment to lock to a custom Studio subdomain:
  // studioHost: 'your-subdomain'
})
