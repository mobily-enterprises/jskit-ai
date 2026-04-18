import test from "node:test";
import assert from "node:assert/strict";

async function importWithIdentity(url, identity) {
  return import(`${url.href}?identity=${identity}`);
}

test("settings field registries stay shared across module identities", async () => {
  const userModuleUrl = new URL("../src/shared/resources/userSettingsFields.js", import.meta.url);

  const userA = await importWithIdentity(userModuleUrl, "user-a");
  const userB = await importWithIdentity(userModuleUrl, "user-b");
  assert.equal(userA.userSettingsFields, userB.userSettingsFields);
});
