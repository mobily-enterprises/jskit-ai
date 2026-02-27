import assert from "node:assert/strict";
import test from "node:test";

import { MODULE_TIERS } from "../src/shared/descriptor.js";
import { composeServerModules } from "../src/shared/composeServer.js";

function moduleDescriptor(overrides = {}) {
  return {
    id: "module-a",
    version: "1.0.0",
    tier: MODULE_TIERS.feature,
    ...overrides
  };
}

test("composeServerModules composes hooks in deterministic dependency order", () => {
  const result = composeServerModules({
    mode: "strict",
    modules: [
      moduleDescriptor({
        id: "social",
        dependsOnModules: [{ id: "core" }],
        requiresCapabilities: [{ id: "cap.runtime.core" }],
        server: {
          routes: () => [{ method: "GET", path: "/social" }],
          actions: () => [{ id: "social.feed" }],
          realtimeTopics: () => [{ topic: "workspace.social.updated" }]
        }
      }),
      moduleDescriptor({
        id: "core",
        tier: MODULE_TIERS.foundation,
        providesCapabilities: [{ id: "cap.runtime.core", version: "1.0.0" }],
        mounts: [{ key: "core.workspace", defaultPath: "/core" }],
        server: {
          repositories: () => [{ id: "core.repo" }],
          services: () => [{ id: "core.service" }],
          routes: () => [{ method: "GET", path: "/health" }]
        },
        diagnostics: {
          startupChecks: () => [{ id: "core.startup" }],
          healthChecks: () => [{ id: "core.health" }]
        }
      }),
      moduleDescriptor({
        id: "chat",
        dependsOnModules: [{ id: "core" }],
        server: {
          routes: () => [{ method: "GET", path: "/chat" }]
        }
      })
    ],
    mountOverrides: {
      "core.workspace": "/runtime"
    }
  });

  assert.deepEqual(result.moduleOrder, ["core", "chat", "social"]);
  assert.equal(result.mounts["core.workspace"].path, "/runtime");
  assert.deepEqual(
    result.routes.map((route) => route.path),
    ["/health", "/chat", "/social"]
  );
  assert.deepEqual(
    result.actions.map((action) => action.id),
    ["social.feed"]
  );
  assert.deepEqual(
    result.realtimeTopics.map((topic) => topic.topic),
    ["workspace.social.updated"]
  );
  assert.equal(result.startupChecks.length, 1);
  assert.equal(result.healthChecks.length, 1);
});

test("composeServerModules strict mode throws on unresolved dependencies", () => {
  assert.throws(
    () =>
      composeServerModules({
        mode: "strict",
        modules: [
          moduleDescriptor({
            id: "social",
            dependsOnModules: [{ id: "core" }]
          })
        ]
      }),
    (error) =>
      error?.code === "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR" &&
      error.diagnostics.some((entry) => entry.code === "MODULE_DEPENDENCY_MISSING")
  );
});

test("composeServerModules permissive mode disables unresolved modules", () => {
  const result = composeServerModules({
    mode: "permissive",
    modules: [
      moduleDescriptor({
        id: "social",
        dependsOnModules: [{ id: "core" }],
        server: {
          routes: () => [{ method: "GET", path: "/social" }]
        }
      })
    ]
  });

  assert.deepEqual(result.moduleOrder, []);
  assert.deepEqual(result.routes, []);
  assert.deepEqual(result.disabledModules.map((entry) => entry.id), ["social"]);
});

test("composeServerModules permissive mode deduplicates conflicting routes/actions/topics", () => {
  const result = composeServerModules({
    mode: "permissive",
    modules: [
      moduleDescriptor({
        id: "a",
        server: {
          routes: () => [{ method: "GET", path: "/health" }],
          actions: () => [{ id: "status.read" }],
          realtimeTopics: () => [{ topic: "workspace.status" }]
        }
      }),
      moduleDescriptor({
        id: "b",
        server: {
          routes: () => [{ method: "GET", path: "/health" }],
          actions: () => [{ id: "status.read" }],
          realtimeTopics: () => [{ topic: "workspace.status" }]
        }
      })
    ]
  });

  assert.equal(result.routes.length, 1);
  assert.equal(result.actions.length, 1);
  assert.equal(result.realtimeTopics.length, 1);
  assert.ok(result.diagnostics.some((entry) => entry.code === "ROUTE_CONFLICT"));
  assert.ok(result.diagnostics.some((entry) => entry.code === "ACTION_CONFLICT"));
  assert.ok(result.diagnostics.some((entry) => entry.code === "TOPIC_CONFLICT"));
});

test("composeServerModules permissive mode records hook execution failures and continues", () => {
  const result = composeServerModules({
    mode: "permissive",
    modules: [
      moduleDescriptor({
        id: "a",
        server: {
          routes() {
            throw new Error("bad hook");
          }
        }
      }),
      moduleDescriptor({
        id: "b",
        server: {
          routes: () => [{ method: "GET", path: "/ok" }]
        }
      })
    ]
  });

  assert.deepEqual(
    result.routes.map((route) => route.path),
    ["/ok"]
  );
  assert.ok(result.diagnostics.some((entry) => entry.code === "MODULE_HOOK_EXECUTION_FAILED"));
});
