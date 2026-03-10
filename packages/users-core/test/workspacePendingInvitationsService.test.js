import test from "node:test";
import assert from "node:assert/strict";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/server/inviteTokens";
import { createService } from "../src/server/workspacePendingInvitations/workspacePendingInvitationsService.js";

function createFixture({
  tenancyMode = "workspace",
  pendingInvitesByEmail = [],
  inviteByTokenHash = null
} = {}) {
  const tokenHashCalls = [];
  const upsertCalls = [];

  const workspace = {
    id: 1,
    slug: "tonymobily3",
    name: "TonyMobily3",
    avatarUrl: "",
    color: "#0F6B54"
  };

  const service = createService({
    appConfig: {
      tenancyMode
    },
    workspaceInvitesRepository: {
      async listPendingByEmail() {
        return Array.isArray(pendingInvitesByEmail) ? [...pendingInvitesByEmail] : [];
      },
      async findPendingByTokenHash(tokenHash) {
        tokenHashCalls.push(String(tokenHash || ""));
        if (!inviteByTokenHash || typeof inviteByTokenHash !== "object") {
          return null;
        }

        return inviteByTokenHash[String(tokenHash || "")] || null;
      },
      async revokeById() {},
      async markAcceptedById() {}
    },
    workspaceMembershipsRepository: {
      async upsertMembership(workspaceId, userId, payload) {
        upsertCalls.push({
          workspaceId: Number(workspaceId),
          userId: Number(userId),
          payload: payload && typeof payload === "object" ? { ...payload } : payload
        });
      }
    },
    workspacesRepository: {
      async findById(id) {
        return Number(id) === 1 ? workspace : null;
      }
    },
    workspaceService: {
      async resolveWorkspaceContextForUserBySlug() {
        return {
          workspace,
          membership: {
            workspaceId: 1,
            userId: 7,
            roleId: "member",
            status: "active"
          },
          permissions: ["workspace.members.view"],
          workspaceSettings: {
            invitesEnabled: true
          }
        };
      }
    }
  });

  return {
    service,
    calls: {
      tokenHashCalls,
      upsertCalls
    }
  };
}

test("listPendingInvitesForUser returns opaque token generated from invite token hash", async () => {
  const tokenHash = "a".repeat(64);
  const { service } = createFixture({
    pendingInvitesByEmail: [
      {
        id: 10,
        workspaceId: 1,
        workspaceSlug: "tonymobily3",
        workspaceName: "TonyMobily3",
        workspaceAvatarUrl: "",
        roleId: "member",
        status: "pending",
        expiresAt: "2030-01-01T00:00:00.000Z",
        tokenHash
      }
    ]
  });

  const pendingInvites = await service.listPendingInvitesForUser({
    id: 7,
    email: "chiaramobily@gmail.com"
  });

  assert.equal(pendingInvites.length, 1);
  assert.equal(pendingInvites[0].token, encodeInviteTokenHash(tokenHash));
});

test("redeemInviteByToken accepts opaque invite token and resolves invite by decoded hash", async () => {
  const tokenHash = "b".repeat(64);
  const encodedToken = encodeInviteTokenHash(tokenHash);
  const { service, calls } = createFixture({
    inviteByTokenHash: {
      [tokenHash]: {
        id: 44,
        workspaceId: 1,
        email: "chiaramobily@gmail.com",
        roleId: "member",
        status: "pending",
        tokenHash,
        expiresAt: "2030-01-01T00:00:00.000Z"
      }
    }
  });

  const response = await service.redeemInviteByToken({
    user: {
      id: 7,
      email: "chiaramobily@gmail.com",
      displayName: "Chiara"
    },
    token: encodedToken,
    decision: "accept"
  });

  assert.deepEqual(calls.tokenHashCalls, [tokenHash]);
  assert.equal(calls.upsertCalls.length, 1);
  assert.equal(response.decision, "accepted");
  assert.equal(response.workspace.slug, "tonymobily3");
});
