/* eslint-disable max-lines */
import { AppError } from "../../lib/errors.js";
import {
  BILLING_ACTIONS,
  BILLING_CHECKOUT_SESSION_STATUS,
  BILLING_DEFAULT_PROVIDER,
  BILLING_FAILURE_CODES,
  BILLING_IDEMPOTENCY_STATUS,
  BILLING_RUNTIME_DEFAULTS,
  NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET,
  resolveProviderRequestSchemaVersion,
  statusFromFailureCode
} from "./constants.js";
import { toCanonicalJson, toSha256Hex } from "./canonicalJson.js";
import { normalizeCheckoutPaths } from "./pathPolicy.js";
import {
  PROVIDER_OUTCOME_ACTIONS,
  resolveProviderErrorOutcome,
  isDeterministicProviderRejection,
  isIndeterminateProviderOutcome
} from "./providerOutcomePolicy.js";
import {
  normalizeProviderSubscriptionStatus,
  isSubscriptionStatusCurrent
} from "./webhookProjection.utils.js";

function normalizePlanCode(value) {
  return String(value || "").trim();
}

const CHECKOUT_KIND_SUBSCRIPTION = "subscription";
const CHECKOUT_KIND_ONE_OFF = "one_off";

function normalizeCheckoutType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized === CHECKOUT_KIND_SUBSCRIPTION) {
    return CHECKOUT_KIND_SUBSCRIPTION;
  }
  if (normalized === CHECKOUT_KIND_ONE_OFF || normalized === "one-off" || normalized === "oneoff" || normalized === "payment") {
    return CHECKOUT_KIND_ONE_OFF;
  }

  throw new AppError(400, "Validation failed.", {
    details: {
      fieldErrors: {
        checkoutType: "checkoutType must be either 'subscription' or 'one_off'."
      }
    }
  });
}

function normalizeCurrency(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeOneOffPayload(oneOffPayload, { defaultCurrency }) {
  const payload = oneOffPayload && typeof oneOffPayload === "object" ? oneOffPayload : null;
  if (!payload) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          oneOff: "oneOff is required when checkoutType is one_off."
        }
      }
    });
  }

  const name = String(payload.name || "").trim();
  if (!name) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          "oneOff.name": "oneOff.name is required."
        }
      }
    });
  }

  const amountMinor = Number(payload.amountMinor);
  if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > 99999999) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          "oneOff.amountMinor": "oneOff.amountMinor must be an integer between 1 and 99,999,999."
        }
      }
    });
  }

  const quantity = payload.quantity == null ? 1 : Number(payload.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          "oneOff.quantity": "oneOff.quantity must be an integer between 1 and 10,000."
        }
      }
    });
  }

  const currency = normalizeCurrency(payload.currency || defaultCurrency);
  if (!currency || currency.length !== 3) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          "oneOff.currency": "oneOff.currency must be a 3-letter ISO currency code."
        }
      }
    });
  }
  const requiredCurrency = normalizeCurrency(defaultCurrency);
  if (requiredCurrency && currency !== requiredCurrency) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          "oneOff.currency": `oneOff.currency must match deployment billing currency (${requiredCurrency}).`
        }
      }
    });
  }

  return {
    name,
    amountMinor,
    quantity,
    currency
  };
}

function buildApiFailure(failureCode, message = "Billing checkout failed.", details = {}) {
  const code = String(failureCode || "").trim();
  return new AppError(statusFromFailureCode(failureCode), message, {
    code,
    details: {
      code,
      ...(details && typeof details === "object" ? details : {})
    }
  });
}

function providerSessionStateToLocalStatus(providerStatus) {
  const normalized = String(providerStatus || "").trim().toLowerCase();
  if (normalized === "complete") {
    return BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION;
  }

  if (normalized === "expired") {
    return BILLING_CHECKOUT_SESSION_STATUS.EXPIRED;
  }

  return BILLING_CHECKOUT_SESSION_STATUS.OPEN;
}

function normalizeOptionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeProviderRefId(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    return normalizeOptionalString(value);
  }

  if (typeof value === "object") {
    return normalizeOptionalString(value.id);
  }

  return null;
}

function parseUnixEpochSeconds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return new Date(parsed * 1000);
}

function isProviderNotFoundError(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  return statusCode === 404;
}

function isBlockingCheckoutDebugEnabled() {
  return String(process.env.BILLING_DEBUG_CHECKOUT_BLOCKS || "")
    .trim()
    .toLowerCase() === "1";
}

function toIsoOrNull(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function summarizeCheckoutSessionForDebug(session) {
  if (!session || typeof session !== "object") {
    return null;
  }

  return {
    id: Number(session.id || 0) || null,
    billableEntityId: Number(session.billableEntityId || 0) || null,
    status: String(session.status || ""),
    operationKey: String(session.operationKey || ""),
    providerCheckoutSessionId: String(session.providerCheckoutSessionId || ""),
    providerSubscriptionId: String(session.providerSubscriptionId || ""),
    providerCustomerId: String(session.providerCustomerId || ""),
    expiresAt: toIsoOrNull(session.expiresAt),
    completedAt: toIsoOrNull(session.completedAt),
    lastProviderEventCreatedAt: toIsoOrNull(session.lastProviderEventCreatedAt),
    lastProviderEventId: session.lastProviderEventId ? String(session.lastProviderEventId) : null,
    metadataJson: session.metadataJson && typeof session.metadataJson === "object" ? session.metadataJson : null
  };
}

function summarizeProviderCheckoutSessionForDebug(session) {
  if (!session || typeof session !== "object") {
    return null;
  }

  return {
    id: session.id ? String(session.id) : null,
    status: session.status ? String(session.status) : null,
    customer: normalizeProviderRefId(session.customer),
    subscription: normalizeProviderRefId(session.subscription),
    expiresAt: session.expires_at ? toIsoOrNull(new Date(Number(session.expires_at) * 1000)) : null,
    urlPresent: Boolean(session.url),
    metadata:
      session.metadata && typeof session.metadata === "object"
        ? {
            operation_key: session.metadata.operation_key || null,
            checkout_flow: session.metadata.checkout_flow || null,
            checkout_type: session.metadata.checkout_type || null
          }
        : null
  };
}

function debugBlockingCheckoutLog(step, payload = {}) {
  if (!isBlockingCheckoutDebugEnabled()) {
    return;
  }

  const safePayload = payload && typeof payload === "object" ? payload : { value: payload };
  console.log("[billing.checkout.blocking.debug]", {
    step,
    at: new Date().toISOString(),
    ...safePayload
  });
}

function buildPlanNotFoundError() {
  return buildApiFailure(BILLING_FAILURE_CODES.CHECKOUT_PLAN_NOT_FOUND, "Billing plan not found.");
}

function resolveDeterministicFailureCode(error) {
  const explicitCode = String(error?.code || error?.details?.code || "").trim();
  if (explicitCode) {
    return explicitCode;
  }

  const statusCode = Number(error?.statusCode || error?.status || 0);
  if (statusCode === 404) {
    return BILLING_FAILURE_CODES.CHECKOUT_PLAN_NOT_FOUND;
  }
  if (statusCode === 400) {
    return BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID;
  }
  if (statusCode === 409) {
    return BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID;
  }

  return "";
}

function createService(options = {}) {
  const {
    billingRepository,
    billingPolicyService,
    billingPricingService,
    billingIdempotencyService,
    billingCheckoutSessionService,
    billingProviderAdapter,
    appPublicUrl,
    observabilityService = null,
    checkoutSessionGraceSeconds = BILLING_RUNTIME_DEFAULTS.CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS,
    providerReplayWindowSeconds = BILLING_RUNTIME_DEFAULTS.PROVIDER_IDEMPOTENCY_REPLAY_WINDOW_SECONDS,
    providerCheckoutExpirySeconds = BILLING_RUNTIME_DEFAULTS.CHECKOUT_PROVIDER_EXPIRES_SECONDS
  } = options;
  if (!billingRepository || typeof billingRepository.transaction !== "function") {
    throw new Error("billingRepository.transaction is required.");
  }
  if (!billingPolicyService || typeof billingPolicyService.resolveBillableEntityForWriteRequest !== "function") {
    throw new Error("billingPolicyService.resolveBillableEntityForWriteRequest is required.");
  }
  if (!billingPricingService || typeof billingPricingService.resolvePhase1SellablePrice !== "function") {
    throw new Error("billingPricingService.resolvePhase1SellablePrice is required.");
  }
  if (!billingIdempotencyService || typeof billingIdempotencyService.claimOrReplay !== "function") {
    throw new Error("billingIdempotencyService.claimOrReplay is required.");
  }
  if (!billingCheckoutSessionService || typeof billingCheckoutSessionService.getBlockingCheckoutSession !== "function") {
    throw new Error("billingCheckoutSessionService.getBlockingCheckoutSession is required.");
  }
  const providerAdapter = billingProviderAdapter;
  if (!providerAdapter || typeof providerAdapter.createCheckoutSession !== "function") {
    throw new Error("billingProviderAdapter.createCheckoutSession is required.");
  }
  const activeProvider =
    String(providerAdapter?.provider || BILLING_DEFAULT_PROVIDER)
      .trim()
      .toLowerCase() || BILLING_DEFAULT_PROVIDER;

  const normalizedAppPublicUrl = String(appPublicUrl || "").trim();
  if (!normalizedAppPublicUrl) {
    throw new Error("appPublicUrl is required.");
  }

  const checkoutGraceSeconds = Math.max(0, Number(checkoutSessionGraceSeconds) || 0);
  const replayWindowSeconds = Math.max(60, Number(providerReplayWindowSeconds) || 60);
  const checkoutExpirySeconds = Math.max(60, Number(providerCheckoutExpirySeconds) || 60);
  const deploymentCurrency = normalizeCurrency(billingPricingService?.deploymentCurrency || "USD");

  function recordGuardrail(code, context = {}) {
    const payload = {
      code,
      ...(context && typeof context === "object" ? context : {})
    };

    if (observabilityService && typeof observabilityService.recordBillingGuardrail === "function") {
      observabilityService.recordBillingGuardrail(payload);
      return;
    }

    if (!observabilityService || typeof observabilityService.recordDbError !== "function") {
      return;
    }

    observabilityService.recordDbError({
      code
    });
  }

  function resolveAndRecordProviderOutcome(error, { operation, correlation = {} } = {}) {
    const context = correlation && typeof correlation === "object" ? correlation : {};
    const outcome = resolveProviderErrorOutcome({
      operation,
      error
    });

    if (outcome.nonNormalizedGuardrailCode) {
      recordGuardrail(outcome.nonNormalizedGuardrailCode, {
        provider: activeProvider,
        ...context
      });
    }

    if (outcome.guardrailCode) {
      recordGuardrail(outcome.guardrailCode, context);
    }

    return outcome;
  }

  function buildNormalizedCheckoutRequest({ billableEntityId, payload, action }) {
    const checkoutType = normalizeCheckoutType(payload.checkoutType);
    const normalizedRequest = {
      action,
      billableEntityId: Number(billableEntityId),
      planCode: normalizePlanCode(payload.planCode),
      successPath: payload.successPath,
      cancelPath: payload.cancelPath
    };
    if (checkoutType === CHECKOUT_KIND_ONE_OFF || payload.checkoutType != null) {
      normalizedRequest.checkoutType = checkoutType;
    }
    if (checkoutType === CHECKOUT_KIND_ONE_OFF) {
      normalizedRequest.oneOff = payload.oneOff;
    }

    return normalizedRequest;
  }

  function resolveFailureCodeForBlockingSession(blockingSession, now) {
    if (!blockingSession) {
      return null;
    }

    if (blockingSession.status === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION) {
      return BILLING_FAILURE_CODES.CHECKOUT_COMPLETION_PENDING;
    }

    if (blockingSession.status === BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING) {
      const expiresAt = blockingSession.expiresAt ? new Date(blockingSession.expiresAt) : null;
      if (!expiresAt || expiresAt.getTime() > now.getTime()) {
        return BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_VERIFICATION_PENDING;
      }
    }

    if (blockingSession.status === BILLING_CHECKOUT_SESSION_STATUS.OPEN) {
      return BILLING_FAILURE_CODES.CHECKOUT_SESSION_OPEN;
    }

    return null;
  }

  async function resolveProviderSessionForBlockingSession(blockingSession) {
    const providerCheckoutSessionId = normalizeOptionalString(blockingSession?.providerCheckoutSessionId);
    const operationKey = normalizeOptionalString(blockingSession?.operationKey);

    debugBlockingCheckoutLog("resolve_provider_session.begin", {
      blockingSession: summarizeCheckoutSessionForDebug(blockingSession),
      hasRetrieveCheckoutSession: typeof providerAdapter.retrieveCheckoutSession === "function",
      hasListCheckoutSessionsByOperationKey: typeof providerAdapter.listCheckoutSessionsByOperationKey === "function"
    });

    if (providerCheckoutSessionId && typeof providerAdapter.retrieveCheckoutSession === "function") {
      try {
        const providerSession = await providerAdapter.retrieveCheckoutSession({
          sessionId: providerCheckoutSessionId,
          expand: ["subscription", "customer"]
        });
        if (providerSession) {
          debugBlockingCheckoutLog("resolve_provider_session.retrieve_by_id.hit", {
            providerCheckoutSessionId,
            providerSession: summarizeProviderCheckoutSessionForDebug(providerSession)
          });
          return {
            providerSession,
            providerSessionMissing: false
          };
        }
      } catch (error) {
        if (isProviderNotFoundError(error)) {
          debugBlockingCheckoutLog("resolve_provider_session.retrieve_by_id.not_found", {
            providerCheckoutSessionId,
            errorMessage: String(error?.message || "")
          });
          return {
            providerSession: null,
            providerSessionMissing: true
          };
        }

        debugBlockingCheckoutLog("resolve_provider_session.retrieve_by_id.error", {
          providerCheckoutSessionId,
          errorMessage: String(error?.message || ""),
          errorStatus: Number(error?.statusCode || error?.status || 0) || null
        });
      }
    }

    if (operationKey && typeof providerAdapter.listCheckoutSessionsByOperationKey === "function") {
      try {
        const sessions = await providerAdapter.listCheckoutSessionsByOperationKey({
          operationKey,
          limit: 10
        });
        const providerSession = Array.isArray(sessions) ? sessions[0] || null : null;
        debugBlockingCheckoutLog("resolve_provider_session.list_by_operation_key.result", {
          operationKey,
          returnedCount: Array.isArray(sessions) ? sessions.length : 0,
          providerSession: summarizeProviderCheckoutSessionForDebug(providerSession)
        });
        if (providerSession) {
          return {
            providerSession,
            providerSessionMissing: false
          };
        }
      } catch {
        debugBlockingCheckoutLog("resolve_provider_session.list_by_operation_key.error", {
          operationKey
        });
        return {
          providerSession: null,
          providerSessionMissing: false
        };
      }
    }

    debugBlockingCheckoutLog("resolve_provider_session.none", {
      providerCheckoutSessionId,
      operationKey
    });
    return {
      providerSession: null,
      providerSessionMissing: false
    };
  }

  function collectProviderSubscriptionPriceIds(providerSubscription) {
    const uniquePriceIds = new Set();
    const items = Array.isArray(providerSubscription?.items?.data) ? providerSubscription.items.data : [];

    for (const item of items) {
      const providerPriceId = normalizeOptionalString(item?.price?.id);
      if (providerPriceId) {
        uniquePriceIds.add(providerPriceId);
      }
    }

    const fallbackPlanPriceId = normalizeOptionalString(providerSubscription?.plan?.id);
    if (fallbackPlanPriceId) {
      uniquePriceIds.add(fallbackPlanPriceId);
    }

    return Array.from(uniquePriceIds.values());
  }

  async function resolvePlanIdFromProviderSubscription(providerSubscription, { trx = null } = {}) {
    const providerPriceIds = collectProviderSubscriptionPriceIds(providerSubscription);
    if (providerPriceIds.length < 1) {
      return null;
    }

    if (typeof billingRepository.listPlans !== "function") {
      return null;
    }

    let resolvedPlanId = null;
    const plans = await billingRepository.listPlans(trx ? { trx } : {});
    for (const providerPriceId of providerPriceIds) {
      const matchedPlan =
        plans.find((plan) => {
          const corePrice = plan?.corePrice && typeof plan.corePrice === "object" ? plan.corePrice : null;
          if (!corePrice) {
            return false;
          }
          return (
            String(corePrice.provider || "").trim().toLowerCase() === activeProvider &&
            String(corePrice.providerPriceId || "").trim() === providerPriceId
          );
        }) || null;
      if (!matchedPlan) {
        continue;
      }

      if (resolvedPlanId == null) {
        resolvedPlanId = Number(matchedPlan.id);
        continue;
      }

      if (Number(resolvedPlanId) !== Number(matchedPlan.id)) {
        return null;
      }
    }

    return resolvedPlanId;
  }

  async function projectCurrentProviderSubscription({
    providerSubscription,
    billableEntityId,
    operationKey,
    now = new Date(),
    trx = null
  }) {
    if (!providerSubscription || typeof providerSubscription !== "object") {
      return null;
    }
    if (typeof billingRepository.upsertSubscription !== "function") {
      return null;
    }

    const providerSubscriptionId = normalizeOptionalString(providerSubscription.id);
    if (!providerSubscriptionId) {
      return null;
    }

    const planId = await resolvePlanIdFromProviderSubscription(providerSubscription, {
      trx
    });
    if (!Number.isInteger(Number(planId)) || Number(planId) < 1) {
      return null;
    }

    const providerCustomerId = normalizeOptionalString(providerSubscription.customer);
    let customer = null;
    if (providerCustomerId && typeof billingRepository.findCustomerByProviderCustomerId === "function") {
      customer = await billingRepository.findCustomerByProviderCustomerId(
        {
          provider: activeProvider,
          providerCustomerId
        },
        trx ? { trx } : {}
      );
    }

    const metadataJson = providerSubscription?.metadata && typeof providerSubscription.metadata === "object"
      ? providerSubscription.metadata
      : {};

    if (!customer && providerCustomerId && typeof billingRepository.upsertCustomer === "function") {
      customer = await billingRepository.upsertCustomer(
        {
          billableEntityId,
          provider: activeProvider,
          providerCustomerId,
          metadataJson
        },
        trx ? { trx } : {}
      );
    }

    const normalizedStatus = normalizeProviderSubscriptionStatus(providerSubscription.status);
    return billingRepository.upsertSubscription(
      {
        billableEntityId,
        planId: Number(planId),
        billingCustomerId: customer ? Number(customer.id) : null,
        provider: activeProvider,
        providerSubscriptionId,
        status: normalizedStatus,
        providerSubscriptionCreatedAt: parseUnixEpochSeconds(providerSubscription.created),
        currentPeriodEnd: parseUnixEpochSeconds(providerSubscription.current_period_end),
        trialEnd: parseUnixEpochSeconds(providerSubscription.trial_end),
        canceledAt: parseUnixEpochSeconds(providerSubscription.canceled_at),
        cancelAtPeriodEnd: Boolean(providerSubscription.cancel_at_period_end),
        endedAt: parseUnixEpochSeconds(providerSubscription.ended_at),
        isCurrent: isSubscriptionStatusCurrent(normalizedStatus),
        lastProviderEventCreatedAt: now,
        lastProviderEventId: operationKey ? `self_heal.subscription.${operationKey}` : `self_heal.subscription.${now.getTime()}`,
        metadataJson
      },
      trx ? { trx } : {}
    );
  }

  async function attemptSelfHealBlockingCheckoutSession({
    blockingSession,
    billableEntityId,
    now = new Date(),
    trx = null
  }) {
    const currentBlockingSession = blockingSession && typeof blockingSession === "object" ? blockingSession : null;
    if (!currentBlockingSession) {
      debugBlockingCheckoutLog("self_heal.skip_no_blocking_session", {
        billableEntityId
      });
      return {
        attempted: false,
        repaired: false
      };
    }

    const operationKey = normalizeOptionalString(currentBlockingSession.operationKey);
    const guardrailContext = {
      billableEntityId,
      operationKey
    };

    recordGuardrail("BILLING_CHECKOUT_BLOCKING_SELF_HEAL_ATTEMPT", {
      ...guardrailContext,
      measure: "count",
      value: 1
    });

    const { providerSession, providerSessionMissing } = await resolveProviderSessionForBlockingSession(currentBlockingSession);
    const fallbackProviderCheckoutSessionId = normalizeOptionalString(currentBlockingSession.providerCheckoutSessionId);

    debugBlockingCheckoutLog("self_heal.provider_session_resolved", {
      guardrailContext,
      providerSessionMissing,
      providerSession: summarizeProviderCheckoutSessionForDebug(providerSession)
    });

    if (!providerSession && providerSessionMissing) {
      await billingCheckoutSessionService.markCheckoutSessionExpiredOrAbandoned({
        providerCheckoutSessionId: fallbackProviderCheckoutSessionId,
        operationKey,
        reason: "abandoned",
        providerEventCreatedAt: now,
        provider: activeProvider,
        trx
      });
      recordGuardrail("BILLING_CHECKOUT_BLOCKING_SELF_HEAL_PROVIDER_SESSION_MISSING", {
        ...guardrailContext,
        measure: "count",
        value: 1
      });

      return {
        attempted: true,
        repaired: true
      };
    }

    if (!providerSession) {
      recordGuardrail("BILLING_CHECKOUT_BLOCKING_SELF_HEAL_PROVIDER_SESSION_UNRESOLVED", {
        ...guardrailContext,
        measure: "count",
        value: 1
      });
      return {
        attempted: true,
        repaired: false
      };
    }

    const metadata = providerSession?.metadata && typeof providerSession.metadata === "object" ? providerSession.metadata : {};
    const providerOperationKey = normalizeOptionalString(metadata.operation_key);
    const effectiveOperationKey = operationKey || providerOperationKey;
    const providerCheckoutSessionId = normalizeOptionalString(providerSession.id) || fallbackProviderCheckoutSessionId;
    const providerCustomerId = normalizeProviderRefId(providerSession.customer);
    const providerSubscriptionId =
      normalizeProviderRefId(providerSession.subscription) || normalizeOptionalString(currentBlockingSession.providerSubscriptionId);
    const providerLocalStatus = providerSessionStateToLocalStatus(providerSession.status);

    debugBlockingCheckoutLog("self_heal.provider_session_status_mapped", {
      guardrailContext,
      providerCheckoutSessionId,
      providerStatus: String(providerSession?.status || ""),
      providerLocalStatus,
      effectiveOperationKey,
      providerSubscriptionId
    });

    if (providerLocalStatus === BILLING_CHECKOUT_SESSION_STATUS.EXPIRED) {
      await billingCheckoutSessionService.markCheckoutSessionExpiredOrAbandoned({
        providerCheckoutSessionId,
        operationKey: effectiveOperationKey,
        reason: "expired",
        providerEventCreatedAt: now,
        provider: activeProvider,
        trx
      });
      recordGuardrail("BILLING_CHECKOUT_BLOCKING_SELF_HEAL_EXPIRED", {
        ...guardrailContext,
        operationKey: effectiveOperationKey,
        measure: "count",
        value: 1
      });

      return {
        attempted: true,
        repaired: true
      };
    }

    if (providerLocalStatus === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION) {
      await billingCheckoutSessionService.markCheckoutSessionCompletedPendingSubscription({
        providerCheckoutSessionId,
        operationKey: effectiveOperationKey,
        providerCustomerId,
        providerSubscriptionId,
        providerEventCreatedAt: now,
        billableEntityId,
        provider: activeProvider,
        trx
      });

      if (providerSubscriptionId && typeof billingRepository.findSubscriptionByProviderSubscriptionId === "function") {
        const localSubscription = await billingRepository.findSubscriptionByProviderSubscriptionId(
          {
            provider: activeProvider,
            providerSubscriptionId
          },
          {
            trx,
            forUpdate: true
          }
        );

        if (localSubscription) {
          debugBlockingCheckoutLog("self_heal.local_subscription_found_reconcile", {
            guardrailContext,
            providerSubscriptionId,
            localSubscriptionId: Number(localSubscription.id || 0) || null,
            localSubscriptionStatus: String(localSubscription.status || "")
          });
          await billingCheckoutSessionService.markCheckoutSessionReconciled({
            providerCheckoutSessionId,
            operationKey: effectiveOperationKey,
            providerSubscriptionId,
            providerEventCreatedAt: now,
            provider: activeProvider,
            trx
          });
          recordGuardrail("BILLING_CHECKOUT_BLOCKING_SELF_HEAL_RECONCILED", {
            ...guardrailContext,
            operationKey: effectiveOperationKey,
            measure: "count",
            value: 1
          });

          return {
            attempted: true,
            repaired: true
          };
        }
      }

      if (providerSubscriptionId && typeof providerAdapter.retrieveSubscription === "function") {
        try {
          const providerSubscription = await providerAdapter.retrieveSubscription({
            subscriptionId: providerSubscriptionId
          });
          const providerSubscriptionStatus = normalizeProviderSubscriptionStatus(providerSubscription?.status);

          debugBlockingCheckoutLog("self_heal.provider_subscription_retrieved", {
            guardrailContext,
            providerSubscriptionId,
            providerSubscriptionStatus
          });

          if (!isSubscriptionStatusCurrent(providerSubscriptionStatus)) {
            await billingCheckoutSessionService.markCheckoutSessionExpiredOrAbandoned({
              providerCheckoutSessionId,
              operationKey: effectiveOperationKey,
              reason: "abandoned",
              providerEventCreatedAt: now,
              provider: activeProvider,
              trx
            });
            recordGuardrail("BILLING_CHECKOUT_BLOCKING_SELF_HEAL_PROVIDER_SUBSCRIPTION_TERMINAL", {
              ...guardrailContext,
              operationKey: effectiveOperationKey,
              measure: "count",
              value: 1
            });

            return {
              attempted: true,
              repaired: true
            };
          }

          const projectedSubscription = await projectCurrentProviderSubscription({
            providerSubscription,
            billableEntityId,
            operationKey: effectiveOperationKey,
            now,
            trx
          });
          if (projectedSubscription && isSubscriptionStatusCurrent(projectedSubscription.status)) {
            debugBlockingCheckoutLog("self_heal.provider_subscription_projected_current", {
              guardrailContext,
              providerSubscriptionId,
              projectedSubscriptionId: Number(projectedSubscription.id || 0) || null,
              projectedStatus: String(projectedSubscription.status || "")
            });
            await billingCheckoutSessionService.markCheckoutSessionReconciled({
              providerCheckoutSessionId,
              operationKey: effectiveOperationKey,
              providerSubscriptionId,
              providerEventCreatedAt: now,
              provider: activeProvider,
              trx
            });
            recordGuardrail("BILLING_CHECKOUT_BLOCKING_SELF_HEAL_PROJECTED_CURRENT_SUBSCRIPTION", {
              ...guardrailContext,
              operationKey: effectiveOperationKey,
              measure: "count",
              value: 1
            });

            return {
              attempted: true,
              repaired: true
            };
          }

          recordGuardrail("BILLING_CHECKOUT_BLOCKING_PROVIDER_SUBSCRIPTION_UNPROJECTED", {
            ...guardrailContext,
            operationKey: effectiveOperationKey,
            measure: "count",
            value: 1
          });
          debugBlockingCheckoutLog("self_heal.provider_subscription_unprojected", {
            guardrailContext,
            providerSubscriptionId
          });
        } catch (error) {
          if (isProviderNotFoundError(error)) {
            await billingCheckoutSessionService.markCheckoutSessionExpiredOrAbandoned({
              providerCheckoutSessionId,
              operationKey: effectiveOperationKey,
              reason: "abandoned",
              providerEventCreatedAt: now,
              provider: activeProvider,
              trx
            });
            recordGuardrail("BILLING_CHECKOUT_BLOCKING_SELF_HEAL_PROVIDER_SUBSCRIPTION_MISSING", {
              ...guardrailContext,
              operationKey: effectiveOperationKey,
              measure: "count",
              value: 1
            });

            return {
              attempted: true,
              repaired: true
            };
          }

          debugBlockingCheckoutLog("self_heal.provider_subscription_error", {
            guardrailContext,
            providerSubscriptionId,
            errorMessage: String(error?.message || ""),
            errorStatus: Number(error?.statusCode || error?.status || 0) || null
          });
        }
      }

      debugBlockingCheckoutLog("self_heal.completed_pending_not_repaired", {
        guardrailContext,
        providerSubscriptionId
      });
      return {
        attempted: true,
        repaired: false
      };
    }

    const metadataJson = providerSession?.metadata && typeof providerSession.metadata === "object" ? providerSession.metadata : {};
    await billingCheckoutSessionService.upsertBlockingCheckoutSession(
      {
        billableEntityId,
        provider: activeProvider,
        providerCheckoutSessionId,
        idempotencyRowId: currentBlockingSession.idempotencyRowId || null,
        operationKey: effectiveOperationKey,
        providerCustomerId,
        providerSubscriptionId,
        status: BILLING_CHECKOUT_SESSION_STATUS.OPEN,
        checkoutUrl: normalizeOptionalString(providerSession?.url),
        expiresAt: parseUnixEpochSeconds(providerSession?.expires_at),
        metadataJson
      },
      { trx }
    );
    recordGuardrail("BILLING_CHECKOUT_BLOCKING_SELF_HEAL_STILL_OPEN", {
      ...guardrailContext,
      operationKey: effectiveOperationKey,
      measure: "count",
      value: 1
    });

    return {
      attempted: true,
      repaired: false
    };
  }

  function formatCheckoutResponse({ providerSession, billableEntityId, operationKey, checkoutType }) {
    const normalizedCheckoutType = normalizeCheckoutType(checkoutType);
    return {
      provider: activeProvider,
      billableEntityId: Number(billableEntityId),
      operationKey: String(operationKey || ""),
      checkoutType: normalizedCheckoutType,
      checkoutSession: {
        providerCheckoutSessionId: providerSession?.id ? String(providerSession.id) : null,
        status: providerSessionStateToLocalStatus(providerSession?.status),
        providerStatus: String(providerSession?.status || ""),
        checkoutUrl: providerSession?.url ? String(providerSession.url) : null,
        expiresAt:
          providerSession?.expires_at != null
            ? new Date(Number(providerSession.expires_at) * 1000).toISOString()
            : null,
        customerId: normalizeProviderRefId(providerSession?.customer),
        subscriptionId: normalizeProviderRefId(providerSession?.subscription)
      }
    };
  }

  function buildCheckoutUrls({ successPath, cancelPath }) {
    const baseUrl = new URL(normalizedAppPublicUrl);
    const successUrl = new URL(successPath, baseUrl).toString();
    const cancelUrl = new URL(cancelPath, baseUrl).toString();

    return {
      successUrl,
      cancelUrl
    };
  }

  async function resolveSubscriptionPriceSelection({ plan, provider }) {
    if (typeof billingPricingService.resolvePlanCheckoutPrice === "function") {
      const resolvedPrice = await billingPricingService.resolvePlanCheckoutPrice({
        plan,
        provider
      });
      return {
        basePrice: resolvedPrice,
        lineItemPrices: [resolvedPrice]
      };
    }

    if (typeof billingPricingService.resolveSubscriptionCheckoutPrices === "function") {
      const resolved = await billingPricingService.resolveSubscriptionCheckoutPrices({
        plan,
        provider
      });
      if (resolved?.basePrice) {
        return {
          basePrice: resolved.basePrice,
          lineItemPrices: [resolved.basePrice]
        };
      }
    }

    const resolvedPrice = await billingPricingService.resolvePhase1SellablePrice({
      planId: plan.id,
      provider
    });
    return {
      basePrice: resolvedPrice,
      lineItemPrices: [resolvedPrice]
    };
  }

  async function buildFrozenCheckoutSessionParams({
    operationKey,
    billableEntityId,
    idempotencyRowId,
    plan,
    price,
    customer,
    payload,
    now = new Date()
  }) {
    const { successPath, cancelPath } = normalizeCheckoutPaths(payload);
    const checkoutType = normalizeCheckoutType(payload?.checkoutType);
    const { successUrl, cancelUrl } = buildCheckoutUrls({
      successPath,
      cancelPath
    });

    const expiresAt = Math.floor((now.getTime() + checkoutExpirySeconds * 1000) / 1000);
    const metadata = {
      operation_key: String(operationKey || ""),
      billable_entity_id: String(billableEntityId),
      idempotency_row_id: String(idempotencyRowId),
      checkout_type: checkoutType,
      checkout_flow: checkoutType,
      plan_code: String(plan?.code || "")
    };

    let params;
    if (checkoutType === CHECKOUT_KIND_ONE_OFF) {
      const oneOff = normalizeOneOffPayload(payload?.oneOff, {
        defaultCurrency: deploymentCurrency
      });

      params = {
        mode: "payment",
        line_items: [
          {
            quantity: oneOff.quantity,
            price_data: {
              currency: oneOff.currency.toLowerCase(),
              product_data: {
                name: oneOff.name
              },
              unit_amount: oneOff.amountMinor
            }
          }
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
        client_reference_id: String(billableEntityId),
        expires_at: expiresAt,
        invoice_creation: {
          enabled: true,
          invoice_data: {
            metadata
          }
        }
      };
    } else {
      const checkoutPrice = price || null;
      if (!checkoutPrice) {
        throw buildApiFailure(
          BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
          "Billing pricing configuration is invalid."
        );
      }

      const providerPriceId = String(checkoutPrice?.providerPriceId || "").trim();
      if (!providerPriceId) {
        throw buildApiFailure(
          BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
          "Billing pricing configuration is invalid."
        );
      }

      params = {
        mode: "subscription",
        line_items: [
          {
            price: providerPriceId,
            quantity: 1
          }
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
        client_reference_id: String(billableEntityId),
        expires_at: expiresAt,
        subscription_data: {
          metadata
        }
      };
    }

    if (customer?.providerCustomerId) {
      params.customer = String(customer.providerCustomerId);
    } else if (checkoutType === CHECKOUT_KIND_ONE_OFF) {
      params.customer_creation = "always";
    }

    if (!Number.isInteger(params.expires_at) || params.expires_at < 1) {
      throw new AppError(500, "Frozen checkout params missing required expires_at.");
    }

    return params;
  }

  async function enforceNoCurrentSubscription({ billableEntityId, trx }) {
    const currentSubscription = await billingRepository.findCurrentSubscriptionForEntity(billableEntityId, {
      trx,
      forUpdate: true
    });

    if (!currentSubscription) {
      return null;
    }

    if (
      currentSubscription.isCurrent &&
      NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET.has(currentSubscription.status)
    ) {
      return currentSubscription;
    }

    return null;
  }

  async function applyFinalizeTx({
    idempotencyRowId,
    expectedLeaseVersion,
    billableEntityId,
    providerSession,
    operationKey,
    checkoutType = CHECKOUT_KIND_SUBSCRIPTION,
    checkoutSessionMetadata = null,
    enforceSubscriptionInvariant = true,
    now
  }) {
    const normalizedCheckoutType = normalizeCheckoutType(checkoutType);
    const shouldEnforceNoCurrentSubscription =
      normalizedCheckoutType === CHECKOUT_KIND_SUBSCRIPTION && enforceSubscriptionInvariant !== false;

    return billingRepository.transaction(async (trx) => {
      await billingRepository.findBillableEntityById(billableEntityId, {
        trx,
        forUpdate: true
      });
      await billingRepository.lockSubscriptionsForEntity(billableEntityId, {
        trx,
        forUpdate: true
      });

      const idempotencyRow = await billingRepository.findIdempotencyById(idempotencyRowId, {
        trx,
        forUpdate: true
      });
      if (!idempotencyRow) {
        throw new AppError(404, "Checkout idempotency record not found.");
      }

      if (expectedLeaseVersion != null && Number(idempotencyRow.leaseVersion) !== Number(expectedLeaseVersion)) {
        throw new AppError(409, "Checkout idempotency lease changed before finalization.", {
          code: "BILLING_LEASE_FENCED"
        });
      }

      await billingRepository.lockCheckoutSessionsForEntity(billableEntityId, {
        trx,
        forUpdate: true
      });

      if (shouldEnforceNoCurrentSubscription) {
        const concurrentSubscription = await enforceNoCurrentSubscription({
          billableEntityId,
          trx
        });
        if (concurrentSubscription) {
          await billingIdempotencyService.markFailed(
            {
              idempotencyRowId,
              failureCode: BILLING_FAILURE_CODES.SUBSCRIPTION_EXISTS_USE_PORTAL,
              failureReason: "Current subscription already exists for billable entity.",
              leaseVersion: expectedLeaseVersion
            },
            { trx }
          );

          let abandonedSession = await billingCheckoutSessionService.markCheckoutSessionExpiredOrAbandoned(
              {
                providerCheckoutSessionId: providerSession?.id ? String(providerSession.id) : null,
                operationKey,
                reason: "abandoned",
                providerEventCreatedAt: now,
                provider: activeProvider,
                trx
              }
            );

          if (!abandonedSession) {
            abandonedSession = await billingRepository.upsertCheckoutSessionByOperationKey(
              {
                billableEntityId,
                provider: activeProvider,
                providerCheckoutSessionId: providerSession?.id ? String(providerSession.id) : null,
                idempotencyRowId,
                operationKey,
                providerCustomerId: normalizeProviderRefId(providerSession?.customer),
                providerSubscriptionId: normalizeProviderRefId(providerSession?.subscription),
                status: BILLING_CHECKOUT_SESSION_STATUS.ABANDONED,
                checkoutUrl: providerSession?.url ? String(providerSession.url) : null,
                expiresAt: providerSession?.expires_at ? new Date(Number(providerSession.expires_at) * 1000) : null,
                completedAt: now,
                metadataJson: {
                  ...(checkoutSessionMetadata && typeof checkoutSessionMetadata === "object" ? checkoutSessionMetadata : {})
                }
              },
              { trx }
            );
          }

          return {
            type: "subscription_exists"
          };
        }
      }

      const localStatus = providerSessionStateToLocalStatus(providerSession?.status);
      const providerCheckoutSessionId = providerSession?.id ? String(providerSession.id) : null;
      const providerCustomerId = normalizeProviderRefId(providerSession?.customer);
      const providerSubscriptionId = normalizeProviderRefId(providerSession?.subscription);
      const checkoutUrl = providerSession?.url ? String(providerSession.url) : null;
      const expiresAt = providerSession?.expires_at ? new Date(Number(providerSession.expires_at) * 1000) : null;
      const metadataJson = {
        ...(providerSession?.metadata && typeof providerSession.metadata === "object" ? providerSession.metadata : {}),
        ...(checkoutSessionMetadata && typeof checkoutSessionMetadata === "object" ? checkoutSessionMetadata : {})
      };

      let checkoutSession = null;
      if (
        localStatus === BILLING_CHECKOUT_SESSION_STATUS.OPEN ||
        localStatus === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION
      ) {
        checkoutSession = await billingCheckoutSessionService.upsertBlockingCheckoutSession(
          {
            billableEntityId,
            provider: activeProvider,
            providerCheckoutSessionId,
            idempotencyRowId,
            operationKey,
            providerCustomerId,
            providerSubscriptionId,
            status: localStatus,
            checkoutUrl,
            expiresAt,
            completedAt: localStatus === BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION ? now : null,
            lastProviderEventCreatedAt: now,
            metadataJson
          },
          { trx }
        );
      } else if (localStatus === BILLING_CHECKOUT_SESSION_STATUS.EXPIRED) {
        checkoutSession = await billingCheckoutSessionService.markCheckoutSessionExpiredOrAbandoned(
          {
            providerCheckoutSessionId,
            operationKey,
            reason: "expired",
            providerEventCreatedAt: now,
            provider: activeProvider,
            trx
          }
        );

        if (!checkoutSession) {
          checkoutSession = await billingRepository.upsertCheckoutSessionByOperationKey(
            {
              billableEntityId,
              provider: activeProvider,
              providerCheckoutSessionId,
              idempotencyRowId,
              operationKey,
              providerCustomerId,
              providerSubscriptionId,
              status: BILLING_CHECKOUT_SESSION_STATUS.EXPIRED,
              checkoutUrl,
              expiresAt,
              lastProviderEventCreatedAt: now,
              metadataJson
            },
            { trx }
          );
        }
      } else {
        throw new AppError(500, "Unsupported checkout session provider state.");
      }

      const responseJson = formatCheckoutResponse({
        providerSession,
        billableEntityId,
        operationKey,
        checkoutType: normalizedCheckoutType
      });

      await billingIdempotencyService.markSucceeded(
        {
          idempotencyRowId,
          responseJson,
          providerSessionId: providerSession?.id ? String(providerSession.id) : null,
          leaseVersion: expectedLeaseVersion
        },
        { trx }
      );

      return {
        type: "succeeded",
        responseJson,
        checkoutSession
      };
    });
  }

  async function materializeRecoveryVerificationHold({
    billableEntityId,
    operationKey,
    idempotencyRowId,
    holdExpiresAt,
    now,
    checkoutSessionMetadata = null,
    provider = activeProvider
  }) {
    return billingRepository.transaction(async (trx) => {
      await billingRepository.findBillableEntityById(billableEntityId, {
        trx,
        forUpdate: true
      });
      await billingRepository.lockSubscriptionsForEntity(billableEntityId, {
        trx,
        forUpdate: true
      });
      await billingRepository.findIdempotencyById(idempotencyRowId, {
        trx,
        forUpdate: true
      });
      await billingRepository.lockCheckoutSessionsForEntity(billableEntityId, {
        trx,
        forUpdate: true
      });

      return billingCheckoutSessionService.markCheckoutSessionRecoveryVerificationPending(
        {
          operationKey,
          idempotencyRowId,
          holdExpiresAt,
          providerEventCreatedAt: now,
          billableEntityId,
          metadataJson: checkoutSessionMetadata,
          provider,
          trx
        }
      );
    });
  }

  async function finalizeRecoveredCheckout({ idempotencyRow, providerSession, expectedLeaseVersion, now = new Date() }) {
    const checkoutType = normalizeCheckoutType(idempotencyRow?.normalizedRequestJson?.checkoutType);
    const result = await applyFinalizeTx({
      idempotencyRowId: idempotencyRow.id,
      expectedLeaseVersion,
      billableEntityId: idempotencyRow.billableEntityId,
      providerSession,
      operationKey: idempotencyRow.operationKey,
      checkoutType,
      checkoutSessionMetadata: {
        checkout_flow: checkoutType,
        checkout_type: checkoutType
      },
      enforceSubscriptionInvariant: checkoutType === CHECKOUT_KIND_SUBSCRIPTION,
      now
    });

    if (result.type === "subscription_exists") {
      throw buildApiFailure(BILLING_FAILURE_CODES.SUBSCRIPTION_EXISTS_USE_PORTAL, "Subscription already exists.");
    }

    return result.responseJson;
  }

  async function resolvePendingThroughProvider({ recoveryLeaseRow, expectedLeaseVersion, now = new Date() }) {
    async function failRecoveryStateInvariant(message) {
      await billingIdempotencyService.markFailed({
        idempotencyRowId: recoveryLeaseRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        failureReason: String(message || "Checkout recovery invariant violated.")
      });

      throw buildApiFailure(
        BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        String(message || "Checkout recovery invariant violated.")
      );
    }

    const checkoutType = normalizeCheckoutType(recoveryLeaseRow?.normalizedRequestJson?.checkoutType);
    const checkoutSessionMetadata = {
      checkout_flow: checkoutType,
      checkout_type: checkoutType
    };

    const replayDeadline = recoveryLeaseRow.providerIdempotencyReplayDeadlineAt
      ? new Date(recoveryLeaseRow.providerIdempotencyReplayDeadlineAt)
      : null;
    if (!replayDeadline || Number.isNaN(replayDeadline.getTime())) {
      await failRecoveryStateInvariant("Idempotency replay deadline is missing for pending checkout recovery.");
    }

    const sessionUpperBound = recoveryLeaseRow.providerCheckoutSessionExpiresAtUpperBound
      ? new Date(recoveryLeaseRow.providerCheckoutSessionExpiresAtUpperBound)
      : null;
    if (!sessionUpperBound || Number.isNaN(sessionUpperBound.getTime())) {
      await failRecoveryStateInvariant("Checkout session expiry upper bound is missing for pending checkout recovery.");
    }

    if (!recoveryLeaseRow.providerRequestParamsJson || typeof recoveryLeaseRow.providerRequestParamsJson !== "object") {
      await failRecoveryStateInvariant("Frozen provider request params are missing for checkout recovery.");
    }
    if (!String(recoveryLeaseRow.providerRequestHash || "").trim()) {
      await failRecoveryStateInvariant("Frozen provider request hash is missing for checkout recovery.");
    }

    if (recoveryLeaseRow.providerSessionId) {
      const providerSession = await providerAdapter.retrieveCheckoutSession({
        sessionId: recoveryLeaseRow.providerSessionId,
        expand: ["subscription", "customer"]
      });

      return finalizeRecoveredCheckout({
        idempotencyRow: recoveryLeaseRow,
        providerSession,
        expectedLeaseVersion,
        now
      });
    }

    if (now.getTime() >= replayDeadline.getTime()) {
      const holdRiskUntil = new Date(sessionUpperBound.getTime() + checkoutGraceSeconds * 1000);
      if (now.getTime() < holdRiskUntil.getTime()) {
        await materializeRecoveryVerificationHold({
          billableEntityId: recoveryLeaseRow.billableEntityId,
          operationKey: recoveryLeaseRow.operationKey,
          idempotencyRowId: recoveryLeaseRow.id,
          holdExpiresAt: holdRiskUntil,
          checkoutSessionMetadata,
          now
        });
      }

      await billingIdempotencyService.markExpired({
        idempotencyRowId: recoveryLeaseRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_WINDOW_ELAPSED,
        failureReason: "Provider replay window elapsed before provider session correlation could be recovered."
      });

      throw buildApiFailure(
        BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_WINDOW_ELAPSED,
        "Checkout recovery window elapsed before verification could complete."
      );
    }

    const sdkProvenance = await providerAdapter.getSdkProvenance();

    try {
      billingIdempotencyService.assertReplayProvenanceCompatible({
        idempotencyRow: recoveryLeaseRow,
        runtimeProviderSdkVersion: sdkProvenance.providerSdkVersion,
        runtimeProviderApiVersion: sdkProvenance.providerApiVersion
      });
    } catch {
      const holdExpiry = new Date(
        Math.max(sessionUpperBound.getTime(), replayDeadline.getTime()) + checkoutGraceSeconds * 1000
      );
      await materializeRecoveryVerificationHold({
        billableEntityId: recoveryLeaseRow.billableEntityId,
        operationKey: recoveryLeaseRow.operationKey,
        idempotencyRowId: recoveryLeaseRow.id,
        holdExpiresAt: holdExpiry,
        checkoutSessionMetadata,
        now
      });
      recordGuardrail("BILLING_CHECKOUT_RECOVERY_VERIFICATION_PENDING", {
        operationKey: recoveryLeaseRow.operationKey,
        billableEntityId: recoveryLeaseRow.billableEntityId
      });

      await billingIdempotencyService.markFailed({
        idempotencyRowId: recoveryLeaseRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_REPLAY_PROVENANCE_MISMATCH,
        failureReason: "Runtime provider SDK/API provenance is incompatible with persisted frozen request provenance."
      });

      throw buildApiFailure(
        BILLING_FAILURE_CODES.CHECKOUT_REPLAY_PROVENANCE_MISMATCH,
        "Checkout replay provenance mismatch prevented safe recovery."
      );
    }

    const replayParamsHash = toSha256Hex(toCanonicalJson(recoveryLeaseRow.providerRequestParamsJson));
    try {
      await billingIdempotencyService.assertProviderRequestHashStable({
        idempotencyRowId: recoveryLeaseRow.id,
        candidateProviderRequestHash: replayParamsHash
      });
    } catch (error) {
      await billingIdempotencyService.markFailed({
        idempotencyRowId: recoveryLeaseRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        failureReason: String(error?.message || "Frozen provider request hash mismatch during checkout recovery.")
      });

      throw buildApiFailure(
        BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        "Checkout recovery request state is invalid."
      );
    }

    let providerSession;
    try {
      providerSession = await providerAdapter.createCheckoutSession({
        params: recoveryLeaseRow.providerRequestParamsJson,
        idempotencyKey: recoveryLeaseRow.providerIdempotencyKey
      });
    } catch (error) {
      const providerOutcome = resolveAndRecordProviderOutcome(error, {
        operation: "checkout_recover_replay",
        correlation: {
          operationKey: recoveryLeaseRow.operationKey,
          billableEntityId: recoveryLeaseRow.billableEntityId
        }
      });
      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.MARK_FAILED) {
        await billingIdempotencyService.markFailed({
          idempotencyRowId: recoveryLeaseRow.id,
          leaseVersion: expectedLeaseVersion,
          failureCode: providerOutcome.failureCode,
          failureReason: String(error?.message || "Provider rejected checkout recovery replay.")
        });

        throw buildApiFailure(providerOutcome.failureCode, "Provider rejected checkout recovery replay.");
      }

      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.IN_PROGRESS) {
        throw buildApiFailure(providerOutcome.failureCode, "Checkout recovery is still in progress.");
      }

      throw error;
    }

    return finalizeRecoveredCheckout({
      idempotencyRow: recoveryLeaseRow,
      providerSession,
      expectedLeaseVersion,
      now
    });
  }

  async function recoverCheckoutFromPending({ idempotencyRow, now = new Date() }) {
    const leased = await billingIdempotencyService.recoverPendingRequest({
      idempotencyRowId: idempotencyRow.id,
      leaseOwner: `recovery:${process.pid}`,
      now
    });

    if (leased.type !== "recovery_leased") {
      if (leased.type === "not_pending") {
        if (leased.row?.status === "succeeded") {
          return leased.row.responseJson;
        }

        if (leased.row?.failureCode) {
          throw buildApiFailure(leased.row.failureCode, leased.row.failureReason || "Checkout request cannot be recovered.");
        }
      }

      throw buildApiFailure(BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS, "Checkout recovery is in progress.");
    }

    return resolvePendingThroughProvider({
      recoveryLeaseRow: leased.row,
      expectedLeaseVersion: leased.expectedLeaseVersion,
      now
    });
  }

  async function startCheckout({ request, user, payload, clientIdempotencyKey, now = new Date() }) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForWriteRequest({
      request,
      user
    });
    const payloadBody = payload && typeof payload === "object" ? payload : {};

    const normalizedPaths = normalizeCheckoutPaths(payloadBody);
    const checkoutType = normalizeCheckoutType(payloadBody.checkoutType);
    const normalizedOneOff =
      checkoutType === CHECKOUT_KIND_ONE_OFF
        ? normalizeOneOffPayload(payloadBody.oneOff, {
            defaultCurrency: deploymentCurrency
          })
        : null;
    const normalizedPayload = {
      ...payloadBody,
      ...normalizedPaths
    };
    if (checkoutType === CHECKOUT_KIND_ONE_OFF || payloadBody.checkoutType != null) {
      normalizedPayload.checkoutType = checkoutType;
    }
    if (normalizedOneOff) {
      normalizedPayload.oneOff = normalizedOneOff;
    }

    const normalizedRequest = buildNormalizedCheckoutRequest({
      billableEntityId: billableEntity.id,
      payload: normalizedPayload,
      action: BILLING_ACTIONS.CHECKOUT
    });

    const planCode = normalizePlanCode(normalizedRequest.planCode);
    if (checkoutType === CHECKOUT_KIND_SUBSCRIPTION && !planCode) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            planCode: "planCode is required."
          }
        }
      });
    }
    const checkoutSessionMetadata = {
      checkout_flow: checkoutType,
      checkout_type: checkoutType
    };

    const requestFingerprintHash = toSha256Hex(toCanonicalJson(normalizedRequest));

    let claim = null;
    let checkoutContext = null;
    let claimedIdempotencyRowId = null;
    let txDeterministicFailure = null;
    try {
      await billingRepository.transaction(async (trx) => {
        await billingRepository.findBillableEntityById(billableEntity.id, {
          trx,
          forUpdate: true
        });

        await billingRepository.lockSubscriptionsForEntity(billableEntity.id, {
          trx,
          forUpdate: true
        });

        claim = await billingIdempotencyService.claimOrReplay(
          {
            action: BILLING_ACTIONS.CHECKOUT,
            billableEntityId: billableEntity.id,
            clientIdempotencyKey,
            requestFingerprintHash,
            normalizedRequestJson: normalizedRequest,
            provider: activeProvider,
            now
          },
          { trx }
        );

        if (!claim || claim.type !== "claimed") {
          debugBlockingCheckoutLog("start_checkout.claim_not_claimed", {
            billableEntityId: billableEntity.id,
            claimType: claim?.type || null,
            idempotencyRowId: claim?.row?.id ? Number(claim.row.id) : null
          });
          return;
        }

        debugBlockingCheckoutLog("start_checkout.claimed", {
          billableEntityId: billableEntity.id,
          idempotencyRowId: claim?.row?.id ? Number(claim.row.id) : null,
          checkoutType,
          operationKey: claim?.row?.operationKey ? String(claim.row.operationKey) : null
        });

        const lockedIdempotencyRow = await billingRepository.findIdempotencyById(claim.row.id, {
          trx,
          forUpdate: true
        });
        if (!lockedIdempotencyRow) {
          throw new AppError(404, "Checkout idempotency record not found.");
        }
        claimedIdempotencyRowId = lockedIdempotencyRow.id;

        if (checkoutType === CHECKOUT_KIND_SUBSCRIPTION) {
          const cleanupResult = await billingCheckoutSessionService.cleanupExpiredBlockingSessions({
            billableEntityId: billableEntity.id,
            now,
            trx
          });
          debugBlockingCheckoutLog("start_checkout.cleanup_expired_blocking_sessions", {
            billableEntityId: billableEntity.id,
            now: now.toISOString(),
            updatedCount: Array.isArray(cleanupResult?.updates) ? cleanupResult.updates.length : 0,
            updates: Array.isArray(cleanupResult?.updates)
              ? cleanupResult.updates.map((session) => summarizeCheckoutSessionForDebug(session))
              : [],
            scannedSessions: Array.isArray(cleanupResult?.sessions)
              ? cleanupResult.sessions.map((session) => summarizeCheckoutSessionForDebug(session))
              : []
          });

          let blockingSession = await billingCheckoutSessionService.getBlockingCheckoutSession({
            billableEntityId: billableEntity.id,
            now,
            trx,
            cleanupExpired: false
          });

          debugBlockingCheckoutLog("start_checkout.blocking_session.initial", {
            billableEntityId: billableEntity.id,
            blockingSession: summarizeCheckoutSessionForDebug(blockingSession)
          });

          if (blockingSession) {
            let selfHealAttempted = false;
            try {
              const selfHealResult = await attemptSelfHealBlockingCheckoutSession({
                blockingSession,
                billableEntityId: billableEntity.id,
                now,
                trx
              });
              selfHealAttempted = Boolean(selfHealResult?.attempted);
              debugBlockingCheckoutLog("start_checkout.blocking_session.self_heal_result", {
                billableEntityId: billableEntity.id,
                blockingSession: summarizeCheckoutSessionForDebug(blockingSession),
                selfHealResult: selfHealResult && typeof selfHealResult === "object" ? selfHealResult : null
              });
            } catch {
              debugBlockingCheckoutLog("start_checkout.blocking_session.self_heal_error", {
                billableEntityId: billableEntity.id,
                blockingSession: summarizeCheckoutSessionForDebug(blockingSession)
              });
              recordGuardrail("BILLING_CHECKOUT_BLOCKING_SELF_HEAL_FAILED", {
                billableEntityId: billableEntity.id,
                operationKey: normalizeOptionalString(blockingSession.operationKey),
                measure: "count",
                value: 1
              });
            }

            if (selfHealAttempted) {
              blockingSession = await billingCheckoutSessionService.getBlockingCheckoutSession({
                billableEntityId: billableEntity.id,
                now,
                trx,
                cleanupExpired: false
              });
              debugBlockingCheckoutLog("start_checkout.blocking_session.after_self_heal_reload", {
                billableEntityId: billableEntity.id,
                blockingSession: summarizeCheckoutSessionForDebug(blockingSession)
              });
            }
          }

          if (blockingSession) {
            const failureCode =
              resolveFailureCodeForBlockingSession(blockingSession, now) || BILLING_FAILURE_CODES.CHECKOUT_IN_PROGRESS;
            const failureMessage = "Checkout is blocked by another checkout session.";
            const failureDetailsBase = {
              blockingSessionStatus: String(blockingSession.status || ""),
              blockingOperationKey: normalizeOptionalString(blockingSession.operationKey)
            };
            const failureDetails =
              failureCode === BILLING_FAILURE_CODES.CHECKOUT_SESSION_OPEN
                ? {
                    ...failureDetailsBase,
                    providerCheckoutSessionId: blockingSession.providerCheckoutSessionId || null,
                    checkoutUrl: blockingSession.checkoutUrl || null
                  }
                : failureDetailsBase;
            recordGuardrail("BILLING_CHECKOUT_BLOCKING_SESSION_PERSISTED", {
              billableEntityId: billableEntity.id,
              operationKey: normalizeOptionalString(blockingSession.operationKey),
              measure: "count",
              value: 1
            });
            await billingIdempotencyService.markFailed(
              {
                idempotencyRowId: lockedIdempotencyRow.id,
                failureCode,
                failureReason: `Checkout blocked by existing checkout session with status "${blockingSession.status}".`
              },
              { trx }
            );

            txDeterministicFailure = {
              failureCode,
              failureMessage,
              failureDetails
            };
            debugBlockingCheckoutLog("start_checkout.blocking_session.persisted_failure", {
              billableEntityId: billableEntity.id,
              failureCode,
              failureMessage,
              failureDetails,
              blockingSession: summarizeCheckoutSessionForDebug(blockingSession)
            });
            return;
          }

          const currentSubscription = await enforceNoCurrentSubscription({
            billableEntityId: billableEntity.id,
            trx
          });
          if (currentSubscription) {
            await billingIdempotencyService.markFailed(
              {
                idempotencyRowId: lockedIdempotencyRow.id,
                failureCode: BILLING_FAILURE_CODES.SUBSCRIPTION_EXISTS_USE_PORTAL,
                failureReason: "Current subscription already exists for billable entity."
              },
              { trx }
            );

            txDeterministicFailure = {
              failureCode: BILLING_FAILURE_CODES.SUBSCRIPTION_EXISTS_USE_PORTAL,
              failureMessage: "Subscription already exists."
            };
            return;
          }
        }
        try {
          let plan = null;
          let price = null;
          if (checkoutType === CHECKOUT_KIND_SUBSCRIPTION) {
            plan = await billingRepository.findPlanByCode(planCode, { trx });
            if (!plan || !plan.isActive) {
              throw buildPlanNotFoundError();
            }

            const priceSelection = await resolveSubscriptionPriceSelection({
              plan,
              provider: activeProvider
            });
            price = priceSelection?.basePrice || null;
          }

          const customer = await billingRepository.findCustomerByEntityProvider(
            {
              billableEntityId: billableEntity.id,
              provider: activeProvider
            },
            { trx }
          );

          const frozenParams = await buildFrozenCheckoutSessionParams({
            operationKey: lockedIdempotencyRow.operationKey,
            billableEntityId: billableEntity.id,
            idempotencyRowId: lockedIdempotencyRow.id,
            plan,
            price,
            customer,
            payload: normalizedPayload,
            now
          });

          const providerRequestHash = toSha256Hex(toCanonicalJson(frozenParams));
          const sdkProvenance = await providerAdapter.getSdkProvenance();
          const frozenAt = new Date(now);
          const replayDeadlineAt = new Date(now.getTime() + replayWindowSeconds * 1000);
          const checkoutSessionExpiresAtUpperBound = new Date(Number(frozenParams.expires_at) * 1000);

          await billingRepository.updateIdempotencyById(
            lockedIdempotencyRow.id,
            {
              providerRequestParamsJson: frozenParams,
              providerRequestHash,
              providerRequestSchemaVersion: resolveProviderRequestSchemaVersion(activeProvider),
              providerSdkName: sdkProvenance.providerSdkName,
              providerSdkVersion: sdkProvenance.providerSdkVersion,
              providerApiVersion: sdkProvenance.providerApiVersion,
              providerRequestFrozenAt: frozenAt,
              providerIdempotencyReplayDeadlineAt: replayDeadlineAt,
              providerCheckoutSessionExpiresAtUpperBound: checkoutSessionExpiresAtUpperBound,
              provider: activeProvider
            },
            { trx }
          );

          checkoutContext = {
            idempotencyRowId: lockedIdempotencyRow.id,
            expectedLeaseVersion: lockedIdempotencyRow.leaseVersion,
            operationKey: lockedIdempotencyRow.operationKey,
            providerIdempotencyKey: lockedIdempotencyRow.providerIdempotencyKey,
            providerParams: frozenParams,
            billableEntityId: billableEntity.id,
            checkoutType,
            checkoutSessionMetadata,
            enforceSubscriptionInvariant: checkoutType === CHECKOUT_KIND_SUBSCRIPTION
          };
        } catch (error) {
          const failureCode =
            resolveDeterministicFailureCode(error) || BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID;

          await billingIdempotencyService.markFailed(
            {
              idempotencyRowId: lockedIdempotencyRow.id,
              failureCode,
              failureReason: String(error?.message || "Checkout request failed before provider dispatch.")
            },
            { trx }
          );

          txDeterministicFailure = {
            failureCode,
            failureMessage: String(error?.message || "Checkout request failed before provider dispatch.")
          };
        }
      });
    } catch (error) {
      if (claimedIdempotencyRowId != null) {
        const failureCode = resolveDeterministicFailureCode(error) || BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID;
        await billingRepository.transaction(async (trx) => {
          const lockedIdempotencyRow = await billingRepository.findIdempotencyById(claimedIdempotencyRowId, {
            trx,
            forUpdate: true
          });
          if (!lockedIdempotencyRow || lockedIdempotencyRow.status !== BILLING_IDEMPOTENCY_STATUS.PENDING) {
            return;
          }

          await billingIdempotencyService.markFailed(
            {
              idempotencyRowId: lockedIdempotencyRow.id,
              failureCode,
              failureReason: String(error?.message || "Checkout request failed before provider dispatch.")
            },
            { trx }
          );
        });
      }

      throw error;
    }

    if (txDeterministicFailure) {
      debugBlockingCheckoutLog("start_checkout.tx_deterministic_failure.throw", {
        billableEntityId: billableEntity.id,
        failure: txDeterministicFailure,
        claimType: claim?.type || null,
        claimedIdempotencyRowId
      });
      throw buildApiFailure(
        txDeterministicFailure.failureCode,
        txDeterministicFailure.failureMessage,
        txDeterministicFailure.failureDetails || {}
      );
    }

    if (!claim) {
      throw new AppError(500, "Checkout idempotency claim did not return a result.");
    }

    if (claim.type === "replay_succeeded") {
      debugBlockingCheckoutLog("start_checkout.replay_succeeded", {
        billableEntityId: billableEntity.id,
        idempotencyRowId: claim?.row?.id ? Number(claim.row.id) : null
      });
      return claim.row.responseJson;
    }

    if (claim.type === "replay_terminal") {
      debugBlockingCheckoutLog("start_checkout.replay_terminal", {
        billableEntityId: billableEntity.id,
        idempotencyRowId: claim?.row?.id ? Number(claim.row.id) : null,
        failureCode: claim?.row?.failureCode || null,
        failureReason: claim?.row?.failureReason || null
      });
      throw buildApiFailure(
        claim.row.failureCode || BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR,
        claim.row.failureReason || "Checkout request previously failed."
      );
    }

    if (claim.type === "in_progress_same_key") {
      debugBlockingCheckoutLog("start_checkout.in_progress_same_key", {
        billableEntityId: billableEntity.id,
        idempotencyRowId: claim?.row?.id ? Number(claim.row.id) : null
      });
      throw buildApiFailure(BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS, "Checkout request is in progress.");
    }

    if (claim.type === "checkout_in_progress_other_key") {
      debugBlockingCheckoutLog("start_checkout.checkout_in_progress_other_key", {
        billableEntityId: billableEntity.id,
        idempotencyRowId: claim?.row?.id ? Number(claim.row.id) : null
      });
      throw buildApiFailure(BILLING_FAILURE_CODES.CHECKOUT_IN_PROGRESS, "Another checkout request is in progress.");
    }

    if (claim.type === "recover_pending") {
      debugBlockingCheckoutLog("start_checkout.recover_pending", {
        billableEntityId: billableEntity.id,
        idempotencyRowId: claim?.row?.id ? Number(claim.row.id) : null,
        operationKey: claim?.row?.operationKey ? String(claim.row.operationKey) : null
      });
      return recoverCheckoutFromPending({
        idempotencyRow: claim.row,
        now
      });
    }

    if (claim.type !== "claimed" || !checkoutContext) {
      throw new AppError(500, "Checkout orchestration state is invalid.");
    }

    let providerSession;
    try {
      providerSession = await providerAdapter.createCheckoutSession({
        params: checkoutContext.providerParams,
        idempotencyKey: checkoutContext.providerIdempotencyKey
      });
    } catch (error) {
      const providerOutcome = resolveAndRecordProviderOutcome(error, {
        operation: "checkout_create",
        correlation: {
          operationKey: checkoutContext.operationKey,
          billableEntityId: checkoutContext.billableEntityId
        }
      });
      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.MARK_FAILED) {
        try {
          await billingIdempotencyService.markFailed({
            idempotencyRowId: checkoutContext.idempotencyRowId,
            leaseVersion: checkoutContext.expectedLeaseVersion,
            failureCode: providerOutcome.failureCode,
            failureReason: String(error?.message || "Provider rejected checkout create request.")
          });
        } catch (markFailedError) {
          if (String(markFailedError?.code || "").trim() === "BILLING_LEASE_FENCED") {
            throw buildApiFailure(BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS, "Checkout request is in progress.");
          }
          throw markFailedError;
        }

        throw buildApiFailure(providerOutcome.failureCode, "Provider rejected checkout create request.");
      }

      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.IN_PROGRESS) {
        throw buildApiFailure(providerOutcome.failureCode, "Checkout request is in progress.");
      }

      throw error;
    }

    const finalized = await applyFinalizeTx({
      idempotencyRowId: checkoutContext.idempotencyRowId,
      expectedLeaseVersion: checkoutContext.expectedLeaseVersion,
      billableEntityId: checkoutContext.billableEntityId,
      providerSession,
      operationKey: checkoutContext.operationKey,
      checkoutType: checkoutContext.checkoutType,
      checkoutSessionMetadata: checkoutContext.checkoutSessionMetadata,
      enforceSubscriptionInvariant: checkoutContext.enforceSubscriptionInvariant,
      now
    });

    if (finalized.type === "subscription_exists") {
      throw buildApiFailure(BILLING_FAILURE_CODES.SUBSCRIPTION_EXISTS_USE_PORTAL, "Subscription already exists.");
    }

    return finalized.responseJson;
  }

  return {
    startCheckout,
    recoverCheckoutFromPending,
    finalizeRecoveredCheckout,
    buildFrozenCheckoutSessionParams
  };
}

const __testables = {
  normalizePlanCode,
  normalizeCheckoutType,
  normalizeOneOffPayload,
  isDeterministicProviderRejection,
  isIndeterminateProviderOutcome,
  providerSessionStateToLocalStatus,
  buildApiFailure
};

export { createService, __testables };
