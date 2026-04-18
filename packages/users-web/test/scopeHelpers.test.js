import test from "node:test";
import assert from "node:assert/strict";
import { computed } from "vue";
import {
  isScopedOwnershipFilter,
  normalizeOwnershipFilter,
  resolveApiSuffix,
  resolveResourceMessages
} from "../src/client/composables/support/scopeHelpers.js";

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

test("normalizeOwnershipFilter accepts users visibility levels", () => {
  assert.equal(normalizeOwnershipFilter("public"), "public");
  assert.equal(normalizeOwnershipFilter("workspace"), "workspace");
  assert.equal(normalizeOwnershipFilter("user"), "user");
  assert.equal(normalizeOwnershipFilter("workspace_user"), "workspace_user");
});

test("isScopedOwnershipFilter only matches scoped ownership levels", () => {
  assert.equal(isScopedOwnershipFilter("workspace"), true);
  assert.equal(isScopedOwnershipFilter("workspace_user"), true);
  assert.equal(isScopedOwnershipFilter("public"), false);
  assert.equal(isScopedOwnershipFilter("user"), false);
});
