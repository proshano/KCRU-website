import { sanityFetch, queries } from '@/lib/sanity'
import { ROLE_OPTIONS } from '@/lib/communicationOptions'
import ManagePreferencesClient from './ManagePreferencesClient'

export const revalidate = 3600

export default async function ManageUpdatesPage() {
  const areasRaw = await sanityFetch(queries.therapeuticAreas)
  const therapeuticAreas = JSON.parse(JSON.stringify(areasRaw || []))

  return (
    <main className="max-w-[1000px] mx-auto px-6 md:px-12 py-12">
      <ManagePreferencesClient roleOptions={ROLE_OPTIONS} therapeuticAreas={therapeuticAreas} />
    </main>
  )
}
