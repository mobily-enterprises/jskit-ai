import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import {
  defineAssistantSurface,
  normalizeAssistantConfigScope,
  resolveAssistantRuntimeRoute,
  resolveAssistantSurfaceConfig
} from "../src/shared/assistantSurfaces.js";

test("assistant surface config resolves runtime/settings surface requirements from app config", () => {
  const appConfig = {
    surfaceDefinitions: {
      admin: { id: "admin", enabled: true, requiresWorkspace: true, accessPolicyId: "workspace_member" },
      console: { id: "console", enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" }
    },
    assistantSurfaces: {
      admin: {
        settingsSurfaceId: "console",
        configScope: "global"
      }
    }
  };

  const assistantSurface = resolveAssistantSurfaceConfig(appConfig, "admin");
  assert.deepEqual(assistantSurface, {
    targetSurfaceId: "admin",
    settingsSurfaceId: "console",
    configScope: "global",
    runtimeSurfaceRequiresWorkspace: true,
    settingsSurfaceRequiresWorkspace: false,
    settingsSurfaceRequiresConsoleOwner: true
  });
});

test("assistant surface config rejects invalid workspace-scoped assistant combinations", () => {
  const appConfig = {
    surfaceDefinitions: {
      home: { id: "home", enabled: true, requiresWorkspace: false, accessPolicyId: "public" },
      console: { id: "console", enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" }
    },
    assistantSurfaces: {
      home: {
        settingsSurfaceId: "console",
        configScope: "workspace"
      }
    }
  };

  assert.equal(resolveAssistantSurfaceConfig(appConfig, "home"), null);
  assert.equal(normalizeAssistantConfigScope("workspace"), "workspace");
  assert.equal(normalizeAssistantConfigScope("weird"), "global");
});

test("single-surface shorthand preserves explicit routing, scope and disabled surface boundaries", () => {
  const home = defineAssistantSurface("home");
  assert.deepEqual(home, {
    surfaceDefinitions: { home: { pagesRoot: "", requiresWorkspace: false } },
    assistantSurfaces: { home: { settingsSurfaceId: "home", configScope: "global" } }
  });
  assert.deepEqual(resolveAssistantSurfaceConfig(home, "home"), resolveAssistantSurfaceConfig({
    surfaceDefinitions: { home: { enabled: true, pagesRoot: "", requiresWorkspace: false } },
    assistantSurfaces: { home: { settingsSurfaceId: "home", configScope: "global" } }
  }, "home"));
  assert.equal(resolveAssistantSurfaceConfig(home, "console"), null);
  const workspace = defineAssistantSurface("admin", {
    pagesRoot: "w/[workspaceSlug]/admin", requiresWorkspace: true, accessPolicyId: "workspace_member"
  });
  assert.equal(workspace.surfaceDefinitions.admin.pagesRoot, "w/[workspaceSlug]/admin");
  assert.equal(workspace.surfaceDefinitions.admin.accessPolicyId, "workspace_member");
  assert.equal(resolveAssistantSurfaceConfig(workspace, "admin").configScope, "workspace");
  assert.equal(resolveAssistantSurfaceConfig(defineAssistantSurface("home", { enabled: false }), "home"), null);
  assert.equal(resolveAssistantSurfaceConfig(defineAssistantSurface("home", { configScope: "workspace" }), "home"), null);
  assert.throws(() => defineAssistantSurface(""), /surface id is required/u);
});

test("only the surface decides the runtime route, so HTTP and realtime name the same one", () => {
  const home = resolveAssistantSurfaceConfig(defineAssistantSurface("home"), "home");
  const admin = resolveAssistantSurfaceConfig(defineAssistantSurface("admin", { requiresWorkspace: true }), "admin");
  // A slug offered to a surface without workspaces is ignored rather than
  // producing a workspace URL the server answers with 404.
  assert.deepEqual(resolveAssistantRuntimeRoute(home, "acme"),
    { workspaceSlug: "", configured: true, endpoint: "/api/assistant/home" });
  assert.deepEqual(resolveAssistantRuntimeRoute(admin, " acme "),
    { workspaceSlug: "acme", configured: true, endpoint: "/api/w/acme/assistant/admin" });
  assert.equal(resolveAssistantRuntimeRoute(admin, "").configured, false);
  assert.equal(resolveAssistantRuntimeRoute(null, "acme").configured, false);
});

test("client runtime code routes from surface configuration and names no application surface", async () => {
  const root = new URL("../src/client/", import.meta.url);
  const files = (await readdir(root, { recursive: true })).filter(file => /\.(js|vue)$/u.test(file));
  for (const file of files) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.doesNotMatch(source, /["']admin["']|isAdminSurface/u, `${file} hard-codes an application surface`);
  }
  for (const file of ["composables/useAssistantConversation.js", "composables/useAssistantRuntime.js"]) {
    const source = await readFile(new URL(file, root), "utf8");
    assert.match(source, /resolveAssistantRuntimeRoute\(/u);
    assert.doesNotMatch(source, /buildAssistantApiPath\(/u, `${file} must route through resolveAssistantRuntimeRoute`);
  }
});
