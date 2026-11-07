import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { buildWorkspaceName, createService as createDirectoryService } from "../src/server/common/services/workspaceDirectoryService.js";
import { listCatalogRolePermissions } from "../src/shared/roles.js";
import { resolveTenancyProfile } from "../src/shared/tenancyProfile.js";
import { workspacesDatabase } from "./support/mysqlWorkspaces.js";

// Characterization of workspaceDirectoryService on MariaDB/MySQL, through the functions the workspace actions,
// sign-in provisioning and the request's workspace context call, before the stores under it move onto table resources:
// what personal and created workspaces are saved with (slug, name, owner membership, settings), repeated calls, the
// user's workspace list, the workspace context and its errors, the patch it saves, and transactions.
const database = workspacesDatabase("da_ws_directory");
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const PERSONAL = { tenancyMode: "personal" };
const TEAMS = { tenancyMode: "workspaces", tenancyPolicy: { workspace: { allowSelfCreate: true } } };
const WORKSPACE_KEYS = ["id", "slug", "name", "ownerUserId", "isPersonal", "avatarUrl", "createdAt", "updatedAt", "deletedAt"];

function directoryOf(db, tenancy) {
  return createDirectoryService({
    tenancyProfile: resolveTenancyProfile(tenancy),
    roleCatalog: db.roleCatalog,
    personalWorkspaceName: buildWorkspaceName,
    workspacesRepository: db.workspaces,
    workspaceMembershipsRepository: db.memberships,
    workspaceSettingsRepository: db.settings
  });
}

const countWhere = async (db, table, where) =>
  Number((await db.knex(table).where(where).count({ count: "*" }).first()).count);

const errorWith = (status, code, message) => (error) => {
  assert.equal(error.status, status);
  assert.equal(error.code, code);
  if (message) assert.equal(error.message, message);
  return true;
};

test("a personal workspace is made once per user, slugged and named after them, with its owner and settings", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const directory = directoryOf(db, PERSONAL);
  const user = await db.createProfile("personal-ann");

  const made = await directory.ensurePersonalWorkspaceForUser(user);
  assert.deepEqual(Object.keys(made), WORKSPACE_KEYS);
  assert.match(made.id, /^\d+$/u);
  assert.equal(made.slug, "personal-ann", "the slug comes from the username");
  assert.equal(made.name, "personal-ann's Workspace");
  assert.equal(made.ownerUserId, user.id);
  assert.equal(made.isPersonal, true);
  assert.equal(made.avatarUrl, "");
  assert.match(made.createdAt, ISO);
  assert.equal(made.deletedAt, null);
  const owner = await db.memberships.findByWorkspaceIdAndUserId(made.id, user.id);
  assert.deepEqual({ roleSid: owner.roleSid, status: owner.status }, { roleSid: "owner", status: "active" });
  assert.equal((await db.settings.findByWorkspaceId(made.id)).id, made.id, "its settings are made with it");

  const again = await directory.ensurePersonalWorkspaceForUser(user);
  assert.equal(again.id, made.id, "a second call answers the same workspace");
  assert.equal(await countWhere(db, "workspaces", { owner_user_id: user.id }), 1);
  assert.equal(await countWhere(db, "workspace_memberships", { workspace_id: made.id }), 1);
  assert.equal(await countWhere(db, "workspace_settings", { workspace_id: made.id }), 1);

  // A taken slug moves the next user's to the first free numbered one.
  const someone = await db.createProfile("personal-someone");
  await db.workspaces.insert({ slug: "personal-bo", name: "Taken", ownerUserId: someone.id });
  const bo = await db.createProfile("personal-bo");
  assert.equal((await directory.ensurePersonalWorkspaceForUser(bo)).slug, "personal-bo-2");

  const provisioned = await directory.ensureProvisionedWorkspaceForAuthenticatedUser(user);
  assert.equal(provisioned.id, made.id, "personal tenancy provisions the personal workspace");
  const teamsUser = await db.createProfile("personal-cy");
  assert.equal(await directoryOf(db, TEAMS).ensureProvisionedWorkspaceForAuthenticatedUser(teamsUser), null,
    "workspace tenancy without auto-provision makes nothing");
  assert.equal(await countWhere(db, "workspaces", { owner_user_id: teamsUser.id }), 0);
  await assert.rejects(directory.ensureProvisionedWorkspaceForAuthenticatedUser({ id: "" }),
    errorWith(400, "workspaces.user.invalidPayload", "Invalid authenticated user payload."));
  await assert.rejects(directory.ensurePersonalWorkspaceForUser(null), errorWith(400, "workspaces.user.invalidPayload"));

  const rolledBack = await db.createProfile("personal-dee");
  await assert.rejects(db.workspaces.withTransaction({}, async (txOptions) => {
    const inside = await directory.ensurePersonalWorkspaceForUser(rolledBack, txOptions);
    assert.equal((await db.memberships.findByWorkspaceIdAndUserId(inside.id, rolledBack.id, txOptions)).status, "active");
    throw new Error("Abort the caller's transaction");
  }), /Abort the caller's transaction/u);
  assert.equal(await countWhere(db, "workspaces", { owner_user_id: rolledBack.id }), 0, "nothing stays after a rollback");
  assert.equal(await countWhere(db, "workspace_memberships", { user_id: rolledBack.id }), 0);
});

test("createWorkspaceForAuthenticatedUser makes an owned workspace with a free slug, its owner membership and settings", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const directory = directoryOf(db, TEAMS);
  const user = await db.createProfile("create-eve");

  const created = await directory.createWorkspaceForAuthenticatedUser(user, { name: "Create Acme", slug: "create-acme" });
  assert.equal(created.kind, "data");
  assert.deepEqual(Object.keys(created.value), WORKSPACE_KEYS);
  assert.equal(created.value.slug, "create-acme");
  assert.equal(created.value.name, "Create Acme");
  assert.equal(created.value.ownerUserId, user.id);
  assert.equal(created.value.isPersonal, false);
  const owner = await db.memberships.findByWorkspaceIdAndUserId(created.value.id, user.id);
  assert.deepEqual({ roleSid: owner.roleSid, status: owner.status }, { roleSid: "owner", status: "active" });
  assert.equal((await db.settings.findByWorkspaceId(created.value.id)).id, created.value.id);

  const taken = await directory.createWorkspaceForAuthenticatedUser(user, { name: "Another", slug: "create-acme" });
  assert.equal(taken.value.slug, "create-acme-2", "a taken requested slug moves to the first free numbered one");
  const fromName = await directory.createWorkspaceForAuthenticatedUser(user, { name: "Create Globex & Co!" });
  assert.equal(fromName.value.slug, "create-globex-co", "an omitted slug comes from the name");

  await assert.rejects(directory.createWorkspaceForAuthenticatedUser(null, { name: "Nobody" }),
    errorWith(401, "workspaces.auth.required", "Authentication required."));
  await assert.rejects(directoryOf(db, PERSONAL).createWorkspaceForAuthenticatedUser(user, { name: "Refused" }),
    errorWith(403, "workspaces.workspace.creationDisabled", "Workspace creation is disabled for this tenancy mode."));
  assert.equal(await countWhere(db, "workspaces", { name: "Refused" }), 0);

  await assert.rejects(db.workspaces.withTransaction({}, async (txOptions) => {
    await directory.createWorkspaceForAuthenticatedUser(user, { name: "Create Rolled", slug: "create-rolled" }, txOptions);
    throw new Error("Abort the caller's transaction");
  }), /Abort the caller's transaction/u);
  assert.equal(await db.workspaces.findBySlug("create-rolled"), null, "nothing stays after a rollback");
});

test("a user's workspace list holds their active, live workspaces, personal first, as summaries", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const directory = directoryOf(db, PERSONAL);
  const user = await db.createProfile("list-fay");
  const host = await db.createProfile("list-host");
  const joined = await db.workspaces.insert({ slug: "list-joined", name: "Joined", ownerUserId: host.id });
  const left = await db.workspaces.insert({ slug: "list-left", name: "Left", ownerUserId: host.id });
  const deleted = await db.workspaces.insert({ slug: "list-deleted", name: "Deleted", ownerUserId: host.id });
  const notMine = await db.workspaces.insert({ slug: "list-not-mine", name: "Not mine", ownerUserId: host.id });
  await db.memberships.ensureOwnerMembership(notMine.id, host.id);
  await db.memberships.upsertMembership(joined.id, user.id, { roleSid: "admin", status: "active" });
  await db.memberships.upsertMembership(left.id, user.id, { roleSid: "member", status: "revoked" });
  await db.memberships.upsertMembership(deleted.id, user.id, { roleSid: "member", status: "active" });
  await db.workspaces.updateById(deleted.id, { deletedAt: new Date().toISOString() });
  const personal = await directory.ensurePersonalWorkspaceForUser(user);

  const listed = await directory.listWorkspacesForUser(user);
  assert.deepEqual(listed, [
    { id: personal.id, slug: "list-fay", name: "list-fay's Workspace", avatarUrl: "", roleSid: "owner", roleLabel: "Owner", isAccessible: true },
    { id: joined.id, slug: "list-joined", name: "Joined", avatarUrl: "", roleSid: "admin", roleLabel: "Admin", isAccessible: true }
  ], "personal first, then by id; revoked, deleted and other people's workspaces left out");
  const response = await directory.listWorkspacesForAuthenticatedUser(user);
  assert.equal(response.kind, "data");
  assert.deepEqual(response.value, { items: listed, nextCursor: null });

  assert.deepEqual(await directory.listWorkspacesForUser({ id: "" }), []);
  assert.deepEqual(await directoryOf(db, { tenancyMode: "none" }).listWorkspacesForUser(user), [], "no tenancy lists nothing");
});

test("the workspace context answers a member's workspace, membership, permissions and settings, and refuses the rest", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const directory = directoryOf(db, TEAMS);
  const owner = await db.createProfile("context-owner");
  const member = await db.createProfile("context-gus");
  const outsider = await db.createProfile("context-hal");
  const workspace = (await directory.createWorkspaceForAuthenticatedUser(owner, { name: "Context", slug: "context-team" })).value;
  await db.memberships.upsertMembership(workspace.id, member.id, { roleSid: "admin", status: "active" });

  const context = await directory.resolveWorkspaceContextForUserBySlug(member, " CONTEXT-TEAM ");
  assert.deepEqual(Object.keys(context), ["workspace", "membership", "permissions", "workspaceSettings"]);
  assert.deepEqual(context.workspace, await db.workspaces.findById(workspace.id));
  assert.equal(context.membership.userId, member.id);
  assert.equal(context.membership.roleSid, "admin");
  assert.equal(context.membership.status, "active");
  assert.deepEqual(context.permissions, listCatalogRolePermissions(db.roleCatalog, "admin"));
  assert.equal(context.workspaceSettings.id, workspace.id);

  const outside = await directory.resolveWorkspaceContextForUserBySlug(outsider, "context-team", { requireMembership: false });
  assert.equal(outside.membership, null);
  assert.deepEqual(outside.permissions, []);
  assert.equal(outside.workspace.id, workspace.id);
  await assert.rejects(directory.resolveWorkspaceContextForUserBySlug(outsider, "context-team"),
    errorWith(403, "workspaces.workspace.accessDenied", "You do not have access to this workspace."));
  await db.memberships.upsertMembership(workspace.id, member.id, { roleSid: "admin", status: "revoked" });
  await assert.rejects(directory.resolveWorkspaceContextForUserBySlug(member, "context-team"),
    errorWith(403, "workspaces.workspace.accessDenied"), "a revoked member is refused");

  // The owner's missing or inactive membership is restored by reading the context.
  await db.memberships.upsertMembership(workspace.id, owner.id, { roleSid: "owner", status: "revoked" });
  const ownerContext = await directory.resolveWorkspaceContextForUserBySlug(owner, "context-team");
  assert.equal(ownerContext.membership.status, "active");
  assert.equal((await db.memberships.findByWorkspaceIdAndUserId(workspace.id, owner.id)).status, "active", "and saved");

  await assert.rejects(directory.resolveWorkspaceContextForUserBySlug(member, "context-missing"),
    errorWith(404, "workspaces.workspace.notFound", "Workspace not found."));
  const gone = (await directory.createWorkspaceForAuthenticatedUser(owner, { name: "Gone", slug: "context-gone" })).value;
  await db.workspaces.updateById(gone.id, { deletedAt: new Date().toISOString() });
  await assert.rejects(directory.resolveWorkspaceContextForUserBySlug(owner, "context-gone"),
    errorWith(404, "workspaces.workspace.notFound"), "a deleted workspace is not found, even for its owner");
  await assert.rejects(directory.resolveWorkspaceContextForUserBySlug(owner, " "),
    errorWith(400, "workspaces.workspace.slugRequired", "workspaceSlug is required."));
  await assert.rejects(directory.resolveWorkspaceContextForUserBySlug(null, "context-team"),
    errorWith(401, "workspaces.auth.required"));
  await assert.rejects(directoryOf(db, { tenancyMode: "none" }).resolveWorkspaceContextForUserBySlug(owner, "context-team"),
    errorWith(403, "workspaces.workspace.contextDisabled", "Workspace context is disabled."));

  const request = {};
  const shared = directory.resolveWorkspaceContextForUserBySlug(owner, "context-team", { request });
  assert.equal(directory.resolveWorkspaceContextForUserBySlug(owner, "Context-Team", { request }), shared,
    "one request reads one context for the same user and slug");
  await shared;
});

test("get and update read the context first and save only the patchable fields", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const directory = directoryOf(db, TEAMS);
  const owner = await db.createProfile("update-ida");
  const intruder = await db.createProfile("update-jon");
  const workspace = (await directory.createWorkspaceForAuthenticatedUser(owner, { name: "Update", slug: "update-team" })).value;

  const got = await directory.getWorkspaceForAuthenticatedUser(owner, "update-team");
  assert.equal(got.kind, "data");
  assert.deepEqual(got.value, await db.workspaces.findById(workspace.id));

  const updated = await directory.updateWorkspaceForAuthenticatedUser(owner, "update-team", {
    name: "Renamed",
    avatarUrl: "https://example.test/avatar.png",
    slug: "update-stolen",
    ownerUserId: intruder.id,
    isPersonal: true
  });
  assert.equal(updated.kind, "data");
  assert.equal(updated.value.name, "Renamed");
  assert.equal(updated.value.avatarUrl, "https://example.test/avatar.png");
  const saved = await db.workspaces.findById(workspace.id);
  assert.deepEqual(updated.value, saved);
  assert.deepEqual({ slug: saved.slug, ownerUserId: saved.ownerUserId, isPersonal: saved.isPersonal },
    { slug: "update-team", ownerUserId: owner.id, isPersonal: false }, "fields outside the patch stay");

  await assert.rejects(directory.updateWorkspaceForAuthenticatedUser(intruder, "update-team", { name: "Hijacked" }),
    errorWith(403, "workspaces.workspace.accessDenied"));
  assert.equal((await db.workspaces.findById(workspace.id)).name, "Renamed");
});
