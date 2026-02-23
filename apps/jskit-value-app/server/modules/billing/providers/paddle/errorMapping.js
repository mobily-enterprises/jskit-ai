import { AppError } from "../../../../lib/errors.js";
import { BILLING_PROVIDER_PADDLE } from "../../constants.js";
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

function resolveCategory({ statusCode, code, message }) {
  if (statusCode === 429 || code.includes("rate_limit") || code.includes("too_many_requests")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.RATE_LIMITED;
  }
  if (statusCode >= 500 || code.includes("service_unavailable")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_PROVIDER;
  }
  if (statusCode === 401 || code.includes("auth") || code.includes("unauthorized")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.AUTH;
  }
  if (statusCode === 403 || code.includes("permission") || code.includes("forbidden")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.PERMISSION;
  }
  if (statusCode === 404 || code.includes("not_found")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.NOT_FOUND;
  }
  if (statusCode === 409 || code.includes("conflict")) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.CONFLICT;
  }
  if (
    code.includes("timeout") ||
    code.includes("network") ||
    code.includes("connection") ||
    code.includes("econn") ||
    code.includes("etimedout") ||
    code.includes("eai_again") ||
    code.includes("enotfound") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("connection")
  ) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK;
  }
  if (statusCode >= 400 && statusCode < 500) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST;
  }
  if (
    code.includes("invalid_request") ||
    code.includes("invalidrequest") ||
    code.includes("validation")
  ) {
    return BILLING_PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST;
  }
  return BILLING_PROVIDER_ERROR_CATEGORIES.UNKNOWN;
}

function mapPaddleProviderError(
  error,
  { operation = "unknown", fallbackStatusCode = null, providerRequestId = null } = {}
) {
  if (error instanceof AppError || isBillingProviderError(error)) {
    return error;
  }

  const message = String(error?.message || "Paddle API request failed.");
  const providerCode = String(error?.code || "").trim() || null;
  const statusCode = toStatusCode(error, fallbackStatusCode);

  return createBillingProviderError({
    provider: BILLING_PROVIDER_PADDLE,
    operation,
    category: resolveCategory({
      statusCode: statusCode || 0,
      code: toNormalizedString(providerCode),
      message: toNormalizedString(message)
    }),
    httpStatus: statusCode,
    providerCode,
    providerRequestId: String(providerRequestId || "").trim() || null,
    message,
    details: error?.details && typeof error.details === "object" ? error.details : null,
    cause: error
  });
}

export { mapPaddleProviderError };
