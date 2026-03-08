import assert from "node:assert/strict";
import test from "node:test";
import { resolveProfileMenuLinks } from "../src/client/lib/profileMenuLinks.js";

function createPlacementContext() {
  return {
    auth: {
      authenticated: true
    },
    permissions: ["console.operator"],
    workspace: {
      slug: "acme"
    },
    surfaceConfig: {
      tenancyMode: "workspace",
      defaultSurfaceId: "app",
      enabledSurfaceIds: ["app", "coffie", "console"],
      surfacesById: {
        app: {
          id: "app",
          prefix: "/app",
          enabled: true,
          requiresWorkspace: false
        },
        coffie: {
          id: "coffie",
          prefix: "/coffie",
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

test("resolveProfileMenuLinks builds workspace-aware target from non-workspace surface", () => {
  const links = resolveProfileMenuLinks({
    context: createPlacementContext(),
    surface: "app"
  });

  assert.equal(links[0].label, "Go to workspace");
  assert.equal(links[0].to, "/coffie/w/acme");
  assert.equal(links[1].label, "Go to console");
  assert.equal(links[1].to, "/console");
});

test("resolveProfileMenuLinks builds app target from workspace surface", () => {
  const links = resolveProfileMenuLinks({
    context: createPlacementContext(),
    surface: "coffie"
  });

  assert.equal(links[0].label, "Go to app");
  assert.equal(links[0].to, "/app/w/acme");
  assert.equal(links[1].label, "Go to console");
  assert.equal(links[1].to, "/console");
});
