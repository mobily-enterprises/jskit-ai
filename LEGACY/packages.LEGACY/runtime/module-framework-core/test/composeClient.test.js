import assert from "node:assert/strict";
import test from "node:test";

import { MODULE_TIERS } from "../src/lib/descriptor.js";
import { composeClientModules } from "../src/lib/composeClient.js";
import { moduleDescriptor } from "./helpers/moduleDescriptor.js";

test("composeClientModules composes api/routes/nav/realtime/flags deterministically", () => {
  const result = composeClientModules({
    mode: "strict",
    modules: [
      moduleDescriptor({
        id: "chat",
        dependsOnModules: [{ id: "core" }],
        requiresCapabilities: [{ id: "cap.http.client" }],
        client: {
          api: () => ({ chatApi: { id: "chat" } }),
          routes: () => [{ path: "/chat" }],
          nav: () => [{ id: "chat-nav" }],
          realtime: () => [{ topic: "chat.updated" }],
          featureFlags: () => ({ chatEnabled: true })
        }
      }),
      moduleDescriptor({
        id: "core",
        tier: MODULE_TIERS.foundation,
        providesCapabilities: [{ id: "cap.http.client", version: "1.0.0" }],
        mounts: [{ key: "chat.workspace", defaultPath: "/chat" }],
        client: {
          routes: () => [{ path: "/" }]
        }
      })
    ],
    mountOverrides: {
      "chat.workspace": "/messages"
    }
  });

  assert.deepEqual(result.moduleOrder, ["core", "chat"]);
  assert.equal(result.mounts["chat.workspace"].path, "/messages");
  assert.deepEqual(Object.keys(result.api), ["chatApi"]);
  assert.deepEqual(
    result.routes.map((route) => route.path),
    ["/", "/chat"]
  );
  assert.equal(result.nav.length, 1);
  assert.equal(result.realtime.length, 1);
  assert.equal(result.featureFlags.chatEnabled, true);
});

test("composeClientModules strict mode throws on API key conflicts", () => {
  assert.throws(
    () =>
      composeClientModules({
        mode: "strict",
        modules: [
          moduleDescriptor({
            id: "a",
            client: {
              api: () => ({ usersApi: {} })
            }
          }),
          moduleDescriptor({
            id: "b",
            client: {
              api: () => ({ usersApi: {} })
            }
          })
        ]
      }),
    (error) =>
      error?.code === "MODULE_FRAMEWORK_DIAGNOSTIC_ERROR" &&
      error.diagnostics.some((entry) => entry.code === "MODULE_CLIENT_FRAGMENT_KEY_CONFLICT")
  );
});

test("composeClientModules permissive mode keeps first API key contributor", () => {
  const result = composeClientModules({
    mode: "permissive",
    modules: [
      moduleDescriptor({
        id: "a",
        client: {
          api: () => ({ usersApi: { provider: "a" } })
        }
      }),
      moduleDescriptor({
        id: "b",
        client: {
          api: () => ({ usersApi: { provider: "b" } })
        }
      })
    ]
  });

  assert.equal(result.api.usersApi.provider, "a");
  assert.ok(result.diagnostics.some((entry) => entry.code === "MODULE_CLIENT_FRAGMENT_KEY_CONFLICT"));
});

test("composeClientModules permissive mode disables modules with unsatisfied capabilities", () => {
  const result = composeClientModules({
    mode: "permissive",
    modules: [
      moduleDescriptor({
        id: "chat",
        requiresCapabilities: [{ id: "cap.http.client" }],
        client: {
          routes: () => [{ path: "/chat" }]
        }
      })
    ]
  });

  assert.deepEqual(result.moduleOrder, []);
  assert.deepEqual(result.routes, []);
  assert.deepEqual(result.disabledModules.map((entry) => entry.id), ["chat"]);
});

test("composeClientModules permissive mode records hook errors and continues", () => {
  const result = composeClientModules({
    mode: "permissive",
    modules: [
      moduleDescriptor({
        id: "a",
        client: {
          routes() {
            throw new Error("bad hook");
          }
        }
      }),
      moduleDescriptor({
        id: "b",
        client: {
          routes: () => [{ path: "/ok" }]
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
