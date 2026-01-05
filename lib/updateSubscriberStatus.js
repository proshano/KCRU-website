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
