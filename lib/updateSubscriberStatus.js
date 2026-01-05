export const SUBSCRIPTION_STATUS_SUBSCRIBED = 'subscribed'
export const SUBSCRIPTION_STATUS_UNSUBSCRIBED = 'unsubscribed'
export const DELIVERY_STATUS_ACTIVE = 'active'
export const DELIVERY_STATUS_SUPPRESSED = 'suppressed'

export function resolveSubscriptionStatus(subscriber) {
  if (typeof subscriber?.subscriptionStatus === 'string') {
    return subscriber.subscriptionStatus
  }
  if (typeof subscriber?.status === 'string') {
    return subscriber.status === SUBSCRIPTION_STATUS_UNSUBSCRIBED
      ? SUBSCRIPTION_STATUS_UNSUBSCRIBED
      : SUBSCRIPTION_STATUS_SUBSCRIBED
  }
  return SUBSCRIPTION_STATUS_UNSUBSCRIBED
}

export function resolveDeliveryStatus(subscriber) {
  if (typeof subscriber?.deliveryStatus === 'string') {
    return subscriber.deliveryStatus
  }
  if (subscriber?.status === DELIVERY_STATUS_SUPPRESSED || subscriber?.suppressEmails === true) {
    return DELIVERY_STATUS_SUPPRESSED
  }
  return DELIVERY_STATUS_ACTIVE
}

export function isSubscriberDeliverable(subscriber) {
  const subscriptionStatus = resolveSubscriptionStatus(subscriber)
  const deliveryStatus = resolveDeliveryStatus(subscriber)
  const isUnsubscribed =
    subscriptionStatus === SUBSCRIPTION_STATUS_UNSUBSCRIBED || subscriber?.status === SUBSCRIPTION_STATUS_UNSUBSCRIBED
  const isSuppressed =
    deliveryStatus === DELIVERY_STATUS_SUPPRESSED ||
    subscriber?.status === DELIVERY_STATUS_SUPPRESSED ||
    subscriber?.suppressEmails === true
  return !isUnsubscribed && !isSuppressed
}

export function deriveLegacyStatus({ subscriptionStatus, deliveryStatus }) {
  if (subscriptionStatus === SUBSCRIPTION_STATUS_UNSUBSCRIBED) {
    return SUBSCRIPTION_STATUS_UNSUBSCRIBED
  }
  if (deliveryStatus === DELIVERY_STATUS_SUPPRESSED) {
    return DELIVERY_STATUS_SUPPRESSED
  }
  return DELIVERY_STATUS_ACTIVE
}
