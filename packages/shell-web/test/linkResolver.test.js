import assert from "node:assert/strict";
import test from "node:test";
import { resolveShellLinkPath } from "../src/client/navigation/linkResolver.js";

function createPlacementContext() {
  return {
    workspace: {
      slug: "acme"
    },
    surfaceRoles: {
      "workspace.main": "app",
      "workspace.admin": "admin",
      "console.global": "console"
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

function createPlacementContextForTenancyMode(tenancyMode = "workspace") {
  const normalizedMode = String(tenancyMode || "").trim().toLowerCase();
  if (normalizedMode === "none") {
    return {
      workspace: null,
      surfaceRoles: {
        "app.global": "app",
        "console.global": "console"
      },
      surfaceConfig: {
        tenancyMode: "none",
        defaultSurfaceId: "app",
        enabledSurfaceIds: ["app", "console"],
        surfacesById: {
          app: {
            id: "app",
            prefix: "/",
            enabled: true,
            requiresWorkspace: false
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

  return {
    workspace: {
      slug: "acme"
    },
    surfaceRoles: {
      "workspace.main": "app",
      "workspace.admin": "admin",
      "console.global": "console"
    },
    surfaceConfig: {
      tenancyMode: normalizedMode === "personal" ? "personal" : "workspace",
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

test("resolveShellLinkPath composes workspace path in auto mode when workspace is available", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "admin",
    relativePath: "/contacts/2",
    mode: "auto"
  });

  assert.equal(to, "/w/acme/admin/contacts/2");
});

test("resolveShellLinkPath composes non-workspace path in auto mode for non-workspace surface", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "console",
    relativePath: "/contacts",
    mode: "auto"
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

test("resolveShellLinkPath supports workspace/surface specific relative paths", () => {
  const context = {
    ...createPlacementContext(),
    workspace: null
  };

  const withoutWorkspace = resolveShellLinkPath({
    context,
    surface: "admin",
    mode: "auto",
    workspaceRelativePath: "/workspace/settings",
    surfaceRelativePath: "/contacts"
  });
  assert.equal(withoutWorkspace, "");

  const withWorkspace = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "admin",
    mode: "auto",
    workspaceRelativePath: "/workspace/settings",
    surfaceRelativePath: "/contacts"
  });
  assert.equal(withWorkspace, "/w/acme/admin/workspace/settings");
});

test("resolveShellLinkPath uses deterministic surface fallback when context is missing", () => {
  const to = resolveShellLinkPath({
    context: null,
    surface: "admin",
    workspaceSlug: "acme",
    relativePath: "/contacts/5"
  });

  assert.equal(to, "/w/acme/admin/contacts/5");
});

test("resolveShellLinkPath keeps console singleton fallback when context is missing", () => {
  const to = resolveShellLinkPath({
    context: null,
    surface: "console",
    workspaceSlug: "acme",
    relativePath: "/contacts/5"
  });

  assert.equal(to, "/console/contacts/5");
});

test("resolveShellLinkPath in workspace mode falls back to surface path for non-workspace surfaces", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surface: "console",
    mode: "workspace",
    workspaceRelativePath: "/workspace/ignored",
    surfaceRelativePath: "/settings"
  });

  assert.equal(to, "/console/settings");
});

test("resolveShellLinkPath resolves surface id from target surface role", () => {
  const to = resolveShellLinkPath({
    context: createPlacementContext(),
    surfaceRole: "workspace.admin",
    relativePath: "/contacts/2",
    mode: "auto"
  });

  assert.equal(to, "/w/acme/admin/contacts/2");
});

test("resolveShellLinkPath follows tenancy mode matrix for shell surfaces", () => {
  const cases = [
    {
      tenancyMode: "none",
      surface: "app",
      relativePath: "/projects",
      expectedPath: "/projects"
    },
    {
      tenancyMode: "none",
      surface: "console",
      relativePath: "/settings",
      expectedPath: "/console/settings"
    },
    {
      tenancyMode: "personal",
      surface: "app",
      relativePath: "/projects",
      expectedPath: "/w/acme/projects"
    },
    {
      tenancyMode: "personal",
      surface: "admin",
      relativePath: "/settings",
      expectedPath: "/w/acme/admin/settings"
    },
    {
      tenancyMode: "personal",
      surface: "console",
      relativePath: "/settings",
      expectedPath: "/console/settings"
    },
    {
      tenancyMode: "workspace",
      surface: "app",
      relativePath: "/projects",
      expectedPath: "/w/acme/projects"
    },
    {
      tenancyMode: "workspace",
      surface: "admin",
      relativePath: "/settings",
      expectedPath: "/w/acme/admin/settings"
    },
    {
      tenancyMode: "workspace",
      surface: "console",
      relativePath: "/settings",
      expectedPath: "/console/settings"
    }
  ];

  for (const entry of cases) {
    const resolvedPath = resolveShellLinkPath({
      context: createPlacementContextForTenancyMode(entry.tenancyMode),
      surface: entry.surface,
      relativePath: entry.relativePath,
      mode: "auto"
    });
    assert.equal(resolvedPath, entry.expectedPath);
  }
});
