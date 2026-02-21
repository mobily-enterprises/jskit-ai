import { createService as createCheckoutProjectionService } from "./webhookCheckoutProjection.service.js";
import { createService as createSubscriptionProjectionService } from "./webhookSubscriptionProjection.service.js";
import {
  CHECKOUT_CORRELATION_ERROR_CODE,
  __testables,
  buildCheckoutResponseJson,
  hasSameTimestampOrderingConflict,
  isIncomingEventOlder,
  normalizeStripeSubscriptionStatus,
  parseUnixEpochSeconds,
  toNullableString,
  toPositiveInteger,
  toSafeMetadata
} from "./webhookProjection.utils.js";

function createService({ billingRepository, billingCheckoutSessionService, stripeSdkService, observabilityService = null }) {
  const checkoutProjectionService = createCheckoutProjectionService({
    billingRepository,
    billingCheckoutSessionService,
    stripeSdkService,
    observabilityService
  });

  const subscriptionProjectionService = createSubscriptionProjectionService({
    billingRepository,
    billingCheckoutSessionService,
    stripeSdkService,
    observabilityService,
    resolveBillableEntityIdFromCustomerId: checkoutProjectionService.resolveBillableEntityIdFromCustomerId,
    lockEntityAggregate: checkoutProjectionService.lockEntityAggregate,
    maybeFinalizePendingCheckoutIdempotency: checkoutProjectionService.maybeFinalizePendingCheckoutIdempotency
  });

  return {
    handleCheckoutSessionCompleted: checkoutProjectionService.handleCheckoutSessionCompleted,
    handleCheckoutSessionExpired: checkoutProjectionService.handleCheckoutSessionExpired,
    projectSubscriptionFromStripe: subscriptionProjectionService.projectSubscriptionFromStripe,
    projectInvoiceAndPaymentFromStripe: subscriptionProjectionService.projectInvoiceAndPaymentFromStripe
  };
}

export {
  CHECKOUT_CORRELATION_ERROR_CODE,
  createService,
  __testables,
  buildCheckoutResponseJson,
  hasSameTimestampOrderingConflict,
  isIncomingEventOlder,
  normalizeStripeSubscriptionStatus,
  parseUnixEpochSeconds,
  toNullableString,
  toPositiveInteger,
  toSafeMetadata
};
