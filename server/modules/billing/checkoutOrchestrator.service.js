/* eslint-disable max-lines */
import { AppError } from "../../lib/errors.js";
import {
  BILLING_ACTIONS,
  BILLING_CHECKOUT_SESSION_STATUS,
  BILLING_FAILURE_CODES,
  BILLING_IDEMPOTENCY_STATUS,
  BILLING_PROVIDER_STRIPE,
  NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET,
  STRIPE_PHASE1_DEFAULTS,
  PROVIDER_REQUEST_SCHEMA_VERSION,
  statusFromFailureCode
} from "./constants.js";
import { toCanonicalJson, toSha256Hex } from "./canonicalJson.js";
import { normalizeCheckoutPaths } from "./pathPolicy.js";

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

function isDeterministicProviderRejection(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
    return true;
  }

  const code = String(error?.code || "").trim();
  if (code === "StripeInvalidRequestError") {
    return true;
  }

  return false;
}

function isIndeterminateProviderOutcome(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  if (statusCode === 429 || statusCode >= 500) {
    return true;
  }

  const code = String(error?.code || "").trim().toLowerCase();
  if (
    code === "ecconnreset" ||
    code === "etimedout" ||
    code === "econnaborted" ||
    code === "stripeapiconnectionerror" ||
    code === "stripeapierror"
  ) {
    return true;
  }

  const message = String(error?.message || "").toLowerCase();
  if (message.includes("timeout") || message.includes("network") || message.includes("connection")) {
    return true;
  }

  return false;
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

function createService({
  billingRepository,
  billingPolicyService,
  billingPricingService,
  billingIdempotencyService,
  billingCheckoutSessionService,
  stripeSdkService,
  appPublicUrl,
  observabilityService = null,
  checkoutSessionGraceSeconds = STRIPE_PHASE1_DEFAULTS.CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS,
  providerReplayWindowSeconds = STRIPE_PHASE1_DEFAULTS.PROVIDER_IDEMPOTENCY_REPLAY_WINDOW_SECONDS,
  providerCheckoutExpirySeconds = STRIPE_PHASE1_DEFAULTS.CHECKOUT_PROVIDER_EXPIRES_SECONDS
}) {
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
  if (!stripeSdkService || typeof stripeSdkService.createCheckoutSession !== "function") {
    throw new Error("stripeSdkService.createCheckoutSession is required.");
  }

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

  function formatCheckoutResponse({ providerSession, billableEntityId, operationKey, checkoutType }) {
    const normalizedCheckoutType = normalizeCheckoutType(checkoutType);
    return {
      provider: BILLING_PROVIDER_STRIPE,
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
        customerId: providerSession?.customer ? String(providerSession.customer) : null,
        subscriptionId: providerSession?.subscription ? String(providerSession.subscription) : null
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
    if (typeof billingPricingService.resolveSubscriptionCheckoutPrices === "function") {
      const resolved = await billingPricingService.resolveSubscriptionCheckoutPrices({
        plan,
        provider
      });

      if (resolved && Array.isArray(resolved.lineItemPrices) && resolved.lineItemPrices.length > 0) {
        return resolved;
      }

      if (resolved?.basePrice) {
        const meteredComponentPrices = Array.isArray(resolved.meteredComponentPrices)
          ? resolved.meteredComponentPrices
          : [];
        return {
          basePrice: resolved.basePrice,
          meteredComponentPrices,
          lineItemPrices: [resolved.basePrice, ...meteredComponentPrices]
        };
      }
    }

    const basePrice = await billingPricingService.resolvePhase1SellablePrice({
      planId: plan.id,
      provider
    });
    return {
      basePrice,
      meteredComponentPrices: [],
      lineItemPrices: [basePrice]
    };
  }

  async function buildFrozenStripeCheckoutSessionParams({
    operationKey,
    billableEntityId,
    idempotencyRowId,
    plan,
    price,
    priceSelection,
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
      plan_code: String(plan?.code || ""),
      plan_version: String(Number(plan?.version || 0) || "")
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
      const lineItemPrices =
        Array.isArray(priceSelection?.lineItemPrices) && priceSelection.lineItemPrices.length > 0
          ? priceSelection.lineItemPrices
          : price
            ? [price]
            : [];
      if (lineItemPrices.length < 1) {
        throw buildApiFailure(
          BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
          "Billing pricing configuration is invalid."
        );
      }

      const lineItems = lineItemPrices.map((lineItemPrice) => {
        const providerPriceId = String(lineItemPrice?.providerPriceId || "").trim();
        if (!providerPriceId) {
          throw buildApiFailure(
            BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
            "Billing pricing configuration is invalid."
          );
        }

        const usageType = String(lineItemPrice?.usageType || "licensed")
          .trim()
          .toLowerCase();
        if (usageType === "metered") {
          return {
            price: providerPriceId
          };
        }

        const quantityCandidate = lineItemPrice?.quantity == null ? 1 : Number(lineItemPrice.quantity);
        const quantity = Number.isInteger(quantityCandidate) && quantityCandidate > 0 ? quantityCandidate : 1;
        return {
          price: providerPriceId,
          quantity
        };
      });

      params = {
        mode: "subscription",
        line_items: lineItems,
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
              provider: BILLING_PROVIDER_STRIPE,
              trx
            }
          );

          if (!abandonedSession) {
            abandonedSession = await billingRepository.upsertCheckoutSessionByOperationKey(
              {
                billableEntityId,
                provider: BILLING_PROVIDER_STRIPE,
                providerCheckoutSessionId: providerSession?.id ? String(providerSession.id) : null,
                idempotencyRowId,
                operationKey,
                providerCustomerId: providerSession?.customer ? String(providerSession.customer) : null,
                providerSubscriptionId: providerSession?.subscription ? String(providerSession.subscription) : null,
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

          if (providerSession?.id) {
            await billingRepository.enqueueOutboxJob(
              {
                jobType: "expire_checkout_session",
                dedupeKey: `expire_checkout_session:${String(providerSession.id)}`,
                billableEntityId,
                operationKey,
                payloadJson: {
                  provider: BILLING_PROVIDER_STRIPE,
                  providerCheckoutSessionId: String(providerSession.id),
                  billableEntityId,
                  operationKey
                },
                availableAt: now
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
      const providerCustomerId = providerSession?.customer ? String(providerSession.customer) : null;
      const providerSubscriptionId = providerSession?.subscription ? String(providerSession.subscription) : null;
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
            provider: BILLING_PROVIDER_STRIPE,
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
            provider: BILLING_PROVIDER_STRIPE,
            trx
          }
        );

        if (!checkoutSession) {
          checkoutSession = await billingRepository.upsertCheckoutSessionByOperationKey(
            {
              billableEntityId,
              provider: BILLING_PROVIDER_STRIPE,
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
    provider = BILLING_PROVIDER_STRIPE
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
      const providerSession = await stripeSdkService.retrieveCheckoutSession({
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

    const sdkProvenance = await stripeSdkService.getSdkProvenance();

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
        failureReason: "Runtime Stripe SDK/API provenance is incompatible with persisted frozen request provenance."
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
      providerSession = await stripeSdkService.createCheckoutSession({
        params: recoveryLeaseRow.providerRequestParamsJson,
        idempotencyKey: recoveryLeaseRow.providerIdempotencyKey
      });
    } catch (error) {
      if (isDeterministicProviderRejection(error)) {
        recordGuardrail("BILLING_CHECKOUT_PROVIDER_ERROR", {
          operationKey: recoveryLeaseRow.operationKey,
          billableEntityId: recoveryLeaseRow.billableEntityId
        });
        await billingIdempotencyService.markFailed({
          idempotencyRowId: recoveryLeaseRow.id,
          leaseVersion: expectedLeaseVersion,
          failureCode: BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR,
          failureReason: String(error?.message || "Provider rejected checkout recovery replay.")
        });

        throw buildApiFailure(BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR, "Provider rejected checkout recovery replay.");
      }

      if (isIndeterminateProviderOutcome(error)) {
        recordGuardrail("BILLING_CHECKOUT_INDETERMINATE_PROVIDER_OUTCOME", {
          operationKey: recoveryLeaseRow.operationKey,
          billableEntityId: recoveryLeaseRow.billableEntityId
        });
        throw buildApiFailure(BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS, "Checkout recovery is still in progress.");
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

    const normalizedPaths = normalizeCheckoutPaths(payload || {});
    const checkoutType = normalizeCheckoutType(payload?.checkoutType);
    const normalizedOneOff =
      checkoutType === CHECKOUT_KIND_ONE_OFF
        ? normalizeOneOffPayload(payload?.oneOff, {
            defaultCurrency: deploymentCurrency
          })
        : null;
    const normalizedPayload = {
      ...(payload || {}),
      ...normalizedPaths
    };
    if (checkoutType === CHECKOUT_KIND_ONE_OFF || payload?.checkoutType != null) {
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
            provider: BILLING_PROVIDER_STRIPE,
            now
          },
          { trx }
        );

        if (!claim || claim.type !== "claimed") {
          return;
        }

        const lockedIdempotencyRow = await billingRepository.findIdempotencyById(claim.row.id, {
          trx,
          forUpdate: true
        });
        if (!lockedIdempotencyRow) {
          throw new AppError(404, "Checkout idempotency record not found.");
        }
        claimedIdempotencyRowId = lockedIdempotencyRow.id;

        if (checkoutType === CHECKOUT_KIND_SUBSCRIPTION) {
          await billingCheckoutSessionService.cleanupExpiredBlockingSessions({
            billableEntityId: billableEntity.id,
            now,
            trx
          });

          const blockingSession = await billingCheckoutSessionService.getBlockingCheckoutSession({
            billableEntityId: billableEntity.id,
            now,
            trx,
            cleanupExpired: false
          });

          if (blockingSession) {
            const failureCode =
              resolveFailureCodeForBlockingSession(blockingSession, now) || BILLING_FAILURE_CODES.CHECKOUT_IN_PROGRESS;
            const failureMessage = "Checkout is blocked by another checkout session.";
            const failureDetails =
              failureCode === BILLING_FAILURE_CODES.CHECKOUT_SESSION_OPEN
                ? {
                    providerCheckoutSessionId: blockingSession.providerCheckoutSessionId || null,
                    checkoutUrl: blockingSession.checkoutUrl || null
                  }
                : {};
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
          let priceSelection = null;
          if (checkoutType === CHECKOUT_KIND_SUBSCRIPTION) {
            plan = await billingRepository.findPlanByCode(planCode, { trx });
            if (!plan || !plan.isActive) {
              throw buildPlanNotFoundError();
            }

            priceSelection = await resolveSubscriptionPriceSelection({
              plan,
              provider: BILLING_PROVIDER_STRIPE
            });
          }

          const customer = await billingRepository.findCustomerByEntityProvider(
            {
              billableEntityId: billableEntity.id,
              provider: BILLING_PROVIDER_STRIPE
            },
            { trx }
          );

          const frozenParams = await buildFrozenStripeCheckoutSessionParams({
            operationKey: lockedIdempotencyRow.operationKey,
            billableEntityId: billableEntity.id,
            idempotencyRowId: lockedIdempotencyRow.id,
            plan,
            price: priceSelection?.basePrice || null,
            priceSelection,
            customer,
            payload: normalizedPayload,
            now
          });

          const providerRequestHash = toSha256Hex(toCanonicalJson(frozenParams));
          const sdkProvenance = await stripeSdkService.getSdkProvenance();
          const frozenAt = new Date(now);
          const replayDeadlineAt = new Date(now.getTime() + replayWindowSeconds * 1000);
          const checkoutSessionExpiresAtUpperBound = new Date(Number(frozenParams.expires_at) * 1000);

          await billingRepository.updateIdempotencyById(
            lockedIdempotencyRow.id,
            {
              providerRequestParamsJson: frozenParams,
              providerRequestHash,
              providerRequestSchemaVersion: PROVIDER_REQUEST_SCHEMA_VERSION,
              providerSdkName: sdkProvenance.providerSdkName,
              providerSdkVersion: sdkProvenance.providerSdkVersion,
              providerApiVersion: sdkProvenance.providerApiVersion,
              providerRequestFrozenAt: frozenAt,
              providerIdempotencyReplayDeadlineAt: replayDeadlineAt,
              providerCheckoutSessionExpiresAtUpperBound: checkoutSessionExpiresAtUpperBound,
              provider: BILLING_PROVIDER_STRIPE
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
      return claim.row.responseJson;
    }

    if (claim.type === "replay_terminal") {
      throw buildApiFailure(
        claim.row.failureCode || BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR,
        claim.row.failureReason || "Checkout request previously failed."
      );
    }

    if (claim.type === "in_progress_same_key") {
      throw buildApiFailure(BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS, "Checkout request is in progress.");
    }

    if (claim.type === "checkout_in_progress_other_key") {
      throw buildApiFailure(BILLING_FAILURE_CODES.CHECKOUT_IN_PROGRESS, "Another checkout request is in progress.");
    }

    if (claim.type === "recover_pending") {
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
      providerSession = await stripeSdkService.createCheckoutSession({
        params: checkoutContext.providerParams,
        idempotencyKey: checkoutContext.providerIdempotencyKey
      });
    } catch (error) {
      if (isDeterministicProviderRejection(error)) {
        recordGuardrail("BILLING_CHECKOUT_PROVIDER_ERROR", {
          operationKey: checkoutContext.operationKey,
          billableEntityId: checkoutContext.billableEntityId
        });
        try {
          await billingIdempotencyService.markFailed({
            idempotencyRowId: checkoutContext.idempotencyRowId,
            leaseVersion: checkoutContext.expectedLeaseVersion,
            failureCode: BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR,
            failureReason: String(error?.message || "Provider rejected checkout create request.")
          });
        } catch (markFailedError) {
          if (String(markFailedError?.code || "").trim() === "BILLING_LEASE_FENCED") {
            throw buildApiFailure(BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS, "Checkout request is in progress.");
          }
          throw markFailedError;
        }

        throw buildApiFailure(BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR, "Provider rejected checkout create request.");
      }

      if (isIndeterminateProviderOutcome(error)) {
        recordGuardrail("BILLING_CHECKOUT_INDETERMINATE_PROVIDER_OUTCOME", {
          operationKey: checkoutContext.operationKey,
          billableEntityId: checkoutContext.billableEntityId
        });
        throw buildApiFailure(BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS, "Checkout request is in progress.");
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
    buildFrozenStripeCheckoutSessionParams
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
