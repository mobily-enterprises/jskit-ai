import test from "node:test";
import assert from "node:assert/strict";
import { computed } from "vue";
import { resolveApiSuffix, resolveResourceMessages } from "../src/client/composables/scopeHelpers.js";

test("resolveResourceMessages merges defaults with resource messages", () => {
  const messages = resolveResourceMessages(
    {
      messages: {
        saveError: "Unable to update workspace settings.",
        saveSuccess: "Workspace settings updated."
      }
    },
    {
      validation: "Fix invalid values and try again.",
      saveSuccess: "Saved.",
      saveError: "Unable to save."
    }
  );

  assert.deepEqual(messages, {
    validation: "Fix invalid values and try again.",
    saveSuccess: "Workspace settings updated.",
    saveError: "Unable to update workspace settings."
  });
});

test("resolveApiSuffix unwraps computed refs", () => {
  const suffix = computed(() => "/customers/42");

  assert.equal(resolveApiSuffix(suffix), "/customers/42");
});

test("resolveApiSuffix unwraps function-returned computed refs", () => {
  const suffix = computed(() => "/customers/42");

  assert.equal(resolveApiSuffix(() => suffix), "/customers/42");
});
