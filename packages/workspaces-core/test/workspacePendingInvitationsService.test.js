import test from "node:test";
import assert from "node:assert/strict";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { createService } from "../src/server/workspacePendingInvitations/workspacePendingInvitationsService.js";

function createFixture({
  pendingInvitesByEmail = [],
  inviteByTokenHash = null
} = {}) {
  const tokenHashCalls = [];
  const upsertCalls = [];
  const revokeCalls = [];
  const acceptCalls = [];

  const service = createService({
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
      async revokeById(inviteId) {
        revokeCalls.push(Number(inviteId));
      },
      async markAcceptedById(inviteId) {
        acceptCalls.push(Number(inviteId));
      }
    },
    workspaceMembershipsRepository: {
      async upsertMembership(workspaceId, userId, payload) {
        upsertCalls.push({
          workspaceId: Number(workspaceId),
          userId: Number(userId),
          payload: payload && typeof payload === "object" ? { ...payload } : payload
        });
      }
    }
  });

  return {
    service,
    calls: {
      tokenHashCalls,
      upsertCalls,
      revokeCalls,
      acceptCalls
    }
  };
}

test("listPendingInvitesForUser returns raw pending invite rows for the action layer to shape", async () => {
  const tokenHash = "a".repeat(64);
  const { service } = createFixture({
    pendingInvitesByEmail: [
      {
        id: "10",
        workspaceId: "1",
        workspaceSlug: "tonymobily3",
        workspaceName: "TonyMobily3",
        workspaceAvatarUrl: "",
        roleSid: "member",
        status: "pending",
        expiresAt: "2030-01-01T00:00:00.000Z",
        tokenHash
      }
    ]
  });

  const pendingInvites = await service.listPendingInvitesForUser({
    id: "7",
    email: "chiaramobily@gmail.com"
  });

  assert.equal(pendingInvites.length, 1);
  assert.equal(pendingInvites[0].tokenHash, tokenHash);
  assert.equal(pendingInvites[0].workspaceName, "TonyMobily3");
});

test("acceptInviteByToken accepts opaque invite token and resolves invite by decoded hash", async () => {
  const tokenHash = "b".repeat(64);
  const encodedToken = encodeInviteTokenHash(tokenHash);
  const { service, calls } = createFixture({
    inviteByTokenHash: {
      [tokenHash]: {
        id: "44",
        workspaceId: "1",
        email: "chiaramobily@gmail.com",
        roleSid: "member",
        status: "pending",
        tokenHash,
        expiresAt: "2030-01-01T00:00:00.000Z"
      }
    }
  });

  const response = await service.acceptInviteByToken({
    user: {
      id: "7",
      email: "chiaramobily@gmail.com",
      displayName: "Chiara"
    },
    token: encodedToken
  });

  assert.deepEqual(calls.tokenHashCalls, [tokenHash]);
  assert.equal(calls.upsertCalls.length, 1);
  assert.deepEqual(calls.acceptCalls, [44]);
  assert.deepEqual(calls.revokeCalls, []);
  assert.equal(response.decision, "accepted");
  assert.equal(response.workspaceId, "1");
});

test("refuseInviteByToken revokes the invite and returns refused", async () => {
  const tokenHash = "c".repeat(64);
  const encodedToken = encodeInviteTokenHash(tokenHash);
  const { service, calls } = createFixture({
    inviteByTokenHash: {
      [tokenHash]: {
        id: "45",
        workspaceId: "1",
        email: "chiaramobily@gmail.com",
        roleSid: "member",
        status: "pending",
        tokenHash,
        expiresAt: "2030-01-01T00:00:00.000Z"
      }
    }
  });

  const response = await service.refuseInviteByToken({
    user: {
      id: "7",
      email: "chiaramobily@gmail.com",
      displayName: "Chiara"
    },
    token: encodedToken
  });

  assert.deepEqual(calls.tokenHashCalls, [tokenHash]);
  assert.deepEqual(calls.acceptCalls, []);
  assert.deepEqual(calls.revokeCalls, [45]);
  assert.equal(calls.upsertCalls.length, 0);
  assert.equal(response.decision, "refused");
  assert.equal(response.workspaceId, "1");
});
