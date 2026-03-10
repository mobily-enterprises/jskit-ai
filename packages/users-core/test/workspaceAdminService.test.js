import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../src/server/workspace/workspaceAdminService.js";

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
    workspaceService: {
      hashInviteToken(value) {
        return `hash:${value}`;
      },
      async redeemInviteByToken(payload) {
        return payload;
      }
    }
  });

  return { service, workspace };
}

test("workspaceAdminService.listMembers uses the resolved workspace directly", async () => {
  const { service, workspace } = createFixture();

  const response = await service.listMembers(workspace);

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

test("workspaceAdminService.updateMemberRole returns the refreshed member list without re-fetching the workspace", async () => {
  const { service, workspace } = createFixture();

  const response = await service.updateMemberRole(workspace, {
    memberUserId: 11,
    roleId: "admin"
  });

  assert.equal(response.members.length, 1);
  assert.equal(response.members[0].roleId, "member");
});
