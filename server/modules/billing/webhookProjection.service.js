import { createService as createCheckoutProjectionService } from "./webhookCheckoutProjection.service.js";
import { createService as createSubscriptionProjectionService } from "./webhookSubscriptionProjection.service.js";
import {
  CHECKOUT_CORRELATION_ERROR_CODE,
  __testables,
  buildCheckoutResponseJson,
  hasSameTimestampOrderingConflict,
  isIncomingEventOlder,
  normalizeProviderSubscriptionStatus,
  parseUnixEpochSeconds,
  toNullableString,
  toPositiveInteger,
  toSafeMetadata
} from "./webhookProjection.utils.js";

function createService(options = {}) {
  const {
    billingRepository,
    billingCheckoutSessionService,
    billingProviderAdapter,
    observabilityService = null
  } = options;
  const providerAdapter = billingProviderAdapter;
  const checkoutProjectionService = createCheckoutProjectionService({
    billingRepository,
    billingCheckoutSessionService,
    billingProviderAdapter: providerAdapter,
    observabilityService
  });

  const subscriptionProjectionService = createSubscriptionProjectionService({
    billingRepository,
    billingCheckoutSessionService,
    billingProviderAdapter: providerAdapter,
    observabilityService,
    resolveBillableEntityIdFromCustomerId: checkoutProjectionService.resolveBillableEntityIdFromCustomerId,
    lockEntityAggregate: checkoutProjectionService.lockEntityAggregate,
    maybeFinalizePendingCheckoutIdempotency: checkoutProjectionService.maybeFinalizePendingCheckoutIdempotency
  });

  return {
    handleCheckoutSessionCompleted: checkoutProjectionService.handleCheckoutSessionCompleted,
    handleCheckoutSessionExpired: checkoutProjectionService.handleCheckoutSessionExpired,
    projectSubscription: subscriptionProjectionService.projectSubscription,
    projectInvoiceAndPayment: subscriptionProjectionService.projectInvoiceAndPayment
  };
}

export {
  CHECKOUT_CORRELATION_ERROR_CODE,
  createService,
  __testables,
  buildCheckoutResponseJson,
  hasSameTimestampOrderingConflict,
  isIncomingEventOlder,
  normalizeProviderSubscriptionStatus,
  parseUnixEpochSeconds,
  toNullableString,
  toPositiveInteger,
  toSafeMetadata
};
