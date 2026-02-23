const BILLING_PROVIDER_ERROR_CATEGORIES = Object.freeze({
  INVALID_REQUEST: "invalid_request",
  RATE_LIMITED: "rate_limited",
  TRANSIENT_NETWORK: "transient_network",
  TRANSIENT_PROVIDER: "transient_provider",
  AUTH: "auth",
  PERMISSION: "permission",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  UNKNOWN: "unknown"
});

const RETRYABLE_PROVIDER_ERROR_CATEGORIES = new Set([
  BILLING_PROVIDER_ERROR_CATEGORIES.RATE_LIMITED,
  BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK,
  BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_PROVIDER
]);

class BillingProviderError extends Error {
  constructor(message, options = {}) {
    super(String(message || "Billing provider operation failed."), {
      cause: options.cause
    });
    this.name = "BillingProviderError";
    this.code = "BILLING_PROVIDER_ERROR";
    this.isBillingProviderError = true;
    this.provider = String(options.provider || "").trim().toLowerCase();
    this.operation = String(options.operation || "").trim().toLowerCase() || "unknown";
    this.category = normalizeProviderErrorCategory(options.category);
    this.retryable = resolveRetryable(options.retryable, this.category);
    this.httpStatus = toNullableInteger(options.httpStatus);
    this.providerCode = toNullableString(options.providerCode);
    this.providerRequestId = toNullableString(options.providerRequestId);
    this.details = options.details && typeof options.details === "object" ? options.details : null;
  }
}

function toNullableString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toNullableInteger(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 100) {
    return null;
  }
  return parsed;
}

function resolveRetryable(retryable, category) {
  if (typeof retryable === "boolean") {
    return retryable;
  }
  return RETRYABLE_PROVIDER_ERROR_CATEGORIES.has(category);
}

function normalizeProviderErrorCategory(category) {
  const normalized = String(category || "")
    .trim()
    .toLowerCase();

  if (Object.values(BILLING_PROVIDER_ERROR_CATEGORIES).includes(normalized)) {
    return normalized;
  }

  return BILLING_PROVIDER_ERROR_CATEGORIES.UNKNOWN;
}

function isBillingProviderError(error) {
  return Boolean(error?.isBillingProviderError === true);
}

function createBillingProviderError({ message, ...options } = {}) {
  return new BillingProviderError(message, options);
}

export {
  BILLING_PROVIDER_ERROR_CATEGORIES,
  RETRYABLE_PROVIDER_ERROR_CATEGORIES,
  BillingProviderError,
  isBillingProviderError,
  createBillingProviderError,
  normalizeProviderErrorCategory
};
