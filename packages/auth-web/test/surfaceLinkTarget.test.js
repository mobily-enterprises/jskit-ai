import assert from "node:assert/strict";
import test from "node:test";
import { resolveSurfaceLinkTarget } from "../src/client/lib/surfaceLinkTarget.js";

function createPlacementContext() {
  return {
    surfaceConfig: {
      tenancyMode: "workspace",
      defaultSurfaceId: "app",
      enabledSurfaceIds: ["app", "admin", "console"],
      surfacesById: {
        app: {
          id: "app",
          pagesRoot: "app",
          routeBase: "/app",
          enabled: true,
          requiresWorkspace: true
        },
        admin: {
          id: "admin",
          pagesRoot: "admin",
          routeBase: "/admin",
          enabled: true,
          requiresWorkspace: true
        },
        console: {
          id: "console",
          pagesRoot: "console",
          routeBase: "/console",
          enabled: true,
          requiresWorkspace: false
        }
      }
    }
  };
}

test("resolveSurfaceLinkTarget builds surface-scoped path for target surfaces", () => {
  const to = resolveSurfaceLinkTarget({
    context: createPlacementContext(),
    surface: "admin",
    workspaceSuffix: "/projects",
    nonWorkspaceSuffix: "/projects"
  });

  assert.equal(to, "/admin/projects");
});

test("resolveSurfaceLinkTarget builds non-workspace path for non-workspace surfaces", () => {
  const to = resolveSurfaceLinkTarget({
    context: createPlacementContext(),
    surface: "console",
    workspaceSuffix: "/projects",
    nonWorkspaceSuffix: "/projects"
  });

  assert.equal(to, "/console/projects");
});

test("resolveSurfaceLinkTarget returns explicit target unchanged", () => {
  const to = resolveSurfaceLinkTarget({
    context: createPlacementContext(),
    surface: "admin",
    explicitTo: "/custom/target"
  });

  assert.equal(to, "/custom/target");
});

test("resolveSurfaceLinkTarget no longer requires workspace slug for surface links", () => {
  const to = resolveSurfaceLinkTarget({
    context: {
      surfaceConfig: createPlacementContext().surfaceConfig
    },
    surface: "admin",
    workspaceSuffix: "/projects"
  });

  assert.equal(to, "/admin/projects");
});
