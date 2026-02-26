import assert from "node:assert/strict";
import test from "node:test";

import { FRAMEWORK_PROFILE_IDS, resolveFrameworkProfile } from "../../shared/framework/profile.js";

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
