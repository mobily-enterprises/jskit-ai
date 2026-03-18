import assert from "node:assert/strict";
import test from "node:test";
import {
  TENANCY_MODE_WORKSPACE,
  buildSurfaceConfigContext,
  readPlacementSurfaceConfig,
  surfaceRequiresWorkspaceFromPlacementContext,
  resolveSurfaceSwitchTargetsFromPlacementContext,
  joinSurfacePath,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceWorkspacesPathFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext,
  extractWorkspaceSlugFromSurfacePathname,
  resolveSurfaceApiPathFromPlacementContext,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfacePathFromPlacementContext
} from "../src/client/placement/surfaceContext.js";

test("buildSurfaceConfigContext normalizes runtime definitions for placement context", () => {
  const surfaceConfig = buildSurfaceConfigContext({
    TENANCY_MODE: TENANCY_MODE_WORKSPACE,
    DEFAULT_SURFACE_ID: "APP",
    listEnabledSurfaceIds() {
      return [" APP ", "admin"];
    },
    listSurfaceDefinitions() {
      return [
        { id: "app", prefix: "/app", requiresWorkspace: false },
        { id: "admin", prefix: "admin/", requiresWorkspace: true },
        { id: "console", prefix: "/console", requiresWorkspace: false }
      ];
    }
  });

  assert.equal(surfaceConfig.defaultSurfaceId, "app");
  assert.equal(surfaceConfig.tenancyMode, "workspace");
  assert.deepEqual(surfaceConfig.enabledSurfaceIds, ["app", "admin"]);
  assert.deepEqual(surfaceConfig.workspaceSurfaceIds, ["admin"]);
  assert.deepEqual(surfaceConfig.nonWorkspaceSurfaceIds, ["app"]);
  assert.deepEqual(surfaceConfig.surfacesById.admin, {
    id: "admin",
    prefix: "/admin",
    enabled: true,
    requiresWorkspace: true
  });
  assert.deepEqual(surfaceConfig.surfacesById.console, {
    id: "console",
    prefix: "/console",
    enabled: false,
    requiresWorkspace: false
  });
});

test("readPlacementSurfaceConfig and workspace helpers normalize malformed context data", () => {
  const context = {
    surfaceConfig: {
      tenancyMode: "workspace",
      defaultSurfaceId: " ADMIN ",
      enabledSurfaceIds: ["admin", "app", "app"],
      surfacesById: {
        admin: {
          id: "ADMIN",
          prefix: "/admin/",
          requiresWorkspace: true
        },
        app: {
          id: "app",
          prefix: "/",
          requiresWorkspace: false
        }
      }
    }
  };

  const surfaceConfig = readPlacementSurfaceConfig(context);
  assert.equal(surfaceConfig.defaultSurfaceId, "admin");
  assert.deepEqual(surfaceConfig.enabledSurfaceIds, ["admin", "app"]);
  assert.equal(surfaceRequiresWorkspaceFromPlacementContext(context, "admin"), true);
  assert.equal(surfaceRequiresWorkspaceFromPlacementContext(context, "app"), false);
  assert.equal(surfaceRequiresWorkspaceFromPlacementContext(context, "missing"), false);
});

test("surface path helpers compose root and prefixed surface routes", () => {
  const context = {
    surfaceConfig: {
      tenancyMode: "workspace",
      enabledSurfaceIds: ["app", "root"],
      surfacesById: {
        app: {
          id: "app",
          prefix: "/app",
          requiresWorkspace: true
        },
        root: {
          id: "root",
          prefix: "/",
          requiresWorkspace: false
        }
      }
    }
  };

  assert.equal(joinSurfacePath("/admin/", "/members/"), "/admin/members");
  assert.equal(resolveSurfaceIdFromPlacementPathname(context, "/w/acme/workspace/settings"), "app");
  assert.equal(resolveSurfaceIdFromPlacementPathname(context, "/unknown"), "app");
  assert.equal(resolveSurfaceRootPathFromPlacementContext(context, "app"), "/app");
  assert.equal(resolveSurfaceRootPathFromPlacementContext(context, "root"), "/");
  assert.equal(resolveSurfaceWorkspacesPathFromPlacementContext(context, "app"), "/app/workspaces");
  assert.equal(resolveSurfaceWorkspacePathFromPlacementContext(context, "app", "acme"), "/w/acme");
  assert.equal(
    resolveSurfaceWorkspacePathFromPlacementContext(context, "app", "acme", "/workspace/settings"),
    "/w/acme/workspace/settings"
  );
  assert.equal(extractWorkspaceSlugFromSurfacePathname(context, "app", "/w/acme/workspace/settings"), "acme");
  assert.equal(resolveSurfaceApiPathFromPlacementContext(context, "app", "/workspace/settings"), "/api/workspace/settings");
  assert.equal(resolveSurfaceApiPathFromPlacementContext(context, "root", "/workspace/settings"), "/api/workspace/settings");
  assert.equal(resolveSurfacePathFromPlacementContext(context, "app", "/workspace/settings"), "/app/workspace/settings");
  assert.equal(resolveSurfacePathFromPlacementContext(context, "root", "members"), "/members");
});

test("resolveSurfaceSwitchTargetsFromPlacementContext picks workspace and app targets", () => {
  const context = {
    surfaceConfig: {
      tenancyMode: "workspace",
      defaultSurfaceId: "app",
      enabledSurfaceIds: ["app", "coffie", "console"],
      surfacesById: {
        app: {
          id: "app",
          prefix: "/app",
          requiresWorkspace: false
        },
        coffie: {
          id: "coffie",
          prefix: "/coffie",
          requiresWorkspace: true
        },
        console: {
          id: "console",
          prefix: "/console",
          requiresWorkspace: false
        }
      }
    }
  };

  const fromApp = resolveSurfaceSwitchTargetsFromPlacementContext(context, "app");
  assert.equal(fromApp.currentSurfaceId, "app");
  assert.equal(fromApp.workspaceSurfaceId, "coffie");
  assert.equal(fromApp.nonWorkspaceSurfaceId, "console");
  assert.equal(fromApp.defaultSurfaceId, "app");

  const fromWorkspace = resolveSurfaceSwitchTargetsFromPlacementContext(context, "coffie");
  assert.equal(fromWorkspace.currentSurfaceId, "coffie");
  assert.equal(fromWorkspace.workspaceSurfaceId, "");
  assert.equal(fromWorkspace.nonWorkspaceSurfaceId, "app");
  assert.equal(fromWorkspace.defaultSurfaceId, "app");
});
