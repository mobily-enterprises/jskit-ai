import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSurfaceConfigContext,
  readPlacementSurfaceConfig,
  joinSurfacePath,
  resolveSurfaceIdFromPlacementPathname,
  resolveSurfaceRootPathFromPlacementContext,
  resolveSurfacePathFromPlacementContext
} from "../src/client/placement/surfaceContext.js";

test("buildSurfaceConfigContext normalizes runtime definitions for placement context", () => {
  const surfaceConfig = buildSurfaceConfigContext(
    {
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
    },
    {
      tenancyMode: "workspace"
    }
  );

  assert.equal(surfaceConfig.defaultSurfaceId, "app");
  assert.equal(surfaceConfig.tenancyMode, "workspace");
  assert.deepEqual(surfaceConfig.enabledSurfaceIds, ["app", "admin"]);
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

test("readPlacementSurfaceConfig normalizes malformed context data", () => {
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
});

test("surface path helpers compose root and prefixed surface routes", () => {
  const context = {
    surfaceConfig: {
      tenancyMode: "workspace",
      enabledSurfaceIds: ["app", "root", "console"],
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
        },
        console: {
          id: "console",
          prefix: "/console",
          requiresWorkspace: false
        }
      }
    }
  };

  assert.equal(joinSurfacePath("/admin/", "/members/"), "/admin/members");
  assert.equal(resolveSurfaceIdFromPlacementPathname(context, "/console/settings"), "console");
  assert.equal(resolveSurfaceIdFromPlacementPathname(context, "/unknown"), "app");
  assert.equal(resolveSurfaceRootPathFromPlacementContext(context, "app"), "/app");
  assert.equal(resolveSurfaceRootPathFromPlacementContext(context, "root"), "/");
  assert.equal(resolveSurfacePathFromPlacementContext(context, "app", "/workspace/settings"), "/app/workspace/settings");
  assert.equal(resolveSurfacePathFromPlacementContext(context, "root", "members"), "/members");
});
