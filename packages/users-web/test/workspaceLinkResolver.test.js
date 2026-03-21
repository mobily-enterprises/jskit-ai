import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceShellLinkPath } from "../src/client/lib/workspaceLinkResolver.js";

test("resolveWorkspaceShellLinkPath uses configured default workspace surface fallback", () => {
  const context = {
    surfaceConfig: {
      defaultSurfaceId: "dashboard",
      enabledSurfaceIds: ["dashboard"],
      surfacesById: {}
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

test("resolveWorkspaceShellLinkPath keeps explicit non-default workspace surface segment", () => {
  const context = {
    surfaceConfig: {
      defaultSurfaceId: "dashboard",
      enabledSurfaceIds: ["dashboard"],
      surfacesById: {}
    }
  };

  const path = resolveWorkspaceShellLinkPath({
    context,
    surface: "admin",
    mode: "workspace",
    workspaceSlug: "acme"
  });

  assert.equal(path, "/w/acme/admin");
});

test("resolveWorkspaceShellLinkPath treats unknown console-like ids as regular surface segments", () => {
  const context = {
    surfaceConfig: {
      defaultSurfaceId: "dashboard",
      enabledSurfaceIds: ["dashboard"],
      surfacesById: {}
    }
  };

  const path = resolveWorkspaceShellLinkPath({
    context,
    surface: "console",
    mode: "workspace",
    workspaceSlug: "acme"
  });

  assert.equal(path, "/w/acme/console");
});
