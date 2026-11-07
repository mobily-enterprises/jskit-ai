import assert from "node:assert/strict";
import test from "node:test";
import { resolveInviteTokenHash } from "@jskit-ai/auth-core/server/inviteTokens";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createWorkspacesServerI18n } from "../src/server/i18n.js";
import { renderDefaultWorkspaceInviteEmail } from "../src/server/workspaceMembers/defaultWorkspaceInviteEmail.js";
import {
  buildMailerUnconfiguredDelivery,
  unconfiguredWorkspaceInviteMailer
} from "../src/server/workspaceMembers/unconfiguredWorkspaceInviteMailer.js";
import { createWorkspaceInviteUrlBuilder } from "../src/server/workspaceMembers/workspaceInviteUrls.js";
import { createService as createMembersService } from "../src/server/workspaceMembers/workspaceMembersService.js";
import { cloneWorkspaceRoleCatalog } from "../src/shared/roles.js";
import { workspacesDatabase } from "./support/mysqlWorkspaces.js";

// Characterization of workspaceMembersService on MariaDB/MySQL, through the functions its actions call, before the
// invite and membership stores move onto table resources: what createInvite, revokeInvite, updateMemberRole and
// removeMember answer and save, that each keeps to its workspace, repeated calls, transactions, and the errors.
const database = workspacesDatabase("da_ws_members");
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function membersService(db) {
  return createMembersService({
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
  });
}

async function teamOf(db, tag, memberNames = []) {
  const owner = await db.createProfile(`${tag}-owner`);
  const workspace = await db.workspaces.insert({ slug: tag, name: `Team ${tag}`, ownerUserId: owner.id });
  await db.memberships.ensureOwnerMembership(workspace.id, owner.id);
  const members = {};
  for (const name of memberNames) {
    members[name] = await db.createProfile(`${tag}-${name}`);
    await db.memberships.addMember({ workspaceId: workspace.id, userId: members[name].id });
  }
  return { owner, workspace, members };
}

const membersWorkspace = (workspace) => ({
  id: workspace.id,
  slug: workspace.slug,
  name: workspace.name,
  ownerUserId: workspace.ownerUserId,
  avatarUrl: ""
});

const validationFailed = (field, code) => (error) => {
  assert.equal(error.status, 400);
  assert.equal(error.code, "validation_failed");
  assert.equal(error.details.fieldErrorCodes[field].code, code);
  return true;
};

test("createInvite saves a pending invite, answers the workspace's pending invites, and a second invite expires the first", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const service = membersService(db);
  const { owner, workspace } = await teamOf(db, "invite");
  const { owner: otherOwner, workspace: other } = await teamOf(db, "invite-other");
  await service.createInvite(other, otherOwner, { email: "quinn@example.test" });

  const before = Date.now();
  const result = await service.createInvite(workspace, owner, { email: " Quinn@Example.TEST ", roleSid: " ADMIN " });
  assert.equal(result.kind, "data");
  const value = result.value;
  assert.deepEqual(Object.keys(value), [
    "workspace", "invites", "roleCatalog", "inviteTokenPreview", "inviteUrl", "inviteDelivery", "createdInviteId"
  ]);
  assert.deepEqual(value.workspace, membersWorkspace(workspace));
  assert.deepEqual(value.roleCatalog, cloneWorkspaceRoleCatalog(db.roleCatalog));
  assert.deepEqual(value.inviteDelivery, buildMailerUnconfiguredDelivery());
  assert.match(value.createdInviteId, /^\d+$/u);
  assert.equal(value.inviteUrl, `/invite/${encodeURIComponent(value.inviteTokenPreview)}`);
  assert.equal(value.invites.length, 1, "only this workspace's pending invites");
  const [listed] = value.invites;
  assert.deepEqual(Object.keys(listed), ["id", "email", "roleSid", "status", "expiresAt", "invitedByUserId"]);
  assert.equal(listed.id, value.createdInviteId);
  assert.equal(listed.email, "quinn@example.test");
  assert.equal(listed.roleSid, "admin");
  assert.equal(listed.status, "pending");
  assert.equal(listed.invitedByUserId, owner.id);
  assert.match(listed.expiresAt, ISO);
  const expiresIn = Date.parse(listed.expiresAt) - before;
  assert.ok(expiresIn > 86400000 - 5000 && expiresIn <= 86400000 + 5000, `expires a day later (${expiresIn} ms)`);

  const saved = await db.invites.findById(value.createdInviteId);
  assert.equal(saved.tokenHash, resolveInviteTokenHash(value.inviteTokenPreview), "the saved hash is the token's");
  assert.equal(saved.workspaceId, workspace.id);

  const again = (await service.createInvite(workspace, owner, { email: "quinn@example.test" })).value;
  assert.notEqual(again.createdInviteId, value.createdInviteId);
  assert.equal((await db.invites.findById(value.createdInviteId)).status, "expired", "inviting the email again expires the earlier invite");
  assert.deepEqual(again.invites.map(({ id, roleSid }) => ({ id, roleSid })), [{ id: again.createdInviteId, roleSid: "member" }],
    "the role defaults to member");
  assert.equal((await db.invites.listPendingByWorkspaceIdWithWorkspace(other.id)).length, 1, "the other workspace's invite stays");

  const listedOnly = (await service.listInvitesResponse(workspace)).value;
  assert.deepEqual(Object.keys(listedOnly), ["workspace", "invites", "roleCatalog"]);
  assert.deepEqual(listedOnly.invites, again.invites);

  await assert.rejects(service.createInvite(workspace, owner, { email: "rae@example.test", roleSid: "owner" }),
    validationFailed("roleSid", "workspaces.member.roleNotAssignable"));
  assert.equal((await db.invites.listPendingByEmail("rae@example.test")).length, 0, "a refused invite saves nothing");
});

test("revokeInvite revokes a pending invite of its workspace once and answers the invites left", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const service = membersService(db);
  const { owner, workspace } = await teamOf(db, "revoke");
  const { owner: otherOwner, workspace: other } = await teamOf(db, "revoke-other");
  const first = (await service.createInvite(workspace, owner, { email: "sam@example.test" })).value.createdInviteId;
  const second = (await service.createInvite(workspace, owner, { email: "tia@example.test" })).value.createdInviteId;
  const foreign = (await service.createInvite(other, otherOwner, { email: "uma@example.test" })).value.createdInviteId;

  const result = await service.revokeInvite(workspace, first);
  assert.equal(result.kind, "data");
  assert.deepEqual(Object.keys(result.value), ["workspace", "invites", "roleCatalog", "revokedInviteId"]);
  assert.equal(result.value.revokedInviteId, first);
  assert.deepEqual(result.value.invites.map(({ id }) => id), [second]);
  assert.equal((await db.invites.findById(first)).status, "revoked");

  const notFound = (error) => {
    assert.equal(error.status, 404);
    assert.equal(error.code, "workspaces.invite.notFound");
    assert.equal(error.message, "Invite not found.");
    return true;
  };
  await assert.rejects(service.revokeInvite(workspace, first), notFound, "revoking twice is refused");
  await assert.rejects(service.revokeInvite(workspace, foreign), notFound, "another workspace's invite");
  assert.equal((await db.invites.findById(foreign)).status, "pending");
  await assert.rejects(service.revokeInvite(workspace, "999999999"), notFound);
  await assert.rejects(service.revokeInvite(workspace, ""), validationFailed("inviteId", "workspaces.invite.idRequired"));

  await assert.rejects(db.invites.withTransaction(async (trx) => {
    const inside = await service.revokeInvite(workspace, second, { trx });
    assert.deepEqual(inside.value.invites, [], "the answer reads inside the caller's transaction");
    throw new Error("Abort the caller's transaction");
  }), /Abort the caller's transaction/u);
  assert.equal((await db.invites.findById(second)).status, "pending", "the revoke rolls back with the caller's transaction");
});

test("updateMemberRole and removeMember change an active member of their workspace only, and answer the members", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const service = membersService(db);
  const { owner, workspace, members } = await teamOf(db, "roles", ["ann", "bea"]);
  const { workspace: other } = await teamOf(db, "roles-other");
  await db.memberships.addMember({ workspaceId: other.id, userId: members.ann.id });
  const outsider = await db.createProfile("roles-outsider");

  const updated = await service.updateMemberRole(workspace, { memberUserId: members.ann.id, roleSid: " Admin " });
  assert.equal(updated.kind, "data");
  assert.deepEqual(Object.keys(updated.value), ["workspace", "members", "roleCatalog"]);
  assert.deepEqual(updated.value.workspace, membersWorkspace(workspace));
  assert.deepEqual(updated.value.members, [
    { userId: members.ann.id, roleSid: "admin", status: "active", displayName: "roles-ann", email: "roles-ann@example.test", isOwner: false },
    { userId: members.bea.id, roleSid: "member", status: "active", displayName: "roles-bea", email: "roles-bea@example.test", isOwner: false },
    { userId: owner.id, roleSid: "owner", status: "active", displayName: "roles-owner", email: "roles-owner@example.test", isOwner: true }
  ], "active members, by name, with the owner marked");
  assert.equal((await db.memberships.findByWorkspaceIdAndUserId(workspace.id, members.ann.id)).roleSid, "admin");
  assert.equal((await db.memberships.findByWorkspaceIdAndUserId(other.id, members.ann.id)).roleSid, "member",
    "the same person's membership elsewhere stays");
  const repeated = await service.updateMemberRole(workspace, { memberUserId: members.ann.id, roleSid: "admin" });
  assert.deepEqual(repeated.value, updated.value, "setting the same role again answers the same");

  const removed = await service.removeMember(workspace, { memberUserId: members.bea.id });
  assert.deepEqual(removed.value.members.map(({ userId }) => userId), [members.ann.id, owner.id]);
  const revoked = await db.memberships.findByWorkspaceIdAndUserId(workspace.id, members.bea.id);
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.roleSid, "member", "a removed member keeps their role");

  const notFound = (error) => error.status === 404 && error.code === "workspaces.member.notFound" && error.message === "Member not found.";
  await assert.rejects(service.removeMember(workspace, { memberUserId: members.bea.id }), notFound, "removing twice is refused");
  await assert.rejects(service.updateMemberRole(workspace, { memberUserId: members.bea.id, roleSid: "admin" }), notFound);
  await assert.rejects(service.updateMemberRole(workspace, { memberUserId: outsider.id, roleSid: "admin" }), notFound);
  await assert.rejects(service.removeMember(other, { memberUserId: members.bea.id }), notFound, "not a member there");
  await assert.rejects(service.updateMemberRole(workspace, { memberUserId: owner.id, roleSid: "admin" }), (error) =>
    error.status === 409 && error.code === "workspaces.member.ownerRoleLocked" && error.message === "Cannot change workspace owner role.");
  await assert.rejects(service.removeMember(workspace, { memberUserId: owner.id }), (error) =>
    error.status === 409 && error.code === "workspaces.member.ownerNotRemovable" && error.message === "Cannot remove workspace owner.");
  await assert.rejects(service.updateMemberRole(workspace, { memberUserId: members.ann.id, roleSid: "owner" }),
    validationFailed("roleSid", "workspaces.member.roleNotAssignable"));
  await assert.rejects(service.removeMember(workspace, { memberUserId: "" }),
    validationFailed("memberUserId", "workspaces.member.userIdRequired"));

  await assert.rejects(db.invites.withTransaction(async (trx) => {
    const inside = await service.updateMemberRole(workspace, { memberUserId: members.ann.id, roleSid: "member" }, { trx });
    assert.equal(inside.value.members[0].roleSid, "member", "the answer reads inside the caller's transaction");
    await service.removeMember(workspace, { memberUserId: members.ann.id }, { trx });
    throw new Error("Abort the caller's transaction");
  }), /Abort the caller's transaction/u);
  const kept = await db.memberships.findByWorkspaceIdAndUserId(workspace.id, members.ann.id);
  assert.deepEqual({ roleSid: kept.roleSid, status: kept.status }, { roleSid: "admin", status: "active" },
    "both changes roll back with the caller's transaction");
});

test("listMembers and the invites list leave out other workspaces' members and invites", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const service = membersService(db);
  const { workspace } = await teamOf(db, "scope", ["cal"]);
  const { owner: otherOwner, workspace: other } = await teamOf(db, "scope-other", ["dan"]);
  await service.createInvite(other, otherOwner, { email: "eli@example.test" });

  const { members } = await service.listMembers(workspace);
  assert.deepEqual(members.map(({ displayName }) => displayName), ["scope-cal", "scope-owner"]);
  assert.deepEqual((await service.listMembersResponse(other)).value.members.map(({ displayName }) => displayName),
    ["scope-other-dan", "scope-other-owner"]);
  assert.deepEqual((await service.listInvitesResponse(workspace)).value.invites, []);
  assert.equal((await service.listInvitesResponse(other)).value.invites.length, 1);
});
