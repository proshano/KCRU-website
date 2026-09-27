import { randomUUID } from 'crypto'
import { getClientIp } from './httpUtils.js'
import {
  DELIVERY_STATUS_ACTIVE,
  SUBSCRIPTION_STATUS_SUBSCRIBED,
  pickPublishedSubscriber,
} from './updateSubscriberStatus.js'

const DRAFT_PREFIX = 'drafts.'

export async function createOrRecoverSubscriber({
  client,
  subscriber,
  headers,
  recaptchaData,
  createToken = randomUUID,
}) {
  if (!client?.config?.().token) {
    throw new Error('SANITY_API_TOKEN missing')
  }

  const emailLower = subscriber.email.toLowerCase()
  const { subscriber: existing, draft } = pickPublishedSubscriber(
    await client.fetch(
      `*[_type == "updateSubscriber" && lower(email) == $emailLower && !(_id in path("versions.**"))]{
        _id,
        manageToken
      }`,
      { emailLower }
    )
  )

  if (existing?._id && !existing._id.startsWith(DRAFT_PREFIX)) {
    const manageToken = existing.manageToken || createToken()
    if (!existing.manageToken) {
      for (const doc of [existing, draft].filter(Boolean)) {
        await client
          .patch(doc._id)
          .set({ manageToken })
          .commit({ returnDocuments: false })
      }
    }
    return { manageToken, created: false }
  }

  // Only an unpublished Studio draft has this address, and drafts are never emailed, so the
  // signup creates the published record. It takes the draft's id and token when nothing is
  // published under that id, so publishing the draft later updates this record instead of
  // adding a second one, and any link already sent with that token keeps working.
  let recordId = null
  let manageToken = null
  if (existing?._id) {
    const baseId = existing._id.slice(DRAFT_PREFIX.length)
    const baseIsPublished = await client.fetch('count(*[_id == $id]) > 0', { id: baseId })
    if (!baseIsPublished) {
      recordId = baseId
      manageToken = existing.manageToken || null
    }
  }
  manageToken ||= createToken()

  const now = new Date().toISOString()
  await client.create({
    ...(recordId ? { _id: recordId } : {}),
    _type: 'updateSubscriber',
    ...subscriber,
    subscriptionStatus: SUBSCRIPTION_STATUS_SUBSCRIBED,
    deliveryStatus: DELIVERY_STATUS_ACTIVE,
    source: 'self',
    manageToken,
    createdAt: now,
    updatedAt: now,
    consent: {
      source: 'self',
      timestamp: now,
      ip: getClientIp(headers),
      userAgent: headers.get('user-agent') || '',
      recaptchaScore: typeof recaptchaData?.score === 'number' ? recaptchaData.score : null,
    },
  })

  return { manageToken, created: true }
}
