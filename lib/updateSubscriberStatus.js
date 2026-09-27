export const SUBSCRIPTION_STATUS_SUBSCRIBED = 'subscribed'
export const SUBSCRIPTION_STATUS_UNSUBSCRIBED = 'unsubscribed'
export const DELIVERY_STATUS_ACTIVE = 'active'
export const DELIVERY_STATUS_SUPPRESSED = 'suppressed'

export function resolveSubscriptionStatus(subscriber) {
  if (typeof subscriber?.subscriptionStatus === 'string') {
    return subscriber.subscriptionStatus
  }
  return SUBSCRIPTION_STATUS_UNSUBSCRIBED
}

export function resolveDeliveryStatus(subscriber) {
  if (typeof subscriber?.deliveryStatus === 'string') {
    return subscriber.deliveryStatus
  }
  return DELIVERY_STATUS_ACTIVE
}

export function isSubscriberDeliverable(subscriber) {
  const subscriptionStatus = resolveSubscriptionStatus(subscriber)
  const deliveryStatus = resolveDeliveryStatus(subscriber)
  const isUnsubscribed = subscriptionStatus === SUBSCRIPTION_STATUS_UNSUBSCRIBED
  const isSuppressed = deliveryStatus === DELIVERY_STATUS_SUPPRESSED
  return !isUnsubscribed && !isSuppressed
}

// Only published subscriber records are emailed. A Studio draft (drafts.<id>) is an unsaved
// edit, so sends, counts and preference links skip it. writeClient's API version reads the raw
// perspective, which returns drafts too, so every subscriber query has to add this filter.
export const PUBLISHED_SUBSCRIBER_FILTER =
  '_type == "updateSubscriber" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))'

// The records the send routes email: published, subscribed, not suppressed, with an address.
export const DELIVERABLE_SUBSCRIBER_FILTER = `${PUBLISHED_SUBSCRIBER_FILTER} && subscriptionStatus == "${SUBSCRIPTION_STATUS_SUBSCRIBED}" && deliveryStatus != "${DELIVERY_STATUS_SUPPRESSED}" && defined(email)`

// A Studio draft copies every field of the record it edits, manage token and email included,
// so a lookup can match both copies. The published record is the one that is emailed; the
// draft is returned alongside so a change can be kept in step on it. A record that only
// exists as a draft is returned as the subscriber (it is not emailed until published).
export function pickPublishedSubscriber(records) {
  const list = (Array.isArray(records) ? records : records ? [records] : []).filter((doc) => doc?._id)
  const subscriber = list.find((doc) => !doc._id.startsWith('drafts.')) || list[0] || null
  if (!subscriber) return { subscriber: null, draft: null }
  const draft = subscriber._id.startsWith('drafts.')
    ? null
    : list.find((doc) => doc._id === `drafts.${subscriber._id}`) || null
  return { subscriber, draft }
}
