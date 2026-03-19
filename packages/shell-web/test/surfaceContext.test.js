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
          { id: "app", pagesRoot: "", requiresWorkspace: false },
          { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", requiresWorkspace: true },
          { id: "console", pagesRoot: "console", requiresWorkspace: false }
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
    pagesRoot: "w/[workspaceSlug]/admin",
    routeBase: "/w/:workspaceSlug/admin",
    enabled: true,
    requiresWorkspace: true
  });
  assert.deepEqual(surfaceConfig.surfacesById.console, {
    id: "console",
    pagesRoot: "console",
    routeBase: "/console",
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
          pagesRoot: "w/[workspaceSlug]/admin/",
          requiresWorkspace: true
        },
        app: {
          id: "app",
          pagesRoot: "",
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
      enabledSurfaceIds: ["app", "home", "console"],
      surfacesById: {
        app: {
          id: "app",
          pagesRoot: "app",
          routeBase: "/app",
          requiresWorkspace: true
        },
        home: {
          id: "home",
          pagesRoot: "",
          routeBase: "/",
          requiresWorkspace: false
        },
        console: {
          id: "console",
          pagesRoot: "console",
          routeBase: "/console",
          requiresWorkspace: false
        }
      }
    }
  };

  assert.equal(joinSurfacePath("/admin/", "/members/"), "/admin/members");
  assert.equal(resolveSurfaceIdFromPlacementPathname(context, "/console/settings"), "console");
  assert.equal(resolveSurfaceIdFromPlacementPathname(context, "/unknown"), "home");
  assert.equal(resolveSurfaceRootPathFromPlacementContext(context, "app"), "/app");
  assert.equal(resolveSurfaceRootPathFromPlacementContext(context, "home"), "/");
  assert.equal(resolveSurfacePathFromPlacementContext(context, "app", "/workspace/settings"), "/app/workspace/settings");
  assert.equal(resolveSurfacePathFromPlacementContext(context, "home", "members"), "/members");
});

test("resolveSurfaceIdFromPlacementPathname prefers most specific dynamic surface route base", () => {
  const context = {
    surfaceConfig: {
      defaultSurfaceId: "home",
      enabledSurfaceIds: ["home", "app", "admin", "console"],
      surfacesById: {
        home: { id: "home", pagesRoot: "", routeBase: "/" },
        app: { id: "app", pagesRoot: "w/[workspaceSlug]", routeBase: "/w/:workspaceSlug" },
        admin: { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", routeBase: "/w/:workspaceSlug/admin" },
        console: { id: "console", pagesRoot: "console", routeBase: "/console" }
      }
    }
  };

  assert.equal(resolveSurfaceIdFromPlacementPathname(context, "/"), "home");
  assert.equal(resolveSurfaceIdFromPlacementPathname(context, "/w/acme"), "app");
  assert.equal(resolveSurfaceIdFromPlacementPathname(context, "/w/acme/projects"), "app");
  assert.equal(resolveSurfaceIdFromPlacementPathname(context, "/w/acme/admin"), "admin");
  assert.equal(resolveSurfaceIdFromPlacementPathname(context, "/w/acme/admin/users"), "admin");
});
