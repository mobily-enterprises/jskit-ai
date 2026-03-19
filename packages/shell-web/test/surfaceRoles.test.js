import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSurfaceRolesContext,
  normalizeSurfaceRole,
  normalizeSurfaceRolesConfig,
  readPlacementSurfaceRoles,
  resolveSurfaceIdForRole
} from "../src/client/placement/surfaceRoles.js";

test("normalizeSurfaceRole lowercases and rejects invalid role tokens", () => {
  assert.equal(normalizeSurfaceRole(" Workspace.Main "), "workspace.main");
  assert.equal(normalizeSurfaceRole("console global"), "");
  assert.equal(normalizeSurfaceRole(""), "");
});

test("normalizeSurfaceRolesConfig keeps only enabled surfaces and deterministic role ordering", () => {
  const roles = normalizeSurfaceRolesConfig(
    {
      "workspace.main": "APP",
      "workspace.admin": "admin",
      "console.global": "console",
      "bad role": "app",
      "workspace.missing": "missing"
    },
    {
      enabledSurfaceIds: ["app", "admin", "console"],
      defaultSurfaceId: "app"
    }
  );

  assert.deepEqual(roles.roles, ["console.global", "workspace.admin", "workspace.main"]);
  assert.deepEqual(roles.surfaceIdByRole, {
    "workspace.main": "app",
    "workspace.admin": "admin",
    "console.global": "console"
  });
  assert.deepEqual(roles.rolesBySurfaceId, {
    app: ["workspace.main"],
    admin: ["workspace.admin"],
    console: ["console.global"]
  });
  assert.equal(roles.defaultRole, "workspace.main");
});

test("buildSurfaceRolesContext honors configured default role when valid", () => {
  const roles = buildSurfaceRolesContext({
    appConfig: {
      surfaceRoles: {
        "workspace.main": "app",
        "workspace.admin": "admin"
      },
      surfaceDefaultRole: "workspace.admin"
    },
    surfaceConfig: {
      enabledSurfaceIds: ["app", "admin"],
      defaultSurfaceId: "app"
    }
  });

  assert.equal(roles.defaultRole, "workspace.admin");
  assert.equal(resolveSurfaceIdForRole(roles, "workspace.main"), "app");
  assert.equal(resolveSurfaceIdForRole(roles, "workspace.unknown"), "");
});

test("readPlacementSurfaceRoles re-normalizes context payload", () => {
  const roles = readPlacementSurfaceRoles({
    surfaceConfig: {
      enabledSurfaceIds: ["app", "console"],
      defaultSurfaceId: "app"
    },
    surfaceRoles: {
      "app.global": "app",
      "console.global": "console",
      "workspace.admin": "admin"
    }
  });

  assert.deepEqual(roles.surfaceIdByRole, {
    "app.global": "app",
    "console.global": "console"
  });
});
