const BILLING_PROVIDER_STRIPE = "stripe";
const BILLING_PROVIDER_PADDLE = "paddle";
const BILLING_DEFAULT_PROVIDER = BILLING_PROVIDER_STRIPE;
const BILLING_ACTIONS = Object.freeze({
  CHECKOUT: "checkout",
  PORTAL: "portal",
  PAYMENT_LINK: "payment_link"
});

const BILLING_FAILURE_CODES = Object.freeze({
  REQUEST_IN_PROGRESS: "request_in_progress",
  CHECKOUT_IN_PROGRESS: "checkout_in_progress",
  CHECKOUT_SESSION_OPEN: "checkout_session_open",
  CHECKOUT_COMPLETION_PENDING: "checkout_completion_pending",
  CHECKOUT_RECOVERY_VERIFICATION_PENDING: "checkout_recovery_verification_pending",
  CHECKOUT_PLAN_NOT_FOUND: "checkout_plan_not_found",
  CHECKOUT_CONFIGURATION_INVALID: "checkout_configuration_invalid",
  SUBSCRIPTION_EXISTS_USE_PORTAL: "subscription_exists_use_portal",
  PORTAL_SUBSCRIPTION_REQUIRED: "portal_subscription_required",
  CHECKOUT_RECOVERY_WINDOW_ELAPSED: "checkout_recovery_window_elapsed",
  CHECKOUT_REPLAY_PROVENANCE_MISMATCH: "checkout_replay_provenance_mismatch",
  CHECKOUT_PROVIDER_ERROR: "checkout_provider_error",
  IDEMPOTENCY_CONFLICT: "idempotency_conflict"
});

const BILLING_IDEMPOTENCY_STATUS = Object.freeze({
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  EXPIRED: "expired"
});

const BILLING_SUBSCRIPTION_STATUS = Object.freeze({
  INCOMPLETE: "incomplete",
  TRIALING: "trialing",
  ACTIVE: "active",
  PAST_DUE: "past_due",
  PAUSED: "paused",
  UNPAID: "unpaid",
  CANCELED: "canceled",
  INCOMPLETE_EXPIRED: "incomplete_expired"
});

const NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET = new Set([
  BILLING_SUBSCRIPTION_STATUS.INCOMPLETE,
  BILLING_SUBSCRIPTION_STATUS.TRIALING,
  BILLING_SUBSCRIPTION_STATUS.ACTIVE,
  BILLING_SUBSCRIPTION_STATUS.PAST_DUE,
  BILLING_SUBSCRIPTION_STATUS.PAUSED,
  BILLING_SUBSCRIPTION_STATUS.UNPAID
]);

const TERMINAL_SUBSCRIPTION_STATUS_SET = new Set([
  BILLING_SUBSCRIPTION_STATUS.CANCELED,
  BILLING_SUBSCRIPTION_STATUS.INCOMPLETE_EXPIRED
]);

const BILLING_CHECKOUT_SESSION_STATUS = Object.freeze({
  OPEN: "open",
  COMPLETED_PENDING_SUBSCRIPTION: "completed_pending_subscription",
  RECOVERY_VERIFICATION_PENDING: "recovery_verification_pending",
  COMPLETED_RECONCILED: "completed_reconciled",
  EXPIRED: "expired",
  ABANDONED: "abandoned"
});

const CHECKOUT_BLOCKING_STATUS_SET = new Set([
  BILLING_CHECKOUT_SESSION_STATUS.OPEN,
  BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION,
  BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING
]);

const CHECKOUT_TERMINAL_STATUS_SET = new Set([
  BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_RECONCILED,
  BILLING_CHECKOUT_SESSION_STATUS.EXPIRED,
  BILLING_CHECKOUT_SESSION_STATUS.ABANDONED
]);

const CHECKOUT_STATUS_TRANSITIONS = Object.freeze({
  [BILLING_CHECKOUT_SESSION_STATUS.OPEN]: new Set([
    BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION,
    BILLING_CHECKOUT_SESSION_STATUS.EXPIRED,
    BILLING_CHECKOUT_SESSION_STATUS.ABANDONED
  ]),
  [BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION]: new Set([
    BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_RECONCILED,
    BILLING_CHECKOUT_SESSION_STATUS.ABANDONED
  ]),
  [BILLING_CHECKOUT_SESSION_STATUS.RECOVERY_VERIFICATION_PENDING]: new Set([
    BILLING_CHECKOUT_SESSION_STATUS.OPEN,
    BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_PENDING_SUBSCRIPTION,
    BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_RECONCILED,
    BILLING_CHECKOUT_SESSION_STATUS.EXPIRED,
    BILLING_CHECKOUT_SESSION_STATUS.ABANDONED
  ]),
  [BILLING_CHECKOUT_SESSION_STATUS.COMPLETED_RECONCILED]: new Set(),
  [BILLING_CHECKOUT_SESSION_STATUS.EXPIRED]: new Set(),
  [BILLING_CHECKOUT_SESSION_STATUS.ABANDONED]: new Set()
});

const BILLING_RUNTIME_DEFAULTS = Object.freeze({
  PROVIDER_IDEMPOTENCY_REPLAY_WINDOW_SECONDS: 23 * 60 * 60,
  CHECKOUT_PROVIDER_EXPIRES_SECONDS: 24 * 60 * 60,
  CHECKOUT_SESSION_EXPIRES_AT_GRACE_SECONDS: 90,
  CHECKOUT_PENDING_LEASE_SECONDS: 120,
  WEBHOOK_MAX_PAYLOAD_BYTES: 256 * 1024
});

const BILLING_PROVIDER_REQUEST_SCHEMA_VERSION_BY_PROVIDER = Object.freeze({
  [BILLING_PROVIDER_STRIPE]: "stripe_checkout_session_create_params_v1",
  [BILLING_PROVIDER_PADDLE]: "paddle_checkout_session_create_params_v1"
});

const BILLING_PROVIDER_SDK_NAME_BY_PROVIDER = Object.freeze({
  [BILLING_PROVIDER_STRIPE]: "stripe-node",
  [BILLING_PROVIDER_PADDLE]: "paddle-rest"
});

const LOCK_ORDER = Object.freeze([
  "billable_entities",
  "billing_subscriptions",
  "billing_request_idempotency",
  "billing_checkout_sessions",
  "billing_subscription_remediations",
  "billing_outbox_jobs"
]);

function isBlockingCheckoutStatus(status) {
  return CHECKOUT_BLOCKING_STATUS_SET.has(String(status || "").trim());
}

function isCheckoutTerminalStatus(status) {
  return CHECKOUT_TERMINAL_STATUS_SET.has(String(status || "").trim());
}

function canTransitionCheckoutStatus(currentStatus, nextStatus) {
  const current = String(currentStatus || "").trim();
  const next = String(nextStatus || "").trim();
  if (!current || !next) {
    return false;
  }

  if (current === next) {
    return true;
  }

  const allowedNext = CHECKOUT_STATUS_TRANSITIONS[current];
  if (!allowedNext) {
    return false;
  }

  return allowedNext.has(next);
}

function statusFromFailureCode(failureCode) {
  const code = String(failureCode || "").trim();
  if (!code) {
    return 409;
  }

  if (code === BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR) {
    return 502;
  }

  if (code === BILLING_FAILURE_CODES.CHECKOUT_PLAN_NOT_FOUND) {
    return 404;
  }

  return 409;
}

function resolveProviderRequestSchemaVersion(provider) {
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  const providerKey = normalizedProvider || BILLING_DEFAULT_PROVIDER;

  return (
    BILLING_PROVIDER_REQUEST_SCHEMA_VERSION_BY_PROVIDER[providerKey] ||
    `${providerKey}_checkout_session_create_params_v1`
  );
}

function resolveProviderSdkName(provider) {
  const normalizedProvider = String(provider || "")
    .trim()
    .toLowerCase();
  const providerKey = normalizedProvider || BILLING_DEFAULT_PROVIDER;

  return BILLING_PROVIDER_SDK_NAME_BY_PROVIDER[providerKey] || `${providerKey}-sdk`;
}

export {
  BILLING_PROVIDER_STRIPE,
  BILLING_PROVIDER_PADDLE,
  BILLING_DEFAULT_PROVIDER,
  BILLING_ACTIONS,
  BILLING_FAILURE_CODES,
  BILLING_IDEMPOTENCY_STATUS,
  BILLING_SUBSCRIPTION_STATUS,
  NON_TERMINAL_CURRENT_SUBSCRIPTION_STATUS_SET,
  TERMINAL_SUBSCRIPTION_STATUS_SET,
  BILLING_CHECKOUT_SESSION_STATUS,
  CHECKOUT_BLOCKING_STATUS_SET,
  CHECKOUT_TERMINAL_STATUS_SET,
  CHECKOUT_STATUS_TRANSITIONS,
  BILLING_RUNTIME_DEFAULTS,
  BILLING_PROVIDER_REQUEST_SCHEMA_VERSION_BY_PROVIDER,
  BILLING_PROVIDER_SDK_NAME_BY_PROVIDER,
  LOCK_ORDER,
  isBlockingCheckoutStatus,
  isCheckoutTerminalStatus,
  canTransitionCheckoutStatus,
  statusFromFailureCode,
  resolveProviderRequestSchemaVersion,
  resolveProviderSdkName
};
