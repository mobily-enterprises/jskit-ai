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

function normalizeOptionalEmail(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized || normalized.length > 320 || !normalized.includes("@") || normalized.includes(" ")) {
    return "";
  }
  return normalized;
}

function buildPaymentLinkUrlWithEmailPrefill({ provider, paymentLinkUrl, customerEmail }) {
  const normalizedUrl = String(paymentLinkUrl || "").trim();
  const normalizedEmail = normalizeOptionalEmail(customerEmail);
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  if (!normalizedUrl || !normalizedEmail || normalizedProvider !== "stripe") {
    return normalizedUrl;
  }

  try {
    const parsed = new URL(normalizedUrl);
    if (!parsed.searchParams.has("prefilled_email")) {
      parsed.searchParams.set("prefilled_email", normalizedEmail);
    }
    return parsed.toString();
  } catch {
    return normalizedUrl;
  }
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

function normalizePaymentLinkRequest({ billableEntityId, payload, defaultCurrency, customerEmail = "" }) {
  const body = payload && typeof payload === "object" ? payload : {};
  const normalizedSuccessPath = normalizeBillingPath(body.successPath, { fieldName: "successPath" });
  const sourceLineItems = Array.isArray(body.lineItems) && body.lineItems.length > 0 ? body.lineItems : null;
  const normalizedCustomerEmail = normalizeOptionalEmail(customerEmail);

  const normalizedLineItems = sourceLineItems
    ? normalizePaymentLinkLineItems(sourceLineItems, { defaultCurrency })
    : normalizePaymentLinkLineItems([body.oneOff || {}], { defaultCurrency });

  return {
    action: BILLING_ACTIONS.PAYMENT_LINK,
    billableEntityId: Number(billableEntityId),
    successPath: normalizedSuccessPath,
    lineItems: normalizedLineItems,
    ...(normalizedCustomerEmail ? { customerEmail: normalizedCustomerEmail } : {})
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

function addUtcDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
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

function isPaidPlan(plan) {
  return resolvePlanCoreAmountMinor(plan) > 0;
}

function resolveDefaultAssignmentPeriodEndForPlan(plan, now = new Date()) {
  return isPaidPlan(plan) ? addUtcDays(now, PLAN_ASSIGNMENT_DEFAULT_PERIOD_DAYS) : null;
}

function resolveProviderObjectId(value) {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number") {
    const normalized = String(value).trim();
    return normalized || null;
  }

  if (typeof value === "object") {
    const normalized = String(value.id || "").trim();
    return normalized || null;
  }

  return null;
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
    billingRealtimePublishService = null,
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

  function mapPurchaseForResponse(entry) {
    const purchase = entry && typeof entry === "object" ? entry : null;
    if (!purchase) {
      return null;
    }

    return {
      id: Number(purchase.id || 0),
      purchaseKind: String(purchase.purchaseKind || ""),
      status: String(purchase.status || "confirmed"),
      amountMinor: Number(purchase.amountMinor || 0),
      currency: String(purchase.currency || "USD")
        .trim()
        .toUpperCase(),
      quantity: purchase.quantity == null ? 1 : Number(purchase.quantity || 1),
      displayName: purchase.displayName == null ? null : String(purchase.displayName),
      purchasedAt: String(purchase.purchasedAt || "")
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
    const definitions = await billingRepository.listEntitlementDefinitions();
    const definitionById = new Map(definitions.map((entry) => [Number(entry.id), entry]));
    const entries = [];

    for (const plan of plans) {
      const templates = await billingRepository.listPlanEntitlementTemplates(plan.id);
      const entitlements = templates
        .map((template) => {
          const definition = definitionById.get(Number(template.entitlementDefinitionId));
          if (!definition) {
            return null;
          }
          return {
            id: Number(template.id),
            planId: Number(template.planId),
            code: String(definition.code || ""),
            schemaVersion: "entitlement.template.v1",
            valueJson: {
              amount: Number(template.amount || 0),
              grantKind: String(template.grantKind || ""),
              effectivePolicy: String(template.effectivePolicy || ""),
              durationPolicy: String(template.durationPolicy || ""),
              durationDays: template.durationDays == null ? null : Number(template.durationDays),
              metadataJson: template.metadataJson && typeof template.metadataJson === "object" ? template.metadataJson : {}
            },
            createdAt: template.createdAt,
            updatedAt: template.updatedAt
          };
        })
        .filter(Boolean);

      entries.push({
        ...plan,
        entitlements
      });
    }

    return {
      plans: entries
    };
  }

  async function listProducts(requestContext = {}) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForReadRequest(requestContext);
    void billableEntity;

    if (typeof billingRepository.listProducts !== "function") {
      return {
        products: []
      };
    }

    const products = await billingRepository.listProducts();
    const entries = products.filter((entry) => {
      if (!entry || entry.isActive === false) {
        return false;
      }

      const price = entry.price && typeof entry.price === "object" ? entry.price : null;
      if (!price) {
        return false;
      }

      const interval = price.interval == null ? "" : String(price.interval).trim().toLowerCase();
      return !interval;
    });

    return {
      products: entries
    };
  }

  async function listPurchases(requestContext = {}) {
    const { billableEntity } = await billingPolicyService.resolveBillableEntityForReadRequest(requestContext);

    if (typeof billingRepository.listBillingPurchasesForEntity !== "function") {
      return {
        billableEntity,
        purchases: []
      };
    }

    const rows = await billingRepository.listBillingPurchasesForEntity({
      billableEntityId: billableEntity.id,
      status: "confirmed",
      limit: 50
    });

    return {
      billableEntity,
      purchases: rows.map(mapPurchaseForResponse).filter(Boolean)
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
    const currentSubscription =
      typeof billingRepository.findCurrentSubscriptionForEntity === "function"
        ? await billingRepository.findCurrentSubscriptionForEntity(billableEntityId, readOptions)
        : null;
    return {
      source: currentSubscription ? "subscription" : "assignment",
      plan,
      subscription: currentSubscription || null,
      assignment: currentAssignment,
      periodEndAt:
        toDateOrNull(currentAssignment.periodEndAt) ||
        (currentSubscription ? resolveSubscriptionPeriodEnd(currentSubscription, now) : null)
    };
  }

  async function resolveUpcomingPlanContext({ billableEntityId, trx = null, forUpdate = false } = {}) {
    if (typeof billingRepository.findUpcomingPlanAssignmentForEntity !== "function") {
      return {
        assignment: null,
        plan: null,
        effectiveAt: null
      };
    }

    const readOptions = trx ? { trx, forUpdate } : { forUpdate };
    const assignment = await billingRepository.findUpcomingPlanAssignmentForEntity(billableEntityId, readOptions);
    if (!assignment) {
      return {
        assignment: null,
        plan: null,
        effectiveAt: null
      };
    }

    const plan = await billingRepository.findPlanById(assignment.planId, trx ? { trx } : {});
    return {
      assignment,
      plan,
      effectiveAt: toDateOrNull(assignment.periodStartAt)
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

  async function applyInternalPlanAssignment({
    billableEntityId,
    targetPlan,
    now = new Date(),
    source = "internal",
    status = "current",
    periodStartAt = null,
    periodEndAt = null,
    metadataJson = null,
    trx = null
  }) {
    if (typeof billingRepository.insertPlanAssignment !== "function") {
      throw new AppError(500, "Internal plan assignment storage is unavailable.");
    }

    const resolvedPeriodEndAt = toDateOrNull(periodEndAt) || resolveDefaultAssignmentPeriodEndForPlan(targetPlan, now);
    return billingRepository.insertPlanAssignment(
      {
        billableEntityId,
        planId: targetPlan.id,
        source,
        status,
        periodStartAt: periodStartAt || now,
        periodEndAt: resolvedPeriodEndAt,
        metadataJson
      },
      trx ? { trx } : {}
    );
  }

  async function syncCurrentAssignmentProviderDetailsFromProviderSubscription({
    currentContext,
    providerSubscription,
    now = new Date(),
    trx = null
  }) {
    if (typeof billingRepository.upsertPlanAssignmentProviderDetails !== "function") {
      return;
    }

    const assignment = currentContext?.assignment || null;
    const subscription = currentContext?.subscription || null;
    if (!assignment || !subscription || !subscription.providerSubscriptionId) {
      return;
    }

    const providerCurrentPeriodEnd = parseUnixEpochSeconds(providerSubscription?.current_period_end);
    const providerTrialEnd = parseUnixEpochSeconds(providerSubscription?.trial_end);
    const providerCanceledAt = parseUnixEpochSeconds(providerSubscription?.canceled_at);
    const providerEndedAt = parseUnixEpochSeconds(providerSubscription?.ended_at);
    const providerCreatedAt = parseUnixEpochSeconds(providerSubscription?.created);
    const providerCustomerId =
      resolveProviderObjectId(providerSubscription?.customer) || subscription.providerCustomerId || null;
    const normalizedStatus = normalizeProviderSubscriptionStatus(providerSubscription?.status || subscription?.status);

    await billingRepository.upsertPlanAssignmentProviderDetails(
      {
        billingPlanAssignmentId: assignment.id,
        provider: subscription.provider,
        providerSubscriptionId: subscription.providerSubscriptionId,
        providerCustomerId,
        providerStatus: normalizedStatus,
        providerSubscriptionCreatedAt:
          providerCreatedAt || toDateOrNull(subscription.providerSubscriptionCreatedAt) || now,
        currentPeriodEnd: providerCurrentPeriodEnd || resolveSubscriptionPeriodEnd(subscription, now),
        trialEnd: providerTrialEnd || toDateOrNull(subscription.trialEnd),
        canceledAt: providerCanceledAt || toDateOrNull(subscription.canceledAt),
        cancelAtPeriodEnd: Boolean(providerSubscription?.cancel_at_period_end),
        endedAt: providerEndedAt || toDateOrNull(subscription.endedAt),
        lastProviderEventCreatedAt: now,
        lastProviderEventId: null,
        metadataJson:
          providerSubscription?.metadata && typeof providerSubscription.metadata === "object"
            ? providerSubscription.metadata
            : subscription.metadataJson || {}
      },
      trx ? { trx } : {}
    );

    if (providerCurrentPeriodEnd) {
      const assignmentPeriodStart = toDateOrNull(assignment.periodStartAt);
      if (!assignmentPeriodStart || providerCurrentPeriodEnd.getTime() > assignmentPeriodStart.getTime()) {
        await billingRepository.updatePlanAssignmentById(
          assignment.id,
          {
            periodEndAt: providerCurrentPeriodEnd
          },
          trx ? { trx } : {}
        );
      }
    }
  }

  async function applyProviderBackedPlanChangeToAssignment({
    currentSubscription,
    targetPlan,
    targetAssignment = null,
    previousCurrentAssignment = null,
    prorationBehavior = "create_prorations",
    billableEntityId = null,
    assignmentSource = "internal",
    targetEffectiveAt = null,
    assignmentMetadataJson = null,
    now = new Date(),
    trx = null
  }) {
    if (!currentSubscription) {
      throw new AppError(409, "Provider-backed assignment update requires current subscription.");
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
    const resolvedTargetAssignment =
      targetAssignment ||
      (await billingRepository.insertPlanAssignment(
        {
          billableEntityId: billableEntityId || currentSubscription.billableEntityId,
          planId: targetPlan.id,
          source: assignmentSource,
          status: "current",
          periodStartAt: targetEffectiveAt || now,
          periodEndAt: providerCurrentPeriodEnd || addUtcDays(now, PLAN_ASSIGNMENT_DEFAULT_PERIOD_DAYS),
          metadataJson:
            assignmentMetadataJson && typeof assignmentMetadataJson === "object" ? assignmentMetadataJson : {}
        },
        trx ? { trx } : {}
      ));

    if (previousCurrentAssignment && Number(previousCurrentAssignment.id) !== Number(resolvedTargetAssignment.id)) {
      await billingRepository.updatePlanAssignmentById(
        previousCurrentAssignment.id,
        {
          status: "past",
          periodEndAt: now,
          metadataJson: {
            ...(previousCurrentAssignment.metadataJson && typeof previousCurrentAssignment.metadataJson === "object"
              ? previousCurrentAssignment.metadataJson
              : {}),
            replacedByAssignmentId: Number(resolvedTargetAssignment.id)
          }
        },
        trx ? { trx } : {}
      );
    }

    await billingRepository.updatePlanAssignmentById(
      resolvedTargetAssignment.id,
      {
        status: "current",
        planId: targetPlan.id,
        periodEndAt:
          providerCurrentPeriodEnd ||
          toDateOrNull(resolvedTargetAssignment.periodEndAt) ||
          addUtcDays(now, PLAN_ASSIGNMENT_DEFAULT_PERIOD_DAYS),
        metadataJson: {
          ...(resolvedTargetAssignment.metadataJson && typeof resolvedTargetAssignment.metadataJson === "object"
            ? resolvedTargetAssignment.metadataJson
            : {}),
          provider: currentSubscription.provider
        }
      },
      trx ? { trx } : {}
    );

    if (typeof billingRepository.upsertPlanAssignmentProviderDetails === "function") {
      await billingRepository.upsertPlanAssignmentProviderDetails(
        {
          billingPlanAssignmentId: resolvedTargetAssignment.id,
          provider: currentSubscription.provider,
          providerSubscriptionId: currentSubscription.providerSubscriptionId,
          providerCustomerId: currentSubscription.providerCustomerId || null,
          providerStatus: normalizedStatus,
          providerSubscriptionCreatedAt: providerCreatedAt || currentSubscription.providerSubscriptionCreatedAt || now,
          currentPeriodEnd: providerCurrentPeriodEnd || resolveSubscriptionPeriodEnd(currentSubscription, now),
          trialEnd: providerTrialEnd,
          canceledAt: providerCanceledAt,
          cancelAtPeriodEnd: Boolean(providerSubscription?.cancel_at_period_end),
          endedAt: providerEndedAt,
          lastProviderEventCreatedAt: now,
          lastProviderEventId: null,
          metadataJson:
            providerSubscription?.metadata && typeof providerSubscription.metadata === "object"
              ? providerSubscription.metadata
              : currentSubscription.metadataJson || {}
        },
        trx ? { trx } : {}
      );
    }

    return billingRepository.findSubscriptionByProviderSubscriptionId(
      {
        provider: currentSubscription.provider,
        providerSubscriptionId: currentSubscription.providerSubscriptionId
      },
      trx ? { trx } : {}
    );
  }

  async function applyProviderBackedDowngradeToFreeAssignment({
    currentSubscription,
    targetPlan,
    targetAssignment = null,
    previousCurrentAssignment = null,
    billableEntityId = null,
    assignmentSource = "internal",
    targetEffectiveAt = null,
    assignmentMetadataJson = null,
    now = new Date(),
    trx = null
  }) {
    if (!currentSubscription) {
      throw new AppError(409, "Provider-backed free downgrade requires current subscription.");
    }
    if (isPaidPlan(targetPlan)) {
      throw new AppError(409, "Free downgrade helper requires a free target plan.");
    }
    if (typeof providerAdapter.cancelSubscription !== "function") {
      throw new AppError(501, "Provider subscription cancellation is not available.");
    }

    const providerSubscription = await providerAdapter.cancelSubscription({
      subscriptionId: currentSubscription.providerSubscriptionId,
      cancelAtPeriodEnd: false
    });

    const providerCurrentPeriodEnd = parseUnixEpochSeconds(providerSubscription?.current_period_end);
    const providerTrialEnd = parseUnixEpochSeconds(providerSubscription?.trial_end);
    const providerCanceledAt = parseUnixEpochSeconds(providerSubscription?.canceled_at) || now;
    const providerEndedAt = parseUnixEpochSeconds(providerSubscription?.ended_at) || now;
    const providerCreatedAt =
      parseUnixEpochSeconds(providerSubscription?.created) ||
      toDateOrNull(currentSubscription.providerSubscriptionCreatedAt) ||
      now;
    const normalizedStatus = normalizeProviderSubscriptionStatus(providerSubscription?.status);

    if (previousCurrentAssignment && Number(previousCurrentAssignment.id) !== Number(targetAssignment?.id || 0)) {
      await billingRepository.updatePlanAssignmentById(
        previousCurrentAssignment.id,
        {
          status: "past",
          periodEndAt: now,
          metadataJson: {
            ...(previousCurrentAssignment.metadataJson && typeof previousCurrentAssignment.metadataJson === "object"
              ? previousCurrentAssignment.metadataJson
              : {}),
            replacedByPlanId: Number(targetPlan.id)
          }
        },
        trx ? { trx } : {}
      );
    }

    const resolvedTargetAssignment =
      targetAssignment ||
      (await billingRepository.insertPlanAssignment(
        {
          billableEntityId: billableEntityId || currentSubscription.billableEntityId,
          planId: targetPlan.id,
          source: assignmentSource,
          status: "current",
          periodStartAt: targetEffectiveAt || now,
          periodEndAt: null,
          metadataJson:
            assignmentMetadataJson && typeof assignmentMetadataJson === "object" ? assignmentMetadataJson : {}
        },
        trx ? { trx } : {}
      ));

    await billingRepository.updatePlanAssignmentById(
      resolvedTargetAssignment.id,
      {
        status: "current",
        planId: targetPlan.id,
        periodEndAt: null,
        metadataJson: {
          ...(resolvedTargetAssignment.metadataJson && typeof resolvedTargetAssignment.metadataJson === "object"
            ? resolvedTargetAssignment.metadataJson
            : {}),
          ...(assignmentMetadataJson && typeof assignmentMetadataJson === "object" ? assignmentMetadataJson : {}),
          downgradedFromProviderSubscriptionId: currentSubscription.providerSubscriptionId
        }
      },
      trx ? { trx } : {}
    );

    if (
      previousCurrentAssignment &&
      typeof billingRepository.upsertPlanAssignmentProviderDetails === "function" &&
      currentSubscription.providerSubscriptionId
    ) {
      await billingRepository.upsertPlanAssignmentProviderDetails(
        {
          billingPlanAssignmentId: previousCurrentAssignment.id,
          provider: currentSubscription.provider,
          providerSubscriptionId: currentSubscription.providerSubscriptionId,
          providerCustomerId: currentSubscription.providerCustomerId || null,
          providerStatus: normalizedStatus,
          providerSubscriptionCreatedAt: providerCreatedAt,
          currentPeriodEnd: providerCurrentPeriodEnd || toDateOrNull(currentSubscription.currentPeriodEnd),
          trialEnd: providerTrialEnd || toDateOrNull(currentSubscription.trialEnd),
          canceledAt: providerCanceledAt,
          cancelAtPeriodEnd: Boolean(providerSubscription?.cancel_at_period_end),
          endedAt: providerEndedAt,
          lastProviderEventCreatedAt: now,
          lastProviderEventId: null,
          metadataJson:
            providerSubscription?.metadata && typeof providerSubscription.metadata === "object"
              ? providerSubscription.metadata
              : currentSubscription.metadataJson || {}
        },
        trx ? { trx } : {}
      );
    }

    return resolvedTargetAssignment;
  }

  async function applyDuePlanChangeForEntity({ billableEntityId, now = new Date() }) {
    if (typeof billingRepository.findUpcomingPlanAssignmentForEntity !== "function") {
      return false;
    }

    let applied = false;
    let changedCodes = [];
    await billingRepository.transaction(async (trx) => {
      const upcoming = await billingRepository.findUpcomingPlanAssignmentForEntity(billableEntityId, {
        trx,
        forUpdate: true
      });
      if (!upcoming || upcoming.status !== "upcoming") {
        applied = false;
        return;
      }

      const effectiveAtDate = toDateOrNull(upcoming.periodStartAt);
      if (!effectiveAtDate || effectiveAtDate.getTime() > now.getTime()) {
        applied = false;
        return;
      }

      const targetPlan = await billingRepository.findPlanById(upcoming.planId, { trx });
      if (!targetPlan || targetPlan.isActive === false) {
        await billingRepository.cancelUpcomingPlanAssignmentForEntity(
          {
            billableEntityId,
            metadataJson: {
              reason: "target_plan_unavailable"
            }
          },
          { trx }
        );
        applied = false;
        return;
      }

      const currentContext = await resolveCurrentPlanContext({
        billableEntityId,
        now,
        trx,
        forUpdate: true
      });
      const previousCurrentAssignment = currentContext.assignment || null;
      const fromPlanId = currentContext.plan?.id || null;

      if (currentContext.subscription) {
        if (isPaidPlan(targetPlan)) {
          await applyProviderBackedPlanChangeToAssignment({
            currentSubscription: currentContext.subscription,
            targetPlan,
            targetAssignment: upcoming,
            previousCurrentAssignment,
            prorationBehavior: "none",
            now,
            trx
          });
        } else {
          await applyProviderBackedDowngradeToFreeAssignment({
            currentSubscription: currentContext.subscription,
            targetPlan,
            targetAssignment: upcoming,
            previousCurrentAssignment,
            billableEntityId,
            assignmentSource: "manual",
            assignmentMetadataJson: {
              changeKind: "scheduled_change_applied"
            },
            targetEffectiveAt: now,
            now,
            trx
          });
        }
      } else {
        if (previousCurrentAssignment && Number(previousCurrentAssignment.id) !== Number(upcoming.id)) {
          await billingRepository.updatePlanAssignmentById(
            previousCurrentAssignment.id,
            {
              status: "past",
              periodEndAt: now
            },
            { trx }
          );
        }
        const upcomingPeriodEndDate = toDateOrNull(upcoming.periodEndAt);
        await billingRepository.updatePlanAssignmentById(
          upcoming.id,
          {
            status: "current",
            periodEndAt:
              !upcomingPeriodEndDate
                ? null
                : upcomingPeriodEndDate.getTime() > now.getTime()
                  ? upcoming.periodEndAt
                  : resolveDefaultAssignmentPeriodEndForPlan(targetPlan, now)
          },
          { trx }
        );
      }

      await billingRepository.insertPlanChangeHistory(
        {
          billableEntityId,
          fromPlanId,
          toPlanId: targetPlan.id,
          changeKind: "scheduled_change_applied",
          effectiveAt: now,
          metadataJson: {
            promotedAssignmentId: upcoming.id
          }
        },
        { trx }
      );
      const grantOutcome = await grantEntitlementsForPlanState({
        billableEntityId,
        planAssignmentId: upcoming.id,
        now,
        trx,
        publish: false
      });
      changedCodes = Array.isArray(grantOutcome?.changedCodes) ? grantOutcome.changedCodes : [];
      applied = true;
    });

    await publishBillingLimitRealtime({
      billableEntityId,
      changedCodes,
      changeSource: "plan_grant",
      changedAt: now
    });

    return applied;
  }

  async function buildPlanState({ billableEntity, now = new Date() }) {
    await applyDuePlanChangeForEntity({
      billableEntityId: billableEntity.id,
      now
    });

    const activePlans = await listActiveWorkspacePlans();
    const currentContext = await resolveCurrentPlanContext({
      billableEntityId: billableEntity.id,
      now
    });
    const currentPlan = currentContext.plan && currentContext.plan.isActive !== false ? currentContext.plan : null;
    const currentPlanId = Number(currentPlan?.id || 0);

    const upcomingContext = await resolveUpcomingPlanContext({
      billableEntityId: billableEntity.id
    });
    const nextPlan = upcomingContext.plan && upcomingContext.plan.isActive !== false ? upcomingContext.plan : null;

    const planSelections = activePlans
      .filter((plan) => Number(plan.id) !== currentPlanId)
      .map((plan) => mapPlanForSelection(plan))
      .filter(Boolean);

    const currentPlanPeriodEndDate = toDateOrNull(currentContext.periodEndAt);
    return {
      currentPlan: currentPlan ? mapPlanForSelection(currentPlan) : null,
      currentPeriodEndAt: currentPlanPeriodEndDate ? currentPlanPeriodEndDate.toISOString() : null,
      nextPlan: nextPlan ? mapPlanForSelection(nextPlan) : null,
      nextEffectiveAt:
        upcomingContext.assignment && nextPlan ? String(upcomingContext.assignment.periodStartAt || "") : null,
      pendingChange: Boolean(upcomingContext.assignment && nextPlan),
      availablePlans: planSelections,
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
        mode: "applied",
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
          if (isPaidPlan(targetPlan)) {
            await applyProviderBackedPlanChangeToAssignment({
              currentSubscription: currentContext.subscription,
              targetPlan,
              previousCurrentAssignment: currentContext.assignment || null,
              prorationBehavior: "none",
              billableEntityId: billableEntity.id,
              assignmentSource: "manual",
              assignmentMetadataJson: {
                changeKind: "downgrade_immediate",
                appliedByUserId: user?.id || null
              },
              now
            });
          } else {
            await applyProviderBackedDowngradeToFreeAssignment({
              currentSubscription: currentContext.subscription,
              targetPlan,
              previousCurrentAssignment: currentContext.assignment || null,
              billableEntityId: billableEntity.id,
              assignmentSource: "manual",
              assignmentMetadataJson: {
                changeKind: "downgrade_immediate",
                appliedByUserId: user?.id || null
              },
              targetEffectiveAt: now,
              now
            });
          }
        } else {
          await applyInternalPlanAssignment({
            billableEntityId: billableEntity.id,
            targetPlan,
            now,
            source: "manual",
            metadataJson: {
              changeKind: "downgrade_immediate",
              appliedByUserId: user?.id || null
            }
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
        await grantEntitlementsForPlanState({
          billableEntityId: billableEntity.id,
          now,
          request,
          user
        });

        return {
          mode: "applied",
          state: await buildPlanState({
            billableEntity,
            now
          })
        };
      }

      if (typeof billingRepository.replaceUpcomingPlanAssignmentForEntity !== "function") {
        throw new AppError(500, "Billing plan change scheduling is unavailable.");
      }

      if (currentContext.source === "subscription" && currentContext.subscription && !isPaidPlan(targetPlan)) {
        if (typeof providerAdapter.cancelSubscription !== "function") {
          throw new AppError(501, "Provider subscription cancellation is not available.");
        }

        const providerSubscription = await providerAdapter.cancelSubscription({
          subscriptionId: currentContext.subscription.providerSubscriptionId,
          cancelAtPeriodEnd: true
        });
        await syncCurrentAssignmentProviderDetailsFromProviderSubscription({
          currentContext,
          providerSubscription,
          now
        });
      }

      await billingRepository.replaceUpcomingPlanAssignmentForEntity({
        billableEntityId: billableEntity.id,
        fromPlanId: currentPlan?.id || null,
        targetPlanId: targetPlan.id,
        changeKind: "downgrade",
        effectiveAt,
        ...(isPaidPlan(targetPlan) ? {} : { periodEndAt: null }),
        requestedByUserId: user?.id || null,
        metadataJson: {
          changeKind: "downgrade",
          appliedByUserId: user?.id || null
        }
      });
      await billingRepository.insertPlanChangeHistory({
        billableEntityId: billableEntity.id,
        fromPlanId: currentPlan?.id || null,
        toPlanId: targetPlan.id,
        changeKind: "downgrade_scheduled",
        effectiveAt,
        appliedByUserId: user?.id || null
      });

      return {
        mode: "scheduled",
        state: await buildPlanState({
          billableEntity,
          now
        })
      };
    }

    if (typeof billingRepository.cancelUpcomingPlanAssignmentForEntity === "function") {
      await billingRepository.cancelUpcomingPlanAssignmentForEntity({
        billableEntityId: billableEntity.id,
        canceledByUserId: user?.id || null,
        metadataJson: {
          reason: "replaced_by_immediate_change"
        }
      });
    }

    if (currentContext.source === "subscription" && currentContext.subscription) {
      const policy = await resolvePaidPlanChangePolicy();
      if (direction === "upgrade" && isTargetPaid && policy === PAID_PLAN_CHANGE_POLICY_REQUIRED_NOW) {
        const hasDefaultPaymentMethod = await hasDefaultPaymentMethodForEntity(billableEntity.id);
        if (!hasDefaultPaymentMethod) {
          throw new AppError(409, "A default payment method is required before switching to a paid plan.", {
            code: "PAYMENT_METHOD_REQUIRED"
          });
        }
      }

      await applyProviderBackedPlanChangeToAssignment({
        currentSubscription: currentContext.subscription,
        targetPlan,
        previousCurrentAssignment: currentContext.assignment || null,
        prorationBehavior: "create_prorations",
        billableEntityId: billableEntity.id,
        assignmentSource: "manual",
        assignmentMetadataJson: {
          changeKind: direction === "upgrade" ? "upgrade_immediate" : "plan_change_immediate",
          appliedByUserId: user?.id || null
        },
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
      await grantEntitlementsForPlanState({
        billableEntityId: billableEntity.id,
        now,
        request,
        user
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
      source: "manual",
      metadataJson: {
        changeKind: "internal_immediate",
        appliedByUserId: user?.id || null
      }
    });
    await billingRepository.insertPlanChangeHistory({
      billableEntityId: billableEntity.id,
      fromPlanId: currentPlan?.id || null,
      toPlanId: targetPlan.id,
      changeKind: "internal_immediate",
      effectiveAt: now,
      appliedByUserId: user?.id || null
    });
    await grantEntitlementsForPlanState({
      billableEntityId: billableEntity.id,
      now,
      request,
      user
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

    const currentContext = await resolveCurrentPlanContext({
      billableEntityId: billableEntity.id,
      now
    });
    const upcomingContext = await resolveUpcomingPlanContext({
      billableEntityId: billableEntity.id
    });

    if (
      upcomingContext.assignment &&
      upcomingContext.plan &&
      !isPaidPlan(upcomingContext.plan) &&
      currentContext.source === "subscription" &&
      currentContext.subscription
    ) {
      if (typeof providerAdapter.setSubscriptionCancelAtPeriodEnd !== "function") {
        throw new AppError(501, "Provider renewal reinstatement is not available.");
      }

      const providerSubscription = await providerAdapter.setSubscriptionCancelAtPeriodEnd({
        subscriptionId: currentContext.subscription.providerSubscriptionId,
        cancelAtPeriodEnd: false
      });
      await syncCurrentAssignmentProviderDetailsFromProviderSubscription({
        currentContext,
        providerSubscription,
        now
      });
    }

    const canceled =
      typeof billingRepository.cancelUpcomingPlanAssignmentForEntity === "function"
        ? await billingRepository.cancelUpcomingPlanAssignmentForEntity({
            billableEntityId: billableEntity.id,
            canceledByUserId: user?.id || null,
            metadataJson: {
              reason: "user_canceled"
            }
          })
        : null;

    if (canceled) {
      await billingRepository.insertPlanChangeHistory({
        billableEntityId: billableEntity.id,
        fromPlanId: currentContext.plan?.id || null,
        toPlanId: canceled.planId,
        changeKind: "scheduled_change_canceled",
        effectiveAt: now,
        appliedByUserId: user?.id || null,
        metadataJson: {
          canceledAssignmentId: canceled.id
        }
      });
    }

    return {
      canceled: Boolean(canceled),
      state: await buildPlanState({
        billableEntity,
        now
      })
    };
  }

  async function processDuePlanChanges({ now = new Date(), limit = 50 } = {}) {
    if (typeof billingRepository.listDueUpcomingPlanAssignments !== "function") {
      return {
        scannedCount: 0,
        appliedCount: 0
      };
    }

    const dueAssignments = await billingRepository.listDueUpcomingPlanAssignments({
      periodStartAtOrBefore: now,
      limit
    });

    let appliedCount = 0;
    for (const assignment of dueAssignments) {
      try {
        const applied = await applyDuePlanChangeForEntity({
          billableEntityId: assignment.billableEntityId,
          now
        });
        if (applied) {
          appliedCount += 1;
        }
      } catch {
        // Best effort processing; failed upcoming assignments remain for the next worker tick.
      }
    }

    return {
      scannedCount: dueAssignments.length,
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
    let changedCodes = [];
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
      const grantOutcome = await grantEntitlementsForPlanState({
        billableEntityId: billableEntity.id,
        now,
        trx,
        publish: false
      });
      changedCodes = Array.isArray(grantOutcome?.changedCodes) ? grantOutcome.changedCodes : [];

      if (
        Number(fallbackPlan.id) !== Number(promoPlan.id) &&
        typeof billingRepository.replaceUpcomingPlanAssignmentForEntity === "function"
      ) {
        await billingRepository.replaceUpcomingPlanAssignmentForEntity(
          {
            billableEntityId: billableEntity.id,
            fromPlanId: promoPlan.id,
            targetPlanId: fallbackPlan.id,
            changeKind: "promo_fallback",
            effectiveAt: promoEndsAt,
            ...(isPaidPlan(fallbackPlan) ? {} : { periodEndAt: null }),
            requestedByUserId: null,
            metadataJson: {
              reason: "signup_promo_fallback"
            }
          },
          { trx }
        );
      }
    });

    await publishBillingLimitRealtime({
      billableEntityId: billableEntity.id,
      changedCodes,
      changeSource: "plan_grant",
      changedAt: now
    });

    return {
      billableEntityId: billableEntity.id,
      promoPlanCode: promoPlan.code,
      fallbackPlanCode: fallbackPlan.code,
      promoEndsAt: promoEndsAt.toISOString()
    };
  }

  function buildCapacityLockedError({
    limitationCode,
    used,
    cap,
    requestedAmount = 1,
    lockState = "projects_locked_over_cap"
  }) {
    const normalizedUsed = Math.max(0, Number(used || 0));
    const normalizedCap = Math.max(0, Number(cap || 0));
    const normalizedRequestedAmount = Math.max(1, Number(requestedAmount || 1));
    const projectedUsed = normalizedUsed + normalizedRequestedAmount;

    throw new AppError(409, "Billing capacity is locked.", {
      code: "BILLING_CAPACITY_LOCKED",
      details: {
        code: "BILLING_CAPACITY_LOCKED",
        limitationCode: toNonEmptyString(limitationCode),
        used: normalizedUsed,
        cap: normalizedCap,
        overBy: Math.max(0, projectedUsed - normalizedCap),
        lockState: toNonEmptyString(lockState) || null,
        requiredReduction: Math.max(0, projectedUsed - normalizedCap)
      }
    });
  }

  function resolveNormalizedChangeSource(value, fallback = "manual_refresh") {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();
    if (
      normalized === "purchase_grant" ||
      normalized === "plan_grant" ||
      normalized === "consumption" ||
      normalized === "boundary_recompute" ||
      normalized === "manual_refresh"
    ) {
      return normalized;
    }
    return fallback;
  }

  function mapPlanTemplateGrantKindToGrantKind(templateGrantKind) {
    const normalized = String(templateGrantKind || "plan_base")
      .trim()
      .toLowerCase();
    if (normalized === "plan_base") {
      return "plan_base";
    }
    if (normalized === "plan_bonus") {
      return "promo";
    }
    return "plan_base";
  }

  function resolvePlanTemplateExpiresAt(template, assignment, effectiveAt) {
    const durationPolicy = String(template?.durationPolicy || "while_current")
      .trim()
      .toLowerCase();
    const assignmentEnd = toDateOrNull(assignment?.periodEndAt);
    if (durationPolicy === "while_current" || durationPolicy === "period_window") {
      return assignmentEnd;
    }
    if (durationPolicy === "fixed_duration") {
      const durationDays = toPositiveInteger(template?.durationDays);
      if (!durationDays) {
        throw new AppError(500, "Plan entitlement template fixed_duration requires durationDays.");
      }
      return addUtcDays(effectiveAt, durationDays);
    }
    return assignmentEnd;
  }

  function mapProductTemplateGrantKindToGrantKind(templateGrantKind) {
    const normalized = String(templateGrantKind || "one_off_topup")
      .trim()
      .toLowerCase();
    if (normalized === "timeboxed_addon") {
      return "addon_timeboxed";
    }
    return "topup";
  }

  function resolveProductTemplateExpiresAt(template, effectiveAt) {
    const grantKind = String(template?.grantKind || "one_off_topup")
      .trim()
      .toLowerCase();
    if (grantKind === "timeboxed_addon") {
      const durationDays = toPositiveInteger(template?.durationDays);
      if (!durationDays) {
        throw new AppError(500, "Product entitlement template timeboxed_addon requires durationDays.");
      }
      return addUtcDays(effectiveAt, durationDays);
    }
    return null;
  }

  function hasMaterialBalanceChange(previousBalance, nextBalance) {
    if (!previousBalance && nextBalance) {
      return true;
    }
    if (previousBalance && !nextBalance) {
      return true;
    }
    if (!previousBalance && !nextBalance) {
      return false;
    }

    const comparableKeys = [
      "grantedAmount",
      "consumedAmount",
      "effectiveAmount",
      "hardLimitAmount",
      "overLimit",
      "lockState",
      "nextChangeAt"
    ];
    return comparableKeys.some((key) => {
      const left = previousBalance?.[key] == null ? null : previousBalance[key];
      const right = nextBalance?.[key] == null ? null : nextBalance[key];
      return String(left) !== String(right);
    });
  }

  async function publishBillingLimitRealtime({
    billableEntityId,
    changedCodes = [],
    changeSource = "manual_refresh",
    changedAt = new Date(),
    request = null,
    user = null
  } = {}) {
    if (!Array.isArray(changedCodes) || changedCodes.length < 1) {
      return;
    }
    if (!billingRealtimePublishService || typeof billingRealtimePublishService.publishWorkspaceBillingLimitsUpdated !== "function") {
      return;
    }

    await billingRealtimePublishService.publishWorkspaceBillingLimitsUpdated({
      billableEntityId,
      changedCodes,
      changeSource: resolveNormalizedChangeSource(changeSource),
      changedAt,
      commandId: request?.headers?.["x-command-id"] || null,
      sourceClientId: request?.headers?.["x-client-id"] || null,
      actorUserId: user?.id || null
    });
  }

  async function resolveEffectiveLimitations({
    billableEntityId,
    limitationCodes = null,
    now = new Date(),
    capacityResolvers = {},
    trx = null
  } = {}) {
    const normalizedBillableEntityId = toPositiveInteger(billableEntityId);
    if (!normalizedBillableEntityId) {
      throw new AppError(400, "Billable entity id is required.");
    }

    const normalizedNow = now instanceof Date ? now : new Date(now);
    const normalizedCodes =
      Array.isArray(limitationCodes) && limitationCodes.length > 0
        ? [...new Set(limitationCodes.map((entry) => String(entry || "").trim()).filter(Boolean))]
        : null;
    const definitions = await billingRepository.listEntitlementDefinitions(
      {
        includeInactive: false,
        codes: normalizedCodes
      },
      trx ? { trx } : {}
    );

    const entries = [];
    for (const definition of definitions) {
      const capacityResolver = capacityResolvers?.[definition.code];
      const previous = await billingRepository.findEntitlementBalance(
        {
          subjectType: "billable_entity",
          subjectId: normalizedBillableEntityId,
          entitlementDefinitionId: definition.id
        },
        trx ? { trx } : {}
      );
      const recomputed = await billingRepository.recomputeEntitlementBalance(
        {
          subjectType: "billable_entity",
          subjectId: normalizedBillableEntityId,
          entitlementDefinitionId: definition.id,
          now: normalizedNow,
          capacityConsumedAmountResolver: capacityResolver
        },
        trx ? { trx } : {}
      );
      const balance = recomputed?.balance || null;
      if (!balance) {
        continue;
      }

      entries.push({
        code: String(definition.code || ""),
        entitlementType: String(definition.entitlementType || ""),
        enforcementMode: String(definition.enforcementMode || "hard_deny"),
        unit: String(definition.unit || ""),
        windowInterval: definition.windowInterval || null,
        windowAnchor: definition.windowAnchor || null,
        grantedAmount: Number(balance.grantedAmount || 0),
        consumedAmount: Number(balance.consumedAmount || 0),
        effectiveAmount: Number(balance.effectiveAmount || 0),
        hardLimitAmount: balance.hardLimitAmount == null ? null : Number(balance.hardLimitAmount),
        overLimit: Boolean(balance.overLimit),
        lockState: balance.lockState || null,
        nextChangeAt: balance.nextChangeAt || null,
        windowStartAt: balance.windowStartAt,
        windowEndAt: balance.windowEndAt,
        lastRecomputedAt: balance.lastRecomputedAt,
        _previous: previous
      });
    }

    return {
      billableEntityId: normalizedBillableEntityId,
      generatedAt: normalizedNow.toISOString(),
      stale: false,
      limitations: entries
    };
  }

  async function grantEntitlementsForPlanState({
    billableEntityId,
    planAssignmentId = null,
    now = new Date(),
    trx = null,
    publish = true,
    request = null,
    user = null
  } = {}) {
    const normalizedBillableEntityId = toPositiveInteger(billableEntityId);
    if (!normalizedBillableEntityId) {
      throw new AppError(400, "Billable entity id is required.");
    }
    const normalizedNow = now instanceof Date ? now : new Date(now);

    const run = async (trxHandle) => {
      const assignmentReadOptions = {
        trx: trxHandle,
        forUpdate: true
      };
      let assignment = null;
      const normalizedAssignmentId = toPositiveInteger(planAssignmentId);
      if (normalizedAssignmentId && typeof billingRepository.findPlanAssignmentById === "function") {
        assignment = await billingRepository.findPlanAssignmentById(normalizedAssignmentId, assignmentReadOptions);
      }
      if (!assignment && typeof billingRepository.findCurrentPlanAssignmentForEntity === "function") {
        assignment = await billingRepository.findCurrentPlanAssignmentForEntity(
          normalizedBillableEntityId,
          assignmentReadOptions
        );
      }
      if (!assignment || String(assignment.status || "").toLowerCase() !== "current") {
        return {
          changedCodes: []
        };
      }

      const plan = await billingRepository.findPlanById(assignment.planId, { trx: trxHandle });
      if (!plan || plan.isActive === false) {
        return {
          changedCodes: []
        };
      }

      const templates = await billingRepository.listPlanEntitlementTemplates(plan.id, { trx: trxHandle });
      if (!Array.isArray(templates) || templates.length < 1) {
        return {
          changedCodes: []
        };
      }

      const changedCodes = new Set();
      for (const template of templates) {
        const entitlementDefinitionId = toPositiveInteger(template?.entitlementDefinitionId);
        if (!entitlementDefinitionId) {
          continue;
        }
        const definition = await billingRepository.findEntitlementDefinitionById(entitlementDefinitionId, { trx: trxHandle });
        if (!definition || definition.isActive === false) {
          continue;
        }

        const effectiveAt = toDateOrNull(assignment.periodStartAt) || normalizedNow;
        const expiresAt = resolvePlanTemplateExpiresAt(template, assignment, effectiveAt);
        if (expiresAt && expiresAt.getTime() <= effectiveAt.getTime()) {
          throw new AppError(500, "Plan entitlement template resolved invalid grant window.");
        }

        const dedupeKey =
          `plan_assignment:${Number(assignment.id)}:` +
          `template:${Number(template.id)}:` +
          `subject:${normalizedBillableEntityId}`;
        await billingRepository.insertEntitlementGrant(
          {
            subjectType: "billable_entity",
            subjectId: normalizedBillableEntityId,
            entitlementDefinitionId,
            amount: Number(template.amount || 0),
            kind: mapPlanTemplateGrantKindToGrantKind(template.grantKind),
            effectiveAt,
            expiresAt,
            sourceType: "plan_assignment",
            sourceId: Number(assignment.id),
            operationKey: null,
            provider: null,
            providerEventId: null,
            dedupeKey,
            metadataJson: {
              assignmentId: Number(assignment.id),
              planId: Number(plan.id),
              templateId: Number(template.id)
            }
          },
          { trx: trxHandle }
        );

        const previous = await billingRepository.findEntitlementBalance(
          {
            subjectType: "billable_entity",
            subjectId: normalizedBillableEntityId,
            entitlementDefinitionId
          },
          { trx: trxHandle }
        );
        const recomputed = await billingRepository.recomputeEntitlementBalance(
          {
            subjectType: "billable_entity",
            subjectId: normalizedBillableEntityId,
            entitlementDefinitionId,
            now: normalizedNow
          },
          { trx: trxHandle }
        );
        if (hasMaterialBalanceChange(previous, recomputed?.balance || null)) {
          changedCodes.add(String(definition.code || ""));
        }
      }

      return {
        changedCodes: [...changedCodes].filter(Boolean)
      };
    };

    const outcome =
      trx && typeof trx === "object"
        ? await run(trx)
        : await billingRepository.transaction(async (tx) => run(tx));

    if (publish && outcome.changedCodes.length > 0) {
      await publishBillingLimitRealtime({
        billableEntityId: normalizedBillableEntityId,
        changedCodes: outcome.changedCodes,
        changeSource: "plan_grant",
        changedAt: normalizedNow,
        request,
        user
      });
    }

    return {
      billableEntityId: normalizedBillableEntityId,
      changedCodes: outcome.changedCodes
    };
  }

  async function grantEntitlementsForPurchase({
    billableEntityId = null,
    purchase = null,
    now = new Date(),
    trx = null,
    publish = true,
    request = null,
    user = null
  } = {}) {
    const normalizedNow = now instanceof Date ? now : new Date(now);
    const purchaseRow = purchase && typeof purchase === "object" ? purchase : null;
    const normalizedBillableEntityId = toPositiveInteger(billableEntityId || purchaseRow?.billableEntityId);
    if (!normalizedBillableEntityId) {
      throw new AppError(400, "Billable entity id is required for purchase entitlement grants.");
    }
    if (!purchaseRow || !toPositiveInteger(purchaseRow.id)) {
      return {
        billableEntityId: normalizedBillableEntityId,
        changedCodes: []
      };
    }

    const run = async (trxHandle) => {
      const purchaseMetadata = purchaseRow.metadataJson && typeof purchaseRow.metadataJson === "object"
        ? purchaseRow.metadataJson
        : {};
      const explicitProductId = toPositiveInteger(purchaseMetadata.billingProductId || purchaseMetadata.productId);
      let product = explicitProductId ? await billingRepository.findProductById(explicitProductId, { trx: trxHandle }) : null;
      if (!product) {
        const providerPriceId = toNonEmptyString(
          purchaseMetadata.providerPriceId || purchaseMetadata.provider_price_id || purchaseMetadata.priceId
        );
        if (providerPriceId && typeof billingRepository.listProducts === "function") {
          const products = await billingRepository.listProducts({ trx: trxHandle });
          const provider = String(purchaseRow.provider || "").trim().toLowerCase();
          product =
            products.find((entry) => {
              const price = entry?.price && typeof entry.price === "object" ? entry.price : null;
              if (!price) {
                return false;
              }
              return (
                String(price.provider || "")
                  .trim()
                  .toLowerCase() === provider && String(price.providerPriceId || "").trim() === providerPriceId
              );
            }) || null;
        }
      }
      if (!product) {
        return {
          changedCodes: []
        };
      }

      const templates = await billingRepository.listProductEntitlementTemplates(product.id, { trx: trxHandle });
      if (!Array.isArray(templates) || templates.length < 1) {
        return {
          changedCodes: []
        };
      }

      const changedCodes = new Set();
      for (const template of templates) {
        const entitlementDefinitionId = toPositiveInteger(template?.entitlementDefinitionId);
        if (!entitlementDefinitionId) {
          continue;
        }
        const definition = await billingRepository.findEntitlementDefinitionById(entitlementDefinitionId, { trx: trxHandle });
        if (!definition || definition.isActive === false) {
          continue;
        }

        const effectiveAt = toDateOrNull(purchaseRow.purchasedAt) || normalizedNow;
        const expiresAt = resolveProductTemplateExpiresAt(template, effectiveAt);
        if (expiresAt && expiresAt.getTime() <= effectiveAt.getTime()) {
          throw new AppError(500, "Product entitlement template resolved invalid grant window.");
        }

        const dedupeKey = `purchase:${Number(purchaseRow.id)}:template:${Number(template.id)}:subject:${normalizedBillableEntityId}`;
        await billingRepository.insertEntitlementGrant(
          {
            subjectType: "billable_entity",
            subjectId: normalizedBillableEntityId,
            entitlementDefinitionId,
            amount: Number(template.amount || 0),
            kind: mapProductTemplateGrantKindToGrantKind(template.grantKind),
            effectiveAt,
            expiresAt,
            sourceType: "billing_purchase",
            sourceId: Number(purchaseRow.id),
            operationKey: toNonEmptyString(purchaseRow.operationKey) || null,
            provider: toNonEmptyString(purchaseRow.provider) || null,
            providerEventId: toNonEmptyString(
              purchaseMetadata.providerEventId || purchaseMetadata.provider_event_id
            ) || null,
            dedupeKey,
            metadataJson: {
              purchaseId: Number(purchaseRow.id),
              productId: Number(product.id),
              templateId: Number(template.id)
            }
          },
          { trx: trxHandle }
        );

        const previous = await billingRepository.findEntitlementBalance(
          {
            subjectType: "billable_entity",
            subjectId: normalizedBillableEntityId,
            entitlementDefinitionId
          },
          { trx: trxHandle }
        );
        const recomputed = await billingRepository.recomputeEntitlementBalance(
          {
            subjectType: "billable_entity",
            subjectId: normalizedBillableEntityId,
            entitlementDefinitionId,
            now: normalizedNow
          },
          { trx: trxHandle }
        );
        if (hasMaterialBalanceChange(previous, recomputed?.balance || null)) {
          changedCodes.add(String(definition.code || ""));
        }
      }

      return {
        changedCodes: [...changedCodes].filter(Boolean)
      };
    };

    const outcome =
      trx && typeof trx === "object"
        ? await run(trx)
        : await billingRepository.transaction(async (tx) => run(tx));

    if (publish && outcome.changedCodes.length > 0) {
      await publishBillingLimitRealtime({
        billableEntityId: normalizedBillableEntityId,
        changedCodes: outcome.changedCodes,
        changeSource: "purchase_grant",
        changedAt: normalizedNow,
        request,
        user
      });
    }

    return {
      billableEntityId: normalizedBillableEntityId,
      changedCodes: outcome.changedCodes
    };
  }

  async function refreshDueLimitationsForSubject({
    billableEntityId,
    entitlementDefinitionIds = null,
    limitationCodes = null,
    now = new Date(),
    changeSource = "boundary_recompute",
    publish = true,
    request = null,
    user = null,
    trx = null
  } = {}) {
    const normalizedBillableEntityId = toPositiveInteger(billableEntityId);
    if (!normalizedBillableEntityId) {
      throw new AppError(400, "Billable entity id is required.");
    }
    const normalizedNow = now instanceof Date ? now : new Date(now);
    const explicitDefinitionIds = Array.isArray(entitlementDefinitionIds)
      ? entitlementDefinitionIds.map((entry) => toPositiveInteger(entry)).filter(Boolean)
      : [];
    const explicitCodes = Array.isArray(limitationCodes)
      ? [...new Set(limitationCodes.map((entry) => String(entry || "").trim()).filter(Boolean))]
      : [];

    const run = async (trxHandle) => {
      let scopedDefinitionIds = [...explicitDefinitionIds];
      if (scopedDefinitionIds.length < 1 && explicitCodes.length > 0) {
        const definitions = await billingRepository.listEntitlementDefinitions(
          {
            includeInactive: false,
            codes: explicitCodes
          },
          { trx: trxHandle }
        );
        scopedDefinitionIds = definitions.map((entry) => toPositiveInteger(entry.id)).filter(Boolean);
      }
      const forceSelectedDefinitions = scopedDefinitionIds.length > 0;

      const balances = await billingRepository.listEntitlementBalancesForSubject(
        {
          subjectType: "billable_entity",
          subjectId: normalizedBillableEntityId,
          entitlementDefinitionIds: forceSelectedDefinitions ? scopedDefinitionIds : null
        },
        { trx: trxHandle }
      );

      const changedCodes = new Set();
      for (const balance of balances) {
        const definitionId = toPositiveInteger(balance?.entitlementDefinitionId);
        if (!definitionId) {
          continue;
        }
        const nextChangeAt = toDateOrNull(balance.nextChangeAt);
        if (!forceSelectedDefinitions && nextChangeAt && nextChangeAt.getTime() > normalizedNow.getTime()) {
          continue;
        }

        const definition = await billingRepository.findEntitlementDefinitionById(definitionId, { trx: trxHandle });
        if (!definition || definition.isActive === false) {
          continue;
        }

        const previous = await billingRepository.findEntitlementBalance(
          {
            subjectType: "billable_entity",
            subjectId: normalizedBillableEntityId,
            entitlementDefinitionId: definitionId,
            windowStartAt: balance.windowStartAt || null,
            windowEndAt: balance.windowEndAt || null
          },
          { trx: trxHandle }
        );
        const recomputed = await billingRepository.recomputeEntitlementBalance(
          {
            subjectType: "billable_entity",
            subjectId: normalizedBillableEntityId,
            entitlementDefinitionId: definitionId,
            windowStartAt: balance.windowStartAt || null,
            windowEndAt: balance.windowEndAt || null,
            now: normalizedNow
          },
          { trx: trxHandle }
        );
        if (hasMaterialBalanceChange(previous, recomputed?.balance || null)) {
          changedCodes.add(String(definition.code || ""));
        }
      }

      return {
        changedCodes: [...changedCodes].filter(Boolean)
      };
    };

    const outcome =
      trx && typeof trx === "object"
        ? await run(trx)
        : await billingRepository.transaction(async (tx) => run(tx));

    if (publish && outcome.changedCodes.length > 0) {
      await publishBillingLimitRealtime({
        billableEntityId: normalizedBillableEntityId,
        changedCodes: outcome.changedCodes,
        changeSource,
        changedAt: normalizedNow,
        request,
        user
      });
    }

    return {
      billableEntityId: normalizedBillableEntityId,
      changedCodes: outcome.changedCodes
    };
  }

  async function consumeEntitlement({
    billableEntityId,
    limitationCode,
    amount = 1,
    usageEventKey = "",
    operationKey = "",
    requestId = "",
    reasonCode = "",
    metadataJson = null,
    now = new Date(),
    trx = null
  } = {}) {
    const normalizedBillableEntityId = toPositiveInteger(billableEntityId);
    const normalizedLimitationCode = toNonEmptyString(limitationCode);
    const normalizedAmount = normalizeUsageAmount(amount);
    if (!normalizedBillableEntityId || !normalizedLimitationCode || !normalizedAmount) {
      throw new AppError(400, "consumeEntitlement requires billableEntityId, limitationCode, and amount.");
    }

    const definition = await billingRepository.findEntitlementDefinitionByCode(
      normalizedLimitationCode,
      trx ? { trx } : {}
    );
    if (!definition) {
      throw new AppError(409, "Billing limitation is not configured.", {
        code: BILLING_LIMIT_NOT_CONFIGURED_ERROR_CODE,
        details: {
          limitationCode: normalizedLimitationCode
        }
      });
    }

    const normalizedUsageEventKey = toNonEmptyString(usageEventKey);
    const normalizedOperationKey = toNonEmptyString(operationKey);
    const dedupeKey = normalizedUsageEventKey
      ? `usage:${normalizedBillableEntityId}:${definition.id}:${normalizedUsageEventKey}`
      : normalizedOperationKey
        ? `op:${normalizedBillableEntityId}:${definition.id}:${normalizedOperationKey}:${toNonEmptyString(reasonCode)}`
        : `req:${normalizedBillableEntityId}:${definition.id}:${toNonEmptyString(requestId)}:${toNonEmptyString(reasonCode)}`;

    const consumption = await billingRepository.insertEntitlementConsumption(
      {
        subjectType: "billable_entity",
        subjectId: normalizedBillableEntityId,
        entitlementDefinitionId: definition.id,
        amount: normalizedAmount,
        occurredAt: now,
        reasonCode: toNonEmptyString(reasonCode) || "usage",
        operationKey: normalizedOperationKey || null,
        usageEventKey: normalizedUsageEventKey || null,
        requestId: toNonEmptyString(requestId) || null,
        dedupeKey,
        metadataJson
      },
      trx ? { trx } : {}
    );

    const recomputed = await billingRepository.recomputeEntitlementBalance(
      {
        subjectType: "billable_entity",
        subjectId: normalizedBillableEntityId,
        entitlementDefinitionId: definition.id,
        now
      },
      trx ? { trx } : {}
    );

    return {
      inserted: Boolean(consumption?.inserted),
      definition,
      balance: recomputed?.balance || null,
      consumption: consumption?.consumption || null
    };
  }

  async function executeWithEntitlementConsumption({
    request,
    user,
    capability = "",
    limitationCode = "",
    amount = null,
    usageEventKey = "",
    operationKey = "",
    requestId = "",
    metadataJson = null,
    now = new Date(),
    access = "write",
    capacityResolvers = {},
    action
  } = {}) {
    if (typeof action !== "function") {
      throw new Error("executeWithEntitlementConsumption requires an action callback.");
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
    const normalizedAmount = normalizeUsageAmount(amount == null ? capabilityConfig?.usageAmount ?? 1 : amount);
    if (!normalizedAmount) {
      throw new AppError(400, "Usage amount must be a positive integer.");
    }

    if (!resolvedLimitationCode) {
      return action({
        billableEntity,
        limitationCode: null,
        capability: toNonEmptyString(capability),
        now,
        trx: null
      });
    }

    let actionResult = null;
    let postCommitChangeSource = "manual_refresh";
    let changedCodes = [];

    await billingRepository.transaction(async (trx) => {
      const effective = await resolveEffectiveLimitations({
        billableEntityId,
        limitationCodes: [resolvedLimitationCode],
        now,
        capacityResolvers,
        trx
      });
      const limitation = effective.limitations.find((entry) => entry.code === resolvedLimitationCode) || null;
      if (!limitation) {
        throw new AppError(409, "Billing limitation is not configured.", {
          code: BILLING_LIMIT_NOT_CONFIGURED_ERROR_CODE,
          details: {
            limitationCode: resolvedLimitationCode,
            billableEntityId
          }
        });
      }

      if (limitation.entitlementType === "capacity") {
        const cap = limitation.hardLimitAmount == null ? 0 : Number(limitation.hardLimitAmount);
        const used = Number(limitation.consumedAmount || 0);
        if (used + normalizedAmount > cap) {
          buildCapacityLockedError({
            limitationCode: resolvedLimitationCode,
            used,
            cap,
            requestedAmount: normalizedAmount,
            lockState: limitation.lockState
          });
        }
      } else if (limitation.entitlementType === "metered_quota" || limitation.entitlementType === "balance") {
        if (Number(limitation.effectiveAmount || 0) < normalizedAmount) {
          buildLimitExceededError({
            limitationCode: resolvedLimitationCode,
            billableEntityId,
            requestedAmount: normalizedAmount,
            limit: limitation.hardLimitAmount,
            used: limitation.consumedAmount,
            remaining: Math.max(0, Number(limitation.effectiveAmount || 0)),
            interval: limitation.windowInterval,
            enforcement: limitation.enforcementMode,
            windowEndAt: limitation.windowEndAt ? new Date(limitation.windowEndAt) : null,
            reason: "quota_exceeded"
          });
        }
      }

      actionResult = await action({
        trx,
        billableEntity,
        limitationCode: resolvedLimitationCode,
        capability: toNonEmptyString(capability),
        limitation,
        now
      });

      if (limitation.entitlementType === "metered_quota" || limitation.entitlementType === "balance") {
        await consumeEntitlement({
          billableEntityId,
          limitationCode: resolvedLimitationCode,
          amount: normalizedAmount,
          usageEventKey,
          operationKey,
          requestId,
          reasonCode: capabilityConfig?.reasonCode || toNonEmptyString(capability) || "usage",
          metadataJson,
          now,
          trx
        });
        postCommitChangeSource = "consumption";
      } else {
        await resolveEffectiveLimitations({
          billableEntityId,
          limitationCodes: [resolvedLimitationCode],
          now,
          capacityResolvers,
          trx
        });
        postCommitChangeSource = "manual_refresh";
      }

      changedCodes = [resolvedLimitationCode];
    });

    await publishBillingLimitRealtime({
      billableEntityId,
      changedCodes,
      changeSource: resolveNormalizedChangeSource(postCommitChangeSource, "consumption"),
      changedAt: now,
      request,
      user
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
    const resolved = await resolveEffectiveLimitations({
      billableEntityId: billableEntity.id,
      now
    });

    return {
      billableEntity,
      generatedAt: resolved.generatedAt,
      stale: resolved.stale,
      limitations: resolved.limitations.map((entry) => ({
        code: entry.code,
        entitlementType: entry.entitlementType,
        enforcementMode: entry.enforcementMode,
        unit: entry.unit,
        windowInterval: entry.windowInterval,
        windowAnchor: entry.windowAnchor,
        grantedAmount: entry.grantedAmount,
        consumedAmount: entry.consumedAmount,
        effectiveAmount: entry.effectiveAmount,
        hardLimitAmount: entry.hardLimitAmount,
        overLimit: entry.overLimit,
        lockState: entry.lockState,
        nextChangeAt: entry.nextChangeAt,
        windowStartAt: entry.windowStartAt,
        windowEndAt: entry.windowEndAt,
        lastRecomputedAt: entry.lastRecomputedAt
      }))
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

  function buildPaymentLinkResponseJson({ paymentLink, billableEntityId, operationKey, customerEmail = "" }) {
    const paymentLinkUrl = buildPaymentLinkUrlWithEmailPrefill({
      provider: activeProvider,
      paymentLinkUrl: paymentLink?.url,
      customerEmail
    });
    return {
      provider: activeProvider,
      billableEntityId: Number(billableEntityId),
      operationKey: String(operationKey || ""),
      paymentLink: {
        id: String(paymentLink?.id || ""),
        url: paymentLinkUrl,
        active: Boolean(paymentLink?.active !== false)
      }
    };
  }

  async function assertPaymentLinkCatalogLineItemsAllowed({ normalizedRequest }) {
    const lineItems = Array.isArray(normalizedRequest?.lineItems) ? normalizedRequest.lineItems : [];
    const priceLineItems = [];
    for (let index = 0; index < lineItems.length; index += 1) {
      const lineItem = lineItems[index];
      if (lineItem?.type !== "price") {
        continue;
      }
      priceLineItems.push({
        index,
        priceId: toNonEmptyString(lineItem.priceId)
      });
    }

    if (priceLineItems.length < 1) {
      return;
    }
    if (typeof billingRepository.listProducts !== "function") {
      throw new AppError(500, "Billing product catalog storage is unavailable.");
    }

    const products = await billingRepository.listProducts();
    const productByPriceId = new Map();
    for (const product of Array.isArray(products) ? products : []) {
      if (!product || product.isActive === false) {
        continue;
      }
      const price = product.price && typeof product.price === "object" ? product.price : null;
      const providerPriceId = toNonEmptyString(price?.providerPriceId);
      if (!price || !providerPriceId) {
        continue;
      }
      productByPriceId.set(providerPriceId, {
        product,
        price
      });
    }

    for (const lineItem of priceLineItems) {
      const catalogEntry = productByPriceId.get(lineItem.priceId);
      if (!catalogEntry) {
        throw new AppError(400, "Validation failed.", {
          details: {
            fieldErrors: {
              [`lineItems[${lineItem.index}].priceId`]:
                "lineItems priceId must reference an active one-off billing product."
            }
          }
        });
      }

      const interval = toNonEmptyString(catalogEntry.price?.interval).toLowerCase();
      if (interval) {
        throw new AppError(400, "Validation failed.", {
          details: {
            fieldErrors: {
              [`lineItems[${lineItem.index}].priceId`]:
                "Recurring prices are not allowed in one-off purchases."
            }
          }
        });
      }
    }
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
      operationKey: recoveryRow.operationKey,
      customerEmail: recoveryRow.normalizedRequestJson?.customerEmail
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
      defaultCurrency: deploymentCurrency,
      customerEmail: user?.email
    });
    await assertPaymentLinkCatalogLineItemsAllowed({
      normalizedRequest
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
      operationKey: idempotencyRow.operationKey,
      customerEmail: normalizedRequest.customerEmail
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
    listProducts,
    listPurchases,
    getPlanState,
    requestPlanChange,
    cancelPendingPlanChange,
    processDuePlanChanges,
    listPaymentMethods,
    syncPaymentMethods,
    getLimitations,
    resolveEffectiveLimitations,
    consumeEntitlement,
    executeWithEntitlementConsumption,
    grantEntitlementsForPurchase,
    grantEntitlementsForPlanState,
    refreshDueLimitationsForSubject,
    listTimeline,
    createPortalSession,
    createPaymentLink,
    startCheckout
  };
}

export { createService };
