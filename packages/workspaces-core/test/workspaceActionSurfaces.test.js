import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig,
  resolveWorkspaceMembershipOptionalSurfaceIdsFromAppConfig
} from "../src/server/support/workspaceActionSurfaces.js";

test("resolveWorkspaceMembershipOptionalSurfaceIdsFromAppConfig honors explicit surface policy overrides", () => {
  const surfaceIds = resolveWorkspaceMembershipOptionalSurfaceIdsFromAppConfig({
    surfaceAccessPolicies: {
      workspace_authenticated: {
        requireWorkspaceMembership: false
      },
      workspace_member: {
        requireWorkspaceMembership: true
      }
    },
    surfaceDefinitions: {
      app: {
        id: "app",
        enabled: true,
        requiresWorkspace: true,
        accessPolicyId: "workspace_authenticated"
      },
      admin: {
        id: "admin",
        enabled: true,
        requiresWorkspace: true,
        accessPolicyId: "workspace_member"
      },
      implicit: {
        id: "implicit",
        enabled: true,
        requiresWorkspace: true
      }
    }
  });

  assert.deepEqual(surfaceIds, ["app"]);
});

test("resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig picks a workspace surface when app default is non-workspace", () => {
  const surfaceId = resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig({
    surfaceDefaultId: "home",
    surfaceDefinitions: {
      home: { id: "home", enabled: true, requiresWorkspace: false },
      app: { id: "app", enabled: true, requiresWorkspace: true },
      admin: { id: "admin", enabled: true, requiresWorkspace: true }
    }
  });

  assert.equal(surfaceId, "app");
});

test("resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig falls back to app default when no workspace surfaces exist", () => {
  const surfaceId = resolveDefaultWorkspaceRouteSurfaceIdFromAppConfig({
    surfaceDefaultId: "home",
    surfaceDefinitions: {
      home: { id: "home", enabled: true, requiresWorkspace: false },
      ops: { id: "ops", enabled: true, requiresWorkspace: false }
    }
  });

  assert.equal(surfaceId, "home");
});
