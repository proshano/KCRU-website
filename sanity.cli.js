import { defineCliConfig } from 'sanity/cli'

// CLI config so `sanity deploy` knows which project/dataset to target.
// Uses env vars if present, otherwise falls back to the defaults used in sanity.config.js.
export default defineCliConfig({
  api: {
    projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 't6eeltne',
    dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'
  }
  // Uncomment to lock to a custom Studio subdomain:
  // studioHost: 'your-subdomain'
})

