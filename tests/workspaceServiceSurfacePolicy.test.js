import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceService } from "../server/modules/workspace/service.js";

function createServiceWithMemberships(memberships) {
  return createWorkspaceService({
    appConfig: {
      tenancyMode: "multi-workspace",
      features: {
        workspaceInvites: true
      }
    },
    rbacManifest: {
      roles: {
        member: {
          permissions: ["history.read", "history.write"]
        }
      }
    },
    workspacesRepository: {
      listByUserId: async () => memberships
    },
    workspaceMembershipsRepository: {},
    workspaceSettingsRepository: {
      ensureForWorkspaceId: async () => ({
        invitesEnabled: true,
        features: {},
        policy: {}
      })
    },
    workspaceInvitesRepository: {
      listPendingByEmail: async () => []
    },
    userSettingsRepository: {
      ensureForUserId: async () => ({
        lastActiveWorkspaceId: null
      }),
      updateLastActiveWorkspaceId: async () => undefined
    },
    userAvatarService: null
  });
}

function makeMembership(overrides = {}) {
  return {
    id: 1,
    slug: "acme",
    name: "Acme",
    color: "#0F6B54",
    avatarUrl: "",
    roleId: "member",
    membershipStatus: "active",
    ...overrides
  };
}

test("listWorkspacesForUser applies surface policy for non-app surfaces", async () => {
  const service = createServiceWithMemberships([makeMembership({ membershipStatus: "pending" })]);

  const result = await service.listWorkspacesForUser(
    { id: 7, email: "user@example.com" },
    {
      request: {
        headers: {
          "x-surface-id": "admin"
        }
      }
    }
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].slug, "acme");
  assert.equal(result[0].isAccessible, false);
});

test("resolveRequestContext workspaces list applies surface policy for non-app surfaces", async () => {
  const service = createServiceWithMemberships([makeMembership({ membershipStatus: "pending" })]);

  const context = await service.resolveRequestContext({
    user: { id: 7, email: "user@example.com" },
    request: {
      headers: {
        "x-surface-id": "admin"
      }
    },
    workspacePolicy: "optional"
  });

  assert.equal(context.workspace, null);
  assert.equal(context.workspaces.length, 1);
  assert.equal(context.workspaces[0].slug, "acme");
  assert.equal(context.workspaces[0].isAccessible, false);
});
