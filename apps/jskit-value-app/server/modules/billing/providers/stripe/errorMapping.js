import { AppError } from "../../../../lib/errors.js";
import { BILLING_PROVIDER_STRIPE } from "../../constants.js";
import {
  BILLING_PROVIDER_ERROR_CATEGORIES,
  createBillingProviderError,
  isBillingProviderError
} from "../shared/providerError.contract.js";

function toNormalizedString(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function toStatusCode(error, fallback = null) {
  const parsed = Number(error?.statusCode || error?.status || fallback || 0);
  if (!Number.isInteger(parsed) || parsed < 100) {
    return null;
  }
  return parsed;
}

function resolveProviderCode(error) {
  const candidates = [error?.code, error?.type, error?.rawType, error?.raw?.code, error?.raw?.type];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function resolveProviderRequestId(error) {
  const candidates = [error?.requestId, error?.request_id, error?.raw?.requestId, error?.raw?.request_id];
  for (const candidate of candidates) {
    const normalized = String(candidate || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function resolveCategory({ statusCode, code, message }) {
  if (statusCode === 429 || code.includes("ratelimit")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.RATE_LIMITED;
  }
  if (statusCode >= 500) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_PROVIDER;
  }
  if (statusCode === 401 || code.includes("authentication")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.AUTH;
  }
  if (statusCode === 403 || code.includes("permission")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.PERMISSION;
  }
  if (statusCode === 404 || code.includes("notfound")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.NOT_FOUND;
  }
  if (statusCode === 409 || code.includes("conflict")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.CONFLICT;
  }
  if (
    code.includes("apiconnection") ||
    code.includes("connectionerror") ||
    code.includes("econn") ||
    code.includes("etimedout") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("connection")
  ) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK;
  }
  if (code.includes("apierror")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_PROVIDER;
  }
  if (statusCode >= 400 && statusCode < 500) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST;
  }
  if (code.includes("invalidrequest") || code.includes("invalid_request")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST;
  }
  return BILLING_PROVIDER_ERROR_CATEGORIES.UNKNOWN;
}

function mapStripeProviderError(error, { operation = "unknown", fallbackStatusCode = null } = {}) {
  if (error instanceof AppError || isBillingProviderError(error)) {
    return error;
  }

  const message = String(error?.message || "Stripe API request failed.");
  if (message.includes("BILLING_STRIPE_")) {
    return error;
  }

  const providerCode = resolveProviderCode(error);
  const normalizedProviderCode = toNormalizedString(providerCode);
  const normalizedMessage = toNormalizedString(message);
  const statusCode = toStatusCode(error, fallbackStatusCode);

  return createBillingProviderError({
    provider: BILLING_PROVIDER_STRIPE,
    operation,
    category: resolveCategory({
      statusCode: statusCode || 0,
      code: normalizedProviderCode,
      message: normalizedMessage
    }),
    httpStatus: statusCode,
    providerCode,
    providerRequestId: resolveProviderRequestId(error),
    message,
    details: error?.raw && typeof error.raw === "object" ? error.raw : null,
    cause: error
  });
}

export { mapStripeProviderError };
