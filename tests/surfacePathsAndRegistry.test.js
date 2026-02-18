import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_SURFACE_PREFIX,
  GOD_SURFACE_PREFIX,
  SURFACE_ADMIN,
  SURFACE_APP,
  SURFACE_GOD,
  createSurfacePaths,
  normalizePathname,
  resolveSurfaceFromPathname,
  resolveSurfacePaths,
  resolveSurfacePrefix,
  withSurfacePrefix
} from "../shared/routing/surfacePaths.js";
import {
  DEFAULT_SURFACE_ID,
  listSurfaceDefinitions,
  normalizeSurfaceId,
  resolveSurfacePrefix as resolveSurfacePrefixFromRegistry,
  surfaceRequiresWorkspace,
  SURFACE_REGISTRY
} from "../shared/routing/surfaceRegistry.js";
import { resolveSurfaceById, SURFACES } from "../server/surfaces/index.js";
import { canAccessWorkspace as canAccessAdminWorkspace } from "../server/surfaces/adminSurface.js";

test("surface registry normalizes ids, prefixes, and definitions", () => {
  assert.equal(DEFAULT_SURFACE_ID, "app");
  assert.deepEqual(Object.keys(SURFACE_REGISTRY).sort(), ["admin", "app", "god"]);
  assert.equal(normalizeSurfaceId("ADMIN"), "admin");
  assert.equal(normalizeSurfaceId("GOD"), "god");
  assert.equal(normalizeSurfaceId("unknown"), "app");
  assert.equal(resolveSurfacePrefixFromRegistry("admin"), "/admin");
  assert.equal(resolveSurfacePrefixFromRegistry("app"), "");
  assert.equal(resolveSurfacePrefixFromRegistry("god"), "/god");
  assert.equal(resolveSurfacePrefixFromRegistry("unknown"), "");
  assert.equal(surfaceRequiresWorkspace("app"), true);
  assert.equal(surfaceRequiresWorkspace("admin"), true);
  assert.equal(surfaceRequiresWorkspace("god"), false);
  assert.equal(surfaceRequiresWorkspace("unknown"), true);

  const definitions = listSurfaceDefinitions();
  assert.equal(
    definitions.some((entry) => entry.id === "app"),
    true
  );
  assert.equal(
    definitions.some((entry) => entry.id === "admin"),
    true
  );
  assert.equal(
    definitions.some((entry) => entry.id === "god"),
    true
  );
});

test("surface path helpers normalize paths and resolve surface by prefix", () => {
  assert.equal(ADMIN_SURFACE_PREFIX, "/admin");
  assert.equal(GOD_SURFACE_PREFIX, "/god");
  assert.equal(SURFACE_APP, "app");
  assert.equal(SURFACE_ADMIN, "admin");
  assert.equal(SURFACE_GOD, "god");

  assert.equal(normalizePathname(""), "/");
  assert.equal(normalizePathname("   "), "/");
  assert.equal(normalizePathname("api/history"), "/api/history");
  assert.equal(normalizePathname("/api/history///"), "/api/history");
  assert.equal(normalizePathname("/admin/w/acme?x=1#y=2"), "/admin/w/acme");

  assert.equal(resolveSurfaceFromPathname("/admin"), "admin");
  assert.equal(resolveSurfaceFromPathname("/admin/w/acme"), "admin");
  assert.equal(resolveSurfaceFromPathname("/god"), "god");
  assert.equal(resolveSurfaceFromPathname("/god/login"), "god");
  assert.equal(resolveSurfaceFromPathname("/w/acme"), "app");
  assert.equal(resolveSurfacePrefix("admin"), "/admin");
  assert.equal(resolveSurfacePrefix("app"), "");
  assert.equal(resolveSurfacePrefix("god"), "/god");
  assert.equal(withSurfacePrefix("admin", "/w/acme"), "/admin/w/acme");
  assert.equal(withSurfacePrefix("god", "/login"), "/god/login");
  assert.equal(withSurfacePrefix("app", "/w/acme"), "/w/acme");
  assert.equal(withSurfacePrefix("admin", "/"), "/admin");
  assert.equal(withSurfacePrefix("god", "/"), "/god");
  assert.equal(withSurfacePrefix("app", "/"), "/");
});

test("createSurfacePaths builds route helpers for app, admin, and god surfaces", () => {
  const appPaths = createSurfacePaths("app");
  assert.equal(appPaths.surface, "app");
  assert.equal(appPaths.prefix, "");
  assert.equal(appPaths.rootPath, "/");
  assert.equal(appPaths.loginPath, "/login");
  assert.equal(appPaths.resetPasswordPath, "/reset-password");
  assert.equal(appPaths.workspacesPath, "/workspaces");
  assert.equal(appPaths.accountSettingsPath, "/account/settings");
  assert.equal(appPaths.workspacePath("acme"), "/w/acme");
  assert.equal(appPaths.workspacePath("acme", "choice-2"), "/w/acme/choice-2");
  assert.equal(appPaths.workspacePath(""), "/workspaces");
  assert.equal(appPaths.workspaceHomePath("acme"), "/w/acme");
  assert.equal(appPaths.extractWorkspaceSlug("/w/acme"), "acme");
  assert.equal(appPaths.extractWorkspaceSlug("/workspaces"), "");
  assert.equal(appPaths.isPublicAuthPath("/login"), true);
  assert.equal(appPaths.isPublicAuthPath("/reset-password"), true);
  assert.equal(appPaths.isPublicAuthPath("/w/acme"), false);
  assert.equal(appPaths.isLoginPath("/login"), true);
  assert.equal(appPaths.isResetPasswordPath("/reset-password"), true);
  assert.equal(appPaths.isWorkspacesPath("/workspaces"), true);
  assert.equal(appPaths.isAccountSettingsPath("/account/settings"), true);

  const adminPaths = createSurfacePaths("admin");
  assert.equal(adminPaths.surface, "admin");
  assert.equal(adminPaths.prefix, "/admin");
  assert.equal(adminPaths.rootPath, "/admin");
  assert.equal(adminPaths.loginPath, "/admin/login");
  assert.equal(adminPaths.workspacePath("acme"), "/admin/w/acme");
  assert.equal(adminPaths.workspacePath("acme", "/settings"), "/admin/w/acme/settings");
  assert.equal(adminPaths.extractWorkspaceSlug("/admin/w/acme"), "acme");

  const godPaths = createSurfacePaths("god");
  assert.equal(godPaths.surface, "god");
  assert.equal(godPaths.prefix, "/god");
  assert.equal(godPaths.rootPath, "/god");
  assert.equal(godPaths.loginPath, "/god/login");
  assert.equal(godPaths.resetPasswordPath, "/god/reset-password");
  assert.equal(godPaths.accountSettingsPath, "/god/account/settings");
  assert.equal(godPaths.isPublicAuthPath("/god/login"), true);
  assert.equal(godPaths.isPublicAuthPath("/god"), false);
  assert.equal(godPaths.extractWorkspaceSlug("/god/w/acme"), "acme");
});

test("resolveSurfacePaths prefers browser pathname when available", () => {
  const originalWindow = globalThis.window;

  const noBrowser = resolveSurfacePaths("/admin/w/acme");
  assert.equal(noBrowser.surface, "admin");

  globalThis.window = {
    location: {
      pathname: "/w/chiara"
    }
  };
  try {
    const fromBrowserPath = resolveSurfacePaths("/admin/w/acme");
    assert.equal(fromBrowserPath.surface, "app");
    assert.equal(fromBrowserPath.workspacePath("chiara"), "/w/chiara");
  } finally {
    globalThis.window = originalWindow;
  }
});

test("surface resolver and admin surface access rules cover supported and fallback behavior", () => {
  assert.equal(typeof SURFACES.app.canAccessWorkspace, "function");
  assert.equal(typeof SURFACES.admin.canAccessWorkspace, "function");
  assert.equal(typeof SURFACES.god.canAccessWorkspace, "function");
  assert.equal(resolveSurfaceById("unknown").id, "app");
  assert.equal(resolveSurfaceById("admin").id, "admin");
  assert.equal(resolveSurfaceById("god").id, "god");

  const godWorkspaceAccess = SURFACES.god.canAccessWorkspace({});
  assert.deepEqual(godWorkspaceAccess, {
    allowed: false,
    reason: "surface_not_supported",
    permissions: []
  });

  const denied = canAccessAdminWorkspace({
    membership: {
      roleId: "member",
      status: "pending"
    }
  });
  assert.deepEqual(denied, {
    allowed: false,
    reason: "membership_required",
    permissions: []
  });

  const allowed = canAccessAdminWorkspace({
    membership: {
      roleId: "admin",
      status: "active"
    },
    resolvePermissions: () => ["workspace.settings.view", "workspace.settings.update"]
  });
  assert.deepEqual(allowed, {
    allowed: true,
    reason: "allowed",
    permissions: ["workspace.settings.view", "workspace.settings.update"]
  });
});
