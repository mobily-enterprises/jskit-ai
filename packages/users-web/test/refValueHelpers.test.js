import test from "node:test";
import assert from "node:assert/strict";
import { computed, ref } from "vue";
import { resolveEnabledRef } from "../src/client/composables/support/refValueHelpers.js";

test("resolveEnabledRef unwraps refs", () => {
  assert.equal(resolveEnabledRef(ref(true)), true);
  assert.equal(resolveEnabledRef(computed(() => false)), false);
});

test("resolveEnabledRef executes callable enabled values", () => {
  assert.equal(resolveEnabledRef(() => true), true);
  assert.equal(resolveEnabledRef(() => false), false);
});
