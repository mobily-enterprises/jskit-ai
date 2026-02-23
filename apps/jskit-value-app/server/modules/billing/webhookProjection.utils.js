import { AppError } from "../../lib/errors.js";
import {
  BILLING_CHECKOUT_SESSION_STATUS,
  BILLING_DEFAULT_PROVIDER,
  BILLING_SUBSCRIPTION_STATUS,
  NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET
} from "./constants.js";

const CHECKOUT_CORRELATION_ERROR_CODE = "CHECKOUT_SESSION_CORRELATION_MISMATCH";

function parseUnixEpochSeconds(value) {
  if (value == null) {
    return null;
  }
  if (typeof value === "string" && String(value).trim() === "") {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return new Date(parsed * 1000);
}

function toSafeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return {};
  }

  const next = {};
  for (const [key, value] of Object.entries(metadata)) {
    next[String(key)] = String(value == null ? "" : value);
  }
  return next;
}

function toNullableString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toPositiveInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function toInvoiceLineItems(invoice) {
  return Array.isArray(invoice?.lines?.data) ? invoice.lines.data : [];
}

function resolveInvoiceSubscriptionId(invoice) {
  const parentSubscriptionId = toNullableString(invoice?.parent?.subscription_details?.subscription);
  if (parentSubscriptionId) {
    return parentSubscriptionId;
  }

  for (const lineItem of toInvoiceLineItems(invoice)) {
    const lineParentSubscriptionId = toNullableString(lineItem?.parent?.subscription_item_details?.subscription);
    if (lineParentSubscriptionId) {
      return lineParentSubscriptionId;
    }
  }

  const topLevelSubscriptionId = toNullableString(invoice?.subscription);
  if (topLevelSubscriptionId) {
    return topLevelSubscriptionId;
  }

  for (const lineItem of toInvoiceLineItems(invoice)) {
    const lineSubscriptionId = toNullableString(lineItem?.subscription);
    if (lineSubscriptionId) {
      return lineSubscriptionId;
    }
  }

  return null;
}

function resolveInvoicePrimaryPriceId(invoice) {
  for (const lineItem of toInvoiceLineItems(invoice)) {
    const pricingPriceId = toNullableString(lineItem?.pricing?.price_details?.price);
    if (pricingPriceId) {
      return pricingPriceId;
    }

    const linePriceId = toNullableString(lineItem?.price?.id);
    if (linePriceId) {
      return linePriceId;
    }

    const linePlanId = toNullableString(lineItem?.plan?.id);
    if (linePlanId) {
      return linePlanId;
    }
  }

  return null;
}

function resolveInvoicePrimaryLineDescription(invoice) {
  for (const lineItem of toInvoiceLineItems(invoice)) {
    const description = toNullableString(lineItem?.description);
    if (description) {
      return description;
    }
  }

  return null;
}

function normalizeProviderSubscriptionStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (
    normalized === BILLING_SUBSCRIPTION_STATUS.INCOMPLETE ||
    normalized === BILLING_SUBSCRIPTION_STATUS.TRIALING ||
    normalized === BILLING_SUBSCRIPTION_STATUS.ACTIVE ||
    normalized === BILLING_SUBSCRIPTION_STATUS.PAST_DUE ||
    normalized === BILLING_SUBSCRIPTION_STATUS.PAUSED ||
    normalized === BILLING_SUBSCRIPTION_STATUS.UNPAID ||
    normalized === BILLING_SUBSCRIPTION_STATUS.CANCELED ||
    normalized === BILLING_SUBSCRIPTION_STATUS.INCOMPLETE_EXPIRED
  ) {
    return normalized;
  }

  if (normalized === "ended") {
    return BILLING_SUBSCRIPTION_STATUS.CANCELED;
  }

  return BILLING_SUBSCRIPTION_STATUS.INCOMPLETE;
}

function isSubscriptionStatusCurrent(status) {
  return NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET.has(String(status || "").trim());
}

function sortDuplicateCandidatesForCanonicalSelection(candidates) {
  return [...candidates].sort((left, right) => {
    const leftCreatedAt = left.providerSubscriptionCreatedAt
      ? new Date(left.providerSubscriptionCreatedAt).getTime()
      : Number.MAX_SAFE_INTEGER;
    const rightCreatedAt = right.providerSubscriptionCreatedAt
      ? new Date(right.providerSubscriptionCreatedAt).getTime()
      : Number.MAX_SAFE_INTEGER;

    if (leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }

    return String(left.providerSubscriptionId || "").localeCompare(String(right.providerSubscriptionId || ""));
  });
}

function isIncomingEventOlder(
  existingLastProviderEventCreatedAt,
  incomingProviderCreatedAt,
  { existingProviderEventId = null, incomingProviderEventId = null } = {}
) {
  if (!existingLastProviderEventCreatedAt) {
    return false;
  }

  const existingMs = new Date(existingLastProviderEventCreatedAt).getTime();
  const incomingMs = new Date(incomingProviderCreatedAt).getTime();
  if (!Number.isFinite(existingMs) || !Number.isFinite(incomingMs)) {
    return false;
  }

  if (incomingMs < existingMs) {
    return true;
  }

  if (incomingMs > existingMs) {
    return false;
  }

  const existingId = String(existingProviderEventId || "").trim();
  const incomingId = String(incomingProviderEventId || "").trim();
  if (!existingId || !incomingId) {
    return false;
  }

  return incomingId.localeCompare(existingId) <= 0;
}

function hasSameTimestampOrderingConflict(
  existingLastProviderEventCreatedAt,
  incomingProviderCreatedAt,
  { existingProviderEventId = null, incomingProviderEventId = null } = {}
) {
  if (!existingLastProviderEventCreatedAt) {
    return false;
  }

  const existingMs = new Date(existingLastProviderEventCreatedAt).getTime();
  const incomingMs = new Date(incomingProviderCreatedAt).getTime();
  if (!Number.isFinite(existingMs) || !Number.isFinite(incomingMs)) {
    return false;
  }

  if (incomingMs !== existingMs) {
    return false;
  }

  const existingId = String(existingProviderEventId || "").trim();
  const incomingId = String(incomingProviderEventId || "").trim();
  if (!existingId || !incomingId || incomingId === existingId) {
    return false;
  }

  return incomingId.localeCompare(existingId) <= 0;
}

function mapProviderCheckoutStatusToLocal(providerStatus) {
  const normalizedStatus = String(providerStatus || "")
    .trim()
    .toLowerCase();
  if (normalizedStatus === "complete") {
    return BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION;
  }
  if (normalizedStatus === "expired") {
    return BILLING_CHECKOUT_SESSION_STATUS.EXPIRED;
  }
  return BILLING_CHECKOUT_SESSION_STATUS.OPEN;
}

function buildCheckoutCorrelationError(message) {
  return new AppError(409, message, {
    code: CHECKOUT_CORRELATION_ERROR_CODE,
    details: {
      code: CHECKOUT_CORRELATION_ERROR_CODE
    }
  });
}

function buildCheckoutResponseJson({ session, billableEntityId, operationKey, provider = BILLING_DEFAULT_PROVIDER }) {
  const expiresAtDate = parseUnixEpochSeconds(session?.expires_at);

  return {
    provider: String(provider || BILLING_DEFAULT_PROVIDER).trim().toLowerCase() || BILLING_DEFAULT_PROVIDER,
    billableEntityId: Number(billableEntityId),
    operationKey: String(operationKey || ""),
    checkoutSession: {
      providerCheckoutSessionId: toNullableString(session?.id),
      status: mapProviderCheckoutStatusToLocal(session?.status),
      providerStatus: String(session?.status || ""),
      checkoutUrl: toNullableString(session?.url),
      expiresAt: expiresAtDate ? expiresAtDate.toISOString() : null,
      customerId: toNullableString(session?.customer),
      subscriptionId: toNullableString(session?.subscription)
    }
  };
}

const __testables = {
  parseUnixEpochSeconds,
  toSafeMetadata,
  toNullableString,
  toPositiveInteger,
  resolveInvoiceSubscriptionId,
  resolveInvoicePrimaryPriceId,
  resolveInvoicePrimaryLineDescription,
  normalizeProviderSubscriptionStatus,
  isSubscriptionStatusCurrent,
  sortDuplicateCandidatesForCanonicalSelection,
  isIncomingEventOlder,
  hasSameTimestampOrderingConflict,
  mapProviderCheckoutStatusToLocal,
  buildCheckoutCorrelationError,
  buildCheckoutResponseJson
};

export {
  CHECKOUT_CORRELATION_ERROR_CODE,
  parseUnixEpochSeconds,
  toSafeMetadata,
  toNullableString,
  toPositiveInteger,
  resolveInvoiceSubscriptionId,
  resolveInvoicePrimaryPriceId,
  resolveInvoicePrimaryLineDescription,
  normalizeProviderSubscriptionStatus,
  isSubscriptionStatusCurrent,
  sortDuplicateCandidatesForCanonicalSelection,
  isIncomingEventOlder,
  hasSameTimestampOrderingConflict,
  mapProviderCheckoutStatusToLocal,
  buildCheckoutCorrelationError,
  buildCheckoutResponseJson,
  __testables
};
