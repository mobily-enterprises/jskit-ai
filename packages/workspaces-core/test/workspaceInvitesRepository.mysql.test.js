import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { findDuplicateEntryError } from "@jskit-ai/database-runtime/shared";
import { workspacesDatabase } from "./support/mysqlWorkspaces.js";

// Characterization of workspaceInvitesRepository on MariaDB/MySQL, through the functions its services call, before
// its locking reads move from Knex onto the invites table resource: the record's shape from every read path (the
// resource reads and the locking reads), scoping to a workspace or an email, the lists' order, expiry and the
// accepted and revoked transitions, transactions, and the errors.
const database = workspacesDatabase("da_ws_invites");
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const RECORD_KEYS = [
  "id", "workspaceId", "email", "roleSid", "status", "tokenHash", "invitedByUserId",
  "expiresAt", "acceptedAt", "revokedAt", "createdAt", "updatedAt"
];

async function teamOf(db, tag) {
  const owner = await db.createProfile(`${tag}-owner`);
  const workspace = await db.workspaces.insert({ slug: tag, name: `Team ${tag}`, ownerUserId: owner.id });
  return { owner, workspace };
}

const invite = (db, workspace, email, tokenHash, extra = {}) =>
  db.invites.insert({ workspaceId: workspace.id, email, tokenHash, ...extra });

const statusOf = async (db, id) => (await db.invites.findById(id)).status;

test("an inserted invite reads back in one shape through the resource reads and the locking reads", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const { owner, workspace } = await teamOf(db, "shape");

  const created = await invite(db, workspace, " Ann@Example.TEST ", " shape-hash ", {
    invitedByUserId: owner.id,
    expiresAt: "2030-01-02T03:04:05.000Z"
  });
  assert.deepEqual(Object.keys(created), RECORD_KEYS);
  assert.match(created.id, /^\d+$/u);
  assert.equal(created.workspaceId, workspace.id);
  assert.equal(created.email, "ann@example.test", "the email is trimmed and lowercased");
  assert.equal(created.roleSid, "member", "the role defaults to member");
  assert.equal(created.status, "pending", "the status defaults to pending");
  assert.equal(created.tokenHash, "shape-hash", "the token hash is trimmed");
  assert.equal(created.invitedByUserId, owner.id);
  assert.equal(created.expiresAt, "2030-01-02T03:04:05.000Z");
  assert.equal(created.acceptedAt, null);
  assert.equal(created.revokedAt, null);
  assert.match(created.createdAt, ISO);
  assert.equal(created.updatedAt, created.createdAt);

  const read = await db.invites.findById(created.id);
  assert.deepEqual(read, created, "findById reads the record insert answered");
  assert.deepEqual(await db.invites.findPendingByTokenHash(" shape-hash "), read);
  assert.deepEqual(await db.invites.findPendingByIdForWorkspace(created.id, workspace.id), read);

  const locked = await db.invites.withTransaction({}, async (txOptions) => ({
    byId: await db.invites.findPendingByIdForWorkspace(created.id, workspace.id, { ...txOptions, lock: true }),
    byToken: await db.invites.findPendingByTokenHash("shape-hash", {
      ...txOptions, lock: true, workspaceId: workspace.id, inviteId: created.id
    }),
    wrongToken: await db.invites.findPendingByTokenHash("another-hash", {
      ...txOptions, lock: true, workspaceId: workspace.id, inviteId: created.id
    })
  }));
  assert.deepEqual(locked.byId, read, "a locking read answers the same record as a resource read");
  assert.deepEqual(locked.byToken, read);
  assert.equal(locked.wrongToken, null, "a locking token read compares the token after reading by id");

  const withWorkspace = await db.invites.findPendingByIdForWorkspace(created.id, workspace.id, { includeWorkspace: true });
  assert.deepEqual(withWorkspace, {
    ...read,
    workspaceSlug: "shape",
    workspaceName: "Team shape",
    workspaceAvatarUrl: undefined
  });
  // Pinned as it is: an empty avatar is a present key holding undefined, not a missing key or "".
  assert.equal(Object.hasOwn(withWorkspace, "workspaceAvatarUrl"), true);
});

test("an invite without an expiry or inviter keeps them null; withTransaction answers its work's value", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const { workspace } = await teamOf(db, "nulls");
  const created = await invite(db, workspace, "bob@example.test", "nulls-hash", { roleSid: " ADMIN ", status: " PENDING " });
  assert.equal(created.expiresAt, null);
  assert.equal(created.invitedByUserId, null);
  assert.equal(created.roleSid, "admin");
  assert.equal(created.status, "pending");
  assert.deepEqual(await db.invites.withTransaction({}, async () => ({ answered: true })), { answered: true });
});

test("reads answer only the named invite, workspace or token, and null for anything else", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const { workspace } = await teamOf(db, "reads");
  const { workspace: other } = await teamOf(db, "reads-other");
  const created = await invite(db, workspace, "cy@example.test", "reads-hash");

  assert.equal(await db.invites.findById("not-an-id"), null);
  assert.equal(await db.invites.findById("999999999"), null);
  assert.equal(await db.invites.findPendingByIdForWorkspace(created.id, other.id), null, "another workspace's invite");
  assert.equal(await db.invites.findPendingByIdForWorkspace(created.id, ""), null);
  assert.equal(await db.invites.findPendingByIdForWorkspace("", workspace.id), null);
  assert.equal(await db.invites.findPendingByTokenHash("no-such-hash"), null);
  assert.equal(await db.invites.findPendingByTokenHash(""), null);
  assert.equal(await db.invites.findByTokenHashWithWorkspace("   "), null);
  assert.equal(await db.invites.findByTokenHashWithWorkspace("no-such-hash"), null);

  await db.invites.revokeById(created.id);
  assert.equal(await db.invites.findPendingByTokenHash("reads-hash"), null, "only a pending invite answers its token");
  assert.equal(await db.invites.findPendingByIdForWorkspace(created.id, workspace.id), null);
  const revoked = await db.invites.findByTokenHashWithWorkspace(" reads-hash ");
  assert.equal(revoked.status, "revoked", "the public token read answers any status");
  assert.equal(revoked.id, created.id);
  assert.equal(revoked.workspaceSlug, "reads");
  assert.equal(revoked.workspaceName, "Team reads");
  assert.match(revoked.revokedAt, ISO);
  assert.equal(revoked.acceptedAt, null);
  assert.equal((await db.invites.findById(created.id)).status, "revoked", "findById answers any status");
});

test("the pending lists keep to their workspace or email and list the newest first, ties in id order", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const { workspace } = await teamOf(db, "lists");
  const { workspace: other } = await teamOf(db, "lists-other");
  const first = await invite(db, workspace, "dee@example.test", "lists-1");
  const second = await invite(db, workspace, "eve@example.test", "lists-2");
  const third = await invite(db, workspace, "fay@example.test", "lists-3");
  const accepted = await invite(db, workspace, "gus@example.test", "lists-4");
  const elsewhere = await invite(db, other, "dee@example.test", "lists-5");
  await db.invites.markAcceptedById(accepted.id);
  const createdAt = (row, value) => db.knex("workspace_invites").where({ id: row.id }).update({ created_at: value });
  await createdAt(first, "2030-01-01 00:00:01");
  await createdAt(second, "2030-01-01 00:00:03");
  await createdAt(third, "2030-01-01 00:00:02");
  await createdAt(elsewhere, "2030-01-01 00:00:04");

  const listed = await db.invites.listPendingByWorkspaceIdWithWorkspace(workspace.id);
  assert.deepEqual(listed.map(({ id }) => id), [second.id, third.id, first.id], "newest first, pending only");
  assert.deepEqual(Object.keys(listed[0]), [...RECORD_KEYS, "workspaceSlug", "workspaceName", "workspaceAvatarUrl"]);
  assert.equal(listed[0].createdAt, "2030-01-01T00:00:03.000Z");
  assert.ok(listed.every((entry) => entry.workspaceSlug === "lists" && entry.workspaceName === "Team lists"));

  const byEmail = await db.invites.listPendingByEmail(" DEE@Example.test ");
  assert.deepEqual(byEmail.map(({ id }) => id), [elsewhere.id, first.id], "every workspace's pending invites for the email");
  assert.deepEqual(byEmail.map(({ workspaceSlug }) => workspaceSlug), ["lists-other", "lists"]);

  // Pinned as it is: created_at keeps whole seconds and the sort compares it as text, so invites created in the same
  // second stay in the read's id order, oldest first, inside a list that is otherwise newest first.
  await createdAt(first, "2030-01-01 00:00:09");
  await createdAt(third, "2030-01-01 00:00:09");
  const tied = await db.invites.listPendingByWorkspaceIdWithWorkspace(workspace.id);
  assert.deepEqual(tied.map(({ id }) => id), [first.id, third.id, second.id]);

  assert.deepEqual(await db.invites.listPendingByEmail(""), []);
  assert.deepEqual(await db.invites.listPendingByEmail("nobody@example.test"), []);
  assert.deepEqual(await db.invites.listPendingByWorkspaceIdWithWorkspace("not-an-id"), []);
});

test("expiring an email's pending invites touches only that workspace's pending invites for it, and joins a transaction", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const { workspace } = await teamOf(db, "expire");
  const { workspace: other } = await teamOf(db, "expire-other");
  const one = await invite(db, workspace, "hal@example.test", "expire-1");
  const two = await invite(db, workspace, "hal@example.test", "expire-2");
  const someoneElse = await invite(db, workspace, "ida@example.test", "expire-3");
  const elsewhere = await invite(db, other, "hal@example.test", "expire-4");
  const accepted = await invite(db, workspace, "hal@example.test", "expire-5");
  await db.invites.markAcceptedById(accepted.id);

  assert.equal(await db.invites.expirePendingByWorkspaceIdAndEmail(workspace.id, " HAL@EXAMPLE.TEST "), undefined);
  assert.equal(await statusOf(db, one.id), "expired", "every pending invite for the email, of any age");
  assert.equal(await statusOf(db, two.id), "expired");
  assert.equal(await statusOf(db, someoneElse.id), "pending");
  assert.equal(await statusOf(db, elsewhere.id), "pending", "another workspace's invite for the same email");
  assert.equal(await statusOf(db, accepted.id), "accepted", "a handled invite stays as it was");
  const expired = await db.invites.findById(one.id);
  assert.equal(expired.revokedAt, null, "expiry stamps no time of its own");
  assert.equal(expired.acceptedAt, null);

  await db.invites.expirePendingByWorkspaceIdAndEmail(workspace.id, "hal@example.test");
  assert.equal(await statusOf(db, one.id), "expired", "expiring again changes nothing");
  assert.equal(await db.invites.expirePendingByWorkspaceIdAndEmail("", "hal@example.test"), undefined, "no workspace: nothing");

  const kept = await invite(db, workspace, "jan@example.test", "expire-6");
  await assert.rejects(db.invites.withTransaction({}, async (txOptions) => {
    await db.invites.expirePendingByWorkspaceIdAndEmail(workspace.id, "jan@example.test", txOptions);
    assert.equal(await statusOf(db, kept.id), "pending", "uncommitted while the caller's transaction runs");
    throw new Error("Abort the caller's transaction");
  }), /Abort the caller's transaction/u);
  assert.equal(await statusOf(db, kept.id), "pending", "it rolls back with the caller's transaction");

  await assert.rejects(db.invites.expirePendingByWorkspaceIdAndEmail("999999999", "hal@example.test"), (error) => {
    assert.equal(error.status, 404);
    assert.equal(error.code, "workspaces.invite.workspaceMissing");
    assert.equal(error.message, "Invitation workspace no longer exists.");
    return true;
  });
});

test("accepting or revoking stamps a pending invite once; a handled, unknown or foreign invite is a 404", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const { workspace } = await teamOf(db, "transitions");
  const { workspace: other } = await teamOf(db, "transitions-other");
  const toAccept = await invite(db, workspace, "kim@example.test", "transitions-1");
  const toRevoke = await invite(db, workspace, "lee@example.test", "transitions-2");
  const kept = await invite(db, workspace, "max@example.test", "transitions-3");

  assert.equal(await db.invites.markAcceptedById(toAccept.id), undefined);
  const accepted = await db.invites.findById(toAccept.id);
  assert.equal(accepted.status, "accepted");
  assert.match(accepted.acceptedAt, ISO);
  assert.equal(accepted.revokedAt, null);
  assert.equal(await db.invites.revokeById(toRevoke.id), undefined);
  const revoked = await db.invites.findById(toRevoke.id);
  assert.equal(revoked.status, "revoked");
  assert.match(revoked.revokedAt, ISO);
  assert.equal(revoked.acceptedAt, null);

  const handled = (error) => {
    assert.equal(error.status, 404);
    assert.equal(error.code, "workspaces.invite.invitationNotFoundOrHandled");
    assert.equal(error.message, "Invitation not found or already handled.");
    return true;
  };
  await assert.rejects(db.invites.revokeById(toRevoke.id), handled, "revoking twice is refused, not repeated");
  await assert.rejects(db.invites.markAcceptedById(toAccept.id), handled);
  await assert.rejects(db.invites.revokeById(toAccept.id), handled, "an accepted invite cannot be revoked");
  await assert.rejects(db.invites.markAcceptedById("999999999"), handled);
  await assert.rejects(db.invites.revokeById(kept.id, { workspaceId: other.id }), handled, "another workspace's id");
  assert.equal(await statusOf(db, kept.id), "pending");
  await assert.rejects(db.invites.revokeById(""), (error) => error instanceof TypeError &&
    error.message === "Invitation transition requires inviteId.");

  await assert.rejects(db.invites.withTransaction({}, async (txOptions) => {
    await db.invites.revokeById(kept.id, txOptions);
    throw new Error("Abort the caller's transaction");
  }), /Abort the caller's transaction/u);
  assert.equal(await statusOf(db, kept.id), "pending", "a revoke rolls back with the caller's transaction");
  await db.invites.withTransaction({}, (txOptions) => db.invites.revokeById(kept.id, { ...txOptions, workspaceId: workspace.id }));
  assert.equal(await statusOf(db, kept.id), "revoked", "and commits with it");
});

test("locking reads need the caller's transaction and no includes, and refuse a missing workspace", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const { workspace } = await teamOf(db, "locking");
  const created = await invite(db, workspace, "ned@example.test", "locking-1");

  await assert.rejects(
    db.invites.findPendingByIdForWorkspace(created.id, workspace.id, { lock: true }),
    /needs a transaction/u
  );
  await db.invites.withTransaction({}, async (txOptions) => {
    await assert.rejects(
      db.invites.findPendingByIdForWorkspace(created.id, workspace.id, { ...txOptions, lock: true, includeWorkspace: true }),
      (error) => error instanceof TypeError &&
        error.message === "Locking invites takes no relationship includes."
    );
  });
  await db.invites.withTransaction({}, async (txOptions) => {
    await assert.rejects(
      db.invites.findPendingByIdForWorkspace(created.id, "999999999", { ...txOptions, lock: true }),
      (error) => error.status === 404 && error.code === "workspaces.invite.workspaceMissing"
    );
  });
  await db.invites.withTransaction({}, async (txOptions) => {
    assert.equal(await db.invites.lockWorkspaceForInvitations(workspace.id, txOptions), undefined);
    await assert.rejects(db.invites.lockWorkspaceForInvitations("999999999", txOptions),
      (error) => error.status === 404 && error.code === "workspaces.invite.workspaceMissing");
  });
});

test("insert needs a workspace; a duplicate token outside a transaction answers the newest pending invite for the email", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const { workspace } = await teamOf(db, "duplicates");
  await assert.rejects(db.invites.insert({ email: "ola@example.test", tokenHash: "duplicates-0" }),
    (error) => error instanceof TypeError && error.message === "workspaceInvitesRepository.insert requires workspaceId.");

  const original = await invite(db, workspace, "ola@example.test", "duplicates-1");
  // Pinned as it is: the token hash is unique, and a standalone insert that loses to it is treated as a lost race,
  // answering the newest pending invite of the same workspace and email; for another email that is null.
  const sameEmail = await invite(db, workspace, "ola@example.test", "duplicates-1", { roleSid: "admin" });
  assert.deepEqual(sameEmail, await db.invites.findById(original.id));
  assert.equal(await invite(db, workspace, "pat@example.test", "duplicates-1"), null);
  assert.equal((await db.invites.listPendingByWorkspaceIdWithWorkspace(workspace.id)).length, 1);

  // Inside a caller's transaction the duplicate is not recovered: it fails the transaction.
  let participantError = null;
  await assert.rejects(db.invites.withTransaction({}, async (txOptions) => {
    try {
      await db.invites.insert({ workspaceId: workspace.id, email: "ola@example.test", tokenHash: "duplicates-1" }, txOptions);
    } catch (error) {
      participantError = error;
      throw error;
    }
  }), (error) => error.transactionOutcome === "rolledBack");
  assert.equal(participantError?.transactionOutcome, "pending");
  assert.ok(findDuplicateEntryError(participantError));
  assert.equal((await db.invites.listPendingByWorkspaceIdWithWorkspace(workspace.id)).length, 1);
});
