import test from "node:test";
import assert from "node:assert/strict";
import {
  isTransientQueryError,
  markTransientRetriesSpent,
  shouldRetryTransientQueryFailure,
  transientQueryRetryDelay,
  normalizeQueryErrorStatus
} from "./queryResilience.js";

test("normalizeQueryErrorStatus reads status and statusCode", () => {
  assert.equal(normalizeQueryErrorStatus({ status: 503 }), 503);
  assert.equal(normalizeQueryErrorStatus({ statusCode: 504 }), 504);
  assert.equal(normalizeQueryErrorStatus({}), 0);
});

test("isTransientQueryError checks transient statuses", () => {
  assert.equal(isTransientQueryError({ status: 503 }), true);
  assert.equal(isTransientQueryError({ status: 0 }), true);
  assert.equal(isTransientQueryError({ status: 401 }), false);
});

test("shouldRetryTransientQueryFailure allows capped transient retries only", () => {
  assert.equal(shouldRetryTransientQueryFailure(0, { status: 503 }), true);
  assert.equal(shouldRetryTransientQueryFailure(1, { status: 502 }), true);
  assert.equal(shouldRetryTransientQueryFailure(2, { status: 503 }), false);
  assert.equal(shouldRetryTransientQueryFailure(0, { status: 422 }), false);
});

test("a transient failure its transport already retried is not retried again by the query", () => {
  const error = markTransientRetriesSpent(Object.assign(new Error("Network request failed."), { status: 0 }));
  assert.equal(isTransientQueryError(error), true);
  assert.equal(shouldRetryTransientQueryFailure(0, error), false);
  assert.deepEqual(Object.keys(error), ["status"], "The mark is not an enumerable field");
  assert.equal(markTransientRetriesSpent(null), null);
});

test("transientQueryRetryDelay is bounded exponential", () => {
  assert.equal(transientQueryRetryDelay(1), 1000);
  assert.equal(transientQueryRetryDelay(2), 2000);
  assert.equal(transientQueryRetryDelay(5), 3000);
});
