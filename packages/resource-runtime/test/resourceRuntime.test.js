import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { RestApiLockOutsideTransactionError, RestApiScopedQueryReadOnlyError } from "json-rest-api";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import {
  DuplicateOwnerError,
  MissingScopeError,
  PageSizeError,
  RowLimitError,
  StaleRecordError,
  UnpagedQueryError
} from "../src/server/index.js";
import { normalizeOpaqueId } from "@jskit-ai/kernel/shared/support/normalize";
import { createTestResourceRuntime } from "../src/test/index.js";

const WORKSPACE_A = Object.freeze({ workspace: { id: "1" } });
const WORKSPACE_B = Object.freeze({ workspace: { id: "2" } });

function noteResource(extra = {}) {
  return defineTableResource({
    name: "notes",
    tableName: "notes",
    ownership: "workspace",
    defaultSort: ["id"],
    queryMaxLimit: 20,
    lockVersionField: "lockVersion",
    schema: {
      id: { type: "id", primary: true },
      workspaceId: { type: "id", nullable: true, search: true, storage: { column: "workspace_id" } },
      title: { type: "string", required: true, search: true },
      status: { type: "string", defaultTo: "open", search: true },
      lockVersion: { type: "integer", defaultTo: 0, storage: { column: "lock_version" } }
    },
    ...extra
  });
}

async function createFixture(t, { requestRowLimit, owns = [noteResource()] } = {}) {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("notes", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("title").notNullable();
    table.string("status").notNullable().defaultTo("open");
    table.integer("lock_version").notNullable().defaultTo(0);
  });
  const runtime = await createTestResourceRuntime({ knex, requestRowLimit });
  const resources = await runtime.own("notes.feature", owns);
  const systemContext = runtime.createSystemContext({ feature: "notes.feature", systemScope: "tests", reason: "read every note" });
  return { knex, runtime, resources, notes: resources.notes, systemContext };
}

test("own() answers a handle per resource and refuses a second owner of a table or name", async (t) => {
  const { runtime, resources } = await createFixture(t);
  assert.deepEqual(Object.keys(resources), ["notes"]);
  assert.equal(typeof resources.contributeRowPolicy, "function");
  await assert.rejects(runtime.own("other.feature", [noteResource()]), DuplicateOwnerError);
  await assert.rejects(runtime.own("other.feature", [noteResource({ name: "otherNotes" })]), DuplicateOwnerError);
  await assert.rejects(runtime.own("other.feature", [{ resource: noteResource({ name: "x", tableName: "x" }), autofilter: "workspace" }]), /does not take "autofilter"/u);
  assert.deepEqual(runtime.ownedTables(), [{ name: "notes", tableName: "notes", featureId: "notes.feature" }]);
});

test("a call without a context is refused before anything runs", async (t) => {
  const { notes } = await createFixture(t);
  await assert.rejects(notes.create({ title: "x" }), MissingScopeError);
  await assert.rejects(notes.query({ page: { size: 5 } }), MissingScopeError);
});

test("reads and single writes stay in the context's workspace", async (t) => {
  const { notes, knex } = await createFixture(t);
  const mine = await notes.create({ title: "mine" }, { context: WORKSPACE_A });
  const theirs = await notes.create({ title: "theirs" }, { context: WORKSPACE_B });
  assert.equal(mine.title, "mine");
  assert.equal(String(mine.workspaceId), "1");
  assert.equal(await notes.create({ title: "quiet" }, { context: WORKSPACE_A, returning: "none" }), undefined);
  assert.match(String(await notes.create({ title: "by id" }, { context: WORKSPACE_A, returning: "id" })), /^\d+$/u);

  const { records, page } = await notes.query({ page: { size: 10 } }, { context: WORKSPACE_A });
  assert.deepEqual(records.map(({ title }) => title), ["mine", "quiet", "by id"]);
  assert.deepEqual(page, { size: 10, hasMore: false, next: null });
  assert.equal(await notes.get(theirs.id, {}, { context: WORKSPACE_A }), null);
  assert.equal(await notes.patch(theirs.id, { title: "taken" }, { context: WORKSPACE_A }), null);
  assert.equal(await notes.delete(theirs.id, { context: WORKSPACE_A }), null);
  assert.equal((await knex("notes").where({ id: theirs.id }).first()).title, "theirs");

  const patched = await notes.patch(mine.id, { title: "mine, edited" }, { context: WORKSPACE_A });
  assert.equal(patched.title, "mine, edited");
  await notes.delete(mine.id, { context: WORKSPACE_A });
  assert.equal(await notes.get(mine.id, {}, { context: WORKSPACE_A }), null);
});

test("query() pages with page.size and page.after, and refuses an unpaged or oversized read", async (t) => {
  const { notes } = await createFixture(t);
  await notes.createMany(Array.from({ length: 5 }, (_, index) => ({ title: `n${index}` })), { context: WORKSPACE_A });
  await assert.rejects(notes.query({}, { context: WORKSPACE_A }), UnpagedQueryError);
  await assert.rejects(notes.query({ page: { size: 21 } }, { context: WORKSPACE_A }), PageSizeError);
  await assert.rejects(notes.query({ limit: 2 }, { context: WORKSPACE_A }), /does not take limit/u);
  const first = await notes.query({ page: { size: 2 } }, { context: WORKSPACE_A });
  assert.deepEqual(first.records.map(({ title }) => title), ["n0", "n1"]);
  assert.equal(first.page.hasMore, true);
  const second = await notes.query({ page: { size: 2, after: first.page.next } }, { context: WORKSPACE_A });
  assert.deepEqual(second.records.map(({ title }) => title), ["n2", "n3"]);
  const filtered = await notes.query({ filters: { title: "n4" }, page: { size: 2 } }, { context: WORKSPACE_A });
  assert.deepEqual(filtered.records.map(({ title }) => title), ["n4"]);
  assert.deepEqual(notes.pageLimits(), { request: 20, server: 1000 });
});

test("queryAll() stops at the request row limit, which background work does not have", async (t) => {
  const { notes, runtime } = await createFixture(t, { requestRowLimit: 3 });
  await notes.createMany(Array.from({ length: 5 }, (_, index) => ({ title: `n${index}` })), { context: WORKSPACE_A });
  await assert.rejects(notes.queryAll({}, { context: WORKSPACE_A }), (error) => error instanceof RowLimitError && /background job/u.test(error.message));
  const system = runtime.createSystemContext({ feature: "notes.feature", systemScope: "tests", reason: "nightly digest" });
  assert.equal((await notes.queryAll({}, { context: system })).length, 5);
  assert.equal((await notes.queryAll({}, { context: system.forWorkspace("1") })).length, 5);
  assert.equal((await notes.queryAll({}, { context: system.forWorkspace("2") })).length, 0);
  assert.throws(() => runtime.createSystemContext({ feature: "notes.feature", systemScope: "tests", reason: " " }), /needs the reason/u);
});

test("forWorkspaceUser() reaches one user's rows in one workspace, of a workspace_user table and of a user table", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("drafts", (table) => {
    table.increments("id");
    table.integer("workspace_id").notNullable();
    table.integer("user_id").notNullable();
    table.string("title").notNullable();
  });
  await knex.schema.createTable("bookmarks", (table) => {
    table.increments("id");
    table.integer("user_id").notNullable();
    table.string("title").notNullable();
  });
  await knex("drafts").insert([
    { workspace_id: 1, user_id: 7, title: "mine" },
    { workspace_id: 1, user_id: 8, title: "a colleague's" },
    { workspace_id: 2, user_id: 7, title: "mine elsewhere" }
  ]);
  await knex("bookmarks").insert([{ user_id: 7, title: "mine" }, { user_id: 8, title: "someone else's" }]);
  const userField = { type: "id", search: true, storage: { column: "user_id" } };
  const drafts = defineTableResource({
    name: "drafts",
    tableName: "drafts",
    ownership: "workspace_user",
    schema: {
      workspaceId: { type: "id", search: true, storage: { column: "workspace_id" } },
      userId: userField,
      title: { type: "string", required: true }
    }
  });
  const bookmarks = defineTableResource({
    name: "bookmarks",
    tableName: "bookmarks",
    ownership: "user",
    schema: { userId: userField, title: { type: "string", required: true } }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const resources = await runtime.own("drafts.feature", [drafts, bookmarks]);
  const system = runtime.createSystemContext({ feature: "drafts.feature", systemScope: "tests", reason: "deliver one user's event" });
  const context = system.forWorkspaceUser("1", "7");

  assert.deepEqual((await resources.drafts.queryAll({}, { context })).map(({ title }) => title), ["mine"]);
  assert.deepEqual((await resources.bookmarks.queryAll({}, { context })).map(({ title }) => title), ["mine"]);
  assert.throws(() => system.forWorkspaceUser("", "7"), /forWorkspaceUser needs the id of the workspace/u);
  assert.throws(() => system.forWorkspaceUser("1", null), /forWorkspaceUser needs the id of the user/u);
});

test("many-row writes run per chunk in the caller's workspace, and answer nothing, ids or records", async (t) => {
  const { notes, knex } = await createFixture(t);
  const ids = await notes.createMany([{ title: "a" }, { title: "b" }, { title: "c" }], { context: WORKSPACE_A, returning: "ids" });
  assert.equal(ids.length, 3);
  const [other] = await notes.createMany([{ title: "other" }], { context: WORKSPACE_B, returning: "records" });
  assert.equal(other.title, "other");

  await notes.patchMany([{ id: ids[0], status: "done" }, { id: ids[1], status: "done" }], { context: WORKSPACE_A });
  await assert.rejects(notes.patchMany([{ id: other.id, status: "done" }], { context: WORKSPACE_A }), /not found|RecordsNotFound/iu);
  await notes.patchMany([{ id: other.id, status: "done" }], { context: WORKSPACE_A, missing: "skip" });
  assert.equal((await knex("notes").where({ id: other.id }).first()).status, "open");

  const changed = await notes.patchWhereIds(ids, { title: "same" }, { context: WORKSPACE_A, returning: "records" });
  assert.deepEqual(changed.map(({ title }) => title), ["same", "same", "same"]);
  await notes.patchWhere({ status: "done" }, { title: "finished" }, { context: WORKSPACE_A });
  assert.deepEqual((await knex("notes").where({ title: "finished" }).pluck("id")).map(String).sort(), [ids[0], ids[1]].map(String).sort());

  await assert.rejects(notes.patchWhere({}, { title: "every" }, { context: WORKSPACE_A }), /pass all: true/u);
  await assert.rejects(notes.deleteWhere({}, { context: WORKSPACE_A }), /pass all: true/u);
  await assert.rejects(notes.patchWhere({ status: "done" }, { title: "every" }, { context: WORKSPACE_A, all: true }), /filters or all: true, not both/u);
  await assert.rejects(notes.deleteWhere({ status: "done" }, { context: WORKSPACE_A, all: true }), /filters or all: true, not both/u);
  // all: true reaches every row the caller owns, and no other workspace's.
  await notes.patchWhere({}, { status: "done" }, { context: WORKSPACE_A, all: true });
  assert.equal((await knex("notes").where({ id: other.id }).first()).status, "open");
  await notes.deleteMany([ids[2]], { context: WORKSPACE_A });
  await notes.deleteWhere({ status: "done" }, { context: WORKSPACE_A });
  assert.deepEqual(await knex("notes").pluck("title"), ["other"]);
});

test("an upsert finds rows by its conflict keys alone, never by an id, and stays in the caller's workspace", async (t) => {
  const { notes, knex } = await createFixture(t);
  await knex.schema.alterTable("notes", (table) => table.unique(["workspace_id", "title"]));
  const upsert = { keys: ["workspaceId", "title"], action: "merge", merge: ["status"] };
  await assert.rejects(
    notes.createMany([{ id: 1, title: "a" }], { context: WORKSPACE_A, onConflict: { ...upsert, action: "ignore" } }),
    /onConflict takes rows without an id/u
  );
  await assert.rejects(
    notes.createMany([{ title: "a" }, { title: "a", status: "done" }], { context: WORKSPACE_A, onConflict: upsert }),
    (error) => error.code === "REST_API_VALIDATION"
  );
  await notes.createMany([{ title: "a" }], { context: WORKSPACE_B });
  await notes.createMany([{ title: "a" }], { context: WORKSPACE_A });
  await notes.createMany([{ title: "a", status: "done" }], { context: WORKSPACE_A, onConflict: upsert });
  assert.deepEqual(
    (await knex("notes").orderBy("workspace_id").select("workspace_id", "status")).map(({ workspace_id: workspaceId, status }) => [workspaceId, status]),
    [[1, "done"], [2, "open"]]
  );
});

test("patch() with lockVersion patches the version it read and refuses a stale one; onlyIf patches only matching rows", async (t) => {
  const { notes } = await createFixture(t);
  const note = await notes.create({ title: "draft" }, { context: WORKSPACE_A });
  assert.equal(note.lockVersion, 0);
  const saved = await notes.patch(note.id, { title: "v1" }, { context: WORKSPACE_A, lockVersion: 0 });
  assert.equal(saved.lockVersion, 1);
  // A write's failure reaches the caller as json-rest-api's RestApiWriteError, its status and code copied from the cause.
  await assert.rejects(notes.patch(note.id, { title: "late" }, { context: WORKSPACE_A, lockVersion: 0 }), (error) =>
    error.cause instanceof StaleRecordError && error.status === 409 && error.code === "crud.document.lockVersionConflict" &&
    error.transactionOutcome === "rolledBack");
  assert.equal(await notes.patch(note.id, { title: "x" }, { context: WORKSPACE_A, onlyIf: { status: "done" } }), null);
  assert.equal((await notes.patch(note.id, { status: "done" }, { context: WORKSPACE_A, onlyIf: { status: "open" } })).status, "done");
  assert.equal(await notes.patch(note.id, { title: "x" }, { context: WORKSPACE_B, lockVersion: 2 }), null);
});

test("afterWrite runs once per write, in the write's transaction and scope", async (t) => {
  const events = [];
  const resource = noteResource();
  const { notes, knex } = await createFixture(t, {
    owns: [{
      resource,
      hooks: {
        afterWrite: async ({ operation, ids, options }) => {
          events.push({ operation, ids, scoped: options.context === WORKSPACE_A, inTransaction: Boolean(options.trx) });
          if (operation === "delete") {
            throw new Error("keep it");
          }
        }
      }
    }]
  });
  const note = await notes.create({ title: "a" }, { context: WORKSPACE_A, returning: "none" });
  assert.equal(note, undefined);
  const [id] = events[0].ids;
  await notes.createMany([{ title: "b" }, { title: "c" }], { context: WORKSPACE_A });
  await assert.rejects(notes.delete(id, { context: WORKSPACE_A }), /keep it/u);
  assert.equal(await knex("notes").count({ count: "*" }).first().then(({ count }) => Number(count)), 3);
  assert.deepEqual(events.map(({ operation, ids, scoped, inTransaction }) => [operation, ids.length, scoped, inTransaction]), [
    ["create", 1, true, true],
    ["createMany", 2, true, true],
    ["delete", 1, true, true]
  ]);
});

test("withTransaction() commits together and rolls back together", async (t) => {
  const { notes, knex } = await createFixture(t);
  await assert.rejects(notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    await notes.create({ title: "a" }, txOptions);
    await notes.createMany([{ title: "b" }], txOptions);
    throw new Error("undo");
  }), /undo/u);
  assert.equal((await knex("notes").count({ count: "*" }).first()).count, 0);
  await notes.withTransaction({ context: WORKSPACE_A }, (txOptions) => notes.create({ title: "kept" }, txOptions));
  assert.deepEqual(await knex("notes").pluck("title"), ["kept"]);
});

test("withTransaction() answers a failure of its work as RestApiWriteError, or as the work threw it with asThrown", async (t) => {
  const { notes } = await createFixture(t);
  const failure = Object.freeze(new Error("refused by the work"));
  await assert.rejects(
    notes.withTransaction({ context: WORKSPACE_A }, () => {
      throw failure;
    }),
    (error) => error !== failure && error.cause === failure && error.transactionOutcome === "rolledBack"
  );
  await assert.rejects(
    notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
      await notes.create({ title: "undone" }, txOptions);
      throw failure;
    }, { retry: false, asThrown: true }),
    (error) => error === failure
  );
  assert.equal((await notes.queryAll({}, { context: WORKSPACE_A })).length, 0);
});

test("findOrCreate() answers the record with the id, creating it only when it is missing", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("counters", (table) => {
    table.string("counter_key").primary();
    table.integer("value").notNullable();
  });
  const runtime = await createTestResourceRuntime({ knex });
  // A key the feature computes is an opaque string id.
  const { counters } = await runtime.own("counters.feature", [{ normalizeId: normalizeOpaqueId, resource: defineTableResource({
    name: "counters",
    tableName: "counters",
    idProperty: "counter_key",
    schema: {
      id: { type: "string", primary: true, required: true, storage: { column: "counter_key" } },
      value: { type: "integer", required: true }
    }
  }) }]);
  const options = { context: runtime.createSystemContext({ feature: "counters.feature", systemScope: "tests", reason: "keyed counters" }) };
  assert.deepEqual(await counters.findOrCreate({ id: "visits", value: 0 }, options), { id: "visits", value: 0 });
  await knex("counters").where({ counter_key: "visits" }).update({ value: 7 });
  assert.deepEqual(await counters.findOrCreate({ id: "visits", value: 0 }, options), { id: "visits", value: 7 });
  assert.deepEqual(await knex("counters").select("counter_key", "value"), [{ counter_key: "visits", value: 7 }]);
});

test("inTransaction() answers whether a call runs inside a transaction", async (t) => {
  const { notes } = await createFixture(t);
  assert.equal(notes.inTransaction({ context: WORKSPACE_A }), false);
  assert.equal(await notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => notes.inTransaction(txOptions)), true);
});

test("locks need a transaction and take only the caller's rows", async (t) => {
  const { notes } = await createFixture(t);
  const [a, b] = await notes.createMany([{ title: "a" }, { title: "b", status: "queued" }], { context: WORKSPACE_A, returning: "records" });
  const [other] = await notes.createMany([{ title: "other", status: "queued" }], { context: WORKSPACE_B, returning: "records" });
  await assert.rejects(notes.lock(a.id, { context: WORKSPACE_A }), RestApiLockOutsideTransactionError);
  await notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    assert.equal((await notes.lock(a.id, txOptions)).title, "a");
    assert.deepEqual((await notes.lockMany([a.id, other.id], { ...txOptions, missing: "skip" })).map(({ title }) => title), ["a"]);
    assert.deepEqual((await notes.lockWhere({ status: "queued" }, txOptions)).map(({ title }) => title), ["b"]);
    assert.deepEqual((await notes.claim({ status: "queued" }, { limit: 5 }, txOptions)).map(({ id }) => String(id)), [String(b.id)]);
  });
});

test("scopedQuery() answers a read-only builder over the caller's rows that orWhere cannot widen", async (t) => {
  const { notes } = await createFixture(t);
  await notes.createMany([{ title: "a" }, { title: "b" }], { context: WORKSPACE_A });
  await notes.createMany([{ title: "other" }], { context: WORKSPACE_B });
  const { query } = await notes.scopedQuery({ alias: "n" }, { context: WORKSPACE_A });
  // The scope is inside the derived table "n", so an orWhere on the outer query cannot reach another workspace's row.
  const rows = await query.clone()
    .where(notes.column("title", "n"), "a")
    .orWhere(notes.column("title", "n"), "other")
    .select(notes.column("title", "n"))
    .orderBy(notes.column("id", "n"));
  assert.deepEqual(rows.map(({ title }) => title), ["a"]);
  const counted = await query.clone().select(notes.raw("count(*) as total")).first();
  assert.equal(Number(counted.total), 2);
  assert.throws(() => query.clone().update({ title: "x" }), RestApiScopedQueryReadOnlyError);
  assert.throws(() => notes.raw("count(?)"), /needs the bindings/u);
  assert.deepEqual(notes.toRecords([{ id: 1, workspace_id: 1, title: "t", lock_version: 0 }]), [{ id: 1, workspaceId: 1, title: "t", lockVersion: 0 }]);
});

test("aggregate() totals the caller's rows", async (t) => {
  const { notes } = await createFixture(t);
  await notes.createMany([{ title: "a" }, { title: "b", status: "done" }, { title: "c", status: "done" }], { context: WORKSPACE_A });
  await notes.createMany([{ title: "other", status: "done" }], { context: WORKSPACE_B });
  const rows = await notes.aggregate({ groupBy: ["status"], measures: { count: { count: "*" } }, sort: ["status"] }, { context: WORKSPACE_A });
  assert.deepEqual(rows, [{ status: "done", count: 2 }, { status: "open", count: 1 }]);
});

test("workspace_or_shared reads a workspace's rows and the shared ones, and writes only its own", async (t) => {
  const { notes, knex } = await createFixture(t, { owns: [noteResource({ ownership: "workspace_or_shared" })] });
  await knex("notes").insert([{ workspace_id: null, title: "shared" }, { workspace_id: 2, title: "theirs" }]);
  await notes.create({ title: "mine" }, { context: WORKSPACE_A });
  const { records } = await notes.query({ page: { size: 10 } }, { context: WORKSPACE_A });
  assert.deepEqual(records.map(({ title }) => title).sort(), ["mine", "shared"]);
  const shared = records.find(({ title }) => title === "shared");
  await assert.rejects(notes.patch(shared.id, { title: "taken" }, { context: WORKSPACE_A }), /only be changed in a system context/u);
  assert.equal((await knex("notes").where({ id: shared.id }).first()).title, "shared");
});

test("row policies read their own tables read-only, and contributions only narrow", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("rooms", (table) => {
    table.increments("id");
    table.string("name");
    table.boolean("archived").defaultTo(false);
  });
  await knex.schema.createTable("room_members", (table) => {
    table.increments("id");
    table.integer("room_id");
    table.integer("user_id");
  });
  await knex.schema.createTable("room_bans", (table) => {
    table.increments("id");
    table.integer("room_id");
  });
  await knex("rooms").insert([
    { name: "general", archived: false },
    { name: "secret", archived: false },
    { name: "old", archived: true },
    { name: "banned", archived: false }
  ]);
  await knex("room_members").insert([{ room_id: 1, user_id: 7 }, { room_id: 3, user_id: 7 }, { room_id: 4, user_id: 7 }]);
  await knex("room_bans").insert([{ room_id: 4 }]);
  const rooms = defineTableResource({
    name: "rooms",
    tableName: "rooms",
    defaultSort: ["id"],
    schema: { id: { type: "id", primary: true }, name: { type: "string" }, archived: { type: "boolean" } }
  });
  const roomMembers = defineTableResource({
    name: "roomMembers",
    tableName: "room_members",
    schema: { id: { type: "id", primary: true }, roomId: { type: "id", storage: { column: "room_id" } }, userId: { type: "id", storage: { column: "user_id" } } }
  });
  const roomBans = defineTableResource({
    name: "roomBans",
    tableName: "room_bans",
    schema: { id: { type: "id", primary: true }, roomId: { type: "id", storage: { column: "room_id" } } }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const owned = await runtime.own("rooms.feature", [
    {
      resource: rooms,
      acceptsContributions: true,
      rowPolicy: ({ query, column, context, ownTable }) => {
        query.whereIn(column("id"), ownTable("roomMembers").select("room_id").where("user_id", context.userId));
        return true;
      }
    },
    roomMembers
  ]);
  const moderation = await runtime.own("moderation.feature", [roomBans]);
  // A contribution that tries to widen with orWhere stays inside its own group.
  moderation.contributeRowPolicy("rooms", ({ query, column, ownTable }) => {
    query.whereNotIn(column("id"), ownTable("roomBans").select("room_id")).orWhere(column("archived"), false);
    return true;
  });
  moderation.contributeRowPolicy("rooms", ({ query, column }) => {
    query.where(column("archived"), false);
    return true;
  });
  assert.throws(() => moderation.contributeRowPolicy("roomMembers", () => true), /does not accept contributions/u);
  await assert.rejects(runtime.own("sneaky.feature", [{
    resource: defineTableResource({ name: "peek", tableName: "peek", schema: { id: { type: "id", primary: true } } }),
    rowPolicy: ({ ownTable }) => Boolean(ownTable("roomMembers"))
  }]).then((peek) => peek.peek.query({ page: { size: 5 } }, {})), /reads only its own feature's tables/u);

  const { records } = await owned.rooms.query({ page: { size: 10 } }, { context: { userId: 7 } });
  assert.deepEqual(records.map(({ name }) => name), ["general", "banned"]);
});

function deadlockVictim() {
  return Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), {
    code: "ER_LOCK_DEADLOCK",
    errno: 1213
  });
}

test("a deadlock victim runs again whole when it owns its transaction, and never inside the caller's", async (t) => {
  let deadlocks = 0;
  let hookRuns = 0;
  const resource = noteResource();
  const { notes, knex } = await createFixture(t, {
    owns: [{
      resource,
      hooks: {
        afterWrite() {
          hookRuns += 1;
          if (deadlocks > 0) {
            deadlocks -= 1;
            throw deadlockVictim();
          }
        }
      }
    }]
  });
  deadlocks = 1;
  await notes.create({ title: "once" }, { context: WORKSPACE_A });
  assert.deepEqual(await knex("notes").pluck("title"), ["once"]);

  deadlocks = 1;
  let attempts = 0;
  await notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    attempts += 1;
    await notes.create({ title: `attempt ${attempts}` }, txOptions);
  });
  assert.equal(attempts, 2);
  assert.deepEqual(await knex("notes").orderBy("id").pluck("title"), ["once", "attempt 2"]);

  deadlocks = 1;
  hookRuns = 0;
  await assert.rejects(
    notes.withTransaction({ context: WORKSPACE_A }, (txOptions) => notes.create({ title: "inner" }, txOptions), { retry: false }),
    (error) => error.code === "ER_LOCK_DEADLOCK"
  );
  assert.equal(hookRuns, 1);
  assert.deepEqual(await knex("notes").orderBy("id").pluck("title"), ["once", "attempt 2"]);
});

test("a write refuses a transaction the runtime did not open, and a missing record fails the transaction it was written in", async (t) => {
  const { notes, knex } = await createFixture(t);
  await knex.transaction(async (trx) => {
    await assert.rejects(
      notes.create({ title: "raw" }, { context: WORKSPACE_A, trx }),
      (error) => error.code === "REST_API_VALIDATION" && error.transactionOutcome === "none"
    );
  });
  assert.deepEqual(await knex("notes"), []);

  // json-rest-api fails a managed transaction once a write in it fails, so inside a transaction a
  // missing record throws its not-found error (null only answers a patch that ran alone).
  await assert.rejects(notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    await notes.create({ title: "kept?" }, txOptions);
    await assert.rejects(notes.patch("999", { title: "missing" }, txOptions), (error) => error.code === "REST_API_RESOURCE" && error.transactionOutcome === "pending");
    return "committed?";
  }), (error) => error.code === "REST_API_RESOURCE" && error.transactionOutcome === "rolledBack");
  assert.deepEqual(await knex("notes"), []);
  assert.equal(await notes.patch("999", { title: "missing" }, { context: WORKSPACE_A }), null);
});

test("a lockVersion patch moves the version on by one, also with no attributes, and rolls back with the caller", async (t) => {
  const { notes, knex } = await createFixture(t);
  const note = await notes.create({ title: "draft" }, { context: WORKSPACE_A });
  assert.equal((await notes.patch(note.id, {}, { context: WORKSPACE_A, lockVersion: 0 })).lockVersion, 1);
  assert.equal((await notes.patch(note.id, {}, { context: WORKSPACE_A })).lockVersion, 1);
  await assert.rejects(notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    assert.equal((await notes.patch(note.id, { title: "renamed" }, { ...txOptions, lockVersion: 1 })).lockVersion, 2);
    throw new Error("Abandon the rename");
  }), /Abandon the rename/u);
  assert.deepEqual(await knex("notes").where({ id: note.id }).first("title", "lock_version"), { title: "draft", lock_version: 1 });
  await assert.rejects(notes.patch(note.id, {}, { context: WORKSPACE_A, lockVersion: -1 }), /must be a non-negative integer/u);
  await assert.rejects(notes.patch(note.id, {}, { context: WORKSPACE_A, lockVersion: "1" }), /must be a non-negative integer/u);
  await assert.rejects(
    notes.patch(note.id, { lockVersion: 9 }, { context: WORKSPACE_A, lockVersion: 1 }),
    /advances lockVersion itself, so the attributes must leave it out/u
  );
});

test("a belongs-to field is written under its relationship, and naming both is refused", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("authors", (table) => {
    table.increments("id");
    table.string("name").notNullable();
  });
  await knex.schema.createTable("books", (table) => {
    table.increments("id");
    table.integer("author_id").nullable();
    table.string("title").notNullable();
  });
  await knex("authors").insert([{ name: "Octavia" }, { name: "Ursula" }]);
  const authors = defineTableResource({ name: "authors", tableName: "authors", schema: { name: { type: "string", required: true } } });
  const books = defineTableResource({
    name: "books",
    tableName: "books",
    schema: {
      authorId: { type: "id", nullable: true, belongsTo: "authors", as: "author", storage: { column: "author_id" } },
      title: { type: "string", required: true }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { books: handle } = await runtime.own("books.feature", [authors, books]);
  const book = await handle.create({ title: "Kindred", authorId: "1" });
  assert.equal(String(book.authorId), "1");
  assert.equal(String((await handle.patch(book.id, { authorId: "2" })).authorId), "2");
  assert.equal((await handle.patch(book.id, { authorId: null })).authorId, null);
  await assert.rejects(handle.create({ title: "Dune", authorId: "1", author: "2" }), /Provide either "authorId" or "author", not both/u);
});
