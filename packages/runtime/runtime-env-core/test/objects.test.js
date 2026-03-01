import assert from "node:assert/strict";
import test from "node:test";

import { normalizeObject } from "../src/shared/objects.js";

test("normalizeObject returns plain objects and coerces non-object values to empty object", () => {
  const payload = {
    ok: true
  };

  assert.equal(normalizeObject(payload), payload);
  assert.deepEqual(normalizeObject(null), {});
  assert.deepEqual(normalizeObject("text"), {});
  assert.deepEqual(normalizeObject(42), {});
  assert.deepEqual(normalizeObject([]), {});
});
