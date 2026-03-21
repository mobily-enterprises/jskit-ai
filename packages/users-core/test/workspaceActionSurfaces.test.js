import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeWorkspaceActionSurfacesFromAppConfig,
  resolveConsoleSurfaceIdsFromAppConfig,
  resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig
} from "../src/server/support/workspaceActionSurfaces.js";

test("materializeWorkspaceActionSurfacesFromAppConfig resolves workspace surfaces from appConfig", () => {
  const actionDefinitions = [
    {
      id: "workspace.settings.read",
      surfacesFrom: "workspace"
    },
    {
      id: "auth.session.read",
      surfacesFrom: "enabled"
    }
  ];

  const materialized = materializeWorkspaceActionSurfacesFromAppConfig(actionDefinitions, {
    appConfig: {
      surfaceDefinitions: {
        app: { id: "app", enabled: true, requiresWorkspace: true },
        admin: { id: "admin", enabled: true, requiresWorkspace: true },
        console: { id: "console", enabled: true, requiresWorkspace: false }
      }
    }
  });

  assert.deepEqual(materialized, [
    {
      id: "workspace.settings.read",
      surfaces: ["app", "admin"]
    },
    {
      id: "auth.session.read",
      surfacesFrom: "enabled"
    }
  ]);
});

test("materializeWorkspaceActionSurfacesFromAppConfig drops workspace actions when no workspace surfaces are enabled", () => {
  const actionDefinitions = [
    {
      id: "workspace.settings.read",
      surfacesFrom: "workspace"
    }
  ];

  const materialized = materializeWorkspaceActionSurfacesFromAppConfig(actionDefinitions, {
    appConfig: {
      surfaceDefinitions: {
        app: { id: "app", enabled: true, requiresWorkspace: false },
        console: { id: "console", enabled: true, requiresWorkspace: false }
      }
    }
  });

  assert.deepEqual(materialized, []);
});

test("resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig picks a workspace surface when app default is non-workspace", () => {
  const surfaceId = resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig({
    surfaceDefaultId: "home",
    surfaceDefinitions: {
      home: { id: "home", enabled: true, requiresWorkspace: false },
      app: { id: "app", enabled: true, requiresWorkspace: true },
      admin: { id: "admin", enabled: true, requiresWorkspace: true }
    }
  });

  assert.equal(surfaceId, "app");
});

test("resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig falls back to app default when no workspace surfaces exist", () => {
  const surfaceId = resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig({
    surfaceDefaultId: "home",
    surfaceDefinitions: {
      home: { id: "home", enabled: true, requiresWorkspace: false },
      console: { id: "console", enabled: true, requiresWorkspace: false }
    }
  });

  assert.equal(surfaceId, "home");
});

test("resolveConsoleSurfaceIdsFromAppConfig resolves all enabled console-owner surfaces", () => {
  const surfaceIds = resolveConsoleSurfaceIdsFromAppConfig({
    surfaceDefinitions: {
      home: { id: "home", enabled: true, requiresWorkspace: false, accessPolicyId: "public" },
      console: { id: "console", enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" },
      opsConsole: { id: "opsConsole", enabled: true, requiresWorkspace: false, accessPolicyId: "console_owner" },
      app: { id: "app", enabled: true, requiresWorkspace: true, accessPolicyId: "workspace_member" },
      disabledConsole: {
        id: "disabledConsole",
        enabled: false,
        requiresWorkspace: false,
        accessPolicyId: "console_owner"
      }
    }
  });

  assert.deepEqual(surfaceIds, ["console", "opsconsole"]);
});
