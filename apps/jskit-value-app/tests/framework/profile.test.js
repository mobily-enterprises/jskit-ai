import assert from "node:assert/strict";
import test from "node:test";

import {
  FRAMEWORK_PROFILE_IDS,
  resolveFrameworkProfile,
  normalizeOptionalModulePacks,
  resolveServerModuleIdsForProfile,
  resolveClientModuleIdsForProfile
} from "../../shared/framework/profile.js";

test("resolveFrameworkProfile returns default web-saas profile", () => {
  const profile = resolveFrameworkProfile(FRAMEWORK_PROFILE_IDS.webSaasDefault);

  assert.equal(profile.id, FRAMEWORK_PROFILE_IDS.webSaasDefault);
  assert.equal(profile.requiredServerModules.includes("auth"), true);
  assert.equal(profile.requiredServerModules.includes("workspace"), true);
  assert.equal(profile.optionalServerModules.includes("social"), true);
  assert.equal(profile.requiredClientModules.includes("deg2rad"), true);
});

test("resolveFrameworkProfile falls back to default profile for unknown id", () => {
  const profile = resolveFrameworkProfile("unknown");
  assert.equal(profile.id, FRAMEWORK_PROFILE_IDS.webSaasDefault);
});

test("normalizeOptionalModulePacks handles csv, +prefixes, and deduplication", () => {
  assert.deepEqual(normalizeOptionalModulePacks(null), null);
  assert.deepEqual(normalizeOptionalModulePacks(" +social, billing,Social ,, +ai "), ["social", "billing", "ai"]);
});

test("resolveServerModuleIdsForProfile returns required plus selected optional packs", () => {
  const profile = resolveFrameworkProfile();
  const moduleIds = resolveServerModuleIdsForProfile(profile, {
    optionalModulePacks: ["social", "billing"]
  });

  for (const requiredId of profile.requiredServerModules) {
    assert.equal(moduleIds.includes(requiredId), true, `Missing required module ${requiredId}.`);
  }

  assert.equal(moduleIds.includes("social"), true);
  assert.equal(moduleIds.includes("billing"), true);
  assert.equal(moduleIds.includes("ai"), false);
});

test("resolveClientModuleIdsForProfile supports core-only optional pack selection", () => {
  const profile = resolveFrameworkProfile();
  const moduleIds = resolveClientModuleIdsForProfile(profile, {
    optionalModulePacks: ["core"]
  });

  assert.deepEqual(moduleIds, profile.requiredClientModules);
});

test("resolveServerModuleIdsForProfile throws for unknown optional pack", () => {
  assert.throws(
    () =>
      resolveServerModuleIdsForProfile(resolveFrameworkProfile(), {
        optionalModulePacks: ["unknown-pack"]
      }),
    /Unknown optional module pack/
  );
});
