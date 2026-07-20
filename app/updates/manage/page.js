import { Suspense } from 'react'
import { ROLE_OPTIONS, SPECIALTY_OPTIONS, CORRESPONDENCE_OPTIONS } from '@/lib/communicationOptions'
import { getPublicCorrespondenceOptions } from '@/lib/researchDigestPublic'
import { sanityFetch, queries } from '@/lib/sanity'
import { buildSiteOptions, fetchSites } from '@/lib/sites'
import { buildTherapeuticAreaOptions, fetchTherapeuticAreas } from '@/lib/therapeuticAreas'
import ManagePreferencesClient from './ManagePreferencesClient'

export const revalidate = 3600

export default async function ManageUpdatesPage() {
  const [settingsRaw, areas, sites] = await Promise.all([
    sanityFetch(queries.siteSettings),
    fetchTherapeuticAreas(),
    fetchSites(),
  ])
  const settings = JSON.parse(JSON.stringify(settingsRaw || {}))
  const interestAreaOptions = buildTherapeuticAreaOptions(areas)
  const practiceSiteOptions = buildSiteOptions(sites)

  return (
    <main className="max-w-[1000px] mx-auto px-6 md:px-12 py-12">
      <Suspense fallback={<div className="bg-white border border-black/[0.06] p-6 shadow-sm animate-pulse h-64" />}>
        <ManagePreferencesClient
          roleOptions={ROLE_OPTIONS}
          specialtyOptions={SPECIALTY_OPTIONS}
          interestAreaOptions={interestAreaOptions}
          practiceSiteOptions={practiceSiteOptions}
          correspondenceOptions={getPublicCorrespondenceOptions(CORRESPONDENCE_OPTIONS, settings)}
        />
      </Suspense>
    </main>
  )
}
