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

test("resolveProfileMenuLinks builds admin target from app workspace surface", () => {
  const links = resolveProfileMenuLinks({
    context: createPlacementContext(),
    surface: "app"
  });

  assert.equal(links[0].label, "Go to admin");
  assert.equal(links[0].to, "/w/acme/admin");
  assert.equal(links[1].label, "Go to console");
  assert.equal(links[1].to, "/console");
});

test("resolveProfileMenuLinks builds app target from admin workspace surface", () => {
  const links = resolveProfileMenuLinks({
    context: createPlacementContext(),
    surface: "admin"
  });

  assert.equal(links[0].label, "Go to app");
  assert.equal(links[0].to, "/w/acme");
  assert.equal(links[1].label, "Go to console");
  assert.equal(links[1].to, "/console");
});

test("resolveProfileMenuLinks builds workspace target from console surface", () => {
  const links = resolveProfileMenuLinks({
    context: createPlacementContext(),
    surface: "console"
  });

  assert.equal(links.length, 1);
  assert.equal(links[0].label, "Go to workspace");
  assert.equal(links[0].to, "/w/acme");
});
