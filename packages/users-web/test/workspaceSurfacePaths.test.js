import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveAccountSettingsPathFromPlacementContext,
  resolveSurfaceWorkspacePathFromPlacementContext
} from "../src/client/lib/workspaceSurfacePaths.js";

test("resolveSurfaceWorkspacePathFromPlacementContext returns empty path without workspace slug", () => {
  const context = {
    surfaceConfig: {
      defaultSurfaceId: "home",
      enabledSurfaceIds: ["home", "app", "admin", "console"],
      surfacesById: {
        home: { id: "home", routeBase: "/home", requiresWorkspace: false },
        app: { id: "app", routeBase: "/w/:workspaceSlug", requiresWorkspace: true },
        admin: { id: "admin", routeBase: "/w/:workspaceSlug/admin", requiresWorkspace: true },
        console: { id: "console", routeBase: "/console", requiresWorkspace: false }
      }
    }
  };

  assert.equal(resolveSurfaceWorkspacePathFromPlacementContext(context, "app", "", "/"), "");
});

test("resolveAccountSettingsPathFromPlacementContext uses account surface route when available", () => {
  const context = {
    surfaceConfig: {
      defaultSurfaceId: "home",
      enabledSurfaceIds: ["home", "account"],
      surfacesById: {
        home: { id: "home", routeBase: "/home", requiresWorkspace: false },
        account: { id: "account", routeBase: "/profile", requiresWorkspace: false }
      }
    }
  };

  assert.equal(resolveAccountSettingsPathFromPlacementContext(context), "/profile");
});
