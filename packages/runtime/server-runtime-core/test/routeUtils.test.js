import test from "node:test";
import assert from "node:assert/strict";

import { AppError } from "../src/shared/errors.js";
import { normalizeIdempotencyKey, requireIdempotencyKey } from "../src/shared/routeUtils.js";

test("normalizeIdempotencyKey trims and normalizes empty values", () => {
  assert.equal(normalizeIdempotencyKey("  abc123  "), "abc123");
  assert.equal(normalizeIdempotencyKey(""), "");
  assert.equal(normalizeIdempotencyKey(null), "");
});

test("requireIdempotencyKey returns normalized header value", () => {
  const value = requireIdempotencyKey({
    headers: {
      "idempotency-key": "  idem-key  "
    }
  });

  assert.equal(value, "idem-key");
});

test("requireIdempotencyKey throws AppError when header is missing", () => {
  assert.throws(
    () => requireIdempotencyKey({ headers: {} }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.status, 400);
      assert.equal(error.code, "IDEMPOTENCY_KEY_REQUIRED");
      return true;
    }
  );
});
