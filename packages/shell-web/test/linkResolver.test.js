import assert from "node:assert/strict";
import test from "node:test";
import { resolveShellLinkPath } from "../src/client/navigation/linkResolver.js";

function createPlacementContext() {
  return {
    surfaceConfig: {
      tenancyMode: "workspace",
      defaultSurfaceId: "app",
      enabledSurfaceIds: ["app", "admin", "console"],
      surfacesById: {
        app: {
          id: "app",
          prefix: "/",
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

test("resolveShellLinkPath composes surface path for workspace-labeled surfaces", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "admin",
    relativePath: "/contacts/2"
  });

  assert.equal(to, "/admin/contacts/2");
});

test("resolveShellLinkPath composes non-workspace path for non-workspace surface", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "console",
    relativePath: "/contacts"
  });

  assert.equal(to, "/console/contacts");
});

test("resolveShellLinkPath keeps explicit target unchanged", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "admin",
    explicitTo: "/custom/path"
  });

  assert.equal(to, "/custom/path");
});

test("resolveShellLinkPath prefers surfaceRelativePath when provided", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "admin",
    relativePath: "/ignored",
    surfaceRelativePath: "/contacts"
  });

  assert.equal(to, "/admin/contacts");
});

test("resolveShellLinkPath uses deterministic surface fallback when context is missing", () => {
  const to = resolveShellLinkPath({
    context: null,
    surface: "admin",
    relativePath: "/contacts/5"
  });

  assert.equal(to, "/admin/contacts/5");
});
