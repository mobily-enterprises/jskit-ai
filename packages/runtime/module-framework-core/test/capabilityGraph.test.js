import assert from "node:assert/strict";
import test from "node:test";

import { resolveCapabilityGraph } from "../src/shared/capabilityGraph.js";
import { moduleDescriptor } from "./helpers/moduleDescriptor.js";

test("resolveCapabilityGraph keeps modules when required capabilities are satisfied", () => {
  const result = resolveCapabilityGraph({
    modules: [
      moduleDescriptor({
        id: "auth",
        providesCapabilities: [{ id: "cap.auth.identity", version: "1.0.0" }]
      }),
      moduleDescriptor({
        id: "profile",
        requiresCapabilities: [{ id: "cap.auth.identity", range: "^1.0.0" }]
      })
    ]
  });

  assert.deepEqual(result.modules.map((entry) => entry.id), ["auth", "profile"]);
  assert.equal(result.capabilityProviders["cap.auth.identity"].moduleId, "auth");
});

test("resolveCapabilityGraph strict mode fails on missing required capability", () => {
  assert.throws(
    () =>
      resolveCapabilityGraph({
        mode: "strict",
        modules: [
          moduleDescriptor({
            id: "profile",
            requiresCapabilities: [{ id: "cap.auth.identity" }]
          })
        ]
      }),
    (error) =>
      error?.code === "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR" &&
      error.diagnostics.some((entry) => entry.code === "MODULE_CAPABILITY_MISSING")
  );
});

test("resolveCapabilityGraph permissive mode disables modules with missing capabilities", () => {
  const result = resolveCapabilityGraph({
    mode: "permissive",
    modules: [
      moduleDescriptor({
        id: "profile",
        requiresCapabilities: [{ id: "cap.auth.identity" }]
      })
    ]
  });

  assert.deepEqual(result.modules, []);
  assert.deepEqual(result.disabledModules.map((entry) => entry.id), ["profile"]);
});

test("resolveCapabilityGraph strict mode fails when multiple modules provide same capability", () => {
  assert.throws(
    () =>
      resolveCapabilityGraph({
        mode: "strict",
        modules: [
          moduleDescriptor({
            id: "provider-a",
            providesCapabilities: [{ id: "cap.storage.avatar", version: "1.0.0" }]
          }),
          moduleDescriptor({
            id: "provider-b",
            providesCapabilities: [{ id: "cap.storage.avatar", version: "1.0.0" }]
          })
        ]
      }),
    (error) =>
      error?.code === "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR" &&
      error.diagnostics.some((entry) => entry.code === "MODULE_CAPABILITY_PROVIDER_CONFLICT")
  );
});

test("resolveCapabilityGraph permissive mode disables conflicting providers", () => {
  const result = resolveCapabilityGraph({
    mode: "permissive",
    modules: [
      moduleDescriptor({
        id: "provider-a",
        providesCapabilities: [{ id: "cap.storage.avatar", version: "1.0.0" }]
      }),
      moduleDescriptor({
        id: "provider-b",
        providesCapabilities: [{ id: "cap.storage.avatar", version: "1.0.0" }]
      })
    ]
  });

  assert.deepEqual(result.modules.map((entry) => entry.id), ["provider-a"]);
  assert.deepEqual(result.disabledModules.map((entry) => entry.id), ["provider-b"]);
});
