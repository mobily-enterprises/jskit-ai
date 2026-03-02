import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOptionalIdempotencyHeaders,
  generateIdempotencyKey,
  resolveIdempotencyKey
} from "../src/client/idempotencyHeaders.js";

test("idempotency helpers honor provided keys and required mode", () => {
  const generated = generateIdempotencyKey();
  assert.match(generated, /^idem_/);

  assert.equal(resolveIdempotencyKey({ idempotencyKey: "  fixed-key  " }), "fixed-key");
  assert.equal(resolveIdempotencyKey({}, { required: false }), "");
  assert.match(resolveIdempotencyKey({}, { required: true }), /^idem_/);

  assert.deepEqual(buildOptionalIdempotencyHeaders({}, { required: false }), {});
  assert.deepEqual(buildOptionalIdempotencyHeaders({ idempotencyKey: "abc" }), {
    "Idempotency-Key": "abc"
  });
});
