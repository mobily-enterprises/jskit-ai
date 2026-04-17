import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceShellLinkPath } from "../src/client/lib/workspaceLinkResolver.js";

function createContext({ defaultSurfaceId = "dashboard", enabledSurfaceIds = ["dashboard"], surfacesById = {} } = {}) {
  return {
    surfaceConfig: {
      defaultSurfaceId,
      enabledSurfaceIds,
      surfacesById
    }
  };
}

test("resolveWorkspaceShellLinkPath resolves workspace path for known workspace surfaces", () => {
  const context = {
    surfaceConfig: {
      defaultSurfaceId: "dashboard",
      enabledSurfaceIds: ["dashboard"],
      surfacesById: {
        dashboard: {
          routeBase: "/dashboard",
          requiresWorkspace: true
        }
      }
    }
  };

  const path = resolveWorkspaceShellLinkPath({
    context,
    surface: "dashboard",
    mode: "workspace",
    workspaceSlug: "acme"
  });

  assert.equal(path, "/w/acme");
});

test("resolveWorkspaceShellLinkPath returns empty path for unknown non-default workspace surface", () => {
  const context = createContext();
  const path = resolveWorkspaceShellLinkPath({
    context,
    surface: "admin",
    mode: "workspace",
    workspaceSlug: "acme"
  });

  assert.equal(path, "");
});

test("resolveWorkspaceShellLinkPath returns empty path for unknown non-workspace surface ids", () => {
  const context = createContext();
  const path = resolveWorkspaceShellLinkPath({
    context,
    surface: "ops",
    mode: "workspace",
    workspaceSlug: "acme"
  });

  assert.equal(path, "");
});
