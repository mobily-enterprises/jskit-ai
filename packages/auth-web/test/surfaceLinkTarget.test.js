import assert from "node:assert/strict";
import test from "node:test";
import { resolveSurfaceLinkTarget } from "../src/client/lib/surfaceLinkTarget.js";

function createPlacementContext() {
  return {
    workspace: {
      slug: "acme"
    },
    surfaceConfig: {
      tenancyMode: "workspace",
      defaultSurfaceId: "app",
      enabledSurfaceIds: ["app", "admin", "console"],
      surfacesById: {
        app: {
          id: "app",
          prefix: "/app",
          enabled: true,
          requiresWorkspace: true
        },
        admin: {
          id: "admin",
          prefix: "/admin",
          enabled: true,
          requiresWorkspace: true
        },
        console: {
          id: "console",
          prefix: "/console",
          enabled: true,
          requiresWorkspace: false
        }
      }
    }
  };
}

test("resolveSurfaceLinkTarget builds workspace-scoped path for workspace surfaces", () => {
  const to = resolveSurfaceLinkTarget({
    context: createPlacementContext(),
    surface: "admin",
    workspaceSuffix: "/projects",
    nonWorkspaceSuffix: "/projects"
  });

  assert.equal(to, "/admin/w/acme/projects");
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

test("resolveSurfaceLinkTarget returns empty when workspace slug is required but unavailable", () => {
  const to = resolveSurfaceLinkTarget({
    context: {
      surfaceConfig: createPlacementContext().surfaceConfig
    },
    surface: "admin",
    workspaceSuffix: "/projects"
  });

  assert.equal(to, "");
});
