import { useState, useCallback } from 'react'
import { definePlugin, useClient } from 'sanity'

// Use Next.js app URL - Sanity Studio runs on different port
const NEXT_APP_URL = process.env.SANITY_STUDIO_NEXT_APP_URL || 'http://localhost:3000'
const SYNC_URL = `${NEXT_APP_URL}/api/trials/sync`

/**
 * Document action to sync trial data from ClinicalTrials.gov
 */
function TrialSyncAction(props) {
  const { id, type, draft, published, onComplete } = props
  const client = useClient({ apiVersion: '2024-01-01' })
  const [isSyncing, setIsSyncing] = useState(false)

  // Get current document (prefer draft over published)
  const doc = draft || published
  const nctId = doc?.nctId
  const ctGovData = doc?.ctGovData
  const lastSyncedAt = ctGovData?.lastSyncedAt
  const hasBeenSynced = !!lastSyncedAt
  const isValidNctId = nctId && /^NCT\d{8}$/i.test(nctId)
  
  // Check if this is a brand new document (no draft or published version exists)
  const isNewDocument = !draft && !published

  const handleSync = useCallback(async () => {
    if (!isValidNctId) return
    
    setIsSyncing(true)

    try {
      console.log('[TrialSync] Fetching from:', SYNC_URL)
      
      const res = await fetch(SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nctId: nctId.toUpperCase(),
          generateSummary: true,
          generateEligibilityOverview: true
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        throw new Error(data?.error || `Sync failed (${res.status})`)
      }

      const syncedData = data.data
      // Use briefTitle (short display title from CT.gov) instead of officialTitle (long scientific title)
      const trialTitle = syncedData.ctGovData?.briefTitle || syncedData.ctGovData?.officialTitle

      console.log('[TrialSync] Got data for document:', id, 'isNew:', isNewDocument)

      // Fields that come from ClinicalTrials.gov (will be updated on sync)
      const syncedFields = {
        nctId: nctId.toUpperCase(),
        title: trialTitle,
        ctGovData: syncedData.ctGovData,
        inclusionCriteria: syncedData.inclusionCriteria || [],
        exclusionCriteria: syncedData.exclusionCriteria || [],
        studyType: syncedData.studyType,
        phase: syncedData.phase,
        conditions: syncedData.conditions || [],
        ageRange: syncedData.ageRange,
        sex: syncedData.sex,
        laySummary: syncedData.laySummary,
        eligibilityOverview: syncedData.eligibilityOverview,
      }

      const draftId = `drafts.${id}`

      if (isNewDocument) {
        // For new documents, create with synced fields
        await client.createIfNotExists({
          _id: draftId,
          _type: 'trialSummary',
          ...syncedFields,
        })
      } else {
        // For existing documents, patch only synced fields
        // This preserves manually-set fields like therapeuticAreas, principalInvestigator, status, localContact, slug, etc.
        await client
          .patch(draftId)
          .set(syncedFields)
          .commit({ returnDocuments: false })
          .catch(async (err) => {
            // If draft doesn't exist, create it first then patch
            if (err.statusCode === 404) {
              const baseDoc = published || {}
              await client.createIfNotExists({
                ...baseDoc,
                _id: draftId,
                _type: 'trialSummary',
              })
              await client.patch(draftId).set(syncedFields).commit({ returnDocuments: false })
            } else {
              throw err
            }
          })
      }

      console.log('[TrialSync] Document saved successfully')

      alert(`✓ Synced: "${trialTitle?.slice(0, 60)}..."\n\nManual fields preserved. Click Publish to save.`)

    } catch (err) {
      console.error('[TrialSync] Failed:', err)
      alert(`Sync failed: ${err.message}`)
    } finally {
      setIsSyncing(false)
      onComplete()
    }
  }, [nctId, isValidNctId, id, isNewDocument, client, onComplete])

  // Don't show if no NCT ID
  if (!nctId) {
    return null
  }

  // Show warning for invalid format
  if (!isValidNctId) {
    return {
      label: 'Invalid NCT ID format',
      disabled: true,
    }
  }

  // Format last sync time
  const lastSyncDisplay = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleDateString()
    : 'Never'

  return {
    label: isSyncing 
      ? 'Fetching...' 
      : hasBeenSynced 
        ? '🔄 Refresh from ClinicalTrials.gov' 
        : '🔄 Fetch from ClinicalTrials.gov',
    title: `Last synced: ${lastSyncDisplay}`,
    disabled: isSyncing,
    onHandle: handleSync,
  }
}

export const trialSyncAction = definePlugin(() => ({
  name: 'trial-sync-action',
  document: {
    actions: (prev, context) => {
      if (context.schemaType !== 'trialSummary') return prev
      return [TrialSyncAction, ...prev]
    },
  },
}))
