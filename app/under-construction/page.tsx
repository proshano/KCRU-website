import UnderConstructionClient from './client'
import { getMaintenanceSettings } from '@/lib/sanity/client'

export const revalidate = 0

export default async function UnderConstructionPage() {
  const settings = await getMaintenanceSettings()
  const { title, message, contactInfo, unitName } = settings || {}

  return (
    <UnderConstructionClient
      settings={{
        title,
        message,
        contactInfo,
        unitName
      }}
    />
  )
}
