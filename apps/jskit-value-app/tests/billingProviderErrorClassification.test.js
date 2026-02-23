import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVIDER_OUTCOME_ACTIONS,
  isProviderErrorNormalized,
  isDeterministicProviderRejection,
  isIndeterminateProviderOutcome,
  resolveProviderErrorOutcome
} from "../server/modules/billing/providerOutcomePolicy.js";
import { BILLING_FAILURE_CODES } from "../server/modules/billing/constants.js";
import {
  BILLING_PROVIDER_ERROR_CATEGORIES,
  createBillingProviderError
} from "../server/modules/billing/providers/shared/providerError.contract.js";

test("provider error classification treats deterministic 4xx and invalid-request codes as terminal", () => {
  assert.equal(isDeterministicProviderRejection({ statusCode: 400 }), true);
  assert.equal(isDeterministicProviderRejection({ statusCode: 422 }), true);
  assert.equal(isDeterministicProviderRejection({ statusCode: 429 }), false);
  assert.equal(isDeterministicProviderRejection({ code: "invalid_request_error" }), true);
  assert.equal(isDeterministicProviderRejection({ code: "ProviderInvalidRequestError" }), true);
});

test("provider error classification treats transient network and api failures as indeterminate", () => {
  assert.equal(isIndeterminateProviderOutcome({ statusCode: 500 }), true);
  assert.equal(isIndeterminateProviderOutcome({ statusCode: 429 }), true);
  assert.equal(isIndeterminateProviderOutcome({ code: "ECONNRESET" }), true);
  assert.equal(isIndeterminateProviderOutcome({ code: "api_connection_error" }), true);
  assert.equal(isIndeterminateProviderOutcome({ code: "ApiError" }), true);
  assert.equal(isIndeterminateProviderOutcome({ message: "upstream network timeout while creating session" }), true);
});

test("provider error classification uses canonical provider-error categories when available", () => {
  const deterministic = createBillingProviderError({
    provider: "stripe",
    operation: "checkout_create",
    category: BILLING_PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST,
    message: "Invalid request."
  });
  const indeterminate = createBillingProviderError({
    provider: "paddle",
    operation: "checkout_create",
    category: BILLING_PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK,
    message: "Network timeout."
  });

  assert.equal(isProviderErrorNormalized(deterministic), true);
  assert.equal(isDeterministicProviderRejection(deterministic), true);
  assert.equal(isIndeterminateProviderOutcome(deterministic), false);

  assert.equal(isProviderErrorNormalized(indeterminate), true);
  assert.equal(isDeterministicProviderRejection(indeterminate), false);
  assert.equal(isIndeterminateProviderOutcome(indeterminate), true);
});

test("provider error classification does not over-classify unknown errors", () => {
  assert.equal(isProviderErrorNormalized({ code: "SOME_UNKNOWN_ERROR" }), false);
  assert.equal(isDeterministicProviderRejection({ code: "SOME_UNKNOWN_ERROR" }), false);
  assert.equal(isIndeterminateProviderOutcome({ code: "SOME_UNKNOWN_ERROR" }), false);
});

test("provider outcome policy resolves deterministic and indeterminate actions by operation family", () => {
  const deterministicError = createBillingProviderError({
    provider: "stripe",
    operation: "checkout_create",
    category: BILLING_PROVIDER_ERROR_CATEGORIES.INVALID_REQUEST,
    message: "Invalid request."
  });

  const deterministicOutcome = resolveProviderErrorOutcome({
    operation: "checkout_create",
    error: deterministicError
  });
  assert.equal(deterministicOutcome.action, PROVIDER_OUTCOME_ACTIONS.MARK_FAILED);
  assert.equal(deterministicOutcome.failureCode, BILLING_FAILURE_CODES.CHECKOUT_PROVIDER_ERROR);
  assert.equal(deterministicOutcome.guardrailCode, "BILLING_CHECKOUT_PROVIDER_ERROR");
  assert.equal(deterministicOutcome.nonNormalizedGuardrailCode, null);

  const indeterminateOutcome = resolveProviderErrorOutcome({
    operation: "portal_create",
    error: { code: "ECONNRESET", message: "socket hang up" }
  });
  assert.equal(indeterminateOutcome.action, PROVIDER_OUTCOME_ACTIONS.IN_PROGRESS);
  assert.equal(indeterminateOutcome.failureCode, BILLING_FAILURE_CODES.REQUEST_IN_PROGRESS);
  assert.equal(indeterminateOutcome.guardrailCode, "BILLING_PORTAL_INDETERMINATE_PROVIDER_OUTCOME");
  assert.equal(indeterminateOutcome.nonNormalizedGuardrailCode, "BILLING_PROVIDER_ERROR_NOT_NORMALIZED");
});

test("provider outcome policy preserves unknown provider errors for rethrow", () => {
  const outcome = resolveProviderErrorOutcome({
    operation: "payment_link_create",
    error: { code: "SOME_UNKNOWN_ERROR" }
  });

  assert.equal(outcome.action, PROVIDER_OUTCOME_ACTIONS.RETHROW);
  assert.equal(outcome.failureCode, null);
  assert.equal(outcome.guardrailCode, null);
  assert.equal(outcome.nonNormalizedGuardrailCode, "BILLING_PROVIDER_ERROR_NOT_NORMALIZED");
});
