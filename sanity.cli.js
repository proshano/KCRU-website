import { defineCliConfig } from 'sanity/cli'

const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET

if (!projectId) {
  throw new Error('Missing NEXT_PUBLIC_SANITY_PROJECT_ID. Set it in the environment.')
}

if (!dataset) {
  throw new Error('Missing NEXT_PUBLIC_SANITY_DATASET. Set it in the environment.')
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
