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
    workspaceMemberPagesRepository: db.memberPages,
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
    "workspace", "invites", "nextCursor", "roleCatalog", "inviteTokenPreview", "inviteUrl", "inviteDelivery", "createdInviteId"
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
  assert.deepEqual(Object.keys(listedOnly), ["workspace", "invites", "nextCursor", "roleCatalog"]);
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
  assert.deepEqual(Object.keys(result.value), ["workspace", "invites", "nextCursor", "roleCatalog", "revokedInviteId"]);
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

  await assert.rejects(db.invites.withTransaction({}, async (txOptions) => {
    const inside = await service.revokeInvite(workspace, second, txOptions);
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
  assert.deepEqual(Object.keys(updated.value), ["workspace", "members", "nextCursor", "roleCatalog"]);
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

  await assert.rejects(db.invites.withTransaction({}, async (txOptions) => {
    const inside = await service.updateMemberRole(workspace, { memberUserId: members.ann.id, roleSid: "member" }, txOptions);
    assert.equal(inside.value.members[0].roleSid, "member", "the answer reads inside the caller's transaction");
    await service.removeMember(workspace, { memberUserId: members.ann.id }, txOptions);
    throw new Error("Abort the caller's transaction");
  }), /Abort the caller's transaction/u);
  const kept = await db.memberships.findByWorkspaceIdAndUserId(workspace.id, members.ann.id);
  assert.deepEqual({ roleSid: kept.roleSid, status: kept.status }, { roleSid: "admin", status: "active" },
    "both changes roll back with the caller's transaction");
});

// Resolves once a statement on this test's database has waited a second or more, which here is only a wait for a row
// lock: the race's second request has reached the membership the first holds. The test user sees its own
// connections in the process list without the PROCESS privilege.
async function untilBlocked(db) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [rows] = await db.knex.raw(
      "SELECT COUNT(*) AS waiting FROM information_schema.PROCESSLIST WHERE DB = ? AND COMMAND = 'Query' " +
        "AND TIME >= 1 AND INFO NOT LIKE '%PROCESSLIST%'",
      [db.name]
    );
    if (Number(rows[0].waiting) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("No statement waited for a lock within 10 s.");
}

// Runs `first` in a transaction that holds what it changed until `second`, started meanwhile, waits for it; answers
// `second`'s outcome once `first` has committed.
async function race(db, first, second) {
  const held = Promise.withResolvers();
  const release = Promise.withResolvers();
  const winner = db.memberships.withTransaction({}, async (txOptions) => {
    await first(txOptions);
    held.resolve();
    await release.promise;
  });
  let loser;
  try {
    await held.promise;
    loser = second();
    loser.catch(() => {});
    await untilBlocked(db);
  } finally {
    release.resolve();
    await winner;
  }
  return loser;
}

test("a role change and a removal of one member at once: the second decides on what the first left", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const service = membersService(db);
  const { workspace, members } = await teamOf(db, "race", ["cy", "di"]);
  const stored = async (member) => {
    const { roleSid, status } = await db.memberships.findByWorkspaceIdAndUserId(workspace.id, member.id);
    return { roleSid, status };
  };

  const changingRemoved = race(db,
    (txOptions) => service.removeMember(workspace, { memberUserId: members.cy.id }, txOptions),
    () => service.updateMemberRole(workspace, { memberUserId: members.cy.id, roleSid: "admin" }));
  await assert.rejects(changingRemoved, (error) => error.status === 404 && error.code === "workspaces.member.notFound",
    "a role change that waited for a removal finds no member");
  assert.deepEqual(await stored(members.cy), { roleSid: "member", status: "revoked" }, "the removed member stays removed");

  await race(db,
    (txOptions) => service.updateMemberRole(workspace, { memberUserId: members.di.id, roleSid: "admin" }, txOptions),
    () => service.removeMember(workspace, { memberUserId: members.di.id }));
  assert.deepEqual(await stored(members.di), { roleSid: "admin", status: "revoked" },
    "a removal that waited for a role change keeps the role it gave");
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

// Every statement the work sends, as SQL.
async function statementsOf(knex, work) {
  const statements = [];
  const record = ({ sql }) => statements.push(sql);
  knex.on("query", record);
  try {
    return { result: await work(), statements };
  } finally {
    knex.off("query", record);
  }
}

test("the members and invites lists answer a page at a time, each page chosen in SQL", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const service = membersService(db);
  const { owner, workspace, members } = await teamOf(db, "pages", ["dan", "amy", "cat", "bob", "eve"]);
  await db.memberships.upsertMembership(workspace.id, members.eve.id, { status: "revoked" });
  await teamOf(db, "pages-other", ["amy"]);
  const names = (page) => page.members.map(({ displayName }) => displayName);

  const { result: first, statements } = await statementsOf(db.knex, () => service.listMembersPage(workspace, { limit: 2 }));
  assert.deepEqual(names(first), ["pages-amy", "pages-bob"]);
  // One statement reads the page: none reads the workspace's memberships whole.
  const memberReads = statements.filter((sql) => /workspace_memberships/u.test(sql));
  assert.equal(memberReads.length, 1, statements.join("\n"));
  assert.match(memberReads[0], /\blimit\b/iu);
  const second = await service.listMembersPage(workspace, { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(names(second), ["pages-cat", "pages-dan"]);
  // The removed member and the other workspace's members are never listed.
  const last = (await service.listMembersResponse(workspace, { limit: 2, cursor: second.nextCursor })).value;
  assert.deepEqual(names(last), ["pages-owner"]);
  assert.equal(last.nextCursor, null);
  assert.deepEqual(names(await service.listMembersPage(workspace)), ["pages-amy", "pages-bob", "pages-cat", "pages-dan", "pages-owner"]);
  await assert.rejects(service.listMembersPage(workspace, { cursor: "not-a-cursor" }),
    (error) => error.status === 400 && error.code === "workspaces.member.cursorInvalid");

  const invited = [];
  for (const email of ["ivy", "jon", "kim"]) {
    invited.push((await service.createInvite(workspace, owner, { email: `${email}@example.test` })).value.createdInviteId);
  }
  const createdAt = (id, value) => db.knex("workspace_invites").where({ id }).update({ created_at: value });
  await createdAt(invited[0], "2030-01-01 00:00:02");
  await createdAt(invited[1], "2030-01-01 00:00:01");
  await createdAt(invited[2], "2030-01-01 00:00:02");
  const { result: newest, statements: inviteStatements } = await statementsOf(db.knex,
    () => service.listInvitesResponse(workspace, { limit: 2 }));
  // Newest first, and invites made in the same second in the order they were made.
  assert.deepEqual(newest.value.invites.map(({ id }) => id), [invited[0], invited[2]]);
  const inviteReads = inviteStatements.filter((sql) => /workspace_invites/u.test(sql));
  assert.equal(inviteReads.length, 1, inviteStatements.join("\n"));
  assert.match(inviteReads[0], /\blimit\b/iu);
  const oldest = (await service.listInvitesResponse(workspace, { limit: 2, cursor: newest.value.nextCursor })).value;
  assert.deepEqual(oldest.invites.map(({ id }) => id), [invited[1]]);
  assert.equal(oldest.nextCursor, null);
});
