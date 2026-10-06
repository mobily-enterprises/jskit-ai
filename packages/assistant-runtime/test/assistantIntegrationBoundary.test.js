import assert from "node:assert/strict";
import test from "node:test";
import { createRouter } from "../../kernel/server/http/lib/router.js";
import { actionIds } from "../src/server/actionIds.js";
import { createAssistantSettingsActions } from "../src/server/createAssistantSettingsActions.js";
import { registerSettingsRoutes } from "../src/server/registerSettingsRoutes.js";
import { resolveRouteRequestState } from "../src/server/support/assistantRouteContext.js";

const config = {
  surfaceDefinitions: {
    home: { enabled: true, requiresWorkspace: false },
    console: { enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" },
    admin: { enabled: true, requiresWorkspace: true }
  },
  assistantSurfaces: {
    home: { settingsSurfaceId: "console", configScope: "global" },
    admin: { settingsSurfaceId: "admin", configScope: "workspace" }
  }
};

function request(surfaceId, hostSurfaceId = surfaceId) {
  return {
    headers: { "x-jskit-surface": hostSurfaceId },
    input: { params: { surfaceId, workspaceSlug: "trusted-workspace" } }
  };
}

test("the shared route boundary derives surface and workspace only from the existing host inputs", () => {
  const input = request("admin");
  input.input.body = { targetSurfaceId: "home", workspaceSlug: "other-workspace", actor: { id: "other-user" } };
  const resolved = resolveRouteRequestState(input, {
    resolveCurrentAppConfig: () => config,
    requiresWorkspace: true,
    workspaceScopeSupport: {
      buildInputFromRouteParams(params) { return { workspaceSlug: params.workspaceSlug }; }
    }
  });
  assert.equal(resolved.hostSurfaceId, "admin");
  assert.deepEqual(resolved.actionInput, { targetSurfaceId: "admin", workspaceSlug: "trusted-workspace" });
  assert.ok(Object.isFrozen(resolved.actionInput));
  const settings = resolveRouteRequestState(request("home", "console"), {
    resolveCurrentAppConfig: () => config,
    kind: "settings"
  });
  assert.equal(settings.hostSurfaceId, "console");
  assert.deepEqual(settings.actionInput, { targetSurfaceId: "home" });
});

test("the shared route boundary retains surface and workspace denial errors", () => {
  for (const [input, options, status, message] of [
    [request("home", ""), {}, 400, "Assistant surface header x-jskit-surface is required."],
    [request("home", "admin"), {}, 403, "Assistant route is not available on this surface."],
    [request("home"), { kind: "settings" }, 403, "Assistant route is not available on this surface."],
    [request("admin"), {}, 404, "Assistant route not found."],
    [request("missing"), {}, 404, "Assistant not found."]
  ]) {
    assert.throws(() => resolveRouteRequestState(input, {
      resolveCurrentAppConfig: () => config,
      ...options
    }), { status, message });
  }
  assert.throws(() => resolveRouteRequestState(request("admin"), {
    resolveCurrentAppConfig: () => config,
    requiresWorkspace: true
  }), /Assistant workspace routes require workspace server scope support/);
});

test("settings routes and actions compose independently of the chat service", async () => {
  const calls = [];
  const definitions = createAssistantSettingsActions({
    settingsSurfaces: ["console"],
    assistantConfigService: {
      getSettings(input, options) { calls.push({ input, options }); return {}; },
      updateSettings(input, patch, options) { calls.push({ input, patch, options }); return {}; }
    }
  });
  assert.deepEqual(definitions.map(({ id }) => id), [actionIds.settingsRead, actionIds.settingsUpdate]);
  assert.ok(definitions.every(({ permission }) => permission.require === "authenticated"));
  assert.ok(definitions.every(({ extensions }) => extensions.assistant.exclude.includes("self-configuration is disabled")));
  const router = createRouter();
  registerSettingsRoutes(router, () => config);
  const routes = router.list();
  assert.deepEqual(routes.map(({ method, path }) => [method, path]), [
    ["GET", "/api/assistant/:surfaceId/settings"],
    ["PATCH", "/api/assistant/:surfaceId/settings"]
  ]);
  const context = { actor: { id: "authenticated-user" } };
  const patch = { systemPrompt: "Use the existing settings service." };
  for (const route of routes) {
    await route.handler({
      ...request("home", "console"),
      input: { params: { surfaceId: "home" }, body: patch },
      executeAction({ actionId, surface, input }) {
        assert.equal(surface, "console");
        return definitions.find(({ id }) => id === actionId).execute(input, context);
      }
    }, { code(status) { assert.equal(status, 200); return this; }, send() {} });
  }
  assert.deepEqual(calls, [
    { input: { targetSurfaceId: "home" }, options: { context } },
    { input: { targetSurfaceId: "home", patch }, patch, options: { context } }
  ]);
});
