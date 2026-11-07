import assert from "node:assert/strict";
import test from "node:test";
import { encodeInviteTokenHash } from "@jskit-ai/auth-core/shared/inviteTokens";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createWorkspacesServerI18n } from "../src/server/i18n.js";
import { renderDefaultWorkspaceInviteEmail } from "../src/server/workspaceMembers/defaultWorkspaceInviteEmail.js";
import { unconfiguredWorkspaceInviteMailer } from "../src/server/workspaceMembers/unconfiguredWorkspaceInviteMailer.js";
import { createWorkspaceInviteUrlBuilder } from "../src/server/workspaceMembers/workspaceInviteUrls.js";
import { createService as createMembersService } from "../src/server/workspaceMembers/workspaceMembersService.js";
import { noInviteAcceptanceParticipant } from "../src/server/workspacePendingInvitations/noInviteAcceptanceParticipant.js";
import { createService as createPendingService } from "../src/server/workspacePendingInvitations/workspacePendingInvitationsService.js";
import { workspacesDatabase } from "./support/mysqlWorkspaces.js";

// Characterization of workspacePendingInvitationsService on MariaDB/MySQL, through the functions its actions, the
// bootstrap and sign-up call, before the invite and membership stores move onto table resources: the pending list and
// the public token view in each state, the sign-up context, accepting and refusing (what they save, repeated calls,
// a membership that existed before), and the errors.
const database = workspacesDatabase("da_ws_pending");
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function servicesOf(db, acceptanceParticipant = noInviteAcceptanceParticipant) {
  return {
    members: createMembersService({
      workspaceMembershipsRepository: db.memberships,
      workspaceInvitesRepository: db.invites,
      inviteExpiresInMs: 86400000,
      roleCatalog: db.roleCatalog,
      workspaceInvitationsEnabled: true,
      inviteUrlBuilder: createWorkspaceInviteUrlBuilder({ appConfig: {}, env: {} }),
      workspaceInviteMailer: unconfiguredWorkspaceInviteMailer,
      workspaceInviteEmailTemplate: renderDefaultWorkspaceInviteEmail,
      i18n: createWorkspacesServerI18n(),
      userProfilesRepository: db.profiles,
      userSettingsRepository: db.userSettings
    }),
    pending: createPendingService({
      workspaceInvitesRepository: db.invites,
      workspaceMembershipsRepository: db.memberships,
      roleCatalog: db.roleCatalog,
      acceptanceParticipant
    })
  };
}

async function teamOf(db, tag) {
  const owner = await db.createProfile(`${tag}-owner`);
  const workspace = await db.workspaces.insert({ slug: tag, name: `Team ${tag}`, ownerUserId: owner.id });
  await db.memberships.ensureOwnerMembership(workspace.id, owner.id);
  return { owner, workspace };
}

// An invite made the way an application makes one; answers its id and the token its link carries.
async function inviteTo(services, { owner, workspace }, email, roleSid) {
  const { createdInviteId, inviteTokenPreview } = (await services.members.createInvite(workspace, owner, { email, roleSid })).value;
  return { id: createdInviteId, token: inviteTokenPreview };
}

const errorWith = (status, code, message) => (error) => {
  assert.equal(error.status, status);
  assert.equal(error.code, code);
  if (message) assert.equal(error.message, message);
  return true;
};

test("a user's pending invites across workspaces are listed newest first, in the bootstrap's shape", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const services = servicesOf(db);
  const user = await db.createProfile("list-fox");
  const first = await teamOf(db, "list-a");
  const second = await teamOf(db, "list-b");
  const third = await teamOf(db, "list-c");
  const older = await inviteTo(services, first, "LIST-FOX@example.test", "admin");
  const newer = await inviteTo(services, second, "list-fox@example.test", "member");
  const accepted = await inviteTo(services, third, "list-fox@example.test", "member");
  await inviteTo(services, first, "someone-else@example.test", "member");
  await db.invites.markAcceptedById(accepted.id);
  await db.knex("workspace_invites").where({ id: older.id }).update({ created_at: "2030-01-01 00:00:01" });
  await db.knex("workspace_invites").where({ id: newer.id }).update({ created_at: "2030-01-01 00:00:02" });

  const listed = await services.pending.listPendingInvitesForUser(user);
  assert.deepEqual(listed.map(({ id }) => id), [newer.id, older.id], "pending only, the user's email only");
  const saved = await db.invites.findById(older.id);
  assert.deepEqual(listed[1], {
    id: older.id,
    workspaceId: first.workspace.id,
    workspaceSlug: "list-a",
    workspaceName: "Team list-a",
    workspaceAvatarUrl: "",
    roleSid: "admin",
    roleLabel: "Admin",
    status: "pending",
    expiresAt: saved.expiresAt,
    token: encodeInviteTokenHash(saved.tokenHash)
  });
  assert.match(listed[1].expiresAt, ISO);

  const response = await services.pending.listPendingInvitesResponse(user);
  assert.equal(response.kind, "data");
  assert.deepEqual(response.value, { pendingInvites: listed });

  // Pinned as it is: the list does not check expiry, so a pending invite past its expiry is still listed as pending.
  await db.knex("workspace_invites").where({ id: older.id }).update({ expires_at: "2000-01-01 00:00:00" });
  const stale = (await services.pending.listPendingInvitesForUser(user)).find(({ id }) => id === older.id);
  assert.equal(stale.status, "pending");
  assert.equal(stale.expiresAt, "2000-01-01T00:00:00.000Z");

  assert.deepEqual(await services.pending.listPendingInvitesForUser({ id: user.id, email: "" }), []);
  await assert.rejects(services.pending.listPendingInvitesForUser(null),
    errorWith(401, "workspaces.auth.required", "Authentication required."));
});

test("the public token view answers an invite in each state without changing it", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const services = servicesOf(db);
  const team = await teamOf(db, "view");
  const pending = await inviteTo(services, team, "gil@example.test", "admin");

  const resolved = await services.pending.resolveInviteByToken(` ${pending.token} `);
  assert.equal(resolved.kind, "data");
  const saved = await db.invites.findById(pending.id);
  assert.deepEqual(resolved.value, {
    id: pending.id,
    token: pending.token,
    status: "pending",
    email: "gil@example.test",
    maskedEmail: "gi*@example.test",
    roleSid: "admin",
    roleLabel: "Admin",
    expiresAt: saved.expiresAt,
    workspace: { id: team.workspace.id, slug: "view", name: "Team view", avatarUrl: "" }
  });
  assert.deepEqual((await services.pending.resolveInviteByToken(encodeInviteTokenHash(saved.tokenHash))).value.id, pending.id,
    "the listed opaque token resolves too");

  await db.knex("workspace_invites").where({ id: pending.id }).update({ expires_at: "2000-01-01 00:00:00" });
  assert.equal((await services.pending.resolveInviteByToken(pending.token)).value.status, "expired");
  assert.equal((await db.invites.findById(pending.id)).status, "pending", "viewing an expired invite changes nothing");

  const accepted = await inviteTo(services, team, "hu@example.test", "member");
  await db.invites.markAcceptedById(accepted.id);
  const acceptedView = (await services.pending.resolveInviteByToken(accepted.token)).value;
  assert.equal(acceptedView.status, "accepted");
  assert.equal(acceptedView.maskedEmail, "h*@example.test");
  const revoked = await inviteTo(services, team, "ivy@example.test", "member");
  await services.members.revokeInvite(team.workspace, revoked.id);
  assert.equal((await services.pending.resolveInviteByToken(revoked.token)).value.status, "revoked");
  const replaced = await inviteTo(services, team, "jo@example.test", "member");
  await inviteTo(services, team, "jo@example.test", "member");
  assert.equal((await services.pending.resolveInviteByToken(replaced.token)).value.status, "expired", "an invite replaced by a new one");

  const unknown = encodeInviteTokenHash("f".repeat(64));
  assert.deepEqual((await services.pending.resolveInviteByToken(unknown)).value, {
    id: "not-found",
    token: unknown,
    status: "not_found",
    email: "",
    maskedEmail: "",
    roleSid: "",
    expiresAt: null,
    workspace: { id: "", slug: "", name: "", avatarUrl: "" }
  });
  assert.equal((await services.pending.resolveInviteByToken("not-a-real-token")).value.status, "not_found",
    "any other text is hashed as a raw token");
  await assert.rejects(services.pending.resolveInviteByToken("  "),
    errorWith(400, "workspaces.invite.tokenRequired", "Invite token is required."));
});

test("sign-up reads a pending invite's context for its own email only", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const services = servicesOf(db);
  const team = await teamOf(db, "signup");
  const pending = await inviteTo(services, team, "kai@example.test", "admin");
  const saved = await db.invites.findById(pending.id);

  assert.deepEqual(await services.pending.resolveInviteContextForAuth({ token: pending.token, email: " KAI@example.test " }), {
    token: pending.token,
    workspaceId: team.workspace.id,
    workspaceSlug: "signup",
    workspaceName: "Team signup",
    email: "kai@example.test",
    roleSid: "admin",
    expiresAt: saved.expiresAt
  });
  await assert.rejects(services.pending.resolveInviteContextForAuth({ token: pending.token, email: "lu@example.test" }),
    errorWith(403, "workspaces.invite.emailMismatchAccount", "Invitation email does not match account email."));
  await db.invites.revokeById(pending.id);
  await assert.rejects(services.pending.resolveInviteContextForAuth({ token: pending.token, email: "kai@example.test" }),
    errorWith(409, "workspaces.invite.notAvailable", "Invitation is not available."));
});

test("accepting activates the membership with the invite's role and stamps the invite, once", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const participations = [];
  const services = servicesOf(db, async (input, options) => {
    participations.push({ input, trx: typeof options.trx });
  });
  const team = await teamOf(db, "accept");
  const user = await db.createProfile("accept-mo");
  const pending = await inviteTo(services, team, user.email, "admin");

  assert.deepEqual(await services.pending.acceptInviteByToken({ user, token: pending.token }), {
    decision: "accepted",
    workspaceId: team.workspace.id
  });
  const membership = await db.memberships.findByWorkspaceIdAndUserId(team.workspace.id, user.id);
  assert.deepEqual({ roleSid: membership.roleSid, status: membership.status }, { roleSid: "admin", status: "active" });
  const accepted = await db.invites.findById(pending.id);
  assert.equal(accepted.status, "accepted");
  assert.match(accepted.acceptedAt, ISO);
  assert.equal(participations.length, 1);
  assert.equal(participations[0].trx, "function", "the participant writes in the acceptance's transaction");
  assert.equal(participations[0].input.invite.id, pending.id);
  assert.equal(participations[0].input.invite.status, "pending", "the participant sees the invite before it is accepted");
  assert.equal(participations[0].input.user.id, user.id);

  await assert.rejects(services.pending.acceptInviteByToken({ user, token: pending.token }),
    errorWith(404, "workspaces.invite.invitationNotFoundOrHandled", "Invitation not found or already handled."),
    "accepting twice is refused");
  assert.equal(participations.length, 1);

  // A membership that existed before, revoked, is reactivated in place with the invite's role.
  const returning = await db.createProfile("accept-ned");
  const before = await db.memberships.upsertMembership(team.workspace.id, returning.id, { roleSid: "member", status: "revoked" });
  const again = await inviteTo(services, team, returning.email, "admin");
  await services.pending.acceptInviteByToken({ user: returning, token: again.token });
  const reactivated = await db.memberships.findByWorkspaceIdAndUserId(team.workspace.id, returning.id);
  assert.equal(reactivated.id, before.id);
  assert.deepEqual({ roleSid: reactivated.roleSid, status: reactivated.status }, { roleSid: "admin", status: "active" });

  const other = await db.createProfile("accept-oz");
  const notTheirs = await inviteTo(services, team, "accept-pia@example.test", "member");
  await assert.rejects(services.pending.acceptInviteByToken({ user: other, token: notTheirs.token }),
    errorWith(403, "workspaces.invite.emailMismatchUser", "Invitation email does not match authenticated user."));
  assert.equal((await db.invites.findById(notTheirs.id)).status, "pending");
  assert.equal(await db.memberships.findByWorkspaceIdAndUserId(team.workspace.id, other.id), null);
  await assert.rejects(services.pending.acceptInviteByToken({ user: null, token: notTheirs.token }),
    errorWith(401, "workspaces.auth.required"));
  await assert.rejects(services.pending.acceptInviteByToken({ user: other, token: "" }),
    errorWith(400, "workspaces.invite.tokenRequired"));

  // An expired invite is revoked, and that commits before the refusal.
  const late = await db.createProfile("accept-quin");
  const expiring = await inviteTo(services, team, late.email, "member");
  await db.knex("workspace_invites").where({ id: expiring.id }).update({ expires_at: "2000-01-01 00:00:00" });
  await assert.rejects(services.pending.acceptInviteByToken({ user: late, token: expiring.token }), (error) => {
    assert.equal(error.status, 409);
    assert.equal(error.code, "workspaces.invite.expired");
    assert.equal(error.transactionOutcome, "committed");
    return true;
  });
  const revoked = await db.invites.findById(expiring.id);
  assert.equal(revoked.status, "revoked");
  assert.match(revoked.revokedAt, ISO);
  assert.equal(await db.memberships.findByWorkspaceIdAndUserId(team.workspace.id, late.id), null);
});

test("refusing revokes the invite and adds no membership; redeem accepts only on an accept decision", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const services = servicesOf(db);
  const team = await teamOf(db, "refuse");
  const user = await db.createProfile("refuse-rex");
  const refused = await inviteTo(services, team, user.email, "member");

  assert.deepEqual(await services.pending.refuseInviteByToken({ user, token: refused.token }), {
    decision: "refused",
    workspaceId: team.workspace.id
  });
  const revoked = await db.invites.findById(refused.id);
  assert.equal(revoked.status, "revoked");
  assert.match(revoked.revokedAt, ISO);
  assert.equal(await db.memberships.findByWorkspaceIdAndUserId(team.workspace.id, user.id), null);
  await assert.rejects(services.pending.refuseInviteByToken({ user, token: refused.token }),
    errorWith(404, "workspaces.invite.invitationNotFoundOrHandled"), "refusing twice is refused");

  const declined = await inviteTo(services, team, user.email, "member");
  const declinedResult = await services.pending.redeemInviteByToken(user, { token: declined.token, decision: "later" });
  assert.equal(declinedResult.kind, "data");
  assert.deepEqual(declinedResult.value, { decision: "refused", workspaceId: team.workspace.id }, "any other decision refuses");

  const listed = await inviteTo(services, team, user.email, "admin");
  const [opaque] = await services.pending.listPendingInvitesForUser(user);
  assert.equal(opaque.id, listed.id);
  const acceptedResult = await services.pending.redeemInviteByToken(user, { token: opaque.token, decision: "accept" });
  assert.deepEqual(acceptedResult.value, { decision: "accepted", workspaceId: team.workspace.id },
    "the listed opaque token redeems the invite");
  assert.equal((await db.memberships.findByWorkspaceIdAndUserId(team.workspace.id, user.id)).roleSid, "admin");
});
