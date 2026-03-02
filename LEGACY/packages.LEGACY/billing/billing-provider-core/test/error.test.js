import assert from "node:assert/strict";
import test from "node:test";

import {
  PROVIDER_ERROR_CATEGORIES,
  createBillingProviderError,
  isBillingProviderError,
  normalizeProviderErrorCategory,
  toProviderStatusCode
} from "../src/lib/index.js";

test("provider error category normalization falls back to unknown", () => {
  assert.equal(normalizeProviderErrorCategory("transient_network"), PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK);
  assert.equal(normalizeProviderErrorCategory("not_a_real_category"), PROVIDER_ERROR_CATEGORIES.UNKNOWN);
  assert.equal(normalizeProviderErrorCategory(""), PROVIDER_ERROR_CATEGORIES.UNKNOWN);
});

test("createBillingProviderError normalizes provider fields and derives retryable", () => {
  const error = createBillingProviderError({
    provider: " StrIPE ",
    operation: "checkout_create",
    category: PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK,
    providerCode: "ECONNRESET",
    httpStatus: 503,
    message: "Connection reset."
  });

  assert.equal(isBillingProviderError(error), true);
  assert.equal(error.provider, "stripe");
  assert.equal(error.operation, "checkout_create");
  assert.equal(error.category, PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK);
  assert.equal(error.retryable, true);
  assert.equal(error.httpStatus, 503);
  assert.equal(error.providerCode, "ECONNRESET");
});

test("createBillingProviderError respects explicit retryable override", () => {
  const error = createBillingProviderError({
    provider: "stripe",
    operation: "checkout_create",
    category: PROVIDER_ERROR_CATEGORIES.TRANSIENT_NETWORK,
    retryable: false
  });

  assert.equal(error.retryable, false);
});

test("isBillingProviderError returns false for plain errors", () => {
  assert.equal(isBillingProviderError(new Error("nope")), false);
});

test("toProviderStatusCode parses valid HTTP status and rejects invalid values", () => {
  assert.equal(toProviderStatusCode({ statusCode: "429" }), 429);
  assert.equal(toProviderStatusCode({ status: 503 }), 503);
  assert.equal(toProviderStatusCode({}, 402), 402);
  assert.equal(toProviderStatusCode({ statusCode: "foo" }, 200), 200);
  assert.equal(toProviderStatusCode({ statusCode: 99 }), null);
  assert.equal(toProviderStatusCode({}), null);
});
