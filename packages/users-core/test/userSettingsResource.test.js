import test from "node:test";
import assert from "node:assert/strict";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/validators/operationValidation";
import {
  USER_SETTINGS_ALL_KEYS,
  userSettingsResource
} from "../src/shared/resources/userSettingsResource.js";

function parseBody(operation, payload = {}) {
  return validateOperationSection({
    operation,
    section: "body",
    value: payload
  });
}

test("user settings preferences update keeps required string validation", async () => {
  const parsed = await parseBody(userSettingsResource.operations.preferencesUpdate, {
    theme: "   "
  });

  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.fieldErrors.theme, "string");
});

test("user settings notifications update rejects non-boolean values", async () => {
  const parsed = await parseBody(userSettingsResource.operations.notificationsUpdate, {
    productUpdates: "yes"
  });

  assert.equal(parsed.ok, false);
  assert.equal(typeof parsed.fieldErrors.productUpdates, "string");
});

async function importWithIdentity(url, identity) {
  return import(`${url.href}?identity=${identity}`);
}

test("user settings key exports stay stable across module identities", async () => {
  const userModuleUrl = new URL("../src/shared/resources/userSettingsResource.js", import.meta.url);

  const userA = await importWithIdentity(userModuleUrl, "user-a");
  const userB = await importWithIdentity(userModuleUrl, "user-b");

  assert.deepEqual(userA.USER_SETTINGS_ALL_KEYS, userB.USER_SETTINGS_ALL_KEYS);
  assert.deepEqual(userA.USER_SETTINGS_ALL_KEYS, USER_SETTINGS_ALL_KEYS);
  assert.ok(Object.isFrozen(userA.USER_SETTINGS_ALL_KEYS));
});
