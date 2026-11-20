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
  resolvedInviteByTokenHash = null,
  invitesByTokenHash = {},
  anyAccount = false,
  requireSameEmail = false,
  acceptanceParticipant = noInviteAcceptanceParticipant
} = {}) {
  const tokenHashCalls = [];
  const resolveTokenHashCalls = [];
  const upsertCalls = [];
  const revokeCalls = [];
  const acceptCalls = [];
  const expireCalls = [];
  const notices = [];
  const events = [];

  const service = createService({
    workspaceInvitesRepository: {
      async withTransaction(options, work) {
        events.push("begin");
        const result = await work({ ...options, trx: {} });
        events.push("commit");
        return result;
      },
      async findByTokenHash(tokenHash) {
        return invitesByTokenHash[String(tokenHash || "")] || null;
      },
      async markExpiredById(inviteId) {
        expireCalls.push(Number(inviteId));
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
    workspacesRepository: {
      async findById(workspaceId) {
        return { id: String(workspaceId), slug: "acme", name: "Acme", ownerUserId: "2" };
      }
    },
    workspaceSettingsRepository: {
      async findInvitesRequireSameEmail() {
        return requireSameEmail;
      }
    },
    roleCatalog: createWorkspaceRoleCatalog(),
    acceptanceParticipant,
    invitationsAnyAccount: anyAccount,
    async notifyInviter(acceptance) {
      events.push("notify");
      notices.push(acceptance);
    }
  });

  return {
    service,
    calls: {
      tokenHashCalls,
      resolveTokenHashCalls,
      upsertCalls,
      revokeCalls,
      acceptCalls,
      expireCalls,
      notices,
      events
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
        workspaceSlug: "tony3",
        workspaceName: "Tony3",
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
    email: "chiara@example.com"
  });

  assert.equal(pendingInvites.length, 1);
  assert.equal(pendingInvites[0].token, encodeInviteTokenHash(tokenHash));
  assert.equal(pendingInvites[0].workspaceName, "Tony3");
  assert.equal(pendingInvites[0].status, "pending");
});

test("listPendingInvitesResponse answers the pending list action with the rows as JSON:API data", async () => {
  const { service } = createFixture({
    pendingInvitesByEmail: [
      {
        id: "10",
        workspaceId: "1",
        workspaceSlug: "tony3",
        workspaceName: "Tony3",
        workspaceAvatarUrl: "",
        roleSid: "member",
        status: "pending",
        expiresAt: "2030-01-01T00:00:00.000Z",
        tokenHash: "b".repeat(64)
      }
    ]
  });
  const user = { id: "7", email: "chiara@example.com" };

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
        email: "chiara@example.com",
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
      email: "chiara@example.com",
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
        email: "chiara@example.com",
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
      email: "chiara@example.com",
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
  const user = { id: "7", email: "chiara@example.com", displayName: "Chiara" };
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
      workspacesRepository: {},
      workspaceSettingsRepository: {},
      roleCatalog: createWorkspaceRoleCatalog(),
      acceptanceParticipant: noInviteAcceptanceParticipant,
      invitationsAnyAccount: false,
      async notifyInviter() {}
    });
    await assert.rejects(service.acceptInviteByToken({ user: { id: "1", email: "a@example.test" }, token: "valid-token" }),
      (error) => error === failure && error.cause === cause);
  });
}

// An invitation to Acme sent to invited@example.com by user 2, pending until 2030.
function pendingInvite(tokenHash, overrides = {}) {
  return {
    id: "60",
    workspaceId: "1",
    workspaceSlug: "acme",
    workspaceName: "Acme",
    workspaceAvatarUrl: "",
    email: "invited@example.com",
    roleSid: "member",
    status: "pending",
    tokenHash,
    invitedByUserId: "2",
    expiresAt: "2030-01-01T00:00:00.000Z",
    ...overrides
  };
}

const OTHER_ACCOUNT = Object.freeze({ id: "7", email: "Other@Example.com", displayName: "Olive" });
const refusedWith = (status, code) => (error) => error.status === status && error.code === code;

test("with anyAccount another account accepts only once it confirms joining as itself, and the inviter is told after commit", async () => {
  const tokenHash = "d".repeat(64);
  const token = encodeInviteTokenHash(tokenHash);
  const participations = [];
  const { service, calls } = createFixture({
    anyAccount: true,
    inviteByTokenHash: { [tokenHash]: pendingInvite(tokenHash) },
    async acceptanceParticipant(acceptance, options) {
      calls.events.push("participant");
      participations.push({ acceptance, trx: options.trx });
    }
  });

  await assert.rejects(service.acceptInviteByToken({ user: OTHER_ACCOUNT, token }), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "workspaces.invite.differentEmailUnconfirmed");
    assert.deepEqual(error.params, { email: "other@example.com", maskedEmail: "in*****@example.com" });
    assert.equal(error.message, "This invitation was sent to in*****@example.com. Confirm that you want to join as other@example.com.");
    return true;
  });
  await assert.rejects(
    service.acceptInviteByToken({ user: OTHER_ACCOUNT, token, acceptAs: "someone@example.com" }),
    refusedWith(409, "workspaces.invite.differentEmailUnconfirmed")
  );
  assert.deepEqual(calls.upsertCalls, [], "an unconfirmed acceptance changes nothing");
  assert.deepEqual(calls.acceptCalls, []);
  assert.deepEqual(calls.notices, []);

  calls.events.length = 0;
  const response = await service.acceptInviteByToken({ user: OTHER_ACCOUNT, token, acceptAs: " OTHER@example.com " });
  assert.deepEqual(response, { decision: "accepted", workspaceId: "1" });
  assert.deepEqual(calls.upsertCalls, [
    { workspaceId: 1, userId: 7, payload: { roleSid: "member", status: "active", acceptedInviteId: "60" } }
  ]);
  assert.deepEqual(calls.acceptCalls, [60]);
  assert.deepEqual(calls.events, ["begin", "participant", "commit", "notify"], "the inviter is told only after commit");
  const [{ acceptance, trx }] = participations;
  assert.ok(trx, "the participant runs in the acceptance's transaction");
  assert.deepEqual(
    { invite: pick(acceptance.invite, ["id", "email", "workspaceId", "invitedByUserId", "roleSid", "status"]), user: acceptance.user, workspace: acceptance.workspace },
    {
      invite: { id: "60", email: "invited@example.com", workspaceId: "1", invitedByUserId: "2", roleSid: "member", status: "pending" },
      user: { id: "7", email: "other@example.com", displayName: "Olive" },
      workspace: { id: "1", slug: "acme", name: "Acme", ownerUserId: "2" }
    }
  );
  assert.equal(calls.notices.length, 1);
  assert.equal(calls.notices[0], acceptance, "the inviter's notice tells what the participant was told");
});

function pick(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key]]));
}

test("the invited address accepts as before, whatever its case, with no confirmation and no notice", async () => {
  const tokenHash = "f".repeat(64);
  const { service, calls } = createFixture({ anyAccount: true, inviteByTokenHash: { [tokenHash]: pendingInvite(tokenHash) } });

  const response = await service.acceptInviteByToken({
    user: { id: "8", email: "INVITED@example.com", displayName: "Ivy" },
    token: encodeInviteTokenHash(tokenHash)
  });

  assert.equal(response.decision, "accepted");
  assert.deepEqual(calls.notices, []);
  assert.deepEqual(calls.events, ["begin", "commit"]);
});

for (const { name, anyAccount, requireSameEmail } of [
  { name: "without anyAccount", anyAccount: false, requireSameEmail: false },
  { name: "in a workspace that requires the invited address", anyAccount: true, requireSameEmail: true }
]) {
  test(`${name} another account cannot accept, confirmed or not`, async () => {
    const tokenHash = "9".repeat(64);
    const token = encodeInviteTokenHash(tokenHash);
    const { service, calls } = createFixture({ anyAccount, requireSameEmail, inviteByTokenHash: { [tokenHash]: pendingInvite(tokenHash) } });

    for (const acceptAs of [undefined, "other@example.com"]) {
      await assert.rejects(
        service.acceptInviteByToken({ user: OTHER_ACCOUNT, token, acceptAs }),
        refusedWith(403, "workspaces.invite.emailMismatchUser")
      );
    }
    assert.deepEqual(calls.upsertCalls, []);
    assert.deepEqual(calls.notices, []);
  });
}

test("only the invited address refuses an invitation, with anyAccount too", async () => {
  const tokenHash = "8".repeat(64);
  const { service, calls } = createFixture({ anyAccount: true, inviteByTokenHash: { [tokenHash]: pendingInvite(tokenHash) } });

  await assert.rejects(
    service.redeemInviteByToken(OTHER_ACCOUNT, { token: encodeInviteTokenHash(tokenHash), decision: "refuse", acceptAs: "other@example.com" }),
    refusedWith(403, "workspaces.invite.emailMismatchUser")
  );
  assert.deepEqual(calls.revokeCalls, []);
});

test("redeem hands the confirmation on to the acceptance", async () => {
  const tokenHash = "7".repeat(64);
  const { service, calls } = createFixture({ anyAccount: true, inviteByTokenHash: { [tokenHash]: pendingInvite(tokenHash) } });

  const response = await service.redeemInviteByToken(OTHER_ACCOUNT, {
    token: encodeInviteTokenHash(tokenHash),
    decision: "accept",
    acceptAs: "other@example.com"
  });

  assert.deepEqual(response.value, { decision: "accepted", workspaceId: "1" });
  assert.equal(calls.notices.length, 1);
});

test("the token view says whether only the invited address may accept", async () => {
  const tokenHash = "6".repeat(64);
  const resolvedInviteByTokenHash = { [tokenHash]: pendingInvite(tokenHash) };
  const token = encodeInviteTokenHash(tokenHash);
  for (const [anyAccount, requireSameEmail, expected] of [[false, false, true], [true, false, false], [true, true, true]]) {
    const { service } = createFixture({ anyAccount, requireSameEmail, resolvedInviteByTokenHash });
    assert.equal((await service.resolveInviteByToken(token)).value.requiresSameEmail, expected, `anyAccount ${anyAccount}, strict ${requireSameEmail}`);
  }
  const { service } = createFixture({ anyAccount: true });
  assert.equal((await service.resolveInviteByToken(token)).value.requiresSameEmail, true, "an invitation that is not there");
});

test("sign-up with another address keeps the invitation's own email where any account may accept it", async () => {
  const tokenHash = "5".repeat(64);
  const resolvedInviteByTokenHash = { [tokenHash]: pendingInvite(tokenHash) };
  const token = encodeInviteTokenHash(tokenHash);

  const lenient = createFixture({ anyAccount: true, resolvedInviteByTokenHash }).service;
  const context = await lenient.resolveInviteContextForAuth({ token, email: "other@example.com" });
  assert.equal(context.email, "invited@example.com", "so the account still confirms its own address");
  assert.equal(context.workspaceId, "1");

  const strict = createFixture({ anyAccount: true, requireSameEmail: true, resolvedInviteByTokenHash }).service;
  await assert.rejects(strict.resolveInviteContextForAuth({ token, email: "other@example.com" }),
    refusedWith(403, "workspaces.invite.emailMismatchAccount"));
  const off = createFixture({ resolvedInviteByTokenHash }).service;
  await assert.rejects(off.resolveInviteContextForAuth({ token, email: "other@example.com" }),
    refusedWith(403, "workspaces.invite.emailMismatchAccount"));
});

test("an invitation past its expiry is marked expired, not revoked, and every later redeem says expired", async () => {
  const tokenHash = "4".repeat(64);
  const token = encodeInviteTokenHash(tokenHash);
  const late = pendingInvite(tokenHash, { email: "late@example.com", expiresAt: "2000-01-01T00:00:00.000Z" });
  const { service, calls } = createFixture({ inviteByTokenHash: { [tokenHash]: late } });
  const user = { id: "9", email: "late@example.com" };

  await assert.rejects(service.acceptInviteByToken({ user, token }), (error) => {
    assert.equal(error.code, "workspaces.invite.expired");
    assert.equal(error.transactionOutcome, "committed");
    return true;
  });
  assert.deepEqual(calls.expireCalls, [60]);
  assert.deepEqual(calls.revokeCalls, []);

  const after = createFixture({ invitesByTokenHash: { [tokenHash]: { ...late, status: "expired" } } }).service;
  for (const decision of ["accept", "refuse"]) {
    await assert.rejects(after.redeemInviteByToken(user, { token, decision }), refusedWith(409, "workspaces.invite.expired"));
  }
  const handled = createFixture({ invitesByTokenHash: { [tokenHash]: { ...late, status: "accepted" } } }).service;
  await assert.rejects(handled.redeemInviteByToken(user, { token, decision: "accept" }),
    refusedWith(404, "workspaces.invite.invitationNotFoundOrHandled"));
});
