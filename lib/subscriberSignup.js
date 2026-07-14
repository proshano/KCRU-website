import { randomUUID } from 'crypto'
import { getClientIp } from './httpUtils.js'
import {
  DELIVERY_STATUS_ACTIVE,
  SUBSCRIPTION_STATUS_SUBSCRIBED,
} from './updateSubscriberStatus.js'

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
  const existing = await client.fetch(
    `*[_type == "updateSubscriber" && lower(email) == $emailLower][0]{
      _id,
      manageToken
    }`,
    { emailLower }
  )

  if (existing?._id) {
    const manageToken = existing.manageToken || createToken()
    if (!existing.manageToken) {
      await client
        .patch(existing._id)
        .set({ manageToken })
        .commit({ returnDocuments: false })
    }
    return { manageToken, created: false }
  }

  const manageToken = createToken()
  const now = new Date().toISOString()
  await client.create({
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
