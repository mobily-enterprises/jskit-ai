import {
  createBillingService,
  createBillingPolicyService,
  createBillingPricingService,
  createBillingIdempotencyService,
  createBillingCheckoutSessionService,
  createBillingCheckoutOrchestratorService,
  createBillingWebhookService,
  createBillingRealtimePublishService
} from "@jskit-ai/billing-service-core";
import { AppError } from "@jskit-ai/server-runtime-core/errors";

import { createService as createBillingOutboxWorkerService } from "./outboxWorker.service.js";
import { createService as createBillingRemediationWorkerService } from "./remediationWorker.service.js";
import { createService as createBillingReconciliationService } from "./reconciliation.service.js";
import { createService as createBillingWorkerRuntimeService } from "./workerRuntime.service.js";

function createBillingDisabledServices() {
  const throwBillingDisabled = async () => {
    throw new AppError(404, "Not found.");
  };

  return {
    billingPolicyService: {
      resolveBillableEntityForReadRequest: throwBillingDisabled,
      resolveBillableEntityForWriteRequest: throwBillingDisabled,
      listAccessibleWorkspacesForUser: async () => []
    },
    billingPricingService: {
      resolvePhase1SellablePrice: throwBillingDisabled,
      deploymentCurrency: ""
    },
    billingIdempotencyService: {
      claimOrReplay: throwBillingDisabled,
      recoverPendingRequest: throwBillingDisabled,
      expireStalePendingRequests: throwBillingDisabled,
      assertProviderRequestHashStable: throwBillingDisabled,
      assertLeaseVersion: throwBillingDisabled,
      assertProviderReplayWindowOpen: throwBillingDisabled,
      assertReplayProvenanceCompatible: throwBillingDisabled,
      markSucceeded: throwBillingDisabled,
      markFailed: throwBillingDisabled,
      markExpired: throwBillingDisabled
    },
    billingCheckoutSessionService: {
      cleanupExpiredBlockingSessions: throwBillingDisabled,
      getBlockingCheckoutSession: throwBillingDisabled,
      upsertBlockingCheckoutSession: throwBillingDisabled,
      markCheckoutSessionCompletedPendingSubscription: throwBillingDisabled,
      markCheckoutSessionReconciled: throwBillingDisabled,
      markCheckoutSessionRecoveryVerificationPending: throwBillingDisabled,
      markCheckoutSessionExpiredOrAbandoned: throwBillingDisabled,
      assertCheckoutSessionCorrelation: throwBillingDisabled
    },
    billingCheckoutOrchestrator: {
      startCheckout: throwBillingDisabled,
      recoverCheckoutFromPending: throwBillingDisabled,
      finalizeRecoveredCheckout: throwBillingDisabled,
      buildFrozenCheckoutSessionParams: throwBillingDisabled
    },
    billingWebhookService: {
      processProviderEvent: throwBillingDisabled,
      reprocessStoredEvent: throwBillingDisabled
    },
    billingOutboxWorkerService: {
      leaseNextJob: async () => null,
      executeJob: throwBillingDisabled,
      retryOrDeadLetter: throwBillingDisabled,
      runExpireCheckoutSession: throwBillingDisabled
    },
    billingRemediationWorkerService: {
      leaseNextRemediation: async () => null,
      runCancelDuplicateSubscription: throwBillingDisabled,
      retryOrDeadLetterRemediation: throwBillingDisabled
    },
    billingReconciliationService: {
      runScope: throwBillingDisabled
    },
    billingRealtimePublishService: {
      async publishWorkspaceBillingLimitsUpdated() {
        return null;
      }
    },
    billingService: {
      ensureBillableEntity: throwBillingDisabled,
      seedSignupPromoPlan: throwBillingDisabled,
      listPlans: throwBillingDisabled,
      listProducts: throwBillingDisabled,
      listPurchases: throwBillingDisabled,
      getPlanState: throwBillingDisabled,
      requestPlanChange: throwBillingDisabled,
      cancelPendingPlanChange: throwBillingDisabled,
      processDuePlanChanges: async () => ({
        scannedCount: 0,
        appliedCount: 0
      }),
      listPaymentMethods: throwBillingDisabled,
      syncPaymentMethods: throwBillingDisabled,
      setDefaultPaymentMethod: throwBillingDisabled,
      detachPaymentMethod: throwBillingDisabled,
      removePaymentMethod: throwBillingDisabled,
      getLimitations: throwBillingDisabled,
      resolveEffectiveLimitations: throwBillingDisabled,
      consumeEntitlement: throwBillingDisabled,
      executeWithEntitlementConsumption: async ({ action } = {}) => {
        if (typeof action !== "function") {
          throw new AppError(500, "Billing entitlement action is unavailable.");
        }
        return action({ trx: null });
      },
      grantEntitlementsForPurchase: throwBillingDisabled,
      grantEntitlementsForPlanState: throwBillingDisabled,
      refreshDueLimitationsForSubject: throwBillingDisabled,
      listTimeline: throwBillingDisabled,
      createPortalSession: throwBillingDisabled,
      createPaymentLink: throwBillingDisabled,
      startCheckout: throwBillingDisabled
    },
    billingWorkerRuntimeService: {
      start() {},
      stop() {},
      isStarted() {
        return false;
      }
    }
  };
}

function createBillingSubsystem({
  repositories,
  services,
  env,
  repositoryConfig,
  realtimeEventTypes,
  realtimeTopics
}) {
  const { workspacesRepository, billingRepository, consoleSettingsRepository } = repositories;
  const { workspaceService, realtimeEventsService, observabilityService } = services;
  const billingPolicyConfig = repositoryConfig?.billing || {};

  if (!billingPolicyConfig.enabled) {
    return {
      ...createBillingDisabledServices(),
      billingPromoProvisioner: null
    };
  }

  const billingPolicyService = createBillingPolicyService({
    workspacesRepository,
    billingRepository,
    resolvePermissions: workspaceService.resolvePermissions
  });

  const billingPricingService = createBillingPricingService({
    billingRepository,
    billingCurrency: billingPolicyConfig.currency
  });

  const billingIdempotencyService = createBillingIdempotencyService({
    billingRepository,
    operationKeySecret: env.BILLING_OPERATION_KEY_SECRET,
    providerIdempotencyKeySecret: env.BILLING_PROVIDER_IDEMPOTENCY_KEY_SECRET,
    pendingLeaseSeconds: billingPolicyConfig.idempotency.pendingLeaseSeconds,
    observabilityService
  });

  const billingCheckoutSessionService = createBillingCheckoutSessionService({
    billingRepository,
    checkoutSessionGraceSeconds: billingPolicyConfig.checkout.sessionExpiresAtGraceSeconds
  });

  const billingCheckoutOrchestrator = createBillingCheckoutOrchestratorService({
    billingRepository,
    billingPolicyService,
    billingPricingService,
    billingIdempotencyService,
    billingCheckoutSessionService,
    billingProviderAdapter: services.billingProviderAdapter,
    appPublicUrl: env.APP_PUBLIC_URL,
    observabilityService,
    logger: observabilityService.createScopedLogger("billing.checkout"),
    checkoutSessionGraceSeconds: billingPolicyConfig.checkout.sessionExpiresAtGraceSeconds,
    providerReplayWindowSeconds: billingPolicyConfig.idempotency.providerReplayWindowSeconds,
    providerCheckoutExpirySeconds: billingPolicyConfig.checkout.providerExpiresSeconds
  });

  const billingRealtimePublishService = createBillingRealtimePublishService({
    billingRepository,
    realtimeEventsService,
    realtimeEventTypes,
    realtimeTopics
  });

  const billingOutboxWorkerService = createBillingOutboxWorkerService({
    billingRepository,
    billingProviderAdapter: services.billingProviderAdapter,
    retryDelaySeconds: billingPolicyConfig.workers.outbox.retryDelaySeconds,
    maxAttempts: billingPolicyConfig.workers.outbox.maxAttempts,
    observabilityService
  });

  const billingRemediationWorkerService = createBillingRemediationWorkerService({
    billingRepository,
    billingProviderAdapter: services.billingProviderAdapter,
    retryDelaySeconds: billingPolicyConfig.workers.remediation.retryDelaySeconds,
    maxAttempts: billingPolicyConfig.workers.remediation.maxAttempts,
    observabilityService
  });

  const billingService = createBillingService({
    billingRepository,
    billingPolicyService,
    billingPricingService,
    billingIdempotencyService,
    billingCheckoutOrchestrator,
    billingProviderAdapter: services.billingProviderAdapter,
    billingRealtimePublishService,
    consoleSettingsRepository,
    appPublicUrl: env.APP_PUBLIC_URL,
    providerReplayWindowSeconds: billingPolicyConfig.idempotency.providerReplayWindowSeconds,
    observabilityService
  });

  const billingWebhookService = createBillingWebhookService({
    billingRepository,
    billingProviderAdapter: services.billingProviderAdapter,
    billingProviderRegistryService: services.billingProviderRegistryService,
    billingWebhookTranslationRegistryService: services.billingWebhookTranslationRegistryService,
    billingCheckoutSessionService,
    billingService,
    billingRealtimePublishService,
    stripeWebhookEndpointSecret: env.BILLING_STRIPE_WEBHOOK_ENDPOINT_SECRET,
    paddleWebhookEndpointSecret: env.BILLING_PADDLE_WEBHOOK_ENDPOINT_SECRET,
    observabilityService,
    payloadRetentionDays: billingPolicyConfig.retention.webhookPayloadDays
  });

  const billingReconciliationService = createBillingReconciliationService({
    billingRepository,
    billingProviderAdapter: services.billingProviderAdapter,
    billingCheckoutSessionService,
    billingWebhookService,
    observabilityService,
    checkoutSessionGraceSeconds: billingPolicyConfig.checkout.sessionExpiresAtGraceSeconds,
    completionSlaSeconds: billingPolicyConfig.checkout.completionSlaSeconds
  });

  const billingWorkerRuntimeService = createBillingWorkerRuntimeService({
    enabled: billingPolicyConfig.enabled,
    billingRepository,
    billingOutboxWorkerService,
    billingRemediationWorkerService,
    billingReconciliationService,
    billingService,
    billingRealtimePublishService,
    reconciliationProvider: services.billingProviderAdapter.provider,
    logger: observabilityService.createScopedLogger("billing.worker"),
    workerIdPrefix: `billing:${process.pid}`
  });

  return {
    billingPolicyService,
    billingPricingService,
    billingIdempotencyService,
    billingCheckoutSessionService,
    billingCheckoutOrchestrator,
    billingWebhookService,
    billingOutboxWorkerService,
    billingRemediationWorkerService,
    billingReconciliationService,
    billingRealtimePublishService,
    billingWorkerRuntimeService,
    billingService,
    billingPromoProvisioner: (payload) => billingService.seedSignupPromoPlan(payload)
  };
}

const BILLING_SUBSYSTEM_EXPORT_IDS = Object.freeze([
  "billingPolicyService",
  "billingPricingService",
  "billingIdempotencyService",
  "billingCheckoutSessionService",
  "billingCheckoutOrchestrator",
  "billingWebhookService",
  "billingOutboxWorkerService",
  "billingRemediationWorkerService",
  "billingReconciliationService",
  "billingRealtimePublishService",
  "billingWorkerRuntimeService",
  "billingService"
]);

export { createBillingDisabledServices, createBillingSubsystem, BILLING_SUBSYSTEM_EXPORT_IDS };
