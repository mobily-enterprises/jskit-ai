import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSurfaceConfigContext,
  readPlacementSurfaceConfig,
  surfaceRequiresWorkspaceFromPlacementContext,
  joinSurfacePath,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfacePathFromPlacementContext
} from "../src/client/placement/surfaceContext.js";

test("buildSurfaceConfigContext normalizes runtime definitions for placement context", () => {
  const surfaceConfig = buildSurfaceConfigContext({
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
  assert.equal(resolveSurfaceRootPathFromPlacementContext(context, "app"), "/app");
  assert.equal(resolveSurfaceRootPathFromPlacementContext(context, "root"), "/");
  assert.equal(resolveSurfacePathFromPlacementContext(context, "app", "/workspace/settings"), "/app/workspace/settings");
  assert.equal(resolveSurfacePathFromPlacementContext(context, "root", "members"), "/members");
});
