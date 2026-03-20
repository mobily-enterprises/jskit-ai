import assert from "node:assert/strict";
import test from "node:test";

import { resolveSurfaceWorkspacePathFromPlacementContext } from "../src/client/lib/workspaceSurfacePaths.js";

test("resolveSurfaceWorkspacePathFromPlacementContext falls back to global account settings without workspace slug", () => {
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

  assert.equal(resolveSurfaceWorkspacePathFromPlacementContext(context, "app", "", "/"), "/account/settings");
});
