import { createClient } from '@sanity/client'

// Dedicated client for maintenance mode checks to avoid CDN caching
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET

if (!projectId) {
  throw new Error('Missing NEXT_PUBLIC_SANITY_PROJECT_ID. Set it in the environment.')
}

if (!dataset) {
  throw new Error('Missing NEXT_PUBLIC_SANITY_DATASET. Set it in the environment.')
}

export const client = createClient({
  projectId,
  dataset,
  apiVersion: '2024-01-01',
  useCdn: false,
  token: process.env.SANITY_API_TOKEN
})

export async function getMaintenanceSettings() {
  return client.fetch(`
    *[_type == "siteSettings"][0]{
      "enabled": maintenanceMode.enabled,
      "password": maintenanceMode.password,
      "title": maintenanceMode.title,
      "message": maintenanceMode.message,
      "contactInfo": maintenanceMode.contactInfo,
      unitName
    }
  `)
}
