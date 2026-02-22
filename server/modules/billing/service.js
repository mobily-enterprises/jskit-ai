import { AppError } from "../../lib/errors.js";
import { normalizePagination } from "../../lib/primitives/pagination.js";
import {
  BILLING_ACTIONS,
  BILLING_DEFAULT_PROVIDER,
  BILLING_FAILURE_CODES,
  BILLING_RUNTIME_DEFAULTS,
  statusFromFailureCode
} from "./constants.js";
import { toCanonicalJson, toSha256Hex } from "./canonicalJson.js";
import { normalizeBillingPath, normalizePortalPath } from "./pathPolicy.js";
import { assertEntitlementValueOrThrow } from "../../lib/billing/entitlementSchemaRegistry.js";
import { resolveCapabilityLimitConfig } from "./appCapabilityLimits.js";
import {
  PROVIDER_OUTCOME_ACTIONS,
  resolveProviderErrorOutcome
} from "./providerOutcomePolicy.js";
import { isBillingProviderError } from "./providers/shared/providerError.contract.js";
import { normalizeProviderSubscriptionStatus, parseUnixEpochSeconds } from "./webhookProjection.utils.js";

function mapFailureCodeToError(failureCode, fallbackMessage) {
  const code = String(failureCode || "").trim() || BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR;
  return new AppError(statusFromFailureCode(code), fallbackMessage || "Billing request failed.", {
    code,
    details: {
      code
    }
  });
}

function normalizePortalRequest({ billableEntityId, payload }) {
  return {
    action: BILLING_ACTIONS.PORTAL,
    billableEntityId: Number(billableEntityId),
    returnPath: String(payload.returnPath || "").trim()
  };
}

function normalizeCurrency(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizePaymentLinkQuantity(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10000) {
    return null;
  }

  return parsed;
}

function normalizePaymentLinkLineItems(items, { defaultCurrency }) {
  const sourceItems = Array.isArray(items) ? items : [];
  if (sourceItems.length < 1 || sourceItems.length > 20) {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          lineItems: "lineItems must contain between 1 and 20 entries."
        }
      }
    });
  }

  const normalizedItems = [];
  const requiredCurrency = normalizeCurrency(defaultCurrency);
  for (let index = 0; index < sourceItems.length; index += 1) {
    const entry = sourceItems[index] && typeof sourceItems[index] === "object" ? sourceItems[index] : {};
    const lineItemFieldPrefix = `lineItems[${index}]`;
    const priceId = toNonEmptyString(entry.priceId || entry.providerPriceId);
    const quantity = normalizePaymentLinkQuantity(entry.quantity == null ? 1 : entry.quantity);
    if (!quantity) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            [`${lineItemFieldPrefix}.quantity`]: `${lineItemFieldPrefix}.quantity must be an integer between 1 and 10,000.`
          }
        }
      });
    }

    if (priceId) {
      normalizedItems.push({
        type: "price",
        priceId,
        quantity
      });
      continue;
    }

    const name = toNonEmptyString(entry.name);
    if (!name) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            [`${lineItemFieldPrefix}.name`]: `${lineItemFieldPrefix}.name is required when priceId is not provided.`
          }
        }
      });
    }

    const amountMinor = Number(entry.amountMinor);
    if (!Number.isInteger(amountMinor) || amountMinor < 1 || amountMinor > 99999999) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            [`${lineItemFieldPrefix}.amountMinor`]:
              `${lineItemFieldPrefix}.amountMinor must be an integer between 1 and 99,999,999.`
          }
        }
      });
    }

    const currency = normalizeCurrency(entry.currency || defaultCurrency);
    if (!currency || currency.length !== 3) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            [`${lineItemFieldPrefix}.currency`]: `${lineItemFieldPrefix}.currency must be a 3-letter ISO currency code.`
          }
        }
      });
    }
    if (requiredCurrency && currency !== requiredCurrency) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            [`${lineItemFieldPrefix}.currency`]:
              `${lineItemFieldPrefix}.currency must match deployment billing currency (${requiredCurrency}).`
          }
        }
      });
    }

    normalizedItems.push({
      type: "ad_hoc",
      name,
      amountMinor,
      quantity,
      currency
    });
  }

  return normalizedItems;
}

function normalizePaymentLinkRequest({ billableEntityId, payload, defaultCurrency }) {
  const body = payload && typeof payload === "object" ? payload : {};
  const normalizedSuccessPath = normalizeBillingPath(body.successPath, { fieldName: "successPath" });
  const sourceLineItems = Array.isArray(body.lineItems) && body.lineItems.length > 0 ? body.lineItems : null;

  const normalizedLineItems = sourceLineItems
    ? normalizePaymentLinkLineItems(sourceLineItems, { defaultCurrency })
    : normalizePaymentLinkLineItems([body.oneOff || {}], { defaultCurrency });

  return {
    action: BILLING_ACTIONS.PAYMENT_LINK,
    billableEntityId: Number(billableEntityId),
    successPath: normalizedSuccessPath,
    lineItems: normalizedLineItems
  };
}

function toLeaseVersionOrNull(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function isLeaseFencedError(error) {
  return String(error?.code || "").trim() === "BILLING_LEASE_FENCED";
}

function isLocalPreparationError(error) {
  return error instanceof AppError && !isBillingProviderError(error);
}

const LIFETIME_WINDOW_END = new Date("9999-12-31T23:59:59.999Z");
const BILLING_LIMIT_EXCEEDED_ERROR_CODE = "BILLING_LIMIT_EXCEEDED";
const BILLING_LIMIT_NOT_CONFIGURED_ERROR_CODE = "BILLING_LIMIT_NOT_CONFIGURED";
const PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW = "required_now";
const PAID_PLAN_CHANGE_POLICY_ALLOW_WITHOUT_PAYMENT_METHOD = "allow_without_payment_method";
const PLAN_ASSIGNMENT_DEFAULT_PERIOD_DAYS = 30;
const SIGNUP_PROMO_PERIOD_DAYS = 7;

function toNonEmptyString(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }

  return parsed;
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function resolveUsageWindow(interval, now = new Date()) {
  const reference = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(reference.getTime())) {
    throw new AppError(400, "Invalid usage window reference time.");
  }

  const normalizedInterval = toNonEmptyString(interval).toLowerCase();
  if (normalizedInterval === "lifetime") {
    return {
      interval: "lifetime",
      windowStartAt: new Date("1970-01-01T00:00:00.000Z"),
      windowEndAt: new Date(LIFETIME_WINDOW_END)
    };
  }

  if (normalizedInterval === "day") {
    const windowStartAt = startOfUtcDay(reference);
    return {
      interval: "day",
      windowStartAt,
      windowEndAt: addUtcDays(windowStartAt, 1)
    };
  }

  if (normalizedInterval === "week") {
    const day = reference.getUTCDay();
    const daysSinceMonday = (day + 6) % 7;
    const windowStartAt = addUtcDays(startOfUtcDay(reference), -daysSinceMonday);
    return {
      interval: "week",
      windowStartAt,
      windowEndAt: addUtcDays(windowStartAt, 7)
    };
  }

  if (normalizedInterval === "year") {
    const windowStartAt = new Date(Date.UTC(reference.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    return {
      interval: "year",
      windowStartAt,
      windowEndAt: new Date(Date.UTC(reference.getUTCFullYear() + 1, 0, 1, 0, 0, 0, 0))
    };
  }

  const windowStartAt = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1, 0, 0, 0, 0));
  return {
    interval: "month",
    windowStartAt,
    windowEndAt: new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1, 0, 0, 0, 0))
  };
}

function toDateOrNull(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function resolveSubscriptionPeriodEnd(subscription, now = new Date()) {
  const candidate = toDateOrNull(subscription?.currentPeriodEnd) || toDateOrNull(subscription?.trialEnd);
  if (candidate) {
    return candidate;
  }

  return addUtcDays(now, PLAN_ASSIGNMENT_DEFAULT_PERIOD_DAYS);
}

function resolvePlanCoreAmountMinor(plan) {
  const amount = Number(plan?.corePrice?.unitAmountMinor);
  if (!Number.isInteger(amount) || amount < 0) {
    return 0;
  }
  return amount;
}

function classifyPlanChangeDirection(currentPlan, targetPlan) {
  if (!currentPlan || !targetPlan) {
    return "new";
  }

  if (Number(currentPlan.id) === Number(targetPlan.id)) {
    return "same";
  }

  const currentAmount = resolvePlanCoreAmountMinor(currentPlan);
  const targetAmount = resolvePlanCoreAmountMinor(targetPlan);
  if (targetAmount > currentAmount) {
    return "upgrade";
  }
  if (targetAmount < currentAmount) {
    return "downgrade";
  }
  return "lateral";
}

function normalizePaidPlanChangePolicy(value) {
  const normalized = toNonEmptyString(value).toLowerCase();
  if (normalized === PAID_PLAN_CHANGE_POLICY_ALLOW_WITHOUT_PAYMENT_METHOD) {
    return PAID_PLAN_CHANGE_POLICY_ALLOW_WITHOUT_PAYMENT_METHOD;
  }
  return PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW;
}

function normalizeUsageAmount(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  const integer = Math.floor(parsed);
  return integer > 0 ? integer : null;
}

function classifyEntitlementType(schemaVersion) {
  const normalized = toNonEmptyString(schemaVersion).toLowerCase();
  if (normalized === "entitlement.quota.v1") {
    return "quota";
  }
  if (normalized === "entitlement.boolean.v1") {
    return "boolean";
  }
  if (normalized === "entitlement.string_list.v1") {
    return "string_list";
  }
  return "unknown";
}

function normalizePaymentMethod(method, defaultPaymentMethodId) {
  const paymentMethod = method && typeof method === "object" ? method : {};
  const card = paymentMethod.card && typeof paymentMethod.card === "object" ? paymentMethod.card : {};
  const providerPaymentMethodId = toNonEmptyString(paymentMethod.id);
  if (!providerPaymentMethodId) {
    return null;
  }

  return {
    providerPaymentMethodId,
    type: toNonEmptyString(paymentMethod.type) || "card",
    brand: toNonEmptyString(card.brand) || null,
    last4: toNonEmptyString(card.last4) || null,
    expMonth: toPositiveInteger(card.exp_month),
    expYear: toPositiveInteger(card.exp_year),
    isDefault: providerPaymentMethodId === toNonEmptyString(defaultPaymentMethodId),
    metadataJson: {
      fingerprint: toNonEmptyString(card.fingerprint) || null
    }
  };
}

function toTitleCase(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return normalized
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function buildWorkspaceTimelineEntry(activityEvent) {
  const event = activityEvent && typeof activityEvent === "object" ? activityEvent : {};
  const source = toNonEmptyString(event.source).toLowerCase();
  const status = toNonEmptyString(event.status).toLowerCase();
  const provider = toNonEmptyString(event.provider).toUpperCase() || "BILLING";

  const sourceLabel = (() => {
    if (source === "idempotency") {
      return "Request";
    }
    if (source === "checkout_session") {
      return "Checkout";
    }
    if (source === "subscription") {
      return "Subscription";
    }
    if (source === "invoice") {
      return "Invoice";
    }
    if (source === "payment") {
      return "Payment";
    }
    if (source === "payment_method_sync") {
      return "Payment Methods";
    }
    if (source === "outbox_job") {
      return "Automation";
    }
    if (source === "remediation") {
      return "Recovery";
    }
    if (source === "reconciliation_run") {
      return "Reconciliation";
    }
    if (source === "webhook") {
      return "Webhook";
    }
    return "Billing";
  })();

  const statusLabel = toTitleCase(status || "updated") || "Updated";
  const title = `${sourceLabel} ${statusLabel}`;

  let description = event.message ? String(event.message) : `${provider} ${sourceLabel.toLowerCase()} ${statusLabel.toLowerCase()}.`;
  if (source === "payment_method_sync" && status === "succeeded") {
    description = "Payment methods were synchronized with the billing provider.";
  }
  if (source === "idempotency" && status === "failed" && event.message) {
    description = String(event.message);
  }
  if (source === "outbox_job" && status === "succeeded") {
    description = "Automated billing follow-up completed.";
  }
  if (source === "remediation" && status === "succeeded") {
    description = "Billing remediation completed successfully.";
  }

  return {
    id: String(event.id || ""),
    occurredAt: String(event.occurredAt || ""),
    kind: source || "billing",
    status: status || "unknown",
    title,
    description,
    provider: toNonEmptyString(event.provider) || null,
    operationKey: toNonEmptyString(event.operationKey) || null,
    providerEventId: toNonEmptyString(event.providerEventId) || null,
    sourceId: Number(event.sourceId || 0)
  };
}

function normalizeLimitBehavior(value, fallback = "allow") {
  const normalized = toNonEmptyString(value).toLowerCase();
  if (normalized === "allow" || normalized === "deny") {
    return normalized;
  }
  return fallback;
}

function buildLimitExceededError({
  limitationCode,
  billableEntityId,
  requestedAmount = null,
  limit = null,
  used = null,
  remaining = null,
  interval = null,
  enforcement = null,
  windowEndAt = null,
  reason = "limit_exceeded"
}) {
  const normalizedWindowEndAt = windowEndAt instanceof Date && Number.isFinite(windowEndAt.getTime()) ? windowEndAt : null;
  const retryAfterSeconds = normalizedWindowEndAt
    ? Math.max(0, Math.ceil((normalizedWindowEndAt.getTime() - Date.now()) / 1000))
    : null;

  throw new AppError(429, "Billing limit exceeded.", {
    code: BILLING_LIMIT_EXCEEDED_ERROR_CODE,
    details: {
      code: BILLING_LIMIT_EXCEEDED_ERROR_CODE,
      limitationCode: toNonEmptyString(limitationCode),
      billableEntityId: toPositiveInteger(billableEntityId),
      reason: toNonEmptyString(reason) || "limit_exceeded",
      requestedAmount: requestedAmount == null ? null : Number(requestedAmount),
      limit: limit == null ? null : Number(limit),
      used: used == null ? null : Number(used),
      remaining: remaining == null ? null : Number(remaining),
      interval: toNonEmptyString(interval) || null,
      enforcement: toNonEmptyString(enforcement) || null,
      windowEndAt: normalizedWindowEndAt ? normalizedWindowEndAt.toISOString() : null,
      retryAfterSeconds
    }
  });
}

function createService(options = {}) {
  const {
    billingRepository,
    billingPolicyService,
    billingPricingService,
    billingIdempotencyService,
    billingCheckoutOrchestrator,
    billingProviderAdapter,
    consoleSettingsRepository = null,
    appPublicUrl,
    providerReplayWindowSeconds = BILLING_RUNTIME_DEFAULTS.PROVIDER_IDEMPOTENCY_REPLAY_WINDOW_SECONDS,
    observabilityService = null
  } = options;
  if (!billingRepository) {
    throw new Error("billingRepository is required.");
  }
  if (!billingPolicyService) {
    throw new Error("billingPolicyService is required.");
  }
  if (!billingPricingService) {
    throw new Error("billingPricingService is required.");
  }
  if (!billingIdempotencyService) {
    throw new Error("billingIdempotencyService is required.");
  }
  if (!billingCheckoutOrchestrator) {
    throw new Error("billingCheckoutOrchestrator is required.");
  }
  const providerAdapter = billingProviderAdapter;
  if (!providerAdapter || typeof providerAdapter.createBillingPortalSession !== "function") {
    throw new Error("billingProviderAdapter.createBillingPortalSession is required.");
  }
  const activeProvider =
    String(providerAdapter?.provider || BILLING_DEFAULT_PROVIDER)
      .trim()
      .toLowerCase() || BILLING_DEFAULT_PROVIDER;

  const replayWindowSeconds = Math.max(
    60,
    Number(providerReplayWindowSeconds) || BILLING_RUNTIME_DEFAULTS.PROVIDER_IDEMPOTENCY_REPLAY_WINDOW_SECONDS
  );
  const normalizedAppPublicUrl = String(appPublicUrl || "").trim();
  if (!normalizedAppPublicUrl) {
    throw new Error("appPublicUrl is required.");
  }
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

  async function resolvePaidPlanChangePolicy() {
    if (!consoleSettingsRepository || typeof consoleSettingsRepository.ensure !== "function") {
      return PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW;
    }

    const settings = await consoleSettingsRepository.ensure();
    const features = settings?.features && typeof settings.features === "object" ? settings.features : {};
    const billingFeatures = features?.billing && typeof features.billing === "object" ? features.billing : {};
    return normalizePaidPlanChangePolicy(billingFeatures.paidPlanChangePaymentMethodPolicy);
  }

  function mapPlanForSelection(plan) {
    const entry = plan && typeof plan === "object" ? plan : null;
    if (!entry) {
      return null;
    }

    return {
      id: Number(entry.id),
      code: String(entry.code || ""),
      name: String(entry.name || ""),
      description: entry.description == null ? null : String(entry.description),
      isActive: entry.isActive !== false,
      corePrice: entry.corePrice && typeof entry.corePrice === "object" ? entry.corePrice : null
    };
  }

  async function updateIdempotencyWithLeaseFence({ idempotencyRowId, leaseVersion = null, patch = {} }) {
    const normalizedLeaseVersion = toLeaseVersionOrNull(leaseVersion);
    const options = normalizedLeaseVersion != null ? { expectedLeaseVersion: normalizedLeaseVersion } : {};
    const updated = await billingRepository.updateIdempotencyById(idempotencyRowId, patch, options);
    if (normalizedLeaseVersion != null && !updated) {
      throw new AppError(409, "Billing idempotency lease has changed.", {
        code: "BILLING_LEASE_FENCED",
        details: {
          code: "BILLING_LEASE_FENCED"
        }
      });
    }

    return updated;
  }

  async function ensureBillableEntity({ workspaceId, ownerUserId }) {
    if (typeof billingRepository.ensureBillableEntityByScope === "function") {
      return billingRepository.ensureBillableEntityByScope({
        entityType: "workspace",
        workspaceId,
        ownerUserId
      });
    }

    return billingRepository.ensureBillableEntity({
      workspaceId,
      ownerUserId
    });
  }

  async function listPlans(requestContext = {}) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForReadRequest(requestContext);
    void billableEntity;

    const plans = await billingRepository.listPlans();
    const entries = [];

    for (const plan of plans) {
      const entitlements = await billingRepository.listPlanEntitlementsForPlan(plan.id);

      const validatedEntitlements = [];
      for (const entitlement of entitlements) {
        assertEntitlementValueOrThrow({
          schemaVersion: entitlement.schemaVersion,
          value: entitlement.valueJson,
          errorStatus: 500
        });
        validatedEntitlements.push(entitlement);
      }

      entries.push({
        ...plan,
        entitlements: validatedEntitlements
      });
    }

    return {
      plans: entries
    };
  }

  async function listActiveWorkspacePlans({ trx = null } = {}) {
    const plans = await billingRepository.listPlans(trx ? { trx } : {});
    return plans.filter((plan) => plan && plan.isActive !== false && String(plan.appliesTo || "workspace") === "workspace");
  }

  async function resolveCurrentPlanContext({ billableEntityId, now = new Date(), trx = null, forUpdate = false } = {}) {
    const readOptions = trx
      ? {
          trx,
          forUpdate
        }
      : {
          forUpdate
        };

    const currentSubscription = await billingRepository.findCurrentSubscriptionForEntity(billableEntityId, readOptions);
    if (currentSubscription) {
      const plan = await billingRepository.findPlanById(currentSubscription.planId, trx ? { trx } : {});
      return {
        source: "subscription",
        plan,
        subscription: currentSubscription,
        assignment: null,
        periodEndAt: resolveSubscriptionPeriodEnd(currentSubscription, now)
      };
    }

    if (typeof billingRepository.findCurrentPlanAssignmentForEntity !== "function") {
      return {
        source: "none",
        plan: null,
        subscription: null,
        assignment: null,
        periodEndAt: null
      };
    }

    const currentAssignment = await billingRepository.findCurrentPlanAssignmentForEntity(billableEntityId, readOptions);
    if (!currentAssignment) {
      return {
        source: "none",
        plan: null,
        subscription: null,
        assignment: null,
        periodEndAt: null
      };
    }

    const plan = await billingRepository.findPlanById(currentAssignment.planId, trx ? { trx } : {});
    return {
      source: "assignment",
      plan,
      subscription: null,
      assignment: currentAssignment,
      periodEndAt: toDateOrNull(currentAssignment.periodEndAt)
    };
  }

  async function hasDefaultPaymentMethodForEntity(billableEntityId) {
    const methods = await billingRepository.listPaymentMethodsForEntity({
      billableEntityId,
      provider: activeProvider,
      includeInactive: false,
      limit: 25
    });
    return methods.some((entry) => entry && entry.isDefault === true);
  }

  async function updateCurrentSubscriptionPlan({
    currentSubscription,
    targetPlan,
    prorationBehavior = "create_prorations",
    now = new Date(),
    trx = null
  }) {
    if (!currentSubscription) {
      throw new AppError(409, "No active subscription found for plan update.");
    }

    const targetPriceId = String(targetPlan?.corePrice?.providerPriceId || "").trim();
    if (!targetPriceId) {
      throw new AppError(409, "Target plan does not expose a valid Stripe recurring price.");
    }
    if (typeof providerAdapter.updateSubscriptionPlan !== "function") {
      throw new AppError(501, "Provider subscription plan updates are not available.");
    }

    const providerSubscription = await providerAdapter.updateSubscriptionPlan({
      subscriptionId: currentSubscription.providerSubscriptionId,
      providerPriceId: targetPriceId,
      prorationBehavior,
      billingCycleAnchor: "unchanged"
    });

    const providerCurrentPeriodEnd = parseUnixEpochSeconds(providerSubscription?.current_period_end);
    const providerTrialEnd = parseUnixEpochSeconds(providerSubscription?.trial_end);
    const providerCanceledAt = parseUnixEpochSeconds(providerSubscription?.canceled_at);
    const providerEndedAt = parseUnixEpochSeconds(providerSubscription?.ended_at);
    const providerCreatedAt = parseUnixEpochSeconds(providerSubscription?.created);
    const normalizedStatus = normalizeProviderSubscriptionStatus(providerSubscription?.status);

    const nextSubscription = await billingRepository.upsertSubscription(
      {
        billableEntityId: currentSubscription.billableEntityId,
        planId: targetPlan.id,
        billingCustomerId: currentSubscription.billingCustomerId,
        provider: currentSubscription.provider,
        providerSubscriptionId: currentSubscription.providerSubscriptionId,
        status: normalizedStatus,
        providerSubscriptionCreatedAt: providerCreatedAt || currentSubscription.providerSubscriptionCreatedAt,
        currentPeriodEnd: providerCurrentPeriodEnd || resolveSubscriptionPeriodEnd(currentSubscription, now),
        trialEnd: providerTrialEnd,
        canceledAt: providerCanceledAt,
        cancelAtPeriodEnd: Boolean(providerSubscription?.cancel_at_period_end),
        endedAt: providerEndedAt,
        isCurrent: true,
        lastProviderEventCreatedAt: now,
        lastProviderEventId: null,
        metadataJson:
          providerSubscription?.metadata && typeof providerSubscription.metadata === "object"
            ? providerSubscription.metadata
            : currentSubscription.metadataJson
      },
      trx ? { trx } : {}
    );

    return nextSubscription;
  }

  async function applyInternalPlanAssignment({
    billableEntityId,
    targetPlan,
    now = new Date(),
    source = "internal",
    periodEndAt = null,
    metadataJson = null,
    trx = null
  }) {
    if (typeof billingRepository.insertPlanAssignment !== "function") {
      throw new AppError(500, "Internal plan assignment storage is unavailable.");
    }

    const resolvedPeriodEndAt = toDateOrNull(periodEndAt) || addUtcDays(now, PLAN_ASSIGNMENT_DEFAULT_PERIOD_DAYS);
    return billingRepository.insertPlanAssignment(
      {
        billableEntityId,
        planId: targetPlan.id,
        source,
        periodStartAt: now,
        periodEndAt: resolvedPeriodEndAt,
        isCurrent: true,
        metadataJson
      },
      trx ? { trx } : {}
    );
  }

  async function applyPendingPlanChangeSchedule({
    schedule,
    now = new Date(),
    trx = null
  }) {
    if (!schedule || schedule.status !== "pending") {
      return null;
    }

    const effectiveAtDate = toDateOrNull(schedule.effectiveAt);
    if (!effectiveAtDate || effectiveAtDate.getTime() > now.getTime()) {
      return null;
    }

    const targetPlan = await billingRepository.findPlanById(schedule.targetPlanId, trx ? { trx } : {});
    if (!targetPlan || targetPlan.isActive === false) {
      await billingRepository.updatePlanChangeScheduleById(
        schedule.id,
        {
          status: "canceled",
          metadataJson: {
            reason: "target_plan_unavailable"
          }
        },
        trx ? { trx } : {}
      );
      return null;
    }

    const currentContext = await resolveCurrentPlanContext({
      billableEntityId: schedule.billableEntityId,
      now,
      trx,
      forUpdate: true
    });
    const fromPlanId = currentContext?.plan?.id || schedule.fromPlanId || null;

    if (currentContext?.source === "subscription" && currentContext.subscription) {
      await updateCurrentSubscriptionPlan({
        currentSubscription: currentContext.subscription,
        targetPlan,
        prorationBehavior: "none",
        now,
        trx
      });
    } else {
      await applyInternalPlanAssignment({
        billableEntityId: schedule.billableEntityId,
        targetPlan,
        now,
        source: "manual",
        periodEndAt: addUtcDays(now, PLAN_ASSIGNMENT_DEFAULT_PERIOD_DAYS),
        metadataJson: {
          scheduledChangeId: schedule.id
        },
        trx
      });
    }

    await billingRepository.updatePlanChangeScheduleById(
      schedule.id,
      {
        status: "applied",
        appliedAt: now
      },
      trx ? { trx } : {}
    );

    await billingRepository.insertPlanChangeHistory(
      {
        billableEntityId: schedule.billableEntityId,
        fromPlanId,
        toPlanId: targetPlan.id,
        changeKind: schedule.changeKind === "promo_fallback" ? "promo_fallback_applied" : "downgrade_applied",
        effectiveAt: now,
        scheduleId: schedule.id
      },
      trx ? { trx } : {}
    );

    return schedule.id;
  }

  async function applyDuePlanChangeForEntity({ billableEntityId, now = new Date() }) {
    if (typeof billingRepository.findPendingPlanChangeScheduleForEntity !== "function") {
      return false;
    }

    let applied = false;
    await billingRepository.transaction(async (trx) => {
      const pending = await billingRepository.findPendingPlanChangeScheduleForEntity(billableEntityId, {
        trx,
        forUpdate: true
      });
      const appliedScheduleId = await applyPendingPlanChangeSchedule({
        schedule: pending,
        now,
        trx
      });
      applied = Boolean(appliedScheduleId);
    });

    return applied;
  }

  async function buildPlanState({
    billableEntity,
    now = new Date(),
    includeHistoryLimit = 20
  }) {
    await applyDuePlanChangeForEntity({
      billableEntityId: billableEntity.id,
      now
    });

    const activePlans = await listActiveWorkspacePlans();
    const planMapById = new Map(activePlans.map((plan) => [Number(plan.id), plan]));
    const currentContext = await resolveCurrentPlanContext({
      billableEntityId: billableEntity.id,
      now
    });
    const currentPlan = currentContext.plan && currentContext.plan.isActive !== false ? currentContext.plan : null;
    const currentPlanId = Number(currentPlan?.id || 0);

    const pendingSchedule =
      typeof billingRepository.findPendingPlanChangeScheduleForEntity === "function"
        ? await billingRepository.findPendingPlanChangeScheduleForEntity(billableEntity.id)
        : null;

    const nextPlan = pendingSchedule ? planMapById.get(Number(pendingSchedule.targetPlanId)) || null : null;
    const history =
      typeof billingRepository.listPlanChangeHistoryForEntity === "function"
        ? await billingRepository.listPlanChangeHistoryForEntity({
            billableEntityId: billableEntity.id,
            limit: includeHistoryLimit
          })
        : [];

    const planSelections = activePlans
      .filter((plan) => Number(plan.id) !== currentPlanId)
      .map((plan) => mapPlanForSelection(plan))
      .filter(Boolean);

    const historyEntries = history.map((entry) => {
      const fromPlan = entry.fromPlanId ? planMapById.get(Number(entry.fromPlanId)) || null : null;
      const toPlan = planMapById.get(Number(entry.toPlanId)) || null;
      return {
        id: entry.id,
        effectiveAt: entry.effectiveAt,
        changeKind: entry.changeKind,
        fromPlan: fromPlan ? mapPlanForSelection(fromPlan) : null,
        toPlan: toPlan ? mapPlanForSelection(toPlan) : null
      };
    });

    const currentPlanPeriodEndDate = toDateOrNull(currentContext.periodEndAt);
    return {
      currentPlan: currentPlan
        ? {
            ...mapPlanForSelection(currentPlan),
            source: currentContext.source,
            expiresAt: currentPlanPeriodEndDate ? currentPlanPeriodEndDate.toISOString() : null
          }
        : null,
      nextPlanChange:
        pendingSchedule && nextPlan
          ? {
              id: pendingSchedule.id,
              changeKind: pendingSchedule.changeKind,
              effectiveAt: pendingSchedule.effectiveAt,
              targetPlan: mapPlanForSelection(nextPlan)
            }
          : null,
      availablePlans: planSelections,
      history: historyEntries,
      settings: {
        paidPlanChangePaymentMethodPolicy: await resolvePaidPlanChangePolicy()
      }
    };
  }

  async function getPlanState({ request, user, now = new Date() }) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForReadRequest({
      request,
      user
    });

    const state = await buildPlanState({
      billableEntity,
      now
    });

    return {
      billableEntity,
      ...state
    };
  }

  async function requestPlanChange({ request, user, payload = {}, clientIdempotencyKey = "", now = new Date() }) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForWriteRequest({
      request,
      user
    });

    const targetPlanCode = toNonEmptyString(payload.planCode).toLowerCase();
    if (!targetPlanCode) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            planCode: "planCode is required."
          }
        }
      });
    }

    const activePlans = await listActiveWorkspacePlans();
    const targetPlan = activePlans.find((entry) => String(entry.code || "").toLowerCase() === targetPlanCode) || null;
    if (!targetPlan) {
      throw new AppError(404, "Billing plan not found.");
    }

    await applyDuePlanChangeForEntity({
      billableEntityId: billableEntity.id,
      now
    });

    const currentContext = await resolveCurrentPlanContext({
      billableEntityId: billableEntity.id,
      now
    });
    const currentPlan = currentContext.plan || null;
    const direction = classifyPlanChangeDirection(currentPlan, targetPlan);
    const isTargetPaid = resolvePlanCoreAmountMinor(targetPlan) > 0;

    if (direction === "same") {
      return {
        mode: "unchanged",
        state: await buildPlanState({
          billableEntity,
          now
        })
      };
    }

    if (direction === "downgrade" && currentContext.source !== "none") {
      const effectiveAt = currentContext.periodEndAt || addUtcDays(now, PLAN_ASSIGNMENT_DEFAULT_PERIOD_DAYS);
      if (effectiveAt.getTime() <= now.getTime()) {
        if (currentContext.source === "subscription" && currentContext.subscription) {
          await updateCurrentSubscriptionPlan({
            currentSubscription: currentContext.subscription,
            targetPlan,
            prorationBehavior: "none",
            now
          });
        } else {
          await applyInternalPlanAssignment({
            billableEntityId: billableEntity.id,
            targetPlan,
            now,
            source: "manual"
          });
        }

        await billingRepository.insertPlanChangeHistory({
          billableEntityId: billableEntity.id,
          fromPlanId: currentPlan?.id || null,
          toPlanId: targetPlan.id,
          changeKind: "downgrade_immediate",
          effectiveAt: now,
          appliedByUserId: user?.id || null
        });

        return {
          mode: "applied",
          state: await buildPlanState({
            billableEntity,
            now
          })
        };
      }

      if (typeof billingRepository.replacePendingPlanChangeSchedule !== "function") {
        throw new AppError(500, "Billing plan change scheduling is unavailable.");
      }

      await billingRepository.replacePendingPlanChangeSchedule({
        billableEntityId: billableEntity.id,
        fromPlanId: currentPlan?.id || null,
        targetPlanId: targetPlan.id,
        changeKind: "downgrade",
        effectiveAt,
        requestedByUserId: user?.id || null
      });

      return {
        mode: "scheduled",
        state: await buildPlanState({
          billableEntity,
          now
        })
      };
    }

    if (typeof billingRepository.cancelPendingPlanChangeScheduleForEntity === "function") {
      await billingRepository.cancelPendingPlanChangeScheduleForEntity({
        billableEntityId: billableEntity.id,
        canceledByUserId: user?.id || null
      });
    }

    if (currentContext.source === "subscription" && currentContext.subscription) {
      const policy = await resolvePaidPlanChangePolicy();
      if (isTargetPaid && policy === PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW) {
        const hasDefaultPaymentMethod = await hasDefaultPaymentMethodForEntity(billableEntity.id);
        if (!hasDefaultPaymentMethod) {
          throw new AppError(409, "A default payment method is required before switching to a paid plan.", {
            code: "PAYMENT_METHOD_REQUIRED"
          });
        }
      }

      await updateCurrentSubscriptionPlan({
        currentSubscription: currentContext.subscription,
        targetPlan,
        prorationBehavior: "create_prorations",
        now
      });
      await billingRepository.insertPlanChangeHistory({
        billableEntityId: billableEntity.id,
        fromPlanId: currentPlan?.id || null,
        toPlanId: targetPlan.id,
        changeKind: direction === "upgrade" ? "upgrade_immediate" : "plan_change_immediate",
        effectiveAt: now,
        appliedByUserId: user?.id || null
      });

      return {
        mode: "applied",
        state: await buildPlanState({
          billableEntity,
          now
        })
      };
    }

    if (isTargetPaid) {
      const normalizedSuccessPath = toNonEmptyString(payload.successPath);
      const normalizedCancelPath = toNonEmptyString(payload.cancelPath);
      if (!normalizedSuccessPath || !normalizedCancelPath) {
        throw new AppError(400, "Validation failed.", {
          details: {
            fieldErrors: {
              successPath: "successPath is required when checkout is needed.",
              cancelPath: "cancelPath is required when checkout is needed."
            }
          }
        });
      }
      if (!toNonEmptyString(clientIdempotencyKey)) {
        throw new AppError(400, "Idempotency-Key header is required.", {
          code: "IDEMPOTENCY_KEY_REQUIRED"
        });
      }

      const checkoutResponse = await billingCheckoutOrchestrator.startCheckout({
        request,
        user,
        payload: {
          planCode: targetPlan.code,
          successPath: normalizedSuccessPath,
          cancelPath: normalizedCancelPath
        },
        clientIdempotencyKey,
        now
      });

      return {
        mode: "checkout_required",
        checkout: checkoutResponse,
        state: await buildPlanState({
          billableEntity,
          now
        })
      };
    }

    await applyInternalPlanAssignment({
      billableEntityId: billableEntity.id,
      targetPlan,
      now,
      source: "manual"
    });
    await billingRepository.insertPlanChangeHistory({
      billableEntityId: billableEntity.id,
      fromPlanId: currentPlan?.id || null,
      toPlanId: targetPlan.id,
      changeKind: "internal_immediate",
      effectiveAt: now,
      appliedByUserId: user?.id || null
    });

    return {
      mode: "applied",
      state: await buildPlanState({
        billableEntity,
        now
      })
    };
  }

  async function cancelPendingPlanChange({ request, user, now = new Date() }) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForWriteRequest({
      request,
      user
    });

    const canceled =
      typeof billingRepository.cancelPendingPlanChangeScheduleForEntity === "function"
        ? await billingRepository.cancelPendingPlanChangeScheduleForEntity({
            billableEntityId: billableEntity.id,
            canceledByUserId: user?.id || null
          })
        : null;

    return {
      canceled: Boolean(canceled),
      state: await buildPlanState({
        billableEntity,
        now
      })
    };
  }

  async function processDuePlanChanges({ now = new Date(), limit = 50 } = {}) {
    if (typeof billingRepository.listDuePendingPlanChangeSchedules !== "function") {
      return {
        scannedCount: 0,
        appliedCount: 0
      };
    }

    const dueSchedules = await billingRepository.listDuePendingPlanChangeSchedules({
      effectiveAtOrBefore: now,
      limit
    });

    let appliedCount = 0;
    for (const schedule of dueSchedules) {
      try {
        await billingRepository.transaction(async (trx) => {
          const lockedSchedule = await billingRepository.findPlanChangeScheduleById(schedule.id, {
            trx,
            forUpdate: true
          });
          const appliedScheduleId = await applyPendingPlanChangeSchedule({
            schedule: lockedSchedule,
            now,
            trx
          });
          if (appliedScheduleId) {
            appliedCount += 1;
          }
        });
      } catch {
        // Best effort processing; failed schedules remain pending for the next worker tick.
      }
    }

    return {
      scannedCount: dueSchedules.length,
      appliedCount
    };
  }

  async function seedSignupPromoPlan({ workspaceId, ownerUserId, now = new Date() }) {
    if (typeof billingRepository.insertPlanAssignment !== "function") {
      return null;
    }

    const billableEntity = await ensureBillableEntity({
      workspaceId,
      ownerUserId
    });
    const currentContext = await resolveCurrentPlanContext({
      billableEntityId: billableEntity.id,
      now
    });
    if (currentContext.source !== "none") {
      return null;
    }

    const activePlans = await listActiveWorkspacePlans();
    if (activePlans.length < 1) {
      return null;
    }

    const sortedByAmountAsc = [...activePlans].sort((left, right) => {
      const delta = resolvePlanCoreAmountMinor(left) - resolvePlanCoreAmountMinor(right);
      if (delta !== 0) {
        return delta;
      }
      return Number(left.id) - Number(right.id);
    });
    const promoPlan = [...activePlans].sort((left, right) => {
      const delta = resolvePlanCoreAmountMinor(right) - resolvePlanCoreAmountMinor(left);
      if (delta !== 0) {
        return delta;
      }
      return Number(left.id) - Number(right.id);
    })[0];
    const fallbackPlan =
      sortedByAmountAsc.find((plan) => resolvePlanCoreAmountMinor(plan) === 0) || sortedByAmountAsc[0] || promoPlan;
    if (!promoPlan || !fallbackPlan) {
      return null;
    }

    const promoEndsAt = addUtcDays(now, SIGNUP_PROMO_PERIOD_DAYS);
    await billingRepository.transaction(async (trx) => {
      await applyInternalPlanAssignment({
        billableEntityId: billableEntity.id,
        targetPlan: promoPlan,
        now,
        source: "promo",
        periodEndAt: promoEndsAt,
        metadataJson: {
          reason: "signup_promo"
        },
        trx
      });

      await billingRepository.insertPlanChangeHistory(
        {
          billableEntityId: billableEntity.id,
          fromPlanId: null,
          toPlanId: promoPlan.id,
          changeKind: "promo_granted",
          effectiveAt: now,
          metadataJson: {
            promoEndsAt: promoEndsAt.toISOString()
          }
        },
        { trx }
      );

      if (Number(fallbackPlan.id) !== Number(promoPlan.id) && typeof billingRepository.replacePendingPlanChangeSchedule === "function") {
        await billingRepository.replacePendingPlanChangeSchedule(
          {
            billableEntityId: billableEntity.id,
            fromPlanId: promoPlan.id,
            targetPlanId: fallbackPlan.id,
            changeKind: "promo_fallback",
            effectiveAt: promoEndsAt,
            requestedByUserId: null
          },
          { trx }
        );
      }
    });

    return {
      billableEntityId: billableEntity.id,
      promoPlanCode: promoPlan.code,
      fallbackPlanCode: fallbackPlan.code,
      promoEndsAt: promoEndsAt.toISOString()
    };
  }

  async function resolveCurrentSubscriptionEntitlements({ billableEntityId }) {
    const currentContext = await resolveCurrentPlanContext({
      billableEntityId
    });
    const currentPlan = currentContext.plan || null;
    if (!currentPlan) {
      return {
        currentSubscription: currentContext.subscription || null,
        currentPlan: null,
        entitlements: []
      };
    }

    const entitlements = await billingRepository.listPlanEntitlementsForPlan(currentPlan.id);
    const validatedEntitlements = [];
    for (const entitlement of entitlements) {
      assertEntitlementValueOrThrow({
        schemaVersion: entitlement.schemaVersion,
        value: entitlement.valueJson,
        errorStatus: 500
      });
      validatedEntitlements.push(entitlement);
    }

    return {
      currentSubscription: currentContext.subscription || null,
      currentPlan,
      entitlements: validatedEntitlements
    };
  }

  async function enforceLimitAndRecordUsage({
    request,
    user,
    capability = "",
    limitationCode = "",
    amount = null,
    usageEventKey = "",
    metadataJson = null,
    now = new Date(),
    access = "write",
    missingSubscriptionBehavior = "allow",
    missingLimitationBehavior = "allow",
    action
  } = {}) {
    if (typeof action !== "function") {
      throw new Error("enforceLimitAndRecordUsage requires an action function.");
    }

    const normalizedAccess = toNonEmptyString(access).toLowerCase() === "read" ? "read" : "write";
    const resolution =
      normalizedAccess === "read"
        ? await billingPolicyService.resolveBillableEntityForReadRequest({ request, user })
        : await billingPolicyService.resolveBillableEntityForWriteRequest({ request, user });
    const billableEntity = resolution?.billableEntity;
    const billableEntityId = toPositiveInteger(billableEntity?.id);
    if (!billableEntityId) {
      throw new AppError(409, "Billable entity resolution failed.");
    }

    const capabilityConfig = resolveCapabilityLimitConfig(capability);
    const resolvedLimitationCode = toNonEmptyString(limitationCode || capabilityConfig?.limitationCode);
    const requestedAmount = amount == null ? capabilityConfig?.usageAmount ?? 1 : amount;
    const normalizedAmount = normalizeUsageAmount(requestedAmount);
    if (!normalizedAmount) {
      throw new AppError(400, "Usage amount must be a positive integer.");
    }

    if (!resolvedLimitationCode) {
      return action({
        billableEntity,
        limitationCode: null,
        capability: toNonEmptyString(capability),
        now
      });
    }

    const { currentSubscription, entitlements } = await resolveCurrentSubscriptionEntitlements({
      billableEntityId
    });

    const subscriptionBehavior = normalizeLimitBehavior(missingSubscriptionBehavior, "allow");
    if (!currentSubscription) {
      if (subscriptionBehavior === "deny") {
        buildLimitExceededError({
          limitationCode: resolvedLimitationCode,
          billableEntityId,
          requestedAmount: normalizedAmount,
          reason: "subscription_required"
        });
      }

      return action({
        billableEntity,
        limitationCode: resolvedLimitationCode,
        capability: toNonEmptyString(capability),
        now
      });
    }

    const limitation = entitlements.find((entry) => entry.code === resolvedLimitationCode) || null;
    const limitationBehavior = normalizeLimitBehavior(missingLimitationBehavior, "allow");
    if (!limitation) {
      if (limitationBehavior === "deny") {
        throw new AppError(409, "Billing limitation is not configured.", {
          code: BILLING_LIMIT_NOT_CONFIGURED_ERROR_CODE,
          details: {
            code: BILLING_LIMIT_NOT_CONFIGURED_ERROR_CODE,
            limitationCode: resolvedLimitationCode,
            billableEntityId
          }
        });
      }

      return action({
        billableEntity,
        limitationCode: resolvedLimitationCode,
        capability: toNonEmptyString(capability),
        now
      });
    }

    const limitationType = classifyEntitlementType(limitation.schemaVersion);
    if (limitationType === "boolean") {
      if (!limitation?.valueJson?.enabled) {
        buildLimitExceededError({
          limitationCode: resolvedLimitationCode,
          billableEntityId,
          requestedAmount: normalizedAmount,
          reason: "feature_disabled"
        });
      }

      return action({
        billableEntity,
        limitationCode: resolvedLimitationCode,
        capability: toNonEmptyString(capability),
        limitation,
        now
      });
    }

    if (limitationType !== "quota") {
      throw new AppError(409, "Billing limitation does not support usage accounting.", {
        code: BILLING_LIMIT_NOT_CONFIGURED_ERROR_CODE,
        details: {
          code: BILLING_LIMIT_NOT_CONFIGURED_ERROR_CODE,
          limitationCode: resolvedLimitationCode,
          billableEntityId
        }
      });
    }

    if (typeof billingRepository.incrementUsageCounter !== "function") {
      throw new AppError(500, "Billing usage counter storage is unavailable.");
    }

    const interval = toNonEmptyString(limitation?.valueJson?.interval).toLowerCase() || "month";
    const enforcement = toNonEmptyString(limitation?.valueJson?.enforcement).toLowerCase() || "hard";
    const window = resolveUsageWindow(interval, now);
    const usageCounter =
      typeof billingRepository.findUsageCounter === "function"
        ? await billingRepository.findUsageCounter({
            billableEntityId,
            entitlementCode: resolvedLimitationCode,
            windowStartAt: window.windowStartAt,
            windowEndAt: window.windowEndAt
          })
        : null;

    const limit = Math.max(0, Number(limitation?.valueJson?.limit) || 0);
    const used = Math.max(0, Number(usageCounter?.usageCount || 0));
    const projectedUsed = used + normalizedAmount;
    const remaining = Math.max(0, limit - used);

    if (enforcement === "hard" && projectedUsed > limit) {
      buildLimitExceededError({
        limitationCode: resolvedLimitationCode,
        billableEntityId,
        requestedAmount: normalizedAmount,
        limit,
        used,
        remaining,
        interval: window.interval,
        enforcement,
        windowEndAt: window.windowEndAt,
        reason: "quota_exceeded"
      });
    }

    const actionResult = await action({
      billableEntity,
      limitationCode: resolvedLimitationCode,
      capability: toNonEmptyString(capability),
      limitation,
      now
    });

    const normalizedUsageEventKey = toNonEmptyString(usageEventKey);
    if (normalizedUsageEventKey && typeof billingRepository.claimUsageEvent === "function") {
      const claim = await billingRepository.claimUsageEvent({
        billableEntityId,
        entitlementCode: resolvedLimitationCode,
        usageEventKey: normalizedUsageEventKey,
        windowStartAt: window.windowStartAt,
        windowEndAt: window.windowEndAt,
        amount: normalizedAmount,
        metadataJson
      });

      if (claim?.claimed === false) {
        return actionResult;
      }
    }

    await billingRepository.incrementUsageCounter({
      billableEntityId,
      entitlementCode: resolvedLimitationCode,
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      amount: normalizedAmount,
      metadataJson
    });

    return actionResult;
  }

  async function listPaymentMethods(requestContext = {}) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForReadRequest(requestContext);
    const paymentMethods =
      typeof billingRepository.listPaymentMethodsForEntity === "function"
        ? await billingRepository.listPaymentMethodsForEntity({
            billableEntityId: billableEntity.id,
            provider: activeProvider,
            includeInactive: false,
            limit: 50
          })
        : [];

    return {
      billableEntity,
      paymentMethods
    };
  }

  async function syncPaymentMethods({ request, user, now = new Date() }) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForWriteRequest({
      request,
      user
    });

    const customer = await billingRepository.findCustomerByEntityProvider({
      billableEntityId: billableEntity.id,
      provider: activeProvider
    });
    const providerCustomerId = toNonEmptyString(customer?.providerCustomerId);
    if (!providerCustomerId) {
      if (typeof billingRepository.insertPaymentMethodSyncEvent === "function") {
        await billingRepository.insertPaymentMethodSyncEvent({
          billableEntityId: billableEntity.id,
          billingCustomerId: customer?.id || null,
          provider: activeProvider,
          eventType: "manual_sync",
          status: "skipped",
          errorText: "Billing customer missing; payment-method sync skipped.",
          payloadJson: {
            reason: "billing_customer_missing"
          },
          processedAt: now
        });
      }

      return {
        billableEntity,
        paymentMethods: [],
        syncedAt: now.toISOString(),
        syncStatus: "skipped",
        fetchedCount: 0
      };
    }

    if (!providerAdapter || typeof providerAdapter.listCustomerPaymentMethods !== "function") {
      throw new AppError(500, "Billing payment-method sync is not available.");
    }

    try {
      const { paymentMethods: providerPaymentMethods, defaultPaymentMethodId, hasMore = false } =
        await providerAdapter.listCustomerPaymentMethods({
          customerId: providerCustomerId,
          type: "card",
          limit: 100
        });

      const normalizedMethods = (Array.isArray(providerPaymentMethods) ? providerPaymentMethods : [])
        .map((entry) => normalizePaymentMethod(entry, defaultPaymentMethodId))
        .filter(Boolean);

      if (typeof billingRepository.upsertPaymentMethod === "function") {
        for (const paymentMethod of normalizedMethods) {
          await billingRepository.upsertPaymentMethod({
            billableEntityId: billableEntity.id,
            billingCustomerId: customer.id,
            provider: activeProvider,
            providerPaymentMethodId: paymentMethod.providerPaymentMethodId,
            type: paymentMethod.type,
            brand: paymentMethod.brand,
            last4: paymentMethod.last4,
            expMonth: paymentMethod.expMonth,
            expYear: paymentMethod.expYear,
            isDefault: paymentMethod.isDefault,
            status: "active",
            lastProviderSyncedAt: now,
            metadataJson: paymentMethod.metadataJson
          });
        }
      }

      if (!hasMore && typeof billingRepository.deactivateMissingPaymentMethods === "function") {
        await billingRepository.deactivateMissingPaymentMethods({
          billableEntityId: billableEntity.id,
          provider: activeProvider,
          keepProviderPaymentMethodIds: normalizedMethods.map((entry) => entry.providerPaymentMethodId),
          now
        });
      }

      if (typeof billingRepository.insertPaymentMethodSyncEvent === "function") {
        await billingRepository.insertPaymentMethodSyncEvent({
          billableEntityId: billableEntity.id,
          billingCustomerId: customer.id,
          provider: activeProvider,
          eventType: "manual_sync",
          status: "succeeded",
          payloadJson: {
            fetchedCount: normalizedMethods.length,
            providerHasMore: Boolean(hasMore),
            defaultPaymentMethodId: toNonEmptyString(defaultPaymentMethodId) || null
          },
          processedAt: now
        });
      }

      const paymentMethods =
        typeof billingRepository.listPaymentMethodsForEntity === "function"
          ? await billingRepository.listPaymentMethodsForEntity({
              billableEntityId: billableEntity.id,
              provider: activeProvider,
              includeInactive: false,
              limit: 50
            })
          : [];

      return {
        billableEntity,
        paymentMethods,
        syncedAt: now.toISOString(),
        syncStatus: "succeeded",
        fetchedCount: normalizedMethods.length
      };
    } catch (error) {
      if (typeof billingRepository.insertPaymentMethodSyncEvent === "function") {
        await billingRepository.insertPaymentMethodSyncEvent({
          billableEntityId: billableEntity.id,
          billingCustomerId: customer.id,
          provider: activeProvider,
          eventType: "manual_sync",
          status: "failed",
          errorText: String(error?.message || "Billing payment-method sync failed."),
          payloadJson: {
            providerCustomerId
          },
          processedAt: now
        });
      }

      throw error;
    }
  }

  async function getLimitations({ request, user, now = new Date() }) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForReadRequest({
      request,
      user
    });

    const { currentSubscription, entitlements } = await resolveCurrentSubscriptionEntitlements({
      billableEntityId: billableEntity.id
    });

    const limitations = [];
    for (const entitlement of entitlements) {
      const type = classifyEntitlementType(entitlement.schemaVersion);
      const limitation = {
        code: entitlement.code,
        schemaVersion: entitlement.schemaVersion,
        type,
        valueJson: entitlement.valueJson
      };

      if (type === "boolean") {
        limitation.enabled = Boolean(entitlement?.valueJson?.enabled);
      } else if (type === "string_list") {
        const values = Array.isArray(entitlement?.valueJson?.values) ? entitlement.valueJson.values : [];
        limitation.values = values.map((value) => String(value));
      } else if (type === "quota") {
        const limit = Math.max(0, Number(entitlement?.valueJson?.limit) || 0);
        const interval = toNonEmptyString(entitlement?.valueJson?.interval).toLowerCase() || "month";
        const enforcement = toNonEmptyString(entitlement?.valueJson?.enforcement).toLowerCase() || "hard";
        const window = resolveUsageWindow(interval, now);
        const usageCounter =
          typeof billingRepository.findUsageCounter === "function"
            ? await billingRepository.findUsageCounter({
                billableEntityId: billableEntity.id,
                entitlementCode: entitlement.code,
                windowStartAt: window.windowStartAt,
                windowEndAt: window.windowEndAt
              })
            : null;
        const used = Math.max(0, Number(usageCounter?.usageCount || 0));
        const remaining = Math.max(0, limit - used);

        limitation.quota = {
          interval: window.interval,
          enforcement,
          limit,
          used,
          remaining,
          reached: used >= limit,
          exceeded: used > limit,
          windowStartAt: window.windowStartAt.toISOString(),
          windowEndAt: window.windowEndAt.toISOString()
        };
      }

      limitations.push(limitation);
    }

    return {
      billableEntity,
      subscription: currentSubscription,
      generatedAt: now.toISOString(),
      limitations
    };
  }

  async function listTimeline({ request, user, query = {} }) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForReadRequest({
      request,
      user
    });

    const pagination = normalizePagination(
      {
        page: query?.page,
        pageSize: query?.pageSize
      },
      {
        defaultPage: 1,
        defaultPageSize: 20,
        maxPageSize: 100
      }
    );
    const startIndex = (pagination.page - 1) * pagination.pageSize;
    const fetchLimit = Math.max(1, startIndex + pagination.pageSize + 1);

    const sourceFilter = toNonEmptyString(query?.source).toLowerCase();
    const operationKeyFilter = toNonEmptyString(query?.operationKey);
    const providerEventIdFilter = toNonEmptyString(query?.providerEventId);

    const events =
      typeof billingRepository.listBillingActivityEvents === "function"
        ? await billingRepository.listBillingActivityEvents({
            billableEntityId: billableEntity.id,
            operationKey: operationKeyFilter || null,
            providerEventId: providerEventIdFilter || null,
            source: sourceFilter || null,
            includeGlobal: false,
            limit: fetchLimit
          })
        : [];

    const hasMore = events.length > startIndex + pagination.pageSize;
    const pagedEntries = events.slice(startIndex, startIndex + pagination.pageSize).map(buildWorkspaceTimelineEntry);

    return {
      billableEntity,
      entries: pagedEntries,
      page: pagination.page,
      pageSize: pagination.pageSize,
      hasMore
    };
  }

  async function recordUsage({ billableEntityId, entitlementCode, amount = 1, now = new Date(), metadataJson = null }) {
    const normalizedBillableEntityId = toPositiveInteger(billableEntityId);
    const normalizedEntitlementCode = toNonEmptyString(entitlementCode);
    const normalizedAmount = normalizeUsageAmount(amount);
    if (!normalizedBillableEntityId) {
      throw new AppError(400, "Billable entity id is required.");
    }
    if (!normalizedEntitlementCode) {
      throw new AppError(400, "Entitlement code is required.");
    }
    if (!normalizedAmount) {
      throw new AppError(400, "Usage amount must be a positive integer.");
    }

    const { currentSubscription, entitlements } = await resolveCurrentSubscriptionEntitlements({
      billableEntityId: normalizedBillableEntityId
    });
    if (!currentSubscription) {
      throw new AppError(409, "No active subscription for usage accounting.");
    }

    const entitlement = entitlements.find((entry) => entry.code === normalizedEntitlementCode) || null;
    if (!entitlement) {
      throw new AppError(404, "Entitlement not found.");
    }
    if (classifyEntitlementType(entitlement.schemaVersion) !== "quota") {
      throw new AppError(409, "Entitlement does not support usage accounting.");
    }

    if (typeof billingRepository.incrementUsageCounter !== "function") {
      throw new AppError(500, "Billing usage counter storage is unavailable.");
    }

    const window = resolveUsageWindow(entitlement?.valueJson?.interval, now);
    const updatedCounter = await billingRepository.incrementUsageCounter({
      billableEntityId: normalizedBillableEntityId,
      entitlementCode: normalizedEntitlementCode,
      windowStartAt: window.windowStartAt,
      windowEndAt: window.windowEndAt,
      amount: normalizedAmount,
      metadataJson
    });

    const limit = Math.max(0, Number(entitlement?.valueJson?.limit) || 0);
    const used = Math.max(0, Number(updatedCounter?.usageCount || 0));

    return {
      billableEntityId: normalizedBillableEntityId,
      entitlementCode: normalizedEntitlementCode,
      interval: window.interval,
      enforcement: toNonEmptyString(entitlement?.valueJson?.enforcement).toLowerCase() || "hard",
      limit,
      used,
      remaining: Math.max(0, limit - used),
      reached: used >= limit,
      exceeded: used > limit,
      windowStartAt: window.windowStartAt.toISOString(),
      windowEndAt: window.windowEndAt.toISOString()
    };
  }

  async function recoverPendingPortalSession({ idempotencyRow, now }) {
    const leased = await billingIdempotencyService.recoverPendingRequest({
      idempotencyRowId: idempotencyRow.id,
      leaseOwner: `portal-recovery:${process.pid}`,
      now
    });

    if (leased.type !== "recovery_leased") {
      if (leased.type === "not_pending") {
        if (leased.row?.status === "succeeded") {
          return leased.row.responseJson;
        }

        if (leased.row?.failureCode) {
          throw mapFailureCodeToError(
            leased.row.failureCode,
            leased.row.failureReason || "Billing portal request cannot be recovered."
          );
        }
      }

      throw mapFailureCodeToError(
        BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
        "Billing portal request is in progress."
      );
    }

    const recoveryRow = leased.row;
    const expectedLeaseVersion = leased.expectedLeaseVersion;

    const replayDeadlineAt = recoveryRow.providerIdempotencyReplayDeadlineAt
      ? new Date(recoveryRow.providerIdempotencyReplayDeadlineAt)
      : null;
    if (!replayDeadlineAt || !Number.isFinite(replayDeadlineAt.getTime())) {
      await billingIdempotencyService.markFailed({
        idempotencyRowId: recoveryRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        failureReason: "Billing portal replay deadline is missing."
      });

      throw mapFailureCodeToError(
        BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        "Billing portal recovery request state is invalid."
      );
    }

    const replayWindowElapsed =
      now.getTime() >= replayDeadlineAt.getTime();

    if (replayWindowElapsed) {
      await billingIdempotencyService.markExpired({
        idempotencyRowId: recoveryRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_WINDOW_ELAPSED,
        failureReason: "Billing portal recovery replay window elapsed."
      });

      throw mapFailureCodeToError(
        BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_WINDOW_ELAPSED,
        "Billing portal recovery window elapsed."
      );
    }

    if (!recoveryRow.providerRequestParamsJson || typeof recoveryRow.providerRequestParamsJson !== "object") {
      await billingIdempotencyService.markFailed({
        idempotencyRowId: recoveryRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        failureReason: "Frozen billing portal provider params are missing."
      });

      throw mapFailureCodeToError(
        BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        "Billing portal recovery request state is invalid."
      );
    }

    if (!String(recoveryRow.providerRequestHash || "").trim()) {
      await billingIdempotencyService.markFailed({
        idempotencyRowId: recoveryRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        failureReason: "Frozen billing portal provider request hash is missing."
      });

      throw mapFailureCodeToError(
        BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        "Billing portal recovery request state is invalid."
      );
    }

    const replayParamsHash = toSha256Hex(toCanonicalJson(recoveryRow.providerRequestParamsJson));
    try {
      await billingIdempotencyService.assertProviderRequestHashStable({
        idempotencyRowId: recoveryRow.id,
        candidateProviderRequestHash: replayParamsHash
      });
    } catch (error) {
      await billingIdempotencyService.markFailed({
        idempotencyRowId: recoveryRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        failureReason: String(error?.message || "Billing portal replay hash mismatch.")
      });

      throw mapFailureCodeToError(
        BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        "Billing portal recovery request state is invalid."
      );
    }

    let portalSession;
    try {
      portalSession = await providerAdapter.createBillingPortalSession({
        params: recoveryRow.providerRequestParamsJson,
        idempotencyKey: recoveryRow.providerIdempotencyKey
      });
    } catch (error) {
      const providerOutcome = resolveAndRecordProviderOutcome(error, {
        operation: "portal_recover_replay",
        correlation: {
          operationKey: recoveryRow.operationKey,
          billableEntityId: recoveryRow.billableEntityId
        }
      });
      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.MARK_FAILED) {
        await billingIdempotencyService.markFailed({
          idempotencyRowId: recoveryRow.id,
          leaseVersion: expectedLeaseVersion,
          failureCode: providerOutcome.failureCode,
          failureReason: String(error?.message || "Provider billing portal session recovery replay failed.")
        });

        throw mapFailureCodeToError(
          providerOutcome.failureCode,
          "Provider rejected billing portal recovery replay."
        );
      }

      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.IN_PROGRESS) {
        throw mapFailureCodeToError(
          providerOutcome.failureCode,
          "Billing portal recovery is in progress."
        );
      }

      throw error;
    }

    const responseJson = {
      provider: activeProvider,
      portalSession: {
        id: String(portalSession?.id || ""),
        url: String(portalSession?.url || "")
      }
    };

    await billingIdempotencyService.markSucceeded({
      idempotencyRowId: recoveryRow.id,
      leaseVersion: expectedLeaseVersion,
      responseJson,
      providerSessionId: String(portalSession?.id || "")
    });

    return responseJson;
  }

  async function getSnapshot(requestContext = {}) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForReadRequest(requestContext);

    const currentSubscription = await billingRepository.findCurrentSubscriptionForEntity(billableEntity.id);
    if (!currentSubscription) {
      return {
        billableEntity,
        subscription: null,
        customer: await billingRepository.findCustomerByEntityProvider({
          billableEntityId: billableEntity.id,
          provider: activeProvider
        }),
        items: [],
        invoices: [],
        payments: []
      };
    }

    const customer = await billingRepository.findCustomerById(currentSubscription.billingCustomerId);
    const items = await billingRepository.listSubscriptionItemsForSubscription({
      subscriptionId: currentSubscription.id,
      provider: activeProvider
    });
    const invoices = await billingRepository.listInvoicesForSubscription({
      subscriptionId: currentSubscription.id,
      provider: activeProvider,
      limit: 25
    });
    const payments = await billingRepository.listPaymentsForInvoiceIds({
      provider: activeProvider,
      invoiceIds: invoices.map((invoice) => invoice.id)
    });

    return {
      billableEntity,
      subscription: currentSubscription,
      customer,
      items,
      invoices,
      payments
    };
  }

  async function createPortalSession({ request, user, payload, clientIdempotencyKey, now = new Date() }) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForWriteRequest({
      request,
      user
    });

    const normalizedPayload = normalizePortalPath(payload || {});
    const normalizedRequest = normalizePortalRequest({
      billableEntityId: billableEntity.id,
      payload: normalizedPayload
    });

    const fingerprintHash = toSha256Hex(toCanonicalJson(normalizedRequest));

    const claim = await billingIdempotencyService.claimOrReplay({
      action: BILLING_ACTIONS.PORTAL,
      billableEntityId: billableEntity.id,
      clientIdempotencyKey,
      requestFingerprintHash: fingerprintHash,
      normalizedRequestJson: normalizedRequest,
      provider: activeProvider,
      now
    });

    if (claim.type === "replay_succeeded") {
      return claim.row.responseJson;
    }

    if (claim.type === "replay_terminal") {
      throw mapFailureCodeToError(claim.row.failureCode, claim.row.failureReason || "Billing portal request previously failed.");
    }

    if (claim.type === "recover_pending") {
      return recoverPendingPortalSession({
        idempotencyRow: claim.row,
        now
      });
    }

    if (claim.type === "in_progress_same_key" || claim.type === "checkout_in_progress_other_key") {
      throw mapFailureCodeToError(BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS, "Billing portal request is in progress.");
    }

    const idempotencyRow = claim.row;
    const claimLeaseVersion = toLeaseVersionOrNull(idempotencyRow?.leaseVersion);

    const currentSubscription = await billingRepository.findCurrentSubscriptionForEntity(billableEntity.id);
    if (!currentSubscription) {
      try {
        await billingIdempotencyService.markFailed({
          idempotencyRowId: idempotencyRow.id,
          leaseVersion: claimLeaseVersion,
          failureCode: BILLING_FAILURE_CODES.PORTAL_SUBSCRIPTION_REQUIRED,
          failureReason: "Billing portal requires an existing subscription."
        });
      } catch (error) {
        if (isLeaseFencedError(error)) {
          throw mapFailureCodeToError(
            BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
            "Billing portal request is in progress."
          );
        }
        throw error;
      }

      throw mapFailureCodeToError(BILLING_FAILURE_CODES.PORTAL_SUBSCRIPTION_REQUIRED, "No active subscription for portal.");
    }

    const customer = await billingRepository.findCustomerByEntityProvider({
      billableEntityId: billableEntity.id,
      provider: activeProvider
    });
    if (!customer?.providerCustomerId) {
      try {
        await billingIdempotencyService.markFailed({
          idempotencyRowId: idempotencyRow.id,
          leaseVersion: claimLeaseVersion,
          failureCode: BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR,
          failureReason: "Billing customer is missing for billing portal session create request."
        });
      } catch (error) {
        if (isLeaseFencedError(error)) {
          throw mapFailureCodeToError(
            BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
            "Billing portal request is in progress."
          );
        }
        throw error;
      }

      throw mapFailureCodeToError(BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR, "Billing customer is missing.");
    }

    const returnUrl = new URL(normalizedPayload.returnPath, normalizedAppPublicUrl).toString();

    const providerRequestParams = {
      customer: customer.providerCustomerId,
      return_url: returnUrl
    };
    const providerRequestHash = toSha256Hex(toCanonicalJson(providerRequestParams));

    const sdkProvenance = await providerAdapter.getSdkProvenance();

    try {
      await updateIdempotencyWithLeaseFence({
        idempotencyRowId: idempotencyRow.id,
        leaseVersion: claimLeaseVersion,
        patch: {
          providerRequestParamsJson: providerRequestParams,
          providerRequestHash,
          providerRequestSchemaVersion: `${activeProvider}_billing_portal_session_create_params_v1`,
          providerSdkName: sdkProvenance.providerSdkName,
          providerSdkVersion: sdkProvenance.providerSdkVersion,
          providerApiVersion: sdkProvenance.providerApiVersion,
          providerRequestFrozenAt: now,
          providerIdempotencyReplayDeadlineAt: new Date(now.getTime() + replayWindowSeconds * 1000)
        }
      });
    } catch (error) {
      if (isLeaseFencedError(error)) {
        throw mapFailureCodeToError(
          BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
          "Billing portal request is in progress."
        );
      }
      throw error;
    }

    let portalSession;
    try {
      portalSession = await providerAdapter.createBillingPortalSession({
        params: providerRequestParams,
        idempotencyKey: idempotencyRow.providerIdempotencyKey
      });
    } catch (error) {
      const providerOutcome = resolveAndRecordProviderOutcome(error, {
        operation: "portal_create",
        correlation: {
          operationKey: idempotencyRow.operationKey,
          billableEntityId: billableEntity.id
        }
      });
      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.MARK_FAILED) {
        try {
          await billingIdempotencyService.markFailed({
            idempotencyRowId: idempotencyRow.id,
            leaseVersion: claimLeaseVersion,
            failureCode: providerOutcome.failureCode,
            failureReason: String(error?.message || "Provider billing portal session creation failed.")
          });
        } catch (markFailedError) {
          if (isLeaseFencedError(markFailedError)) {
            throw mapFailureCodeToError(
              BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
              "Billing portal request is in progress."
            );
          }
          throw markFailedError;
        }

        throw mapFailureCodeToError(
          providerOutcome.failureCode,
          "Failed to create billing portal session."
        );
      }

      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.IN_PROGRESS) {
        throw mapFailureCodeToError(
          providerOutcome.failureCode,
          "Billing portal request is in progress."
        );
      }

      throw error;
    }

    const responseJson = {
      provider: activeProvider,
      portalSession: {
        id: String(portalSession?.id || ""),
        url: String(portalSession?.url || "")
      }
    };

    try {
      await billingIdempotencyService.markSucceeded({
        idempotencyRowId: idempotencyRow.id,
        leaseVersion: claimLeaseVersion,
        responseJson,
        providerSessionId: String(portalSession?.id || "")
      });
    } catch (error) {
      if (isLeaseFencedError(error)) {
        throw mapFailureCodeToError(
          BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
          "Billing portal request is in progress."
        );
      }
      throw error;
    }

    return responseJson;
  }

  function buildPaymentLinkResponseJson({ paymentLink, billableEntityId, operationKey }) {
    return {
      provider: activeProvider,
      billableEntityId: Number(billableEntityId),
      operationKey: String(operationKey || ""),
      paymentLink: {
        id: String(paymentLink?.id || ""),
        url: String(paymentLink?.url || ""),
        active: Boolean(paymentLink?.active !== false)
      }
    };
  }

  async function resolvePaymentLinkProviderLineItems({ normalizedRequest, idempotencyRow }) {
    const lineItems = Array.isArray(normalizedRequest?.lineItems) ? normalizedRequest.lineItems : [];
    if (lineItems.length < 1) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            lineItems: "lineItems is required."
          }
        }
      });
    }

    const resolvedLineItems = [];
    for (let index = 0; index < lineItems.length; index += 1) {
      const lineItem = lineItems[index];
      if (lineItem?.type === "price") {
        resolvedLineItems.push({
          price: String(lineItem.priceId || ""),
          quantity: Number(lineItem.quantity || 1)
        });
        continue;
      }

      if (lineItem?.type !== "ad_hoc") {
        throw new AppError(400, "Validation failed.", {
          details: {
            fieldErrors: {
              [`lineItems[${index}]`]: "line item type is invalid."
            }
          }
        });
      }

      if (!providerAdapter || typeof providerAdapter.createPrice !== "function") {
        throw new AppError(500, "Provider price creation is not available.");
      }

      const adHocMetadata = {
        operation_key: String(idempotencyRow.operationKey || ""),
        billable_entity_id: String(idempotencyRow.billableEntityId || ""),
        idempotency_row_id: String(idempotencyRow.id || ""),
        line_item_index: String(index),
        billing_flow: "payment_link_one_off"
      };

      const createdPrice = await providerAdapter.createPrice({
        params: {
          currency: String(lineItem.currency || deploymentCurrency).toLowerCase(),
          unit_amount: Number(lineItem.amountMinor || 0),
          product_data: {
            name: String(lineItem.name || ""),
            metadata: adHocMetadata
          },
          metadata: adHocMetadata
        },
        idempotencyKey: `${idempotencyRow.providerIdempotencyKey}:price:${index}`
      });

      const providerPriceId = toNonEmptyString(createdPrice?.id);
      if (!providerPriceId) {
        throw new AppError(502, "Provider ad-hoc price creation did not return a price id.");
      }

      resolvedLineItems.push({
        price: providerPriceId,
        quantity: Number(lineItem.quantity || 1)
      });
    }

    return resolvedLineItems;
  }

  async function buildFrozenPaymentLinkParams({ normalizedRequest, idempotencyRow }) {
    const successUrl = new URL(normalizedRequest.successPath, normalizedAppPublicUrl).toString();
    const metadata = {
      operation_key: String(idempotencyRow.operationKey || ""),
      billable_entity_id: String(idempotencyRow.billableEntityId || ""),
      idempotency_row_id: String(idempotencyRow.id || ""),
      checkout_flow: "one_off",
      checkout_type: "one_off",
      payment_link_mode: "one_off"
    };

    return {
      line_items: await resolvePaymentLinkProviderLineItems({
        normalizedRequest,
        idempotencyRow
      }),
      after_completion: {
        type: "redirect",
        redirect: {
          url: successUrl
        }
      },
      customer_creation: "always",
      metadata,
      invoice_creation: {
        enabled: true,
        invoice_data: {
          metadata
        }
      }
    };
  }

  async function freezePaymentLinkProviderRequest({ idempotencyRow, providerRequestParams, now, leaseVersion = null }) {
    const providerRequestHash = toSha256Hex(toCanonicalJson(providerRequestParams));
    const sdkProvenance = await providerAdapter.getSdkProvenance();

    await updateIdempotencyWithLeaseFence({
      idempotencyRowId: idempotencyRow.id,
      leaseVersion,
      patch: {
        providerRequestParamsJson: providerRequestParams,
        providerRequestHash,
        providerRequestSchemaVersion: `${activeProvider}_payment_link_create_params_v1`,
        providerSdkName: sdkProvenance.providerSdkName,
        providerSdkVersion: sdkProvenance.providerSdkVersion,
        providerApiVersion: sdkProvenance.providerApiVersion,
        providerRequestFrozenAt: now,
        providerIdempotencyReplayDeadlineAt: new Date(now.getTime() + replayWindowSeconds * 1000)
      }
    });

    return providerRequestHash;
  }

  async function recoverPendingPaymentLink({ idempotencyRow, now }) {
    const leased = await billingIdempotencyService.recoverPendingRequest({
      idempotencyRowId: idempotencyRow.id,
      leaseOwner: `payment-link-recovery:${process.pid}`,
      now
    });

    if (leased.type !== "recovery_leased") {
      if (leased.type === "not_pending") {
        if (leased.row?.status === "succeeded") {
          return leased.row.responseJson;
        }

        if (leased.row?.failureCode) {
          throw mapFailureCodeToError(
            leased.row.failureCode,
            leased.row.failureReason || "Billing payment link request cannot be recovered."
          );
        }
      }

      throw mapFailureCodeToError(
        BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
        "Billing payment link request is in progress."
      );
    }

    const recoveryRow = leased.row;
    const expectedLeaseVersion = leased.expectedLeaseVersion;
    const replayDeadlineAt = recoveryRow.providerIdempotencyReplayDeadlineAt
      ? new Date(recoveryRow.providerIdempotencyReplayDeadlineAt)
      : null;
    if (!replayDeadlineAt || !Number.isFinite(replayDeadlineAt.getTime())) {
      await billingIdempotencyService.markFailed({
        idempotencyRowId: recoveryRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        failureReason: "Billing payment-link replay deadline is missing."
      });

      throw mapFailureCodeToError(
        BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        "Billing payment link recovery request state is invalid."
      );
    }

    if (now.getTime() >= replayDeadlineAt.getTime()) {
      await billingIdempotencyService.markExpired({
        idempotencyRowId: recoveryRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_WINDOW_ELAPSED,
        failureReason: "Billing payment-link recovery replay window elapsed."
      });

      throw mapFailureCodeToError(
        BILLING_FAILURE_CODES.CHECKOUT_RECOVERY_WINDOW_ELAPSED,
        "Billing payment link recovery window elapsed."
      );
    }

    let providerRequestParams = recoveryRow.providerRequestParamsJson;
    let providerRequestHash = toNonEmptyString(recoveryRow.providerRequestHash);

    if (!providerRequestParams || typeof providerRequestParams !== "object" || !providerRequestHash) {
      try {
        providerRequestParams = await buildFrozenPaymentLinkParams({
          normalizedRequest: recoveryRow.normalizedRequestJson,
          idempotencyRow: recoveryRow
        });
        providerRequestHash = toSha256Hex(toCanonicalJson(providerRequestParams));

        const sdkProvenance = await providerAdapter.getSdkProvenance();
        const updatedRow = await billingRepository.updateIdempotencyById(
          recoveryRow.id,
          {
            providerRequestParamsJson: providerRequestParams,
            providerRequestHash,
            providerRequestSchemaVersion: `${activeProvider}_payment_link_create_params_v1`,
            providerSdkName: sdkProvenance.providerSdkName,
            providerSdkVersion: sdkProvenance.providerSdkVersion,
            providerApiVersion: sdkProvenance.providerApiVersion,
            providerRequestFrozenAt: now,
            providerIdempotencyReplayDeadlineAt: new Date(now.getTime() + replayWindowSeconds * 1000)
          },
          {
            expectedLeaseVersion
          }
        );
        if (!updatedRow) {
          throw new AppError(409, "Billing idempotency lease has changed.", {
            code: "BILLING_LEASE_FENCED"
          });
        }
      } catch (error) {
        if (String(error?.code || "").trim() === "BILLING_LEASE_FENCED") {
          throw mapFailureCodeToError(
            BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
            "Billing payment-link recovery is in progress."
          );
        }

        if (isLocalPreparationError(error)) {
          await billingIdempotencyService.markFailed({
            idempotencyRowId: recoveryRow.id,
            leaseVersion: expectedLeaseVersion,
            failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
            failureReason: String(error?.message || "Frozen billing payment-link provider params are missing.")
          });

          throw mapFailureCodeToError(
            BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
            "Billing payment link recovery request state is invalid."
          );
        }

        const providerOutcome = resolveAndRecordProviderOutcome(error, {
          operation: "payment_link_recover_prepare",
          correlation: {
            operationKey: recoveryRow.operationKey,
            billableEntityId: recoveryRow.billableEntityId
          }
        });
        if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.MARK_FAILED) {
          await billingIdempotencyService.markFailed({
            idempotencyRowId: recoveryRow.id,
            leaseVersion: expectedLeaseVersion,
            failureCode: providerOutcome.failureCode,
            failureReason: String(error?.message || "Provider payment-link recovery preparation failed.")
          });

          throw mapFailureCodeToError(
            providerOutcome.failureCode,
            "Provider rejected billing payment-link recovery replay preparation."
          );
        }

        if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.IN_PROGRESS) {
          throw mapFailureCodeToError(
            providerOutcome.failureCode,
            "Billing payment-link recovery is in progress."
          );
        }

        await billingIdempotencyService.markFailed({
          idempotencyRowId: recoveryRow.id,
          leaseVersion: expectedLeaseVersion,
          failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
          failureReason: String(error?.message || "Frozen billing payment-link provider params are missing.")
        });
        throw mapFailureCodeToError(
          BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
          "Billing payment link recovery request state is invalid."
        );
      }
    }

    const replayParamsHash = toSha256Hex(toCanonicalJson(providerRequestParams));
    try {
      await billingIdempotencyService.assertProviderRequestHashStable({
        idempotencyRowId: recoveryRow.id,
        candidateProviderRequestHash: replayParamsHash
      });
    } catch (error) {
      await billingIdempotencyService.markFailed({
        idempotencyRowId: recoveryRow.id,
        leaseVersion: expectedLeaseVersion,
        failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        failureReason: String(error?.message || "Billing payment-link replay hash mismatch.")
      });

      throw mapFailureCodeToError(
        BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        "Billing payment link recovery request state is invalid."
      );
    }

    let paymentLink;
    try {
      paymentLink = await providerAdapter.createPaymentLink({
        params: providerRequestParams,
        idempotencyKey: recoveryRow.providerIdempotencyKey
      });
    } catch (error) {
      const providerOutcome = resolveAndRecordProviderOutcome(error, {
        operation: "payment_link_recover_replay",
        correlation: {
          operationKey: recoveryRow.operationKey,
          billableEntityId: recoveryRow.billableEntityId
        }
      });
      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.MARK_FAILED) {
        await billingIdempotencyService.markFailed({
          idempotencyRowId: recoveryRow.id,
          leaseVersion: expectedLeaseVersion,
          failureCode: providerOutcome.failureCode,
          failureReason: String(error?.message || "Provider billing payment-link recovery replay failed.")
        });

        throw mapFailureCodeToError(
          providerOutcome.failureCode,
          "Provider rejected billing payment-link recovery replay."
        );
      }

      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.IN_PROGRESS) {
        throw mapFailureCodeToError(
          providerOutcome.failureCode,
          "Billing payment-link recovery is in progress."
        );
      }

      throw error;
    }

    const responseJson = buildPaymentLinkResponseJson({
      paymentLink,
      billableEntityId: recoveryRow.billableEntityId,
      operationKey: recoveryRow.operationKey
    });

    await billingIdempotencyService.markSucceeded({
      idempotencyRowId: recoveryRow.id,
      leaseVersion: expectedLeaseVersion,
      responseJson,
      providerSessionId: String(paymentLink?.id || "")
    });

    return responseJson;
  }

  async function createPaymentLink({ request, user, payload, clientIdempotencyKey, now = new Date() }) {
    if (!providerAdapter || typeof providerAdapter.createPaymentLink !== "function") {
      throw new AppError(500, "Provider payment links are not available.");
    }

    const { billableEntity } = await billingPolicyService.resolveBillableEntityForWriteRequest({
      request,
      user
    });

    const normalizedRequest = normalizePaymentLinkRequest({
      billableEntityId: billableEntity.id,
      payload,
      defaultCurrency: deploymentCurrency
    });
    const requestFingerprintHash = toSha256Hex(toCanonicalJson(normalizedRequest));

    const claim = await billingIdempotencyService.claimOrReplay({
      action: BILLING_ACTIONS.PAYMENT_LINK,
      billableEntityId: billableEntity.id,
      clientIdempotencyKey,
      requestFingerprintHash,
      normalizedRequestJson: normalizedRequest,
      provider: activeProvider,
      now
    });

    if (claim.type === "replay_succeeded") {
      return claim.row.responseJson;
    }

    if (claim.type === "replay_terminal") {
      throw mapFailureCodeToError(
        claim.row.failureCode,
        claim.row.failureReason || "Billing payment-link request previously failed."
      );
    }

    if (claim.type === "recover_pending") {
      return recoverPendingPaymentLink({
        idempotencyRow: claim.row,
        now
      });
    }

    if (claim.type === "in_progress_same_key" || claim.type === "checkout_in_progress_other_key") {
      throw mapFailureCodeToError(BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS, "Billing payment-link request is in progress.");
    }

    if (claim.type !== "claimed" || !claim.row) {
      throw new AppError(500, "Billing payment-link idempotency claim state is invalid.");
    }

    const idempotencyRow = claim.row;
    const claimLeaseVersion = toLeaseVersionOrNull(idempotencyRow?.leaseVersion);
    try {
      await updateIdempotencyWithLeaseFence({
        idempotencyRowId: idempotencyRow.id,
        leaseVersion: claimLeaseVersion,
        patch: {
          providerIdempotencyReplayDeadlineAt: new Date(now.getTime() + replayWindowSeconds * 1000)
        }
      });
    } catch (error) {
      if (isLeaseFencedError(error)) {
        throw mapFailureCodeToError(
          BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
          "Billing payment-link request is in progress."
        );
      }
      throw error;
    }

    let providerRequestParams;
    try {
      providerRequestParams = await buildFrozenPaymentLinkParams({
        normalizedRequest,
        idempotencyRow
      });
      await freezePaymentLinkProviderRequest({
        idempotencyRow,
        providerRequestParams,
        now,
        leaseVersion: claimLeaseVersion
      });
    } catch (error) {
      if (isLeaseFencedError(error)) {
        throw mapFailureCodeToError(
          BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
          "Billing payment-link request is in progress."
        );
      }

      if (isLocalPreparationError(error)) {
        try {
          await billingIdempotencyService.markFailed({
            idempotencyRowId: idempotencyRow.id,
            leaseVersion: claimLeaseVersion,
            failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
            failureReason: String(error?.message || "Billing payment-link request is invalid.")
          });
        } catch (markFailedError) {
          if (isLeaseFencedError(markFailedError)) {
            throw mapFailureCodeToError(
              BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
              "Billing payment-link request is in progress."
            );
          }
          throw markFailedError;
        }

        throw mapFailureCodeToError(
          BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
          "Billing payment-link request is invalid."
        );
      }

      const providerOutcome = resolveAndRecordProviderOutcome(error, {
        operation: "payment_link_create_prepare",
        correlation: {
          operationKey: idempotencyRow.operationKey,
          billableEntityId: idempotencyRow.billableEntityId
        }
      });
      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.MARK_FAILED) {
        try {
          await billingIdempotencyService.markFailed({
            idempotencyRowId: idempotencyRow.id,
            leaseVersion: claimLeaseVersion,
            failureCode: providerOutcome.failureCode,
            failureReason: String(error?.message || "Provider payment-link request preparation failed.")
          });
        } catch (markFailedError) {
          if (isLeaseFencedError(markFailedError)) {
            throw mapFailureCodeToError(
              BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
              "Billing payment-link request is in progress."
            );
          }
          throw markFailedError;
        }

        throw mapFailureCodeToError(
          providerOutcome.failureCode,
          "Provider rejected billing payment-link request preparation."
        );
      }

      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.IN_PROGRESS) {
        throw mapFailureCodeToError(
          providerOutcome.failureCode,
          "Billing payment-link request is in progress."
        );
      }

      try {
        await billingIdempotencyService.markFailed({
          idempotencyRowId: idempotencyRow.id,
          leaseVersion: claimLeaseVersion,
          failureCode: BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
          failureReason: String(error?.message || "Billing payment-link request is invalid.")
        });
      } catch (markFailedError) {
        if (isLeaseFencedError(markFailedError)) {
          throw mapFailureCodeToError(
            BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
            "Billing payment-link request is in progress."
          );
        }
        throw markFailedError;
      }
      throw mapFailureCodeToError(
        BILLING_FAILURE_CODES.CHECKOUT_CONFIGURATION_INVALID,
        "Billing payment-link request is invalid."
      );
    }

    let paymentLink;
    try {
      paymentLink = await providerAdapter.createPaymentLink({
        params: providerRequestParams,
        idempotencyKey: idempotencyRow.providerIdempotencyKey
      });
    } catch (error) {
      const providerOutcome = resolveAndRecordProviderOutcome(error, {
        operation: "payment_link_create",
        correlation: {
          operationKey: idempotencyRow.operationKey,
          billableEntityId: idempotencyRow.billableEntityId
        }
      });
      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.MARK_FAILED) {
        try {
          await billingIdempotencyService.markFailed({
            idempotencyRowId: idempotencyRow.id,
            leaseVersion: claimLeaseVersion,
            failureCode: providerOutcome.failureCode,
            failureReason: String(error?.message || "Provider payment-link create request failed.")
          });
        } catch (markFailedError) {
          if (isLeaseFencedError(markFailedError)) {
            throw mapFailureCodeToError(
              BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
              "Billing payment-link request is in progress."
            );
          }
          throw markFailedError;
        }

        throw mapFailureCodeToError(
          providerOutcome.failureCode,
          "Failed to create billing payment link."
        );
      }

      if (providerOutcome.action === PROVIDER_OUTCOME_ACTIONS.IN_PROGRESS) {
        throw mapFailureCodeToError(
          providerOutcome.failureCode,
          "Billing payment-link request is in progress."
        );
      }

      throw error;
    }

    const responseJson = buildPaymentLinkResponseJson({
      paymentLink,
      billableEntityId: billableEntity.id,
      operationKey: idempotencyRow.operationKey
    });

    try {
      await billingIdempotencyService.markSucceeded({
        idempotencyRowId: idempotencyRow.id,
        leaseVersion: claimLeaseVersion,
        responseJson,
        providerSessionId: String(paymentLink?.id || "")
      });
    } catch (error) {
      if (isLeaseFencedError(error)) {
        throw mapFailureCodeToError(
          BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS,
          "Billing payment-link request is in progress."
        );
      }
      throw error;
    }

    return responseJson;
  }

  async function startCheckout({ request, user, payload, clientIdempotencyKey, now = new Date() }) {
    return billingCheckoutOrchestrator.startCheckout({
      request,
      user,
      payload,
      clientIdempotencyKey,
      now
    });
  }

  return {
    ensureBillableEntity,
    seedSignupPromoPlan,
    listPlans,
    getPlanState,
    requestPlanChange,
    cancelPendingPlanChange,
    processDuePlanChanges,
    getSnapshot,
    listPaymentMethods,
    syncPaymentMethods,
    getLimitations,
    listTimeline,
    recordUsage,
    enforceLimitAndRecordUsage,
    createPortalSession,
    createPaymentLink,
    startCheckout
  };
}

export { createService };
