import test from "node:test";
import assert from "node:assert/strict";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import "../test-support/registerDefaultSettingsFields.js";
import { userSettingsResource } from "../src/shared/resources/userSettingsResource.js";

function parseBody(operation, payload = {}) {
  return validateOperationSection({
    operation,
    section: "bodyValidator",
    value: payload
  });
}

test("user settings preferences update keeps required string validation after normalization", () => {
  const parsed = parseBody(userSettingsResource.operations.preferencesUpdate, {
    theme: "   "
  });

  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.fieldErrors.theme, "string");
});

test("user settings notifications update rejects non-boolean values", () => {
  const parsed = parseBody(userSettingsResource.operations.notificationsUpdate, {
    productUpdates: "yes"
  });

  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.fieldErrors.productUpdates, "string");
});
