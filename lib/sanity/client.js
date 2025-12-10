import { createClient } from '@sanity/client'

// Dedicated client for maintenance mode checks to avoid CDN caching
const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || 't6eeltne'
const dataset = process.env.NEXT_PUBLIC_SANITY_DATASET || 'production'

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
