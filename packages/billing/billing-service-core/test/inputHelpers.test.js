import assert from "node:assert/strict";
import test from "node:test";

import { resolveBodyInput } from "../src/shared/actions/inputHelpers.js";

test("resolveBodyInput returns nested payload object when provided", () => {
  const input = {
    payload: {
      planId: "pro"
    },
    planId: "legacy"
  };

  assert.deepEqual(resolveBodyInput(input), { planId: "pro" });
});

test("resolveBodyInput falls back to normalized top-level object", () => {
  const input = {
    planId: "pro"
  };

  assert.deepEqual(resolveBodyInput(input), input);
  assert.deepEqual(resolveBodyInput(null), {});
});
