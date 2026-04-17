import test from "node:test";
import assert from "node:assert/strict";

async function importWithIdentity(url, identity) {
  return import(`${url.href}?identity=${identity}`);
}

test("settings field registries stay shared across module identities", async () => {
  const consoleModuleUrl = new URL("../src/shared/resources/consoleSettingsFields.js", import.meta.url);

  const consoleA = await importWithIdentity(consoleModuleUrl, "console-a");
  const consoleB = await importWithIdentity(consoleModuleUrl, "console-b");
  assert.equal(consoleA.consoleSettingsFields, consoleB.consoleSettingsFields);
});
