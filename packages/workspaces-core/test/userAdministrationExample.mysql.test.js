import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { workspaceMembersOnly } from "../../users-core/patterns/user-administration-server/example/packages/users-workspace/src/server/workspaceMembersOnly.js";
import { workspacesDatabase } from "./support/mysqlWorkspaces.js";

// users-core's workspace user administration example (users-workspace's workspaceMembersOnly) over the migrated users
// and workspaces tables on MariaDB/MySQL: a page of the workspace's active members is chosen in SQL, so no statement
// reads the workspace's memberships whole.
const database = workspacesDatabase("da_ws_user_admin");

async function teamOf(db, tag, memberNames) {
  const owner = await db.createProfile(`${tag}-owner`);
  const workspace = await db.workspaces.insert({ slug: tag, name: `Team ${tag}`, ownerUserId: owner.id });
  await db.memberships.ensureOwnerMembership(workspace.id, owner.id);
  const members = { owner };
  for (const name of memberNames) {
    members[name] = await db.createProfile(`${tag}-${name}`);
    await db.memberships.addMember({ workspaceId: workspace.id, userId: members[name].id });
  }
  return { workspace, members };
}

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

const names = (document) => document.data.map((record) => record.attributes.displayName);

test("the workspace user administration list pages the workspace's active members, choosing each page in SQL", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const { workspace, members } = await teamOf(db, "uaw", ["dan", "amy", "cat", "bob", "eve"]);
  await db.memberships.upsertMembership(workspace.id, members.eve.id, { status: "revoked" });
  const { members: others } = await teamOf(db, "uaw-other", ["amy"]);
  const outsider = await db.createProfile("uaw-ann");
  const users = workspaceMembersOnly(db.profiles, db.memberships);
  const options = { context: { workspace: { id: workspace.id } }, format: "jsonapi" };

  const { result: first, statements } = await statementsOf(db.knex, () => users.query({ page: { size: 2 } }, options));
  assert.deepEqual(names(first), ["uaw-amy", "uaw-bob"]);
  assert.equal(first.meta.pagination.hasMore, true);
  // Each statement that reads memberships asks whether one row has one, in the page's own statement: none reads them
  // whole to filter the users in code.
  const membershipReads = statements.filter((sql) => /workspace_memberships/u.test(sql));
  assert.ok(membershipReads.length > 0, statements.join("\n"));
  assert.ok(membershipReads.every((sql) => /exists/iu.test(sql) && /limit/iu.test(sql)), membershipReads.join("\n"));

  const second = await users.query({ page: { size: 2, after: first.meta.pagination.cursor.next } }, options);
  assert.deepEqual(names(second), ["uaw-cat", "uaw-dan"]);
  const last = await users.query({ page: { size: 2, after: second.meta.pagination.cursor.next } }, options);
  // The revoked member, the other workspace's member and a user of no workspace are never listed.
  assert.deepEqual(names(last), ["uaw-owner"]);
  assert.equal(last.meta.pagination.hasMore, false);
  assert.equal(last.meta.pagination.cursor, undefined);

  // The users list's search and an id list narrow the members in the same statement.
  assert.deepEqual(names(await users.query({ filters: { q: "amy" }, page: { size: 20 } }, options)), ["uaw-amy"]);
  const requested = [members.bob.id, members.eve.id, others.amy.id, outsider.id];
  assert.deepEqual(names(await users.query({ filters: { id: requested }, page: { size: 20 } }, options)), ["uaw-bob"]);
  // A context with no workspace lists nobody.
  assert.deepEqual((await users.query({ page: { size: 20 } }, { context: {}, format: "jsonapi" })).data, []);
  // Without the JSON:API format the page answers records.
  const plain = await users.query({ page: { size: 4 } }, { context: options.context });
  assert.deepEqual(plain.records.map((record) => record.displayName), ["uaw-amy", "uaw-bob", "uaw-cat", "uaw-dan"]);
  assert.equal(plain.page.hasMore, true);
  await assert.rejects(users.query({ page: { size: 2, after: "not-a-cursor" } }, options),
    (error) => error.status === 400 && error.code === "users.list.cursorInvalid");
});

test("the workspace user administration view reads one membership to show a member, and hides anyone else", async () => {
  requireTestDatabase(process.env);
  const db = await database.open();
  const { workspace, members } = await teamOf(db, "uav", ["amy", "bob"]);
  await db.memberships.upsertMembership(workspace.id, members.bob.id, { status: "revoked" });
  const outsider = await db.createProfile("uav-ann");
  const users = workspaceMembersOnly(db.profiles, db.memberships);
  const options = { context: { workspace: { id: workspace.id } } };

  const { result: shown, statements } = await statementsOf(db.knex, () => users.get(members.amy.id, {}, options));
  assert.equal(shown.displayName, "uav-amy");
  // The membership read selects the one user's membership, not every member's.
  const membershipReads = statements.filter((sql) => /workspace_memberships/u.test(sql));
  assert.ok(membershipReads.length > 0 && membershipReads.every((sql) => /\bwhere\b[\s\S]*user_id`?\s*=/iu.test(sql)),
    membershipReads.join("\n"));
  assert.equal(await users.get(members.bob.id, {}, { ...options, missing: "skip" }), null);
  for (const id of [members.bob.id, outsider.id]) {
    await assert.rejects(users.get(id, {}, options), (error) => error.status === 404 && error.code === "crud.document.notFound");
  }
});
