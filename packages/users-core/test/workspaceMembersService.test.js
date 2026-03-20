import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/server/workspaceMembers/workspaceMembersService.js";
import { createWorkspaceRoleCatalog } from "../src/shared/roles.js";

function authorizedOptions(permissions = []) {
  return {
    context: {
      actor: {
        id: 1
      },
      permissions
    }
  };
}

function createRoleCatalog() {
  return createWorkspaceRoleCatalog({
    workspaceRoles: {
      defaultInviteRole: "member",
      roles: {
        owner: {
          assignable: false,
          permissions: ["*"]
        },
        admin: {
          assignable: true,
          permissions: ["workspace.members.manage"]
        },
        member: {
          assignable: true,
          permissions: ["workspace.members.view", "workspace.members.invite"]
        }
      }
    }
  });
}

function createFixture() {
  const workspace = {
    id: 7,
    slug: "tonymobily3",
    name: "TonyMobily3",
    ownerUserId: 9,
    avatarUrl: "",
    color: "#0F6B54"
  };

  const service = createService({
    workspaceMembershipsRepository: {
      async listActiveByWorkspaceId(workspaceId) {
        assert.equal(Number(workspaceId), 7);
        return [
          {
            userId: 11,
            roleId: "member",
            status: "active",
            displayName: "Alice",
            email: "alice@example.com"
          }
        ];
      },
      async findByWorkspaceIdAndUserId(workspaceId, userId) {
        assert.equal(Number(workspaceId), 7);
        assert.equal(Number(userId), 11);
        return {
          workspaceId: 7,
          userId: 11,
          roleId: "member",
          status: "active"
        };
      },
      async upsertMembership(workspaceId, userId, patch) {
        assert.equal(Number(workspaceId), 7);
        assert.equal(Number(userId), 11);
        assert.deepEqual(patch, {
          roleId: "admin",
          status: "active"
        });
      }
    },
    workspaceInvitesRepository: {
      async listPendingByWorkspaceIdWithWorkspace(workspaceId) {
        assert.equal(Number(workspaceId), 7);
        return [];
      },
      async expirePendingByWorkspaceIdAndEmail() {},
      async insert() {},
      async findPendingByIdForWorkspace() {
        return null;
      },
      async revokeById() {}
    },
    inviteExpiresInMs: 7 * 24 * 60 * 60 * 1000,
    roleCatalog: createRoleCatalog()
  });

  return { service, workspace };
}

test("workspaceMembersService.createInvite uses configured inviteExpiresInMs", async () => {
  const expiresAtValues = [];
  const service = createService({
    workspaceMembershipsRepository: {
      async listActiveByWorkspaceId() {
        return [];
      }
    },
    workspaceInvitesRepository: {
      async expirePendingByWorkspaceIdAndEmail() {},
      async insert(payload) {
        expiresAtValues.push(payload.expiresAt);
      },
      async listPendingByWorkspaceIdWithWorkspace() {
        return [];
      },
      async findPendingByIdForWorkspace() {
        return null;
      },
      async revokeById() {}
    },
    inviteExpiresInMs: 30 * 60 * 1000,
    roleCatalog: createRoleCatalog()
  });

  const before = Date.now();
  await service.createInvite(
    {
      id: 7,
      ownerUserId: 9
    },
    { id: 11 },
    {
      email: "alice@example.com",
      roleId: "member"
    },
    authorizedOptions(["workspace.members.invite"])
  );
  const after = Date.now();

  assert.equal(expiresAtValues.length, 1);
  const expiresAt = new Date(expiresAtValues[0]).getTime();
  assert.ok(expiresAt >= before + 30 * 60 * 1000);
  assert.ok(expiresAt <= after + 30 * 60 * 1000);
});

test("workspaceMembersService.listMembers uses the resolved workspace directly", async () => {
  const { service, workspace } = createFixture();

  const response = await service.listMembers(workspace, authorizedOptions(["workspace.members.view"]));

  assert.deepEqual(response.workspace, {
    id: 7,
    slug: "tonymobily3",
    name: "TonyMobily3",
    ownerUserId: 9,
    avatarUrl: "",
    color: "#0F6B54"
  });
  assert.equal(response.members.length, 1);
  assert.equal(response.members[0].displayName, "Alice");
});

test("workspaceMembersService.updateMemberRole returns the refreshed member list without re-fetching the workspace", async () => {
  const { service, workspace } = createFixture();

  const response = await service.updateMemberRole(
    workspace,
    {
      memberUserId: 11,
      roleId: "admin"
    },
    authorizedOptions(["workspace.members.manage"])
  );

  assert.equal(response.members.length, 1);
  assert.equal(response.members[0].roleId, "member");
});
