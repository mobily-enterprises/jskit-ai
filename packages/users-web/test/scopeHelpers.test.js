import test from "node:test";
import assert from "node:assert/strict";
import { resolveResourceMessages } from "../src/client/composables/scopeHelpers.js";

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
