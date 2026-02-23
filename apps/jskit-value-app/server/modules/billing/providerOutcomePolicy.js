import { BILLING_FAILURE_CODES } from "./constants.js";
import {
  BILLING_PROVIDER_ERROR_CATEGORIES,
  isBillingProviderError
} from "./providers/shared/providerError.contract.js";

const PROVIDER_OUTCOME_ACTIONS = Object.freeze({
  MARK_FAILED: "mark_failed",
  IN_PROGRESS: "in_progress",
  RETHROW: "rethrow"
});

const PROVIDER_OPERATION_FAMILIES = Object.freeze({
  CHECKOUT: "checkout",
  PORTAL: "portal",
  PAYMENT_LINK: "payment_link",
  UNKNOWN: "unknown"
});

const PROVIDER_OPERATION_GUARDRAILS = Object.freeze({
  [PROVIDER_OPERATION_FAMILIES.CHECKOUT]: Object.freeze({
    deterministic: "BILLING_CHECKOUT_PROVIDER_ERROR",
    indeterminate: "BILLING_CHECKOUT_INDETERMINATE_PROVIDER_OUTCOME"
  }),
  [PROVIDER_OPERATION_FAMILIES.PORTAL]: Object.freeze({
    deterministic: "BILLING_PORTAL_PROVIDER_ERROR",
    indeterminate: "BILLING_PORTAL_INDETERMINATE_PROVIDER_OUTCOME"
  }),
  [PROVIDER_OPERATION_FAMILIES.PAYMENT_LINK]: Object.freeze({
    deterministic: "BILLING_PAYMENT_LINK_PROVIDER_ERROR",
    indeterminate: "BILLING_PAYMENT_LINK_INDETERMINATE_PROVIDER_OUTCOME"
  }),
  [PROVIDER_OPERATION_FAMILIES.UNKNOWN]: Object.freeze({
    deterministic: null,
    indeterminate: null
  })
});

const DETERMINISTIC_PROVIDER_ERROR_CATEGORIES = new Set([
  BILLING_PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST,
  BILLING_PROVIDER_ERROR_CATEGORIES.AUTH,
  BILLING_PROVIDER_ERROR_CATEGORIES.PERMISSION,
  BILLING_PROVIDER_ERROR_CATEGORIES.NOT_FOUND,
  BILLING_PROVIDER_ERROR_CATEGORIES.CONFLICT
]);

const INDETERMINATE_PROVIDER_ERROR_CATEGORIES = new Set([
  BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK,
  BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_PROVIDER,
  BILLING_PROVIDER_ERROR_CATEGORIES.RATE_LIMITED
]);

function normalizeErrorCode(error) {
  return String(error?.code || "")
    .trim()
    .toLowerCase();
}

function normalizeErrorMessage(error) {
  return String(error?.message || "")
    .trim()
    .toLowerCase();
}

function normalizeOperation(operation) {
  return String(operation || "")
    .trim()
    .toLowerCase();
}

function resolveProviderOperationFamily(operation) {
  const normalizedOperation = normalizeOperation(operation);
  if (!normalizedOperation) {
    return PROVIDER_OPERATION_FAMILIES.UNKNOWN;
  }

  if (normalizedOperation.startsWith("checkout")) {
    return PROVIDER_OPERATION_FAMILIES.CHECKOUT;
  }

  if (normalizedOperation.startsWith("portal")) {
    return PROVIDER_OPERATION_FAMILIES.PORTAL;
  }

  if (normalizedOperation.startsWith("payment_link")) {
    return PROVIDER_OPERATION_FAMILIES.PAYMENT_LINK;
  }

  return PROVIDER_OPERATION_FAMILIES.UNKNOWN;
}

function isProviderErrorNormalized(error) {
  return isBillingProviderError(error);
}

function isDeterministicProviderRejection(error) {
  if (isBillingProviderError(error)) {
    if (DETERMINISTIC_PROVIDER_ERROR_CATEGORIES.has(error.category)) {
      return true;
    }
    return error.retryable === false;
  }

  const statusCode = Number(error?.statusCode || error?.status || 0);
  if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
    return true;
  }

  const code = normalizeErrorCode(error);
  if (!code) {
    return false;
  }

  return (
    code === "invalid_request_error" ||
    code === "invalidrequesterror" ||
    code === "invalid_request" ||
    code === "invalidrequest" ||
    code.includes("invalidrequest")
  );
}

function isIndeterminateProviderOutcome(error) {
  if (isBillingProviderError(error)) {
    if (INDETERMINATE_PROVIDER_ERROR_CATEGORIES.has(error.category)) {
      return true;
    }
    return error.retryable === true;
  }

  const statusCode = Number(error?.statusCode || error?.status || 0);
  if (statusCode === 429 || statusCode >= 500) {
    return true;
  }

  const code = normalizeErrorCode(error);
  if (
    code === "econnreset" ||
    code === "ecconnreset" ||
    code === "etimedout" ||
    code === "econnaborted" ||
    code === "econnrefused" ||
    code === "ehostunreach" ||
    code === "eai_again" ||
    code === "enotfound" ||
    code === "api_connection_error" ||
    code === "apiconnectionerror" ||
    code === "api_error" ||
    code === "apierror" ||
    code === "service_unavailable" ||
    code === "temporarily_unavailable" ||
    code === "request_timeout" ||
    code === "gateway_timeout" ||
    code.endsWith("apiconnectionerror") ||
    code.endsWith("apierror")
  ) {
    return true;
  }

  const message = normalizeErrorMessage(error);
  if (
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("connection") ||
    message.includes("temporarily unavailable")
  ) {
    return true;
  }

  return false;
}

function resolveProviderErrorOutcome({
  operation,
  error,
  deterministicFailureCode = BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR,
  inProgressFailureCode = BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS
} = {}) {
  const operationFamily = resolveProviderOperationFamily(operation);
  const guardrails =
    PROVIDER_OPERATION_GUARDRAILS[operationFamily] || PROVIDER_OPERATION_GUARDRAILS[PROVIDER_OPERATION_FAMILIES.UNKNOWN];
  const normalized = isProviderErrorNormalized(error);
  const deterministic = isDeterministicProviderRejection(error);
  const indeterminate = isIndeterminateProviderOutcome(error);

  if (deterministic) {
    return {
      normalized,
      deterministic,
      indeterminate,
      operationFamily,
      action: PROVIDER_OUTCOME_ACTIONS.MARK_FAILED,
      failureCode: deterministicFailureCode,
      guardrailCode: guardrails.deterministic,
      nonNormalizedGuardrailCode: normalized ? null : "BILLING_PROVIDER_ERROR_NOT_NORMALIZED"
    };
  }

  if (indeterminate) {
    return {
      normalized,
      deterministic,
      indeterminate,
      operationFamily,
      action: PROVIDER_OUTCOME_ACTIONS.IN_PROGRESS,
      failureCode: inProgressFailureCode,
      guardrailCode: guardrails.indeterminate,
      nonNormalizedGuardrailCode: normalized ? null : "BILLING_PROVIDER_ERROR_NOT_NORMALIZED"
    };
  }

  return {
    normalized,
    deterministic,
    indeterminate,
    operationFamily,
    action: PROVIDER_OUTCOME_ACTIONS.RETHROW,
    failureCode: null,
    guardrailCode: null,
    nonNormalizedGuardrailCode: normalized ? null : "BILLING_PROVIDER_ERROR_NOT_NORMALIZED"
  };
}

export {
  PROVIDER_OUTCOME_ACTIONS,
  PROVIDER_OPERATION_FAMILIES,
  isProviderErrorNormalized,
  isDeterministicProviderRejection,
  isIndeterminateProviderOutcome,
  resolveProviderErrorOutcome,
  resolveProviderOperationFamily
};
