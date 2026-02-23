import assert from "node:assert/strict";
import test from "node:test";

import { shouldRetryForCsrfFailure } from "../src/retry.js";

test("shouldRetryForCsrfFailure returns true only for unsafe csrf 403 before retry", () => {
  const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

  assert.equal(
    shouldRetryForCsrfFailure({
      response: { status: 403 },
      method: "POST",
      state: { csrfRetried: false },
      data: { details: { code: "FST_CSRF_INVALID_TOKEN" } },
      unsafeMethods
    }),
    true
  );

  assert.equal(
    shouldRetryForCsrfFailure({
      response: { status: 403 },
      method: "GET",
      state: { csrfRetried: false },
      data: { details: { code: "FST_CSRF_INVALID_TOKEN" } },
      unsafeMethods
    }),
    false
  );

  assert.equal(
    shouldRetryForCsrfFailure({
      response: { status: 403 },
      method: "POST",
      state: { csrfRetried: true },
      data: { details: { code: "FST_CSRF_INVALID_TOKEN" } },
      unsafeMethods
    }),
    false
  );
});
