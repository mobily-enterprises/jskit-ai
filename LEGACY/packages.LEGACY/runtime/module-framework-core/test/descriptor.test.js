import assert from "node:assert/strict";
import test from "node:test";

import {
  MODULE_TIERS,
  defineModule,
  validateModuleDescriptor,
  validateModuleDescriptors
} from "../src/lib/descriptor.js";

test("validateModuleDescriptor returns normalized descriptor", () => {
  const descriptor = validateModuleDescriptor({
    id: "social",
    version: "1.2.3",
    tier: MODULE_TIERS.feature,
    dependsOnModules: [{ id: "workspace", range: "^1.0.0" }],
    requiresCapabilities: [{ id: "cap.workspace.selection", range: "^1.0.0" }],
    providesCapabilities: [{ id: "cap.social.feed", version: "1.0.0" }],
    mounts: [{ key: "social.workspace", defaultPath: "/social", aliases: ["/community"] }],
    server: {
      routes: () => []
    },
    client: {
      routes: () => []
    },
    diagnostics: {
      startupChecks: () => []
    }
  });

  assert.equal(descriptor.id, "social");
  assert.equal(descriptor.mounts.length, 1);
  assert.equal(typeof descriptor.server.routes, "function");
  assert.equal(typeof descriptor.client.routes, "function");
  assert.equal(typeof descriptor.diagnostics.startupChecks, "function");
});

test("defineModule returns deeply frozen descriptor", () => {
  const descriptor = defineModule({
    id: "core",
    version: "1.0.0",
    tier: MODULE_TIERS.foundation,
    providesCapabilities: [{ id: "cap.core", version: "1.0.0" }]
  });

  assert.ok(Object.isFrozen(descriptor));
  assert.ok(Object.isFrozen(descriptor.providesCapabilities));
  assert.throws(() => {
    descriptor.id = "changed";
  });
});

test("validateModuleDescriptors throws on duplicate module ids", () => {
  assert.throws(
    () =>
      validateModuleDescriptors([
        {
          id: "dup",
          version: "1.0.0",
          tier: MODULE_TIERS.feature
        },
        {
          id: "dup",
          version: "1.0.0",
          tier: MODULE_TIERS.feature
        }
      ]),
    /Duplicate module id/
  );
});

test("validateModuleDescriptor rejects unsupported hook names", () => {
  assert.throws(
    () =>
      validateModuleDescriptor({
        id: "invalid",
        version: "1.0.0",
        tier: MODULE_TIERS.feature,
        server: {
          notAHook: () => []
        }
      }),
    /notAHook/
  );
});
