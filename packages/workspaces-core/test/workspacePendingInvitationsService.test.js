import test from "node:test";
import assert from "node:assert/strict";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { createService } from "../src/server/workspacePendingInvitations/workspacePendingInvitationsService.js";
import { noInviteAcceptanceParticipant } from "../src/server/workspacePendingInvitations/noInviteAcceptanceParticipant.js";
import { createWorkspaceRoleCatalog } from "../src/shared/roles.js";

function createFixture({
  pendingInvitesByEmail = [],
  inviteByTokenHash = null,
  resolvedInviteByTokenHash = null
} = {}) {
  const tokenHashCalls = [];
  const resolveTokenHashCalls = [];
  const upsertCalls = [];
  const revokeCalls = [];
  const acceptCalls = [];

  const service = createService({
    workspaceInvitesRepository: {
      async withTransaction(work) {
        return work({});
      },
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
      async findByTokenHashWithWorkspace(tokenHash) {
        resolveTokenHashCalls.push(String(tokenHash || ""));
        if (!resolvedInviteByTokenHash || typeof resolvedInviteByTokenHash !== "object") {
          return null;
        }

        return resolvedInviteByTokenHash[String(tokenHash || "")] || null;
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
    },
    roleCatalog: createWorkspaceRoleCatalog(),
    acceptanceParticipant: noInviteAcceptanceParticipant
  });

  return {
    service,
    calls: {
      tokenHashCalls,
      resolveTokenHashCalls,
      upsertCalls,
      revokeCalls,
      acceptCalls
    }
  };
}

test("listPendingInvitesForUser returns raw pending invite rows", async () => {
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
  assert.equal(pendingInvites[0].token, encodeInviteTokenHash(tokenHash));
  assert.equal(pendingInvites[0].workspaceName, "TonyMobily3");
  assert.equal(pendingInvites[0].status, "pending");
});

test("listPendingInvitesResponse answers the pending list action with the rows as JSON:API data", async () => {
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
        tokenHash: "b".repeat(64)
      }
    ]
  });
  const user = { id: "7", email: "chiaramobily@gmail.com" };

  assert.deepEqual(
    await service.listPendingInvitesResponse(user),
    returnJsonApiData({ pendingInvites: await service.listPendingInvitesForUser(user) })
  );
});

test("resolveInviteByToken returns safe public invite metadata without mutating the invite", async () => {
  const tokenHash = "d".repeat(64);
  const encodedToken = encodeInviteTokenHash(tokenHash);
  const { service, calls } = createFixture({
    resolvedInviteByTokenHash: {
      [tokenHash]: {
        id: "46",
        workspaceId: "8",
        workspaceSlug: "acme",
        workspaceName: "Acme",
        workspaceAvatarUrl: "https://example.com/acme.png",
        email: "Invitee@Example.com",
        roleSid: "admin",
        status: "pending",
        tokenHash,
        expiresAt: "2030-01-01T00:00:00.000Z"
      }
    }
  });

  const resolved = (await service.resolveInviteByToken(encodedToken)).value;

  assert.deepEqual(calls.resolveTokenHashCalls, [tokenHash]);
  assert.deepEqual(calls.revokeCalls, []);
  assert.equal(resolved.id, "46");
  assert.equal(resolved.token, encodedToken);
  assert.equal(resolved.status, "pending");
  assert.equal(resolved.email, "invitee@example.com");
  assert.equal(resolved.maskedEmail, "in*****@example.com");
  assert.equal(resolved.roleSid, "admin");
  assert.deepEqual(resolved.workspace, {
    id: "8",
    slug: "acme",
    name: "Acme",
    avatarUrl: "https://example.com/acme.png"
  });
});

test("resolveInviteByToken reports expired and missing invitations as terminal states", async () => {
  const expiredTokenHash = "e".repeat(64);
  const missingTokenHash = "f".repeat(64);
  const expiredToken = encodeInviteTokenHash(expiredTokenHash);
  const missingToken = encodeInviteTokenHash(missingTokenHash);
  const { service, calls } = createFixture({
    resolvedInviteByTokenHash: {
      [expiredTokenHash]: {
        id: "47",
        workspaceId: "8",
        workspaceSlug: "acme",
        workspaceName: "Acme",
        workspaceAvatarUrl: "",
        email: "invitee@example.com",
        roleSid: "member",
        status: "pending",
        tokenHash: expiredTokenHash,
        expiresAt: "2000-01-01T00:00:00.000Z"
      }
    }
  });

  const expired = (await service.resolveInviteByToken(expiredToken)).value;
  const missing = (await service.resolveInviteByToken(missingToken)).value;

  assert.equal(expired.status, "expired");
  assert.equal(missing.status, "not_found");
  assert.equal(missing.email, "");
  assert.deepEqual(calls.revokeCalls, []);
  assert.deepEqual(calls.acceptCalls, []);
});

test("resolveInviteContextForAuth returns invite context for matching registration emails", async () => {
  const tokenHash = "1".repeat(64);
  const encodedToken = encodeInviteTokenHash(tokenHash);
  const { service } = createFixture({
    resolvedInviteByTokenHash: {
      [tokenHash]: {
        id: "48",
        workspaceId: "8",
        workspaceSlug: "acme",
        workspaceName: "Acme",
        workspaceAvatarUrl: "",
        email: "Invitee@Example.com",
        roleSid: "member",
        status: "pending",
        tokenHash,
        expiresAt: "2030-01-01T00:00:00.000Z"
      }
    }
  });

  const context = await service.resolveInviteContextForAuth({
    token: encodedToken,
    email: "invitee@example.com"
  });

  assert.deepEqual(context, {
    token: encodedToken,
    workspaceId: "8",
    workspaceSlug: "acme",
    workspaceName: "Acme",
    email: "invitee@example.com",
    roleSid: "member",
    expiresAt: "2030-01-01T00:00:00.000Z"
  });
  await assert.rejects(
    () =>
      service.resolveInviteContextForAuth({
        token: encodedToken,
        email: "other@example.com"
      }),
    /Invitation email does not match account email/
  );
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

  assert.deepEqual(calls.tokenHashCalls, [tokenHash, tokenHash]);
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

  assert.deepEqual(calls.tokenHashCalls, [tokenHash, tokenHash]);
  assert.deepEqual(calls.acceptCalls, []);
  assert.deepEqual(calls.revokeCalls, [45]);
  assert.equal(calls.upsertCalls.length, 0);
  assert.equal(response.decision, "refused");
  assert.equal(response.workspaceId, "1");
});

test("redeemInviteByToken accepts on an accept decision and refuses on any other", async () => {
  const user = { id: "7", email: "chiaramobily@gmail.com", displayName: "Chiara" };
  for (const [decision, expected] of [["accept", "accepted"], ["refuse", "refused"]]) {
    const tokenHash = "d".repeat(64);
    const { service, calls } = createFixture({
      inviteByTokenHash: {
        [tokenHash]: {
          id: "46",
          workspaceId: "1",
          email: user.email,
          roleSid: "member",
          status: "pending",
          tokenHash,
          expiresAt: "2030-01-01T00:00:00.000Z"
        }
      }
    });

    const response = (await service.redeemInviteByToken(user, { token: encodeInviteTokenHash(tokenHash), decision })).value;

    assert.equal(response.decision, expected);
    assert.deepEqual(calls.acceptCalls, decision === "accept" ? [46] : []);
    assert.deepEqual(calls.revokeCalls, decision === "accept" ? [] : [46]);
  }
});

for (const transactionOutcome of ["committed", "unknown", "rolledBack"]) {
  test(`acceptance preserves a ${transactionOutcome} managed completion failure`, async () => {
    const cause = new Error("Completion failed");
    const failure = Object.assign(new Error("Managed completion failed"), { transactionOutcome, cause });
    const service = createService({
      workspaceInvitesRepository: {
        async findPendingByTokenHash() {
          return { workspaceId: "1", email: "a@example.test" };
        },
        async withTransaction() {
          throw failure;
        }
      },
      workspaceMembershipsRepository: {},
      roleCatalog: createWorkspaceRoleCatalog(),
      acceptanceParticipant: noInviteAcceptanceParticipant
    });
    await assert.rejects(service.acceptInviteByToken({ user: { id: "1", email: "a@example.test" }, token: "valid-token" }),
      (error) => error === failure && error.cause === cause);
  });
}
