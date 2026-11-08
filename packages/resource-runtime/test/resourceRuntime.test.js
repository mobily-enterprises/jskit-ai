import assert from "node:assert/strict";
import test from "node:test";
import { RestApiLockOutsideTransactionError, RestApiScopedQueryReadOnlyError } from "json-rest-api";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import {
  DuplicateOwnerError,
  MissingScopeError,
  PageSizeError,
  RowLimitError,
  StaleRecordError,
  SystemContextRequiredError,
  UnpagedQueryError,
  UnsupportedDatabaseError
} from "../src/server/index.js";
import { createActionCatalogue, createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";
import { emptyInputValidator, resolveActorId, resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { requireAuth } from "@jskit-ai/kernel/server/runtime";
import { normalizeOpaqueId } from "@jskit-ai/kernel/shared/support/normalize";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { isLostDuplicateInsertRace } from "@jskit-ai/database-runtime/shared";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { createPackageTestKnex, createTestResourceRuntime } from "../src/test/index.js";

// SQLite in memory, or a PostgreSQL schema of its own on a DB_CLIENT=pg run (see createPackageTestKnex).
const testKnex = (t) => createPackageTestKnex(t, { environment: process.env });

const WORKSPACE_A = Object.freeze({ workspace: { id: "1" } });
const WORKSPACE_B = Object.freeze({ workspace: { id: "2" } });
// json-rest-api's not-found error, classified by its code (404 at the HTTP edge).
const notFound = (error) => error.code === "REST_API_RESOURCE" && error.subtype === "not_found";

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
  const knex = await testKnex(t);
  await knex.schema.createTable("notes", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("title").notNullable();
    table.string("status").notNullable().defaultTo("open");
    table.integer("lock_version").notNullable().defaultTo(0);
  });
  const runtime = await createTestResourceRuntime({ knex, requestRowLimit });
  const resources = await runtime.own("notes.feature", owns);
  const systemContext = runtime.declareSystemScope("notes.feature", "tests")("read every note");
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

test("a system table answers only a system context: a request's, a derived job's or none is refused before any statement", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("leases", (table) => {
    table.increments("id");
    table.string("holder").notNullable();
  });
  const leaseResource = defineTableResource({
    name: "leases",
    tableName: "leases",
    ownership: "system",
    defaultSort: ["id"],
    schema: { id: { type: "id", primary: true }, holder: { type: "string", required: true, search: true } }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { leases } = await runtime.own("leases.feature", [leaseResource]);
  const systemContext = runtime.declareSystemScope("leases.feature", "keep every server's leases")("take a lease");
  const system = { context: systemContext };

  // The owner's background work reads and writes every row, the many-row writes and the locks included.
  const [first] = await leases.createMany([{ holder: "a" }, { holder: "b" }], { ...system, returning: "ids" });
  assert.deepEqual((await leases.queryAll({}, system)).map(({ holder }) => holder), ["a", "b"]);
  assert.equal(await leases.patchWhere({ holder: "b" }, { holder: "c" }, { ...system, returning: "count" }), 1);
  assert.deepEqual(await leases.withTransaction(system, async (txOptions) => (await leases.claim({ filters: { holder: "a" } }, txOptions)).map(({ id }) => id)), [first]);

  const statements = [];
  knex.on("query", ({ sql }) => statements.push(sql));
  const refused = [
    { context: WORKSPACE_A },
    { context: { visibilityContext: { userId: "7" } } },
    { context: systemContext.forWorkspace("1") },
    { context: systemContext.forUser("7", { actorId: "7" }) },
    {}
  ];
  for (const options of refused) {
    const calls = [
      () => leases.create({ holder: "x" }, { ...options, returning: "none" }),
      () => leases.createMany([{ holder: "x" }], options),
      () => leases.query({ page: { size: 5 } }, options),
      () => leases.queryAll({}, options),
      () => leases.get(first, {}, options),
      () => leases.aggregate({ measures: { leases: { count: "*" } } }, options),
      () => leases.patch(first, { holder: "x" }, options),
      () => leases.patchWhere({ holder: "a" }, { holder: "x" }, options),
      () => leases.delete(first, options),
      () => leases.deleteWhere({ holder: "a" }, options),
      () => leases.scopedQuery({}, options),
      () => leases.findOrCreate({ id: "9", holder: "x" }, options)
    ];
    for (const call of calls) {
      await assert.rejects(call, (error) => error instanceof SystemContextRequiredError &&
        error.code === "RESOURCE_SYSTEM_CONTEXT_REQUIRED" && /ownership "system"/u.test(error.message));
    }
  }
  assert.deepEqual(statements, [], "a refused call sends nothing");
  // A lock in the owner's transaction with another context is refused too.
  await leases.withTransaction(system, async (txOptions) => {
    await assert.rejects(leases.lock(first, { ...txOptions, context: WORKSPACE_A }), SystemContextRequiredError);
    await assert.rejects(leases.claim({ filters: { holder: "a" } }, { ...txOptions, context: WORKSPACE_A }), SystemContextRequiredError);
  });
  assert.deepEqual((await knex("leases").orderBy("id")).map(({ holder }) => holder), ["a", "c"]);
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
  // Another workspace's record is missing to this caller: get, patch and delete throw, or answer null with missing: "skip".
  await assert.rejects(notes.get(theirs.id, {}, { context: WORKSPACE_A }), notFound);
  await assert.rejects(notes.patch(theirs.id, { title: "taken" }, { context: WORKSPACE_A }), notFound);
  await assert.rejects(notes.delete(theirs.id, { context: WORKSPACE_A }), notFound);
  assert.equal(await notes.get(theirs.id, {}, { context: WORKSPACE_A, missing: "skip" }), null);
  assert.equal(await notes.patch(theirs.id, { title: "taken" }, { context: WORKSPACE_A, missing: "skip" }), null);
  assert.equal(await notes.patch(theirs.id, { title: "taken" }, { context: WORKSPACE_A, missing: "skip", returning: "id" }), null);
  assert.equal(await notes.delete(theirs.id, { context: WORKSPACE_A, missing: "skip" }), null);
  // Inside a transaction a skipped row fails nothing: the transaction goes on and commits.
  await notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    assert.equal(await notes.patch(theirs.id, { title: "taken" }, { ...txOptions, missing: "skip" }), null);
    assert.equal(await notes.delete(theirs.id, { ...txOptions, missing: "skip" }), null);
    await notes.create({ title: "after the skipped row" }, { ...txOptions, returning: "none" });
  });
  assert.equal((await knex("notes").where({ id: theirs.id }).first()).title, "theirs");
  assert.equal((await knex("notes").where({ title: "after the skipped row" })).length, 1);
  await assert.rejects(notes.get(mine.id, { context: WORKSPACE_A }), /options go third: get\(id, \{\}, options\)/u);
  await assert.rejects(notes.get(mine.id, {}, { context: WORKSPACE_A, missing: "ignore" }), /missing is "throw" \(the default\) or "skip"/u);

  const patched = await notes.patch(mine.id, { title: "mine, edited" }, { context: WORKSPACE_A });
  assert.equal(patched.title, "mine, edited");
  assert.equal(await notes.patch(mine.id, { title: "mine, again" }, { context: WORKSPACE_A, missing: "skip", returning: "id" }), mine.id);
  assert.equal((await notes.patch(mine.id, { status: "done" }, { context: WORKSPACE_A, missing: "skip" })).status, "done");
  assert.equal(await notes.patch(mine.id, { title: "x" }, { context: WORKSPACE_A, missing: "skip", onlyIf: { status: "open" } }), null);
  assert.equal(await notes.delete(mine.id, { context: WORKSPACE_A }), mine.id);
  assert.equal(await notes.get(mine.id, {}, { context: WORKSPACE_A, missing: "skip" }), null);
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

test("query() serves a numbered page in one statement, with no count, and refuses page.number with page.after", async (t) => {
  const { knex, notes } = await createFixture(t);
  await notes.createMany(Array.from({ length: 5 }, (_, index) => ({ title: `n${index}` })), { context: WORKSPACE_A });
  const { result: second, count } = await countQueries(knex, () => notes.query({ page: { size: 2, number: 2 } }, { context: WORKSPACE_A }));
  assert.equal(count, 1);
  assert.deepEqual(second.records.map(({ title }) => title), ["n2", "n3"]);
  assert.deepEqual(second.page, { size: 2, number: 2, hasMore: true, next: 3 });
  const last = await notes.query({ page: { size: 2, number: 3 } }, { context: WORKSPACE_A });
  assert.deepEqual(last.records.map(({ title }) => title), ["n4"]);
  assert.deepEqual(last.page, { size: 2, number: 3, hasMore: false, next: null });
  assert.deepEqual((await notes.query({ page: { size: 2, number: 9 } }, { context: WORKSPACE_A })).records, []);
  await assert.rejects(notes.query({ page: { number: 2 } }, { context: WORKSPACE_A }), UnpagedQueryError);
  await assert.rejects(notes.query({ page: { size: 21, number: 1 } }, { context: WORKSPACE_A }), PageSizeError);
  await assert.rejects(notes.query({ page: { size: 2, number: 0 } }, { context: WORKSPACE_A }), /page.number as a whole number from 1/u);
  const first = await notes.query({ page: { size: 2 } }, { context: WORKSPACE_A });
  await assert.rejects(notes.query({ page: { size: 2, number: 2, after: first.page.next } }, { context: WORKSPACE_A }), /not with page.after/u);
});

test("queryAll() stops at the request row limit, which background work does not have", async (t) => {
  const { notes, runtime } = await createFixture(t, { requestRowLimit: 3 });
  await notes.createMany(Array.from({ length: 5 }, (_, index) => ({ title: `n${index}` })), { context: WORKSPACE_A });
  // A request learns it asked for too much (a 400 with a code and a translatable sentence); the developer reads why.
  await assert.rejects(notes.queryAll({}, { context: WORKSPACE_A }), (error) => error instanceof RowLimitError &&
    error.status === 400 && error.code === "RESOURCE_ROW_LIMIT" && error.messageCode === "resource.rowLimit" &&
    error.messageParams.rowLimit === 3 && /background job/u.test(error.message));
  const system = runtime.declareSystemScope("notes.feature", "tests")("nightly digest");
  assert.equal((await notes.queryAll({}, { context: system })).length, 5);
  assert.equal((await notes.queryAll({}, { context: system.forWorkspace("1") })).length, 5);
  assert.equal((await notes.queryAll({}, { context: system.forWorkspace("2") })).length, 0);
  assert.throws(() => runtime.declareSystemScope("notes.feature", "tests")(" "), /needs the reason/u);
});

test("a system context comes only from a declared system scope, one per feature, and the runtime lists them", async (t) => {
  const { runtime } = await createFixture(t);
  assert.equal(Object.hasOwn(runtime, "createSystemContext"), false);
  const systemContext = runtime.declareSystemScope("digest.feature", "  nightly digests  ");
  assert.equal(systemContext("send the digest").reason, "send the digest");
  assert.equal(typeof runtime.declareSystemScope("digest.feature", "nightly digests"), "function");
  assert.throws(() => runtime.declareSystemScope("digest.feature", "something else"),
    /Feature "digest\.feature" declares one system scope, and it already declared "nightly digests"\./u);
  assert.throws(() => runtime.declareSystemScope("other.feature", " "), /systemScope must say why/u);
  assert.throws(() => systemContext(), /systemContext\(reason\) needs the reason/u);
  assert.deepEqual(runtime.systemScopes(), [
    { featureId: "notes.feature", systemScope: "tests" },
    { featureId: "digest.feature", systemScope: "nightly digests" }
  ]);
});

test("forWorkspaceUser() reaches one user's rows in one workspace, of a workspace_user table and of a user table", async (t) => {
  const knex = await testKnex(t);
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
  const system = runtime.declareSystemScope("drafts.feature", "tests")("deliver one user's event");
  const context = system.forWorkspaceUser("1", "7");

  assert.deepEqual((await resources.drafts.queryAll({}, { context })).map(({ title }) => title), ["mine"]);
  assert.deepEqual((await resources.bookmarks.queryAll({}, { context })).map(({ title }) => title), ["mine"]);
  assert.throws(() => system.forWorkspaceUser("", "7"), /forWorkspaceUser needs the id of the workspace/u);
  assert.throws(() => system.forWorkspaceUser("1", null), /forWorkspaceUser needs the id of the user/u);
});

test("many-row writes run per chunk in the caller's workspace, and answer nothing, ids, records or a count", async (t) => {
  const { notes, knex } = await createFixture(t);
  const ids = await notes.createMany([{ title: "a" }, { title: "b" }, { title: "c" }], { context: WORKSPACE_A, returning: "ids" });
  assert.equal(ids.length, 3);
  const [other] = await notes.createMany([{ title: "other" }], { context: WORKSPACE_B, returning: "records" });
  assert.equal(other.title, "other");

  await notes.patchMany([{ id: ids[0], status: "done" }, { id: ids[1], status: "done" }], { context: WORKSPACE_A });
  await assert.rejects(notes.patchMany([{ id: other.id, status: "done" }], { context: WORKSPACE_A }), /not found|RecordsNotFound/iu);
  await notes.patchMany([{ id: other.id, status: "done" }], { context: WORKSPACE_A, missing: "skip" });
  assert.equal((await knex("notes").where({ id: other.id }).first()).status, "open");

  // `filters: { id }` takes a list of ids, or one, and stays in the caller's rows.
  const changed = await notes.patchWhere({ id: [...ids, other.id] }, { title: "same" }, { context: WORKSPACE_A, returning: "records" });
  assert.deepEqual(changed.map(({ title }) => title), ["same", "same", "same"]);
  assert.equal((await knex("notes").where({ id: other.id }).first()).title, "other");
  await notes.patchWhere({ status: "done" }, { title: "finished" }, { context: WORKSPACE_A });
  assert.deepEqual((await knex("notes").where({ title: "finished" }).pluck("id")).map(String).sort(), [ids[0], ids[1]].map(String).sort());

  await assert.rejects(notes.patchWhere({}, { title: "every" }, { context: WORKSPACE_A }), /pass all: true/u);
  await assert.rejects(notes.deleteWhere({}, { context: WORKSPACE_A }), /pass all: true/u);
  await assert.rejects(notes.patchWhere({ status: "done" }, { title: "every" }, { context: WORKSPACE_A, all: true }), /filters or all: true, not both/u);
  await assert.rejects(notes.deleteWhere({ status: "done" }, { context: WORKSPACE_A, all: true }), /filters or all: true, not both/u);
  // all: true reaches every row the caller owns, and no other workspace's.
  await notes.patchWhere({}, { status: "done" }, { context: WORKSPACE_A, all: true });
  assert.equal((await knex("notes").where({ id: other.id }).first()).status, "open");
  assert.deepEqual(await notes.deleteWhere({ id: ids[2] }, { context: WORKSPACE_A, returning: "ids" }), [String(ids[2])]);
  // A selection write changes the rows its filters select as it runs, so it takes no missing; a count reads nothing back.
  await assert.rejects(notes.patchWhere({ status: "done" }, { title: "x" }, { context: WORKSPACE_A, missing: "skip" }), /takes no missing/u);
  await assert.rejects(notes.deleteWhere({ status: "done" }, { context: WORKSPACE_A, missing: "throw" }), /takes no missing/u);
  assert.equal(await notes.patchWhere({ status: "done" }, { title: "counted" }, { context: WORKSPACE_A, returning: "count" }), 2);
  assert.equal(await notes.patchWhere({ status: "gone" }, { title: "none" }, { context: WORKSPACE_A, returning: "count" }), 0);
  assert.equal(await notes.deleteWhere({ status: "done" }, { context: WORKSPACE_A, returning: "count" }), 2);
  assert.deepEqual(await knex("notes").pluck("title"), ["other"]);
});

test("a table keyed by a uuid or a string takes its ids as text without its own normalizeId", async (t) => {
  const tokens = defineTableResource({
    name: "tokens",
    tableName: "tokens",
    ownership: "public",
    schema: { id: { type: "uuid", primary: true }, label: { type: "string", required: true } }
  });
  const { knex, resources, systemContext } = await createFixture(t, { owns: [noteResource(), tokens] });
  await knex.schema.createTable("tokens", (table) => {
    table.uuid("id").primary();
    table.string("label").notNullable();
  });
  const id = "0b8f2f1e-6a51-4c1e-9d2f-2b1c3e4d5f60";
  const options = { context: systemContext };
  await resources.tokens.create({ id, label: "first" }, options);
  assert.equal((await resources.tokens.get(id, {}, options)).label, "first");
  assert.equal((await resources.tokens.patch(id, { label: "second" }, options)).label, "second");
});

test("a null filter value matches the rows where the field is null", async (t) => {
  const tasks = defineTableResource({
    name: "tasks",
    tableName: "tasks",
    ownership: "public",
    defaultSort: ["id"],
    schema: { id: { type: "id", primary: true }, title: { type: "string", required: true }, archivedAt: { type: "dateTime", nullable: true, search: true, storage: { column: "archived_at" } } }
  });
  const { knex, resources, systemContext } = await createFixture(t, { owns: [noteResource(), tasks] });
  await knex.schema.createTable("tasks", (table) => {
    table.increments("id");
    table.string("title").notNullable();
    table.string("archived_at");
  });
  await knex("tasks").insert([{ title: "open" }, { title: "archived", archived_at: "2026-11-08 01:00:00.000" }]);
  const open = await resources.tasks.queryAll({ filters: { archivedAt: null } }, { context: systemContext });
  assert.deepEqual(open.map(({ title }) => title), ["open"]);
});

test("an upsert on a table with no owners may key on the id alone; an owned table's may not", async (t) => {
  const settings = defineTableResource({
    name: "settings",
    tableName: "settings",
    ownership: "public",
    schema: { id: { type: "string", primary: true }, value: { type: "string", nullable: true }, note: { type: "string", nullable: true } }
  });
  const { knex, resources, notes, systemContext } = await createFixture(t, {
    owns: [noteResource(), settings]
  });
  await knex.schema.createTable("settings", (table) => {
    table.string("id").primary();
    table.string("value");
    table.string("note");
  });
  const system = { context: systemContext };
  await resources.settings.createMany([{ id: "theme", value: "dark", note: "kept" }], system);
  // Merge replaces the fields each row gives and keeps the rest; a new id is created.
  await resources.settings.createMany([{ id: "theme", value: "light" }, { id: "lang", value: "en" }], {
    ...system,
    onConflict: { keys: ["id"], action: "merge" }
  });
  assert.deepEqual(await knex("settings").orderBy("id").select("id", "value", "note"), [
    { id: "lang", value: "en", note: null },
    { id: "theme", value: "light", note: "kept" }
  ]);
  await assert.rejects(
    resources.settings.createMany([{ id: "theme", value: "x" }], { ...system, onConflict: { keys: ["id", "value"], action: "merge" } }),
    /onConflict takes rows without an id/u
  );
  // On a workspace table the conflict keys must hold the owner, so json-rest-api refuses the id alone.
  await assert.rejects(notes.createMany([{ id: 1, title: "a" }], { context: WORKSPACE_A, onConflict: { keys: ["id"], action: "merge" } }));
  assert.equal(Number((await knex("notes").count({ count: "*" }).first()).count), 0);
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

test("an upsert merge with no merge list changes the rows' fields but never their keys, owner or lock version", async (t) => {
  const slots = defineTableResource({
    name: "slots",
    tableName: "slots",
    ownership: "workspace",
    lockVersionField: "lockVersion",
    schema: {
      id: { type: "id", primary: true },
      workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
      day: { type: "string", required: true, search: true },
      status: { type: "string", required: true },
      lockVersion: { type: "integer", defaultTo: 0, storage: { column: "lock_version" } },
      createdAt: { type: "dateTime", storage: { column: "created_at", writeSerializer: "datetime-utc" } },
      updatedAt: { type: "dateTime", storage: { column: "updated_at", writeSerializer: "datetime-utc" } }
    }
  });
  const { knex, resources } = await createFixture(t, { owns: [noteResource(), slots] });
  await knex.schema.createTable("slots", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("day").notNullable();
    table.string("status").notNullable();
    table.integer("lock_version").notNullable().defaultTo(0);
    table.string("created_at").notNullable();
    table.string("updated_at").notNullable();
    table.unique(["workspace_id", "day"]);
  });
  const upsert = { context: WORKSPACE_A, onConflict: { keys: ["workspaceId", "day"], action: "merge" } };
  await resources.slots.createMany([{ day: "mon", status: "pencilled" }], { context: WORKSPACE_A });
  const before = await knex("slots").first("created_at", "lock_version");
  // The rows give their owner and lock version too, as a record read back and sent again does.
  await resources.slots.createMany([
    { workspaceId: 1, day: "mon", status: "booked", lockVersion: 7 },
    { workspaceId: 1, day: "tue", status: "pencilled", lockVersion: 0 }
  ], upsert);
  // The merged row's version moves on by one, as on any write; the row's own 7 is never taken.
  assert.deepEqual(await knex("slots").orderBy("day").select("workspace_id", "day", "status", "lock_version", "created_at"), [
    { workspace_id: 1, day: "mon", status: "booked", lock_version: before.lock_version + 1, created_at: before.created_at },
    { workspace_id: 1, day: "tue", status: "pencilled", lock_version: 0, created_at: (await knex("slots").where({ day: "tue" }).first()).created_at }
  ]);
});

test("lockOrCreate() runs work on the locked record, creating it first when missing, with the work or not at all", async (t) => {
  const counters = defineTableResource({
    name: "counters",
    tableName: "counters",
    ownership: "public",
    schema: { id: { type: "string", primary: true }, value: { type: "integer", required: true } }
  });
  const { knex, resources, systemContext } = await createFixture(t, {
    owns: [noteResource(), { normalizeId: normalizeOpaqueId, resource: counters }]
  });
  await knex.schema.createTable("counters", (table) => {
    table.string("id").primary();
    table.integer("value").notNullable();
  });
  const options = { context: systemContext };
  const bump = (record, txOptions) => resources.counters.patch(record.id, { value: record.value + 1 }, txOptions);
  assert.deepEqual(await resources.counters.lockOrCreate({ id: "visits", value: 0 }, options, bump), { id: "visits", value: 1 });
  assert.deepEqual(await resources.counters.lockOrCreate({ id: "visits", value: 0 }, options, bump), { id: "visits", value: 2 });
  // lockMode picks the record's lock, as lock() takes it; another is refused before any transaction opens.
  assert.deepEqual(await resources.counters.lockOrCreate({ id: "visits", value: 0 }, { ...options, lockMode: "noKeyUpdate" }, bump), { id: "visits", value: 3 });
  assert.deepEqual(await resources.counters.lockOrCreate({ id: "fresh", value: 0 }, { ...options, lockMode: "noKeyUpdate" }, bump), { id: "fresh", value: 1 });
  const statements = [];
  const counted = ({ sql }) => statements.push(sql);
  knex.on("query", counted);
  await assert.rejects(resources.counters.lockOrCreate({ id: "moded", value: 0 }, { ...options, lockMode: "share" }, bump), {
    name: "TypeError",
    message: 'counters.lockOrCreate() lockMode is "update" (the default) or "noKeyUpdate". Received: "share"'
  });
  knex.off("query", counted);
  assert.deepEqual(statements, []);
  // Work that fails leaves no new record behind, and runs once.
  let runs = 0;
  await assert.rejects(resources.counters.lockOrCreate({ id: "failed", value: 0 }, options, () => {
    runs += 1;
    throw new Error("provider refused");
  }), /provider refused/u);
  assert.equal(runs, 1);
  assert.equal(await knex("counters").where({ id: "failed" }).first(), undefined);
  // In the caller's transaction it locks and creates there, and rolls back with it.
  await assert.rejects(resources.counters.withTransaction(options, async (txOptions) => {
    await resources.counters.lockOrCreate({ id: "inner", value: 5 }, txOptions, bump);
    throw new Error("caller failed");
  }), /caller failed/u);
  assert.equal(await knex("counters").where({ id: "inner" }).first(), undefined);
  await assert.rejects(resources.counters.lockOrCreate({ value: 0 }, options, bump), /takes \(row, options, work\)/u);
});

test("a table that stores createdAt and updatedAt has every write stamp them; a request never sets its own", async (t) => {
  const stamped = defineTableResource({
    name: "stamped",
    tableName: "stamped",
    ownership: "public",
    schema: {
      id: { type: "string", primary: true },
      title: { type: "string", required: true },
      createdAt: { type: "dateTime", storage: { column: "created_at", writeSerializer: "datetime-utc" } },
      updatedAt: { type: "dateTime", storage: { column: "updated_at", writeSerializer: "datetime-utc" } }
    }
  });
  const { knex, resources, systemContext } = await createFixture(t, {
    owns: [noteResource(), { normalizeId: normalizeOpaqueId, resource: stamped }]
  });
  await knex.schema.createTable("stamped", (table) => {
    table.string("id").primary();
    table.string("title").notNullable();
    table.string("created_at").notNullable();
    table.string("updated_at").notNullable();
  });
  const options = { context: systemContext };
  const at = (iso) => t.mock.timers.setTime(Date.parse(iso));
  const stamps = async (id) => knex("stamped").where({ id }).first("created_at", "updated_at");
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-08T01:00:00.000Z") });
  await resources.stamped.create({ id: "a", title: "a" }, options);
  await resources.stamped.createMany([{ id: "b", title: "b" }, { id: "c", title: "c" }], options);
  assert.deepEqual(await stamps("b"), { created_at: "2026-11-08 01:00:00.000", updated_at: "2026-11-08 01:00:00.000" });

  at("2026-11-08T02:00:00.000Z");
  await resources.stamped.patch("a", { title: "a2" }, options);
  assert.deepEqual(await stamps("a"), { created_at: "2026-11-08 01:00:00.000", updated_at: "2026-11-08 02:00:00.000" });
  at("2026-11-08T03:00:00.000Z");
  await resources.stamped.patchMany([{ id: "b", title: "b2" }], options);
  await resources.stamped.patchWhere({ id: "c" }, { title: "c2" }, options);
  assert.equal((await stamps("b")).updated_at, "2026-11-08 03:00:00.000");
  assert.equal((await stamps("c")).updated_at, "2026-11-08 03:00:00.000");
  // An upsert merge moves updatedAt on and keeps the stored createdAt; a new row gets both.
  at("2026-11-08T04:00:00.000Z");
  await resources.stamped.createMany([{ id: "a", title: "a3" }, { id: "d", title: "d" }], { ...options, onConflict: { keys: ["id"], action: "merge" } });
  assert.deepEqual(await stamps("a"), { created_at: "2026-11-08 01:00:00.000", updated_at: "2026-11-08 04:00:00.000" });
  assert.deepEqual(await stamps("d"), { created_at: "2026-11-08 04:00:00.000", updated_at: "2026-11-08 04:00:00.000" });
  // A system context's write keeps the timestamps it sets, and a patch that changes nothing stamps nothing.
  await resources.stamped.patch("a", { updatedAt: "2020-01-01T00:00:00.000Z" }, options);
  await resources.stamped.create({ id: "e", title: "e", createdAt: "2020-01-01T00:00:00.000Z" }, options);
  at("2026-11-08T05:00:00.000Z");
  await resources.stamped.patch("a", {}, options);
  assert.equal((await stamps("a")).updated_at, "2020-01-01 00:00:00.000");
  assert.deepEqual(await stamps("e"), { created_at: "2020-01-01 00:00:00.000", updated_at: "2026-11-08 04:00:00.000" });
  // A call without a context is a request's, even on a public table: server code cannot pass a forged body through.
  await resources.stamped.create({ id: "g", title: "g", createdAt: "2020-01-01T00:00:00.000Z" }, {});
  assert.equal((await stamps("g")).created_at, "2026-11-08 05:00:00.000");
  // A request's timestamps are replaced by the handle's: a patch that sends updatedAt gets the server's time and
  // leaves createdAt as stored, a create that sends createdAt gets the server's, and an upsert merge keeps createdAt.
  const request = { context: {} };
  await resources.stamped.patch("a", { title: "a4", createdAt: "2019-01-01T00:00:00.000Z", updatedAt: "2019-01-01T00:00:00.000Z" }, request);
  assert.deepEqual(await stamps("a"), { created_at: "2026-11-08 01:00:00.000", updated_at: "2026-11-08 05:00:00.000" });
  await resources.stamped.create({ id: "f", title: "f", createdAt: "2019-01-01T00:00:00.000Z" }, request);
  assert.deepEqual(await stamps("f"), { created_at: "2026-11-08 05:00:00.000", updated_at: "2026-11-08 05:00:00.000" });
  await resources.stamped.createMany([{ id: "a", title: "a5", createdAt: "2019-01-01T00:00:00.000Z" }], {
    ...request, onConflict: { keys: ["id"], action: "merge", merge: ["title", "createdAt"] }
  });
  assert.equal((await stamps("a")).created_at, "2026-11-08 01:00:00.000");
});

test("the handle stamps a timestamp to its field's temporalPrecision: whole seconds for 0, milliseconds for 3", async (t) => {
  const precise = defineTableResource({
    name: "precise",
    tableName: "precise",
    ownership: "public",
    schema: {
      id: { type: "string", primary: true },
      title: { type: "string", required: true },
      createdAt: { type: "dateTime", temporalPrecision: 3, storage: { column: "created_at", writeSerializer: "datetime-utc" } },
      updatedAt: { type: "dateTime", temporalPrecision: 0, storage: { column: "updated_at", writeSerializer: "datetime-utc" } }
    }
  });
  const { knex, resources } = await createFixture(t, {
    owns: [noteResource(), { normalizeId: normalizeOpaqueId, resource: precise }]
  });
  await knex.schema.createTable("precise", (table) => {
    table.string("id").primary();
    table.string("title").notNullable();
    table.string("created_at").notNullable();
    table.string("updated_at").notNullable();
  });
  const options = { context: {} };
  const stamps = async () => knex("precise").where({ id: "a" }).first("created_at", "updated_at");
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-08T01:00:00.789Z") });
  await resources.precise.create({ id: "a", title: "a" }, options);
  assert.deepEqual(await stamps(), { created_at: "2026-11-08 01:00:00.789", updated_at: "2026-11-08 01:00:00.000" });

  t.mock.timers.setTime(Date.parse("2026-11-08T02:00:00.456Z"));
  await resources.precise.patch("a", { title: "a2" }, options);
  assert.deepEqual(await stamps(), { created_at: "2026-11-08 01:00:00.789", updated_at: "2026-11-08 02:00:00.000" });
});

test("patch() with lockVersion patches the version it read and refuses a stale one; onlyIf patches only matching rows", async (t) => {
  const { notes } = await createFixture(t);
  const note = await notes.create({ title: "draft" }, { context: WORKSPACE_A });
  assert.equal(note.lockVersion, 0);
  const saved = await notes.patch(note.id, { title: "v1" }, { context: WORKSPACE_A, lockVersion: 0 });
  assert.equal(saved.lockVersion, 1);
  await assert.rejects(notes.patch(note.id, { title: "late" }, { context: WORKSPACE_A, lockVersion: 0 }), (error) =>
    error instanceof StaleRecordError && error.status === 409 && error.code === "crud.document.lockVersionConflict");
  assert.equal(await notes.patch(note.id, { title: "x" }, { context: WORKSPACE_A, onlyIf: { status: "done" } }), null);
  assert.equal((await notes.patch(note.id, { status: "done" }, { context: WORKSPACE_A, onlyIf: { status: "open" } })).status, "done");
  await assert.rejects(notes.patch(note.id, { title: "x" }, { context: WORKSPACE_B, lockVersion: 2 }), notFound);
  await assert.rejects(notes.patch(note.id, { title: "x" }, { context: WORKSPACE_B, onlyIf: { status: "done" } }), notFound);
  assert.equal(await notes.patch(note.id, { title: "x" }, { context: WORKSPACE_B, lockVersion: 2, missing: "skip" }), null);
});

test("advancing a lock version with no field changed is an update: it stamps updatedAt, one row or many in one statement", async (t) => {
  const versioned = defineTableResource({
    name: "versioned",
    tableName: "versioned",
    ownership: "public",
    lockVersionField: "lockVersion",
    schema: {
      id: { type: "string", primary: true },
      title: { type: "string", required: true },
      lockVersion: { type: "integer", defaultTo: 0, storage: { column: "lock_version" } },
      updatedAt: { type: "dateTime", storage: { column: "updated_at", writeSerializer: "datetime-utc" } }
    }
  });
  const { knex, resources } = await createFixture(t, {
    owns: [noteResource(), { normalizeId: normalizeOpaqueId, resource: versioned }]
  });
  await knex.schema.createTable("versioned", (table) => {
    table.string("id").primary();
    table.string("title").notNullable();
    table.integer("lock_version").notNullable().defaultTo(0);
    table.string("updated_at").notNullable();
  });
  const options = { context: {} };
  const rows = async () => (await knex("versioned").orderBy("id").select("id", "lock_version", "updated_at"))
    .map(({ id, lock_version: version, updated_at: stamp }) => [id, version, stamp]);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-08T01:00:00.000Z") });
  await resources.versioned.createMany([{ id: "a", title: "a" }, { id: "b", title: "b" }, { id: "c", title: "c" }], options);

  t.mock.timers.setTime(Date.parse("2026-11-08T02:00:00.000Z"));
  await resources.versioned.patch("a", {}, { ...options, lockVersion: 0 });
  const statements = [];
  const count = (query) => statements.push(query.sql);
  knex.on("query", count);
  await resources.versioned.patchMany([{ id: "b" }, { id: "c" }], options);
  knex.off("query", count);
  assert.deepEqual(await rows(), [
    ["a", 1, "2026-11-08 02:00:00.000"],
    ["b", 1, "2026-11-08 02:00:00.000"],
    ["c", 1, "2026-11-08 02:00:00.000"]
  ]);
  assert.equal(statements.filter((sql) => /^update/iu.test(sql)).length, 1, "many rows advance in one UPDATE");
  // A patch that changes nothing, and names no lock version, still writes nothing.
  t.mock.timers.setTime(Date.parse("2026-11-08T03:00:00.000Z"));
  await resources.versioned.patch("a", {}, options);
  assert.deepEqual((await rows())[0], ["a", 1, "2026-11-08 02:00:00.000"]);
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
  assert.equal(Number((await knex("notes").count({ count: "*" }).first()).count), 0);
  await notes.withTransaction({ context: WORKSPACE_A }, (txOptions) => notes.create({ title: "kept" }, txOptions));
  assert.deepEqual(await knex("notes").pluck("title"), ["kept"]);
});

test("withTransaction() rethrows its work's own error, and takes its settings in options", async (t) => {
  const { notes } = await createFixture(t);
  const failure = Object.freeze(new Error("refused by the work"));
  await assert.rejects(
    notes.withTransaction({ context: WORKSPACE_A }, () => {
      throw failure;
    }),
    (error) => error === failure
  );
  await assert.rejects(
    notes.withTransaction({ context: WORKSPACE_A, retry: false }, async (txOptions) => {
      assert.equal(Object.hasOwn(txOptions, "retry"), false);
      await notes.create({ title: "undone" }, txOptions);
      throw failure;
    }),
    (error) => error === failure
  );
  assert.equal((await notes.queryAll({}, { context: WORKSPACE_A })).length, 0);
  // The work's own error says it rolled back, keeping its status and code and its serialized form, so a retry of a
  // lost insert race sees the 409 the work made from the duplicate as one.
  const duplicate = Object.assign(new Error("UNIQUE constraint failed: notes.title"), { code: "SQLITE_CONSTRAINT_UNIQUE" });
  const taken = await notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    await notes.create({ title: "undone" }, txOptions);
    throw new AppError(409, "That title is taken.", { code: "notes.title.taken", cause: duplicate });
  }).catch((error) => error);
  assert.deepEqual([taken.status, taken.code, taken.transactionOutcome], [409, "notes.title.taken", "rolledBack"]);
  assert.equal(Object.keys(taken).includes("transactionOutcome"), false);
  assert.equal(isLostDuplicateInsertRace(taken, { context: WORKSPACE_A }), true);
  assert.equal((await notes.queryAll({}, { context: WORKSPACE_A })).length, 0);
  // A failed write inside the work reports the outcome after the rollback, not the "pending" it saw.
  await assert.rejects(
    notes.withTransaction({ context: WORKSPACE_A }, (txOptions) => notes.patch("999", { title: "missing" }, txOptions)),
    (error) => notFound(error) && error.transactionOutcome === "rolledBack"
  );
  await assert.rejects(notes.withTransaction({ context: WORKSPACE_A }, () => null, { retry: false }), /settings ride in options/u);
  // outermost work owns its transaction, so a call inside one is refused.
  await notes.withTransaction({ context: WORKSPACE_A, outermost: true }, async (txOptions) => {
    await assert.rejects(notes.withTransaction({ ...txOptions, outermost: true }, () => null), /cannot run inside the caller's transaction/u);
    assert.equal(await notes.withTransaction(txOptions, () => "joined"), "joined");
  });
});

test("findOrCreate() answers the record with the id, creating it only when it is missing", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("counters", (table) => {
    table.string("counter_key").primary();
    table.integer("value").notNullable();
  });
  const runtime = await createTestResourceRuntime({ knex });
  // A key the feature computes is an opaque string id.
  const { counters } = await runtime.own("counters.feature", [{ normalizeId: normalizeOpaqueId, resource: defineTableResource({
    name: "counters",
    tableName: "counters",
    ownership: "public",
    idProperty: "counter_key",
    schema: {
      id: { type: "string", primary: true, required: true, storage: { column: "counter_key" } },
      value: { type: "integer", required: true }
    }
  }) }]);
  const options = { context: runtime.declareSystemScope("counters.feature", "tests")("keyed counters") };
  assert.deepEqual(await counters.findOrCreate({ id: "visits", value: 0 }, options), { id: "visits", value: 0 });
  await knex("counters").where({ counter_key: "visits" }).update({ value: 7 });
  assert.deepEqual(await counters.findOrCreate({ id: "visits", value: 0 }, options), { id: "visits", value: 7 });
  assert.deepEqual(await knex("counters").select("counter_key", "value"), [{ counter_key: "visits", value: 7 }]);
});

test("an id filter with an empty list matches no row", async (t) => {
  const { notes } = await createFixture(t);
  await notes.create({ title: "kept" }, { context: WORKSPACE_A });
  assert.deepEqual((await notes.query({ filters: { id: [] }, page: { size: 5 } }, { context: WORKSPACE_A })).records, []);
  assert.deepEqual(await notes.queryAll({ filters: { id: [] } }, { context: WORKSPACE_A }), []);
});

test("findOrCreate() of an id another workspace's row holds answers a missing record, never null or that row", async (t) => {
  const { notes } = await createFixture(t);
  const created = await notes.create({ title: "theirs" }, { context: WORKSPACE_B });
  const missing = await notes.get(987654, {}, { context: WORKSPACE_A }).then(() => null, (error) => error);
  const taken = await notes.findOrCreate({ id: created.id, title: "mine" }, { context: WORKSPACE_A }).then(() => null, (error) => error);
  assert.equal(taken?.code, missing?.code);
  assert.equal(taken?.subtype, missing?.subtype);
  assert.doesNotMatch(String(taken?.message), /theirs/u);
  assert.equal((await notes.get(created.id, {}, { context: WORKSPACE_B })).title, "theirs");
});

test("a handle offers one way to each write: no patchWhereIds, deleteMany, toRecords or inTransaction", async (t) => {
  const { notes } = await createFixture(t);
  for (const method of ["patchWhereIds", "deleteMany", "toRecords", "inTransaction"]) {
    assert.equal(notes[method], undefined, method);
  }
});

test("locks need a transaction and take only the caller's rows", async (t) => {
  const { notes } = await createFixture(t);
  const [a, b] = await notes.createMany([{ title: "a" }, { title: "b", status: "queued" }], { context: WORKSPACE_A, returning: "records" });
  const [other] = await notes.createMany([{ title: "other", status: "queued" }], { context: WORKSPACE_B, returning: "records" });
  await assert.rejects(notes.lock(a.id, { context: WORKSPACE_A }), RestApiLockOutsideTransactionError);
  await notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    assert.equal((await notes.lock(a.id, txOptions)).title, "a");
    assert.equal(await notes.lock(other.id, { ...txOptions, missing: "skip" }), null);
    assert.deepEqual((await notes.lockMany([a.id, other.id], { ...txOptions, missing: "skip" })).map(({ title }) => title), ["a"]);
    assert.deepEqual((await notes.lockWhere({ status: "queued" }, txOptions)).map(({ title }) => title), ["b"]);
    assert.deepEqual((await notes.claim({ filters: { status: "queued" }, take: 5 }, txOptions)).map(({ id }) => String(id)), [String(b.id)]);
    await assert.rejects(notes.claim({ status: "queued" }, { limit: 5 }, txOptions), /takes \(\{ filters, sort, take \}, options\)/u);
  });
  await assert.rejects(notes.withTransaction({ context: WORKSPACE_A }, (txOptions) => notes.lock(other.id, txOptions)), notFound);
});

test("every lock and patchWhere take lockMode \"update\" or \"noKeyUpdate\" and reach the same rows; another is refused before any statement", async (t) => {
  const { knex, notes } = await createFixture(t);
  const [a] = await notes.createMany([{ title: "a", status: "queued" }], { context: WORKSPACE_A, returning: "ids" });
  const statements = [];
  const counted = ({ sql }) => statements.push(sql);
  await notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    for (const lockMode of ["update", "noKeyUpdate"]) {
      const options = { ...txOptions, lockMode };
      assert.equal((await notes.lock(a, options)).title, "a", lockMode);
      assert.deepEqual((await notes.lockMany([a], options)).map(({ title }) => title), ["a"], lockMode);
      assert.deepEqual((await notes.lockWhere({ status: "queued" }, options)).map(({ title }) => title), ["a"], lockMode);
      assert.deepEqual((await notes.claim({ filters: { status: "queued" } }, options)).map(({ title }) => title), ["a"], lockMode);
      assert.equal(await notes.patchWhere({ status: "queued" }, { title: "a" }, { ...options, returning: "count" }), 1, lockMode);
    }
    knex.on("query", counted);
    const options = { ...txOptions, lockMode: "share" };
    const refused = (method) => ({ name: "TypeError", message: `notes.${method}() lockMode is "update" (the default) or "noKeyUpdate". Received: "share"` });
    await assert.rejects(notes.lock(a, options), refused("lock"));
    await assert.rejects(notes.lockMany([a], options), refused("lockMany"));
    await assert.rejects(notes.lockWhere({ status: "queued" }, options), refused("lockWhere"));
    await assert.rejects(notes.claim({ filters: { status: "queued" } }, options), refused("claim"));
    await assert.rejects(notes.patchWhere({ status: "queued" }, { title: "b" }, options), refused("patchWhere"));
    knex.off("query", counted);
    // Nothing reached the database, so the transaction goes on (on PostgreSQL a failed statement would end it).
    assert.equal((await notes.lock(a, txOptions)).title, "a");
  });
  assert.deepEqual(statements, []);
});

test("changeHorizon() answers PostgreSQL's snapshot horizon as decimal text; elsewhere it throws before any statement", async (t) => {
  const { knex, notes } = await createFixture(t);
  await assert.rejects(notes.changeHorizon({}), MissingScopeError);
  if (knex.client.config.client === "pg") {
    assert.match(await notes.changeHorizon({ context: WORKSPACE_A }), /^\d{1,20}$/u);
    return;
  }
  const statements = [];
  const counted = ({ sql }) => statements.push(sql);
  knex.on("query", counted);
  await assert.rejects(notes.changeHorizon({ context: WORKSPACE_A }), (error) => error instanceof UnsupportedDatabaseError &&
    error.code === "RESOURCE_DATABASE_UNSUPPORTED" &&
    error.message === "notes.changeHorizon() reads PostgreSQL's snapshot horizon (pg_snapshot_xmin), which MySQL, MariaDB and SQLite do not have.");
  knex.off("query", counted);
  assert.deepEqual(statements, []);
});

test("an xid8 field, PostgreSQL's transaction id, is refused where the table is on another database", async (t) => {
  const knex = await testKnex(t);
  if (knex.client.config.client === "pg") {
    t.skip("PostgreSQL has xid8: changes.postgres.test.js reads it");
    return;
  }
  const stamped = defineTableResource({
    name: "stamped",
    tableName: "stamped",
    ownership: "public",
    schema: { id: { type: "id", primary: true }, changed: { type: "xid8", nullable: true } }
  });
  const runtime = await createTestResourceRuntime({ knex });
  await assert.rejects(runtime.own("stamped.feature", [stamped]), /Field 'changed' in resource 'stamped' has type 'xid8', PostgreSQL's transaction id, which only Knex storage on PostgreSQL has/u);
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
});

test("raw() is a value only: it is no promise, running it any other way throws, and nothing runs", async (t) => {
  const { notes, knex } = await createFixture(t);
  await notes.create({ title: "keep" }, { context: WORKSPACE_A });
  await notes.create({ title: "theirs" }, { context: WORKSPACE_B });
  const statement = notes.raw("DELETE FROM notes");
  // Its then is undefined, so awaiting it answers the value itself, unrun, and nothing mistakes it for a promise.
  assert.equal(statement.then, undefined);
  assert.equal(await statement, statement);
  for (const method of ["catch", "finally", "asCallback", "stream", "pipe"]) {
    assert.throws(() => statement[method](() => {}), /notes\.raw\(\) is a value inside a scoped query or a write; it never runs as a statement of its own/u, method);
  }
  assert.equal((await knex("notes")).length, 2);

  const { query } = await notes.scopedQuery({}, { context: WORKSPACE_A });
  const rows = await query.select({ shout: notes.raw("UPPER(??)", [notes.column("title")]) });
  assert.deepEqual(rows.map(({ shout }) => shout), ["KEEP"]);
  await notes.patchWhere({ title: "keep" }, { status: notes.raw("?", ["done"]) }, { context: WORKSPACE_A });
  assert.deepEqual((await knex("notes").orderBy("id")).map(({ status }) => status), ["done", "open"]);
});

test("an undefined filter value is refused by every filtered call, so it never widens to every row", async (t) => {
  const { notes, knex } = await createFixture(t);
  await notes.createMany([{ title: "a", status: "paused" }, { title: "b", status: "paused" }], { context: WORKSPACE_A });
  const context = WORKSPACE_A;
  const refused = /filters\.status is undefined: pass its value, or leave the filter out/u;
  await assert.rejects(notes.query({ filters: { status: undefined }, page: { size: 5 } }, { context }), refused);
  await assert.rejects(notes.queryAll({ filters: { status: undefined } }, { context }), refused);
  await assert.rejects(notes.aggregate({ measures: { total: { count: "id" } }, filters: { status: undefined } }, { context }), refused);
  await assert.rejects(notes.scopedQuery({ filters: { status: undefined } }, { context }), refused);
  await assert.rejects(notes.patchWhere({ status: undefined }, { title: "every" }, { context }), refused);
  await assert.rejects(notes.patchWhere({ title: "a", status: undefined }, { title: "every" }, { context }), refused);
  await assert.rejects(notes.deleteWhere({ status: undefined }, { context }), refused);
  await notes.withTransaction({ context }, async (txOptions) => {
    await assert.rejects(notes.lockWhere({ status: undefined }, txOptions), refused);
    await assert.rejects(notes.claim({ filters: { status: undefined }, take: 5 }, txOptions), refused);
  });
  assert.deepEqual((await knex("notes").orderBy("id")).map(({ title, status }) => `${title}:${status}`), ["a:paused", "b:paused"]);
});

test("aggregate() totals the caller's rows", async (t) => {
  const { notes } = await createFixture(t);
  await notes.createMany([{ title: "a" }, { title: "b", status: "done" }, { title: "c", status: "done" }], { context: WORKSPACE_A });
  await notes.createMany([{ title: "other", status: "done" }], { context: WORKSPACE_B });
  const rows = await notes.aggregate({ groupBy: ["status"], measures: { count: { count: "*" } }, sort: ["status"] }, { context: WORKSPACE_A });
  assert.deepEqual(rows, [{ status: "done", count: 2 }, { status: "open", count: 1 }]);
});

test("aggregate() counts a table's ids, distinct or not, as its rows, on a schema that declares no id field", async (t) => {
  const { visits, options } = await createVisitFixture(t);
  const [totals] = await visits.aggregate({
    measures: { visits: { count: "id" }, distinct: { countDistinct: "id" }, seen: { count: "id", where: { stage: "seen" } } }
  }, options);
  assert.deepEqual(totals, { visits: 2, distinct: 2, seen: 0 });
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

test("a context naming no owner the table needs is refused, never read as the rows with no owner", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("notes", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("title").notNullable();
  });
  await knex.schema.createTable("bookmarks", (table) => {
    table.increments("id");
    table.integer("user_id").nullable();
    table.string("title").notNullable();
  });
  await knex("notes").insert([{ workspace_id: null, title: "orphan" }, { workspace_id: 1, title: "mine" }]);
  await knex("bookmarks").insert([{ user_id: null, title: "orphan" }, { user_id: 7, title: "mine" }]);
  const workspaceField = { type: "id", nullable: true, search: true, storage: { column: "workspace_id" } };
  const userField = { type: "id", nullable: true, search: true, storage: { column: "user_id" } };
  const runtime = await createTestResourceRuntime({ knex });
  const { notes, bookmarks } = await runtime.own("notes.feature", [
    defineTableResource({ name: "notes", tableName: "notes", ownership: "workspace", schema: { workspaceId: workspaceField, title: { type: "string", required: true } } }),
    defineTableResource({ name: "bookmarks", tableName: "bookmarks", ownership: "user", schema: { userId: userField, title: { type: "string", required: true } } })
  ]);
  const system = runtime.declareSystemScope("notes.feature", "tests")("check scopes");
  const userRoute = { visibilityContext: { visibility: "user", scopeOwnerId: "7", userId: "7" } };
  const page = { page: { size: 10 } };

  for (const [handle, context, owner] of [
    [notes, {}, "workspace"],
    [notes, userRoute, "workspace"],
    [notes, system.forUser("7"), "workspace"],
    [bookmarks, {}, "user"],
    [bookmarks, system.forWorkspace("1"), "user"]
  ]) {
    const refused = new RegExp(`rows each belong to a ${owner}, and this context names no ${owner}`, "u");
    await assert.rejects(handle.query(page, { context }), refused);
    await assert.rejects(handle.queryAll({}, { context }), refused);
    await assert.rejects(handle.create({ title: "x" }, { context }), refused);
    await assert.rejects(handle.patchWhere({ title: "orphan" }, { title: "taken" }, { context }), refused);
  }
  assert.equal((await knex("notes").where({ title: "x" })).length, 0);
  assert.deepEqual((await notes.queryAll({}, { context: WORKSPACE_A })).map(({ title }) => title), ["mine"]);
  assert.deepEqual((await bookmarks.queryAll({}, { context: userRoute })).map(({ title }) => title), ["mine"]);
  assert.equal((await notes.queryAll({}, { context: system })).length, 2);
});

test("workspace_or_shared without a workspace reads only the shared rows and writes none", async (t) => {
  const { notes, knex } = await createFixture(t, { owns: [noteResource({ ownership: "workspace_or_shared" })] });
  await knex("notes").insert([{ workspace_id: null, title: "shared" }, { workspace_id: 2, title: "theirs" }]);
  const { records } = await notes.query({ page: { size: 10 } }, { context: {} });
  assert.deepEqual(records.map(({ title }) => title), ["shared"]);
  await assert.rejects(notes.create({ title: "stray" }, { context: {} }));
  assert.equal((await knex("notes").where({ title: "stray" })).length, 0);
});

test("a shared row is written in the owner's system context, naming its empty owner, also inside a request's transaction", async (t) => {
  const { notes, knex, systemContext } = await createFixture(t, { owns: [noteResource({ ownership: "workspace_or_shared" })] });
  const forbidden = (error) => error.code === "REST_API_RESOURCE" && error.subtype === "forbidden";
  // A job derived for a user is no system context: with no workspace to stamp, it may not create a shared row.
  await assert.rejects(notes.create({ title: "stray" }, { context: systemContext.forUser("7") }), forbidden);
  await assert.rejects(notes.create({ title: "stray", workspaceId: null }, { context: systemContext.forUser("7") }), forbidden);
  // A workspace request stamps its own workspace and refuses another owner, the empty one included.
  await assert.rejects(notes.create({ title: "stray", workspaceId: null }, { context: WORKSPACE_A }));
  assert.equal((await knex("notes").where({ title: "stray" })).length, 0);
  // The system context names the owner: an empty one is the shared row, and leaving it out is refused.
  await assert.rejects(notes.create({ title: "stray" }, { context: systemContext }), /needs explicit ownership values/u);

  const shared = await notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    await notes.create({ title: "mine" }, { ...txOptions, returning: "none" });
    return notes.create({ title: "house rules", workspaceId: null }, { ...txOptions, context: systemContext });
  });
  assert.equal((await knex("notes").where({ id: shared.id }).first()).workspace_id, null);
  for (const [context, titles] of [[WORKSPACE_A, ["house rules", "mine"]], [WORKSPACE_B, ["house rules"]]]) {
    assert.deepEqual((await notes.queryAll({}, { context })).map(({ title }) => title).sort(), titles);
  }
  // A request or a job may not change or delete it, and its many-row writes leave shared rows out.
  await assert.rejects(notes.patch(shared.id, { title: "taken" }, { context: WORKSPACE_A }), /only be changed in a system context/u);
  await assert.rejects(notes.delete(shared.id, { context: systemContext.forWorkspace("1") }), /only be changed in a system context/u);
  assert.deepEqual(await notes.patchWhere({ id: [shared.id] }, { title: "taken" }, { context: WORKSPACE_A, returning: "ids" }), []);

  // The owner changes it in its system context once the request has read it in its own (it reaches the row), with
  // the empty owner among the filters: a compare-and-set that never reaches a workspace's row, whatever id it names.
  const { id: mine } = await notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    const reached = await notes.get(shared.id, {}, txOptions);
    const changed = await notes.patchWhere({ id: [reached.id], workspaceId: null }, { title: "house rules, revised" }, {
      ...txOptions, context: systemContext, returning: "ids"
    });
    assert.deepEqual(changed.map(String), [String(shared.id)]);
    return (await notes.queryAll({ filters: { title: "mine" } }, txOptions))[0];
  });
  assert.deepEqual(await notes.patchWhere({ id: [mine], workspaceId: null }, { title: "taken" }, { context: systemContext, returning: "ids" }), []);
  assert.equal((await knex("notes").where({ id: mine }).first()).title, "mine");
  assert.deepEqual((await notes.deleteWhere({ id: [shared.id], workspaceId: null }, { context: systemContext, returning: "ids" })).map(String), [String(shared.id)]);
  assert.equal(await knex("notes").where({ id: shared.id }).first(), undefined);
});

test("row policies read their own tables read-only, and contributions only narrow", async (t) => {
  const knex = await testKnex(t);
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
    ownership: "public",
    defaultSort: ["id"],
    schema: { id: { type: "id", primary: true }, name: { type: "string" }, archived: { type: "boolean" } }
  });
  const roomMembers = defineTableResource({
    name: "roomMembers",
    tableName: "room_members",
    ownership: "public",
    schema: { id: { type: "id", primary: true }, roomId: { type: "id", storage: { column: "room_id" } }, userId: { type: "id", storage: { column: "user_id" } } }
  });
  const roomBans = defineTableResource({
    name: "roomBans",
    tableName: "room_bans",
    ownership: "public",
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
    resource: defineTableResource({ name: "peek", tableName: "peek", ownership: "public", schema: { id: { type: "id", primary: true } } }),
    rowPolicy: ({ ownTable }) => Boolean(ownTable("roomMembers"))
  }]).then((peek) => peek.peek.query({ page: { size: 5 } }, {})), /reads only its own feature's tables/u);

  const { records } = await owned.rooms.query({ page: { size: 10 } }, { context: { userId: 7 } });
  assert.deepEqual(records.map(({ name }) => name), ["general", "banned"]);
});

test("a row policy is told who the call runs for: a system context, a job it derived, a signed-in user or no one", async (t) => {
  const seen = [];
  const { notes, runtime } = await createFixture(t, {
    owns: [{
      resource: noteResource(),
      rowPolicy: ({ query, column, caller, ...rest }) => {
        seen.push(caller);
        // caller is the one way to tell who the call runs for: json-rest-api's own system flag is not handed on.
        assert.equal(Object.hasOwn(rest, "system"), false);
        // A job reads its workspace's notes; a request reads only the notes its user may see, and no one reads none.
        if (caller.kind === "anonymous") return false;
        if (caller.kind === "user") query.where(column("title"), "shared");
        return true;
      }
    }]
  });
  const systemContext = runtime.declareSystemScope("digest.feature", "nightly digests")("send the digest");
  await notes.createMany([{ title: "shared" }, { title: "private" }], { context: WORKSPACE_A });
  const titles = async (context) => (await notes.queryAll({}, { context })).map(({ title }) => title).sort();
  seen.length = 0;
  assert.deepEqual(await titles(systemContext), ["private", "shared"]);
  assert.deepEqual(await titles(systemContext.forWorkspace("1")), ["private", "shared"]);
  assert.deepEqual(await titles({ ...WORKSPACE_A, actor: { id: "7" } }), ["shared"]);
  assert.deepEqual(await titles(WORKSPACE_A), []);
  assert.deepEqual(seen, [
    { kind: "system", reason: "digest.feature: send the digest" },
    { kind: "job", reason: "digest.feature: send the digest" },
    { kind: "user", userId: "7" },
    { kind: "anonymous" }
  ]);

  // A job done for one person carries who it is for, for audit fields and the policy's caller.actorId. It reaches the
  // workspace's rows as before, not that person's.
  const forAda = systemContext.forWorkspace("1", { actorId: 9 });
  assert.equal(resolveAuditActorId(forAda), "9");
  assert.equal(resolveAuditActorId(systemContext.forWorkspace("1")), null);
  seen.length = 0;
  assert.deepEqual(await titles(forAda), ["private", "shared"]);
  assert.deepEqual(await titles(systemContext.forWorkspaceUser("1", "4", { actorId: "9" })), ["private", "shared"]);
  assert.deepEqual(seen, [
    { kind: "job", reason: "digest.feature: send the digest", actorId: "9" },
    { kind: "job", reason: "digest.feature: send the digest", actorId: "9" }
  ]);
  assert.throws(() => systemContext.forUser("4", { actor: "9" }), /forUser takes \{ actorId \} as its last argument/u);
  assert.throws(() => systemContext.forWorkspace("1", { actorId: " " }), /forWorkspace needs the id of the user it acts for/u);
});

test("a job's actorId never moves its scope; a row policy that keys on the person holds a job done for them to their rows", async (t) => {
  const drafts = defineTableResource({
    name: "drafts",
    tableName: "drafts",
    ownership: "workspace",
    defaultSort: ["id"],
    schema: {
      workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
      authorId: { type: "id", search: true, storage: { column: "author_id" } },
      title: { type: "string", required: true }
    }
  });
  const knex = await testKnex(t);
  await knex.schema.createTable("drafts", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.integer("author_id");
    table.string("title");
  });
  await knex("drafts").insert([
    { workspace_id: 1, author_id: 9, title: "first author's" },
    { workspace_id: 1, author_id: 8, title: "second author's" },
    { workspace_id: 2, author_id: 9, title: "first author's elsewhere" }
  ]);
  const runtime = await createTestResourceRuntime({ knex });
  const handles = await runtime.own("drafts.feature", [{
    resource: drafts,
    // A person sees their own drafts, whether they ask or a job asks for them; a job for no one sees its whole scope.
    rowPolicy: ({ query, caller, column, value }) => {
      if (caller.kind === "anonymous") return false;
      const personId = caller.kind === "user" ? caller.userId : caller.actorId;
      if (personId) query.where(column("authorId"), value("authorId", personId));
      return true;
    }
  }]);
  const jobs = runtime.declareSystemScope("drafts.feature", "publish drafts people scheduled")("publish a scheduled draft");
  const titles = async (context) => (await handles.drafts.queryAll({}, { context })).map(({ title }) => title);

  assert.deepEqual(await titles(jobs.forWorkspace("1")), ["first author's", "second author's"]);
  assert.deepEqual(await titles(jobs.forWorkspace("1", { actorId: "9" })), ["first author's"]);
  assert.deepEqual(await titles({ ...WORKSPACE_A, actor: { id: "9" } }), ["first author's"]);
  // The person's rows in another workspace stay out: the scope comes from the workspace the job was derived for.
  assert.deepEqual(await titles(jobs.forWorkspace("2", { actorId: "8" })), []);
  // The policy holds the job's writes too: another person's draft is missing to it.
  await assert.rejects(handles.drafts.patch("2", { title: "taken" }, { context: jobs.forWorkspace("1", { actorId: "9" }) }), notFound);
  assert.equal((await knex("drafts").where({ id: 2 }).first()).title, "second author's");
});

test("an event a job publishes carries the scope of the workspace or user it works on, as a request there would", async (t) => {
  const knex = await testKnex(t);
  const runtime = await createTestResourceRuntime({ knex });
  const system = runtime.declareSystemScope("journal.feature", "announce the entries people asked for")("announce an entry");
  const published = [];
  const actions = createActionCatalogue({ events: { publish: async (event) => published.push(event) } });
  actions.register({
    contributorId: "journal",
    domain: "journal",
    actions: [{
      id: "journal.announce",
      kind: "command",
      channels: ["automation"],
      surfaces: ["app"],
      permission: { require: "none" },
      input: emptyInputValidator,
      execute: () => ({ id: "4" }),
      events: [createEntityChangedActionEvent({ source: "journal", entity: "entry", operation: "created", entityId: ({ result }) => result.id })]
    }]
  });
  for (const context of [system.forWorkspace("1"), system.forUser("9"), system.forWorkspaceUser("1", "9"), system.forWorkspace("1", { actorId: "9" })]) {
    await actions.execute({ actionId: "journal.announce", input: {}, context: { ...context, channel: "automation", surface: "app" } });
  }
  assert.deepEqual(published.map(({ scope }) => scope), [
    { kind: "workspace", id: "1" },
    { kind: "user", id: "9" },
    { kind: "workspace_user", id: "1", scopeId: "1", userId: "9" },
    // The person the work acts for is no scope: the event is the workspace's.
    { kind: "workspace", id: "1" }
  ]);
});

test("an action a system context or a job runs reads as that system context or job, and is still signed in as no one", async (t) => {
  const seen = [];
  const { notes, runtime } = await createFixture(t, {
    owns: [{
      resource: noteResource(),
      rowPolicy: ({ caller }) => {
        seen.push(caller);
        return caller.kind !== "anonymous";
      }
    }]
  });
  const systemContext = runtime.declareSystemScope("digest.feature", "nightly digests")("send the digest");
  await notes.createMany([{ title: "a" }, { title: "b" }], { context: WORKSPACE_A });
  seen.length = 0;
  const actions = createActionCatalogue();
  const action = (id, require, execute) => ({
    id,
    kind: "command",
    channels: ["automation"],
    surfaces: ["app"],
    permission: { require },
    input: emptyInputValidator,
    execute
  });
  actions.register({
    contributorId: "digest",
    domain: "digest",
    actions: [
      action("digest.count", "none", async (input, context) => ({
        count: (await notes.queryAll({}, { context })).length,
        actorId: resolveActorId(context)
      })),
      action("digest.send", "authenticated", () => ({ sent: true }))
    ]
  });
  const run = (actionId, context) => actions.execute({ actionId, input: {}, context: { ...context, channel: "automation", surface: "app" } });

  assert.deepEqual(await run("digest.count", systemContext), { count: 2, actorId: null });
  assert.deepEqual(await run("digest.count", systemContext.forWorkspace("1")), { count: 2, actorId: null });
  assert.deepEqual(await run("digest.count", systemContext.forWorkspace("2", { actorId: "9" })), { count: 0, actorId: null });
  assert.deepEqual(seen, [
    { kind: "system", reason: "digest.feature: send the digest" },
    { kind: "job", reason: "digest.feature: send the digest" },
    { kind: "job", reason: "digest.feature: send the digest", actorId: "9" }
  ]);
  // A request context with no one signed in is still anonymous, and the policy refuses it.
  assert.deepEqual(await run("digest.count", WORKSPACE_A), { count: 0, actorId: null });
  assert.deepEqual(seen.at(-1), { kind: "anonymous" });
  // The person a job acts for is no one signed in: an authenticated action refuses every one of them.
  for (const context of [systemContext, systemContext.forWorkspace("1"), systemContext.forWorkspace("1", { actorId: "9" })]) {
    await assert.rejects(run("digest.send", context), (error) => error?.statusCode === 401 && error?.code === "ACTION_AUTHENTICATION_REQUIRED");
  }
});

test("a report joins another owner's joinSource() as a subquery: one statement, each owner's scope and row policy kept", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("tasks", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.integer("project_id");
  });
  await knex.schema.createTable("invoices", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.integer("project_id");
    table.integer("amount");
    table.string("status");
  });
  await knex("tasks").insert([
    { workspace_id: 1, project_id: 1 }, { workspace_id: 1, project_id: 1 }, { workspace_id: 1, project_id: 2 }, { workspace_id: 2, project_id: 1 }
  ]);
  await knex("invoices").insert([
    { workspace_id: 1, project_id: 1, amount: 100, status: "sent" },
    { workspace_id: 1, project_id: 1, amount: 50, status: "void" },
    { workspace_id: 1, project_id: 2, amount: 30, status: "sent" },
    { workspace_id: 2, project_id: 1, amount: 999, status: "sent" }
  ]);
  const owned = (name, fields) => defineTableResource({
    name,
    tableName: name,
    ownership: "workspace",
    schema: {
      id: { type: "id", primary: true },
      workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
      projectId: { type: "integer", storage: { column: "project_id" } },
      ...fields
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { tasks } = await runtime.own("tasks.feature", [owned("tasks", {})]);
  const { invoices } = await runtime.own("billing.feature", [{
    resource: owned("invoices", { amount: { type: "integer" }, status: { type: "string" } }),
    // Billing never shows a void invoice.
    rowPolicy: ({ query, column }) => {
      query.whereNot(column("status"), "void");
      return true;
    }
  }]);
  // Knex: report - open tasks and billed totals per project, joined on billing's scoped invoices
  async function projectSummary(options) {
    const source = await invoices.joinSource({ alias: "i" }, options);
    const billed = source.query
      .select({ projectId: source.column("projectId") })
      .sum({ billed: source.column("amount") })
      .groupBy(source.column("projectId"))
      .as("b");
    const { query } = await tasks.scopedQuery({ alias: "t" }, options);
    const projectId = tasks.column("projectId", "t");
    const rows = await query
      .leftJoin(billed, "b.projectId", projectId)
      .select({ projectId })
      .count({ open: tasks.column("id", "t") })
      .max({ billed: "b.billed" })
      .groupBy(projectId)
      .orderBy(projectId);
    return rows.map((row) => ({ projectId: Number(row.projectId), open: Number(row.open), billed: Number(row.billed ?? 0) }));
  }

  const { result, count } = await countQueries(knex, () => projectSummary({ context: WORKSPACE_A }));
  assert.deepEqual(result, [{ projectId: 1, open: 2, billed: 100 }, { projectId: 2, open: 1, billed: 30 }]);
  assert.equal(count, 1);
  assert.deepEqual(await projectSummary({ context: WORKSPACE_B }), [{ projectId: 1, open: 1, billed: 999 }]);
});

test("a job done for one person records that person in audit fields and is never signed in as them", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("entries", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.string("body").notNullable();
    table.string("created_by");
  });
  const entryResource = defineTableResource({
    name: "entries",
    tableName: "entries",
    ownership: "workspace",
    schema: {
      workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
      body: { type: "string", required: true },
      createdBy: { type: "string", nullable: true, storage: { column: "created_by" } }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { entries } = await runtime.own("journal.feature", [entryResource]);
  const systemContext = runtime.declareSystemScope("journal.feature", "write the entries people asked for");
  const forAda = systemContext("write the entry a person asked for").forWorkspace("1", { actorId: "9" });
  const written = [];
  const actions = createActionCatalogue();
  actions.register({
    contributorId: "journal",
    domain: "journal",
    actions: [{
      id: "journal.write",
      kind: "command",
      channels: ["automation"],
      surfaces: ["app"],
      permission: { require: "authenticated" },
      input: emptyInputValidator,
      execute: (input, context) => written.push(context)
    }]
  });

  // An authenticated action and a service's requireAuth see no one signed in.
  await assert.rejects(
    actions.execute({ actionId: "journal.write", input: {}, context: { ...forAda, channel: "automation", surface: "app" } }),
    (error) => error?.statusCode === 401 && error?.code === "ACTION_AUTHENTICATION_REQUIRED"
  );
  assert.deepEqual(written, []);
  assert.throws(() => requireAuth({ context: forAda }, { require: "authenticated" }), (error) => error?.statusCode === 401);
  assert.equal(resolveActorId(forAda), null);
  // Its audit field still records whom the entry was written for.
  await entries.create({ body: "Asked for", createdBy: resolveAuditActorId(forAda) }, { context: forAda, returning: "none" });
  assert.deepEqual(await knex("entries").first("workspace_id", "body", "created_by"), { workspace_id: 1, body: "Asked for", created_by: "9" });
});

test("a context that names no owner a linked table needs is refused there too, never shown the rows whose owner is NULL", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("profiles", (table) => {
    table.increments("id");
    table.integer("user_id");
    table.string("secret");
  });
  await knex.schema.createTable("cards", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.string("title");
    table.integer("profile_id");
  });
  await knex.schema.createTable("tips", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.string("text");
  });
  // Profile 1 has no owner; profile 2 is user 5's.
  await knex("profiles").insert([{ user_id: null, secret: "orphan" }, { user_id: 5, secret: "fives" }]);
  await knex("cards").insert([{ workspace_id: 1, title: "a", profile_id: 1 }, { workspace_id: 1, title: "b", profile_id: 2 }]);
  await knex("tips").insert([{ workspace_id: null, text: "shared" }, { workspace_id: 1, text: "ones" }, { workspace_id: 2, text: "twos" }]);
  const profiles = defineTableResource({
    name: "profiles",
    tableName: "profiles",
    ownership: "user",
    schema: { userId: { type: "id", nullable: true, storage: { column: "user_id" } }, secret: { type: "string", nullable: true } }
  });
  const cards = defineTableResource({
    name: "cards",
    tableName: "cards",
    ownership: "workspace",
    schema: {
      workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
      title: { type: "string" },
      profileId: { type: "id", nullable: true, belongsTo: "profiles", as: "profile", storage: { column: "profile_id" } }
    }
  });
  const tips = defineTableResource({
    name: "tips",
    tableName: "tips",
    ownership: "workspace_or_shared",
    defaultSort: ["id"],
    schema: { workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } }, text: { type: "string" } }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const handles = await runtime.own("cards.feature", [profiles, cards, tips]);
  // A workspace request names no user, so the user-owned profiles refuse it however it reaches them.
  const options = { context: { workspace: { id: "1" } } };
  // An include's refusal arrives wrapped in the include's own errors.
  const noUser = (error) => {
    for (let cause = error; cause; cause = cause.cause) {
      if (cause.code === "REST_API_AUTOFILTER_CONTEXT") return true;
    }
    return false;
  };
  await assert.rejects(handles.profiles.query({ page: { size: 10 } }, options));
  await assert.rejects(handles.cards.query({ include: ["profile"], page: { size: 10 } }, options), noUser);
  await assert.rejects(handles.cards.get("1", { include: ["profile"] }, options), noUser);
  await assert.rejects(handles.cards.create({ title: "linked", profileId: "1" }, options), noUser);
  assert.equal(await knex("cards").where({ title: "linked" }).first(), undefined);
  // The cards themselves still read when the read leaves the link out.
  assert.deepEqual((await handles.cards.queryAll({ fields: ["title"] }, options)).map(({ title }) => title), ["a", "b"]);
  // A shared table still reads its shared rows for a context with no workspace, and the workspace's rows with one.
  assert.deepEqual((await handles.tips.queryAll({}, { context: { actor: { id: "5" } } })).map(({ text }) => text), ["shared"]);
  assert.deepEqual((await handles.tips.queryAll({}, options)).map(({ text }) => text), ["shared", "ones"]);
});

test("the owner's row policy cannot widen past ownership: its orWhere stays inside its own group", async (t) => {
  const { notes, knex } = await createFixture(t, {
    owns: [{
      resource: noteResource(),
      rowPolicy: ({ query, column }) => {
        query.where(column("status"), "open").orWhere(column("title"), "shared");
        return true;
      }
    }]
  });
  await knex("notes").insert([
    { workspace_id: 1, title: "mine", status: "open" },
    { workspace_id: 1, title: "closed", status: "closed" },
    { workspace_id: 2, title: "theirs", status: "open" },
    { workspace_id: 2, title: "shared", status: "closed" }
  ]);
  const { records } = await notes.query({ page: { size: 10 } }, { context: WORKSPACE_A });
  assert.deepEqual(records.map(({ title }) => title), ["mine"]);
  assert.deepEqual((await notes.query({ page: { size: 10 } }, { context: WORKSPACE_B })).records.map(({ title }) => title), ["theirs", "shared"]);
  const theirs = await knex("notes").where({ title: "shared" }).first();
  await assert.rejects(notes.get(theirs.id, {}, { context: WORKSPACE_A }), notFound);
  assert.equal(await notes.patch(theirs.id, { title: "taken" }, { context: WORKSPACE_A, missing: "skip" }), null);
  assert.equal((await knex("notes").where({ id: theirs.id }).first()).title, "shared");
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
    notes.withTransaction({ context: WORKSPACE_A, retry: false }, (txOptions) => notes.create({ title: "inner" }, txOptions)),
    (error) => error.code === "ER_LOCK_DEADLOCK"
  );
  assert.equal(hookRuns, 1);
  assert.deepEqual(await knex("notes").orderBy("id").pluck("title"), ["once", "attempt 2"]);
});

test("every call refuses a transaction no handle opened, and a missing record fails the transaction it was written in", async (t) => {
  const { notes, knex } = await createFixture(t);
  // Reads and writes alike, before anything runs, with the way to a handle's transaction.
  const refused = /notes: options\.trx is not a transaction a handle opened\. .*withTransaction\(options, work\)/u;
  await knex.transaction(async (trx) => {
    const options = { context: WORKSPACE_A, trx };
    await assert.rejects(notes.create({ title: "raw" }, options), refused);
    await assert.rejects(notes.get("1", {}, options), refused);
    await assert.rejects(notes.query({ page: { size: 5 } }, options), refused);
    await assert.rejects(notes.queryAll({}, options), refused);
    await assert.rejects(notes.withTransaction(options, () => "joined"), refused);
  });
  assert.deepEqual(await knex("notes"), []);

  // json-rest-api fails a managed transaction once a write in it fails, so a missing record's not-found error fails the
  // transaction it was written in even when the work catches it; missing: "skip" leaves the row alone instead.
  await assert.rejects(notes.withTransaction({ context: WORKSPACE_A }, async (txOptions) => {
    await notes.create({ title: "kept?" }, txOptions);
    await assert.rejects(notes.patch("999", { title: "missing" }, txOptions), (error) => error.code === "REST_API_RESOURCE" && error.transactionOutcome === "pending");
    return "committed?";
  }), (error) => error.code === "REST_API_RESOURCE" && error.transactionOutcome === "rolledBack");
  assert.deepEqual(await knex("notes"), []);
  await assert.rejects(notes.patch("999", { title: "missing" }, { context: WORKSPACE_A }), notFound);
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
  // A condition named with no value (a version read under the wrong field name) is refused, never run without it.
  await assert.rejects(notes.patch(note.id, {}, { context: WORKSPACE_A, lockVersion: undefined }), /notes\.patch\(\) options\.lockVersion is undefined/u);
  await assert.rejects(notes.patch(note.id, { title: "x" }, { context: WORKSPACE_A, onlyIf: undefined }), /notes\.patch\(\) options\.onlyIf is undefined/u);
  await assert.rejects(notes.patchMany([{ id: note.id }], { context: WORKSPACE_A, onlyIf: undefined }), /notes\.patchMany\(\) options\.onlyIf is undefined/u);
  await assert.rejects(notes.patchWhere({ id: note.id }, { title: "x" }, { context: WORKSPACE_A, onlyIf: undefined }), /notes\.patchWhere\(\) options\.onlyIf is undefined/u);
  assert.deepEqual(await knex("notes").where({ id: note.id }).first("title", "lock_version"), { title: "draft", lock_version: 1 });
  await assert.rejects(notes.patch(note.id, {}, { context: WORKSPACE_A, lockVersion: -1 }), /must be a non-negative integer/u);
  await assert.rejects(notes.patch(note.id, {}, { context: WORKSPACE_A, lockVersion: "1" }), /must be a non-negative integer/u);
  await assert.rejects(
    notes.patch(note.id, { lockVersion: 9 }, { context: WORKSPACE_A, lockVersion: 1 }),
    /advances lockVersion itself, so the attributes must leave it out/u
  );
});

test("a belongs-to field is written under its relationship, and naming both is refused", async (t) => {
  const knex = await testKnex(t);
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
  const authors = defineTableResource({ name: "authors", tableName: "authors", ownership: "public", schema: { name: { type: "string", required: true } } });
  const books = defineTableResource({
    name: "books",
    tableName: "books",
    ownership: "public",
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

// Visits each belong to a workspace's customer and to a vet; customers are workspace rows, vets public ones.
async function createVisitFixture(t) {
  const knex = await testKnex(t);
  await knex.schema.createTable("customers", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.string("name");
  });
  await knex.schema.createTable("vets", (table) => {
    table.increments("id");
    table.string("name");
  });
  await knex.schema.createTable("visits", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.integer("customer_id");
    table.integer("vet_id");
    table.string("stage").notNullable();
    table.string("internal_code");
    table.string("reviewer");
    table.integer("lock_version").notNullable().defaultTo(0);
  });
  await knex("customers").insert({ workspace_id: 1, name: "Ada" });
  await knex("vets").insert({ name: "Grace" });
  const customers = defineTableResource({
    name: "customers",
    tableName: "customers",
    ownership: "workspace",
    schema: { workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } }, name: { type: "string" } }
  });
  const vets = defineTableResource({ name: "vets", tableName: "vets", ownership: "public", schema: { name: { type: "string" } } });
  const visits = defineTableResource({
    name: "visits",
    tableName: "visits",
    ownership: "workspace",
    lockVersionField: "lockVersion",
    defaultExclude: ["internalCode"],
    schema: {
      workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
      customerId: { type: "id", nullable: true, belongsTo: "customers", as: "customer", storage: { column: "customer_id" } },
      vetId: { type: "id", nullable: true, belongsTo: "vets", as: "vet", storage: { column: "vet_id" } },
      stage: { type: "string", required: true },
      internalCode: { type: "string", nullable: true, storage: { column: "internal_code" } },
      reviewer: { type: "string", nullable: true, hidden: true },
      lockVersion: { type: "integer", defaultTo: 0, storage: { column: "lock_version" } }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const handles = await runtime.own("visits.feature", [customers, vets, visits]);
  const options = { context: WORKSPACE_A };
  const created = await handles.visits.createMany([
    { customerId: "1", vetId: "1", stage: "new", internalCode: "k1", reviewer: "lee" },
    { customerId: "1", vetId: "1", stage: "new", internalCode: "k2" }
  ], { ...options, returning: "ids" });
  // The tables each SELECT reads, in order.
  const selects = async (work) => (await countQueries(knex, work)).queries
    .filter((sql) => /^select/iu.test(sql))
    .map((sql) => [...sql.matchAll(/from [`"](\w+)[`"]/gu)].map(([, table]) => table)[0]);
  return { visits: handles.visits, options, ids: created, selects, postgres: knex.client.config.client === "pg" };
}

test("a read whose list filter is an empty list answers nothing without a statement, as a read that matches no row does", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("tickets", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.string("stage").notNullable();
    table.integer("points");
  });
  await knex("tickets").insert([{ workspace_id: 1, stage: "new", points: 3 }, { workspace_id: 1, stage: "done", points: 5 }]);
  const runtime = await createTestResourceRuntime({ knex });
  const { tickets } = await runtime.own("tickets.feature", [defineTableResource({
    name: "tickets",
    tableName: "tickets",
    ownership: "workspace",
    searchSchema: { stages: { type: "array", actualField: "stage", filterOperator: "in" } },
    schema: {
      workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
      stage: { type: "string", required: true, search: true },
      points: { type: "integer", nullable: true }
    }
  })]);
  const options = { context: WORKSPACE_A };
  const measures = { tickets: { count: "id" }, points: { sum: "points" }, most: { max: "points" } };
  const reads = (filters) => [
    () => tickets.query({ filters, page: { size: 10 } }, options),
    () => tickets.query({ filters, page: { size: 10, number: 2 } }, options),
    () => tickets.queryAll({ filters }, options),
    () => tickets.aggregate({ measures, filters }, options),
    () => tickets.aggregate({ measures, groupBy: ["stage"], filters }, options)
  ];
  const none = reads({ id: ["999"] });
  for (const [index, read] of reads({ id: [] }).entries()) {
    const { result, count } = await countQueries(knex, read);
    assert.equal(count, 0);
    // The same answer the database gives a read that matches no row.
    assert.deepEqual(result, await none[index]());
  }
  for (const read of reads({ stages: [], stage: "new" })) {
    assert.equal((await countQueries(knex, read)).count, 0);
  }
  // The guards still run: a context that names no workspace is refused, and a list read still needs its page size.
  await assert.rejects(tickets.queryAll({ filters: { id: [] } }, { context: {} }), /this context names no workspace/u);
  await assert.rejects(tickets.query({ filters: { id: [] } }, options), (error) => error.name === "UnpagedQueryError");
});

test("lock, lockMany, lockWhere and claim read only the fields they name, so a relation left out costs no visibility check", async (t) => {
  const { visits, options, ids, selects, postgres } = await createVisitFixture(t);
  let locked;
  // PostgreSQL's lockWhere reads once more under the locks it took, for rows that started to match while it waited.
  const lockWhereReads = postgres ? ["visits", "visits"] : ["visits"];
  // Every field: the locking read, then one visibility check per related type.
  assert.deepEqual(await selects(() => visits.withTransaction(options, (tx) => visits.lock(ids[0], tx))), ["visits", "customers", "vets"]);
  assert.deepEqual(await selects(() => visits.withTransaction(options, async (tx) => {
    locked = await visits.lock(ids[0], { ...tx, fields: ["stage", "lockVersion"] });
  })), ["visits"]);
  assert.deepEqual(locked, { id: ids[0], stage: "new", lockVersion: 0 });
  assert.deepEqual(await selects(() => visits.withTransaction(options, async (tx) => {
    locked = await visits.lockMany(ids, { ...tx, fields: ["stage", "customerId"] });
  })), ["visits", "customers"]);
  assert.deepEqual(locked, ids.map((id) => ({ id, stage: "new", customerId: "1" })));
  assert.deepEqual(await selects(() => visits.withTransaction(options, (tx) => visits.lockWhere({ id: ids }, tx))), [...lockWhereReads, "customers", "vets"]);
  assert.deepEqual(await selects(() => visits.withTransaction(options, async (tx) => {
    locked = await visits.lockWhere({ id: ids }, { ...tx, fields: ["stage"] });
  })), lockWhereReads);
  assert.deepEqual(locked, ids.map((id) => ({ id, stage: "new" })));
  assert.deepEqual(await selects(() => visits.withTransaction(options, (tx) => visits.claim({ filters: { id: ids } }, tx))), ["visits", "customers", "vets"]);
  assert.deepEqual(await selects(() => visits.withTransaction(options, async (tx) => {
    locked = await visits.claim({ filters: { id: ids }, take: 1 }, { ...tx, fields: ["stage", "vetId"] });
  })), ["visits", "vets"]);
  assert.deepEqual(locked, [{ id: ids[0], stage: "new", vetId: "1" }]);
});

test("a patch that compares a lock version or onlyIf locks only the version, and compares onlyIf in SQL, hidden fields too", async (t) => {
  const { visits, options, ids, selects } = await createVisitFixture(t);
  // The patch's own locking read checks no relation: the customer it writes unchanged is checked by the write alone.
  const statements = await selects(() => visits.patch(ids[0], { stage: "seen", customerId: "1" }, { ...options, lockVersion: 0, returning: "none" }));
  assert.equal(statements[0], "visits");
  assert.equal(statements.filter((table) => table === "vets").length, 0);
  assert.deepEqual(await selects(() => visits.patch(ids[1], { stage: "seen" }, { ...options, lockVersion: 0, returning: "none" })).then((tables) => tables[0]), "visits");
  // onlyIf may compare a field reads hide by default.
  assert.equal((await visits.patch(ids[0], { stage: "done" }, { ...options, onlyIf: { internalCode: "k1" } })).stage, "done");
  assert.equal(await visits.patch(ids[0], { stage: "late" }, { ...options, onlyIf: { internalCode: "other" } }), null);
  // A hidden field, which no read answers, is compared by the UPDATE itself.
  assert.equal((await visits.patch(ids[0], { stage: "checked" }, { ...options, onlyIf: { reviewer: "lee" } })).stage, "checked");
  assert.equal(await visits.patch(ids[0], { stage: "late" }, { ...options, onlyIf: { reviewer: "sam" } }), null);
  assert.equal((await visits.patch(ids[1], { stage: "seen" }, { ...options, lockVersion: 1, onlyIf: { reviewer: null } })).stage, "seen");
  await assert.rejects(visits.patch("999", { stage: "late" }, { ...options, onlyIf: { reviewer: "lee" } }), notFound);
});

test("a patch with onlyIf and no changes compares in SQL, so an id given as a number and a hidden field match", async (t) => {
  const { visits, options, ids } = await createVisitFixture(t);
  // A record answers customerId as text and never the hidden reviewer, yet both compare.
  for (const missing of ["throw", "skip"]) {
    const call = { ...options, missing };
    assert.equal((await visits.patch(ids[0], {}, { ...call, onlyIf: { customerId: 1 } }))?.id, ids[0], missing);
    assert.equal((await visits.patch(ids[0], {}, { ...call, onlyIf: { reviewer: "lee", customerId: "1" } }))?.id, ids[0], missing);
    assert.equal((await visits.patch(ids[1], {}, { ...call, onlyIf: { reviewer: null } }))?.id, ids[1], missing);
    assert.equal(await visits.patch(ids[0], {}, { ...call, onlyIf: { customerId: 2 } }), null, missing);
    assert.equal(await visits.patch(ids[0], {}, { ...call, onlyIf: { reviewer: "sam" } }), null, missing);
  }
  // With a lock version, an empty patch that matches advances it, and one that does not leaves it.
  assert.equal(await visits.patch(ids[0], {}, { ...options, lockVersion: 0, onlyIf: { reviewer: "sam" } }), null);
  assert.equal((await visits.patch(ids[0], {}, { ...options, lockVersion: 0, onlyIf: { reviewer: "lee" } })).lockVersion, 1);
  // onlyIf names stored fields, as an UPDATE's onlyIf does.
  await assert.rejects(visits.patch(ids[0], {}, { ...options, onlyIf: { nothing: 1 } }), /visits\.patch\(\) onlyIf\.nothing is not a stored field/u);
  await assert.rejects(visits.patch(ids[0], {}, { ...options, missing: "skip", onlyIf: { stage: ["new"] } }), /onlyIf\.stage must be a scalar/u);
});

test("delete, deleteWhere, createMany, patchMany and patchWhere refuse a condition they cannot compare, and write nothing", async (t) => {
  const { knex, notes } = await createFixture(t);
  const options = { context: WORKSPACE_A };
  const note = await notes.create({ title: "draft" }, options);
  const refused = (method, keys) => new RegExp(`notes\\.${method}\\(\\) cannot compare ${keys}, so it refuses`, "u");
  await assert.rejects(notes.delete(note.id, { ...options, lockVersion: 0 }), refused("delete", "lockVersion"));
  await assert.rejects(notes.delete(note.id, { ...options, missing: "skip", onlyIf: { status: "open" } }), refused("delete", "onlyIf"));
  await assert.rejects(notes.deleteWhere({ id: note.id }, { ...options, lockVersion: 0, onlyIf: { status: "open" } }),
    refused("deleteWhere", "lockVersion or onlyIf"));
  await assert.rejects(notes.createMany([{ title: "copy" }], { ...options, onlyIf: { status: "open" } }), refused("createMany", "onlyIf"));
  await assert.rejects(notes.createMany([{ title: "copy" }], { ...options, lockVersion: 0 }), refused("createMany", "lockVersion"));
  await assert.rejects(notes.patchMany([{ id: note.id, title: "x" }], { ...options, lockVersion: 0 }), refused("patchMany", "lockVersion"));
  await assert.rejects(notes.patchWhere({ id: note.id }, { title: "x" }, { ...options, lockVersion: 0 }), refused("patchWhere", "lockVersion"));
  assert.deepEqual(await knex("notes").select("title", "lock_version"), [{ title: "draft", lock_version: 0 }]);
  // What the refusal suggests: patchMany's onlyIf on the lock version field changes only the rows still at that version.
  assert.deepEqual(await notes.patchMany([{ id: note.id, title: "x" }], { ...options, onlyIf: { lockVersion: 1 }, returning: "ids" }), []);
  assert.deepEqual(await notes.patchMany([{ id: note.id, title: "x" }], { ...options, onlyIf: { lockVersion: 0 }, returning: "ids" }), [note.id]);
  assert.deepEqual(await knex("notes").select("title", "lock_version"), [{ title: "x", lock_version: 1 }]);
});

test("a read with one include or two reads each included type once, whatever the rows, and checks no included link again", async (t) => {
  const { visits, options, ids, selects } = await createVisitFixture(t);
  const one = await selects(() => visits.get(ids[0], { fields: ["stage", "customerId"], include: ["customer"] }, options));
  const two = await selects(() => visits.get(ids[0], { fields: ["stage", "customerId", "vetId"], include: ["customer", "vet"] }, options));
  const many = await selects(() => visits.query({ fields: ["stage", "customerId", "vetId"], include: ["customer", "vet"], page: { size: 10 } }, options));
  // The read, then each include's own scoped select. A link to an included target needs no visibility check: the
  // include's select already proved the reader may see it.
  assert.deepEqual(one, ["visits", "customers"]);
  assert.deepEqual(two, ["visits", "customers", "vets"]);
  // A page of rows reads the same tables as one row.
  assert.deepEqual(many, two);
});

test("a record written back as it was read keeps a link to a target the writer cannot see", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("suppliers", (table) => {
    table.increments("id");
    table.string("name");
    table.boolean("archived").notNullable().defaultTo(false);
  });
  await knex.schema.createTable("items", (table) => {
    table.increments("id");
    table.string("name");
    table.integer("supplier_id");
  });
  await knex("suppliers").insert([{ name: "Open", archived: false }, { name: "Closed", archived: true }]);
  await knex("items").insert([{ name: "Kept", supplier_id: 2 }, { name: "Other", supplier_id: 2 }, { name: "Third", supplier_id: 2 }]);
  const suppliers = defineTableResource({
    name: "suppliers",
    tableName: "suppliers",
    ownership: "public",
    schema: { name: { type: "string" }, archived: { type: "boolean", defaultTo: false } }
  });
  const items = defineTableResource({
    name: "items",
    tableName: "items",
    ownership: "public",
    schema: {
      name: { type: "string" },
      supplierId: { type: "id", nullable: true, belongsTo: "suppliers", as: "supplier", storage: { column: "supplier_id" } }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  // A request sees only open suppliers, so a link to an archived one reads as null.
  const handles = await runtime.own("items.feature", [items, {
    resource: suppliers,
    rowPolicy: ({ query, column, caller }) => {
      if (caller.kind !== "system") query.where(column("archived"), false);
      return true;
    }
  }]);
  const options = { context: { actor: { id: "7" } } };
  const supplierOf = async (id) => (await knex("items").where({ id }).first("supplier_id")).supplier_id;
  const read = await handles.items.get("1", {}, options);
  assert.equal(read.supplierId, null);

  // A form sends back what it read: the null it was shown keeps the stored link, and the rest of the write applies.
  await handles.items.patch("1", { name: "Renamed", supplierId: read.supplierId }, { ...options, returning: "none" });
  assert.deepEqual(await knex("items").where({ id: 1 }).first("name", "supplier_id"), { name: "Renamed", supplier_id: 2 });
  await handles.items.patchMany([{ id: "2", name: "Also", supplierId: null }], options);
  assert.equal(await supplierOf(2), 2);
  // Linking a target the writer sees applies, and so does clearing a link to one.
  await handles.items.patch("3", { supplierId: "1" }, { ...options, returning: "none" });
  assert.equal(await supplierOf(3), 1);
  await handles.items.patch("3", { supplierId: null }, { ...options, returning: "none" });
  assert.equal(await supplierOf(3), null);
});

test("own() refuses a cross-table filter whose target field is not indexed, whichever table is owned first", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("suppliers", (table) => {
    table.increments("id");
    table.string("name").index();
  });
  await knex.schema.createTable("items", (table) => {
    table.increments("id");
    table.string("name");
    table.integer("supplier_id");
  });
  await knex("suppliers").insert([{ name: "Open" }, { name: "Shut" }]);
  await knex("items").insert([{ name: "Kept", supplier_id: 1 }, { name: "Other", supplier_id: 2 }]);
  const suppliers = (indexed) => defineTableResource({
    name: "suppliers",
    tableName: "suppliers",
    ownership: "public",
    schema: { name: { type: "string", ...(indexed ? { indexed: true } : {}) } }
  });
  const items = defineTableResource({
    name: "items",
    tableName: "items",
    ownership: "public",
    searchSchema: { supplierName: { type: "string", actualField: "suppliers.name" } },
    schema: {
      name: { type: "string" },
      supplierId: { type: "id", nullable: true, belongsTo: "suppliers", as: "supplier", storage: { column: "supplier_id" } }
    }
  });
  const unindexed = /Table resource "items" filters "supplierName" on suppliers\.name, which "suppliers" does not declare indexed: true/u;
  // The target owned first, then the filtering table; and the other way round.
  const first = await createTestResourceRuntime({ knex });
  await first.own("suppliers.feature", [suppliers(false)]);
  await assert.rejects(first.own("items.feature", [items]), unindexed);
  const second = await createTestResourceRuntime({ knex });
  await second.own("items.feature", [items]);
  await assert.rejects(second.own("suppliers.feature", [suppliers(false)]), unindexed);
  // An indexed target is searched through the join.
  const runtime = await createTestResourceRuntime({ knex });
  const { items: handle } = await runtime.own("items.feature", [items, suppliers(true)]);
  assert.deepEqual((await handle.queryAll({ filters: { supplierName: "Open" } }, {})).map(({ name }) => name), ["Kept"]);
});

test("a job finds its units by grouping on a hidden ownership field, which a request may not group by", async (t) => {
  const { notes, runtime } = await createFixture(t, {
    owns: [noteResource({
      schema: {
        id: { type: "id", primary: true },
        workspaceId: { type: "id", nullable: true, hidden: true, storage: { column: "workspace_id" } },
        title: { type: "string", required: true, search: true },
        status: { type: "string", defaultTo: "open", search: true },
        lockVersion: { type: "integer", defaultTo: 0, storage: { column: "lock_version" } }
      }
    })]
  });
  await notes.createMany([{ title: "a" }, { title: "b" }], { context: WORKSPACE_A });
  await notes.createMany([{ title: "c" }], { context: WORKSPACE_B });
  const systemContext = runtime.declareSystemScope("digest.feature", "nightly digests")("find the workspaces with notes");
  const units = await notes.aggregate({ groupBy: ["workspaceId"], measures: { notes: { count: "*" } }, filters: { status: "open" } }, { context: systemContext });
  assert.deepEqual(units.map(({ workspaceId, notes: count }) => [String(workspaceId), Number(count)]).sort(), [["1", 2], ["2", 1]]);
  await assert.rejects(
    notes.aggregate({ groupBy: ["workspaceId"], measures: { notes: { count: "*" } } }, { context: WORKSPACE_A }),
    /'workspaceId' is not an attribute of 'notes' that can be aggregated/u
  );
});

test("a sparse read names a belongs-to field by its own key or its relationship, and leaves out the ones it does not name", async (t) => {
  const { visits, options, ids } = await createVisitFixture(t);
  const expected = { id: ids[0], customerId: "1" };
  assert.deepEqual(await visits.get(ids[0], { fields: ["customerId"] }, options), expected);
  assert.deepEqual(await visits.get(ids[0], { fields: ["customer"] }, options), expected);
  assert.deepEqual(await visits.get(ids[0], { fields: { visits: "customerId" } }, options), expected);
  assert.deepEqual(await visits.queryAll({ filters: { id: ids[0] }, fields: ["stage", "vetId"] }, options), [{ id: ids[0], stage: "new", vetId: "1" }]);
});

test("a collection relation with hydrateOnList or hydrateOnView false loads its rows only when the read includes it", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("contacts", (table) => {
    table.increments("id");
    table.string("name").notNullable();
  });
  await knex.schema.createTable("pets", (table) => {
    table.increments("id");
    table.integer("contact_id");
    table.string("name").notNullable();
  });
  await knex("contacts").insert([{ name: "Ada" }, { name: "Grace" }]);
  await knex("pets").insert([{ contact_id: 1, name: "Rex" }, { contact_id: 2, name: "Tom" }]);
  const contacts = (flags) => defineTableResource({
    name: "contacts",
    tableName: "contacts",
    ownership: "public",
    schema: {
      name: { type: "string", required: true },
      pets: { type: "array", storage: { virtual: true }, relation: { kind: "collection", namespace: "pets", foreignKey: "contactId", ...flags } }
    }
  });
  const pets = defineTableResource({
    name: "pets",
    tableName: "pets",
    ownership: "public",
    schema: {
      contactId: { type: "id", nullable: true, belongsTo: "contacts", as: "contact", storage: { column: "contact_id" } },
      name: { type: "string", required: true }
    }
  });
  const reads = async (work) => (await countQueries(knex, work)).queries.filter((sql) => /^select/iu.test(sql)).length;
  const quietRuntime = await createTestResourceRuntime({ knex });
  const quiet = (await quietRuntime.own("contacts.feature", [contacts({ hydrateOnList: false, hydrateOnView: false }), pets])).contacts;

  assert.equal(await reads(() => quiet.queryAll({}, {})), 1);
  assert.deepEqual(await quiet.queryAll({}, {}), [{ id: "1", name: "Ada" }, { id: "2", name: "Grace" }]);
  assert.deepEqual(await quiet.get("1", {}, {}), { id: "1", name: "Ada" });
  assert.equal(await reads(() => quiet.withTransaction({}, (tx) => quiet.lock("1", tx))), 1);
  // An include still loads it.
  assert.deepEqual((await quiet.get("1", { include: "pets" }, {})).pets.map(({ name }) => name), ["Rex"]);

  const loudRuntime = await createTestResourceRuntime({ knex });
  const loud = (await loudRuntime.own("contacts.feature", [contacts({}), pets])).contacts;
  assert.equal(await reads(() => loud.queryAll({}, {})), 2, "without the flags a read loads the collection's linkage");
  assert.deepEqual((await loud.get("1", {}, {})).pets.map(({ id }) => id), ["1"]);
});

test("an included record reads as a read of its own resource answers it, at every depth and in a collection", async (t) => {
  const knex = await testKnex(t);
  await knex.schema.createTable("contacts", (table) => {
    table.increments("id");
    table.string("name").notNullable();
  });
  await knex.schema.createTable("pets", (table) => {
    table.increments("id");
    table.integer("contact_id");
    table.string("name").notNullable();
  });
  await knex.schema.createTable("bookings", (table) => {
    table.increments("id");
    table.integer("pet_id");
    table.string("day").notNullable();
  });
  await knex("contacts").insert({ name: "Ada" });
  await knex("pets").insert({ contact_id: 1, name: "Rex" });
  await knex("bookings").insert({ pet_id: 1, day: "monday" });
  const contacts = defineTableResource({
    name: "contacts",
    tableName: "contacts",
    ownership: "public",
    schema: {
      name: { type: "string", required: true },
      pets: { type: "array", storage: { virtual: true }, relation: { kind: "collection", namespace: "pets", foreignKey: "contactId" } }
    }
  });
  const pets = defineTableResource({
    name: "pets",
    tableName: "pets",
    ownership: "public",
    schema: {
      contactId: { type: "id", nullable: true, belongsTo: "contacts", as: "contact", storage: { column: "contact_id" } },
      name: { type: "string", required: true }
    }
  });
  const bookings = defineTableResource({
    name: "bookings",
    tableName: "bookings",
    ownership: "public",
    schema: {
      petId: { type: "id", nullable: true, belongsTo: "pets", as: "pet", storage: { column: "pet_id" } },
      day: { type: "string", required: true }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const handles = await runtime.own("bookings.feature", [contacts, pets, bookings]);
  const pet = await handles.pets.get("1", {}, {});
  assert.deepEqual(pet, { id: "1", name: "Rex", contactId: "1" });

  const booking = await handles.bookings.get("1", { include: "pet" }, {});
  assert.deepEqual(booking, { id: "1", day: "monday", petId: "1", pet });
  const deeper = await handles.bookings.queryAll({ include: "pet.contact" }, {});
  // The contact's own collection is not included, so it is left out rather than answered empty.
  assert.deepEqual(deeper[0].pet, { ...pet, contact: { id: "1", name: "Ada" } });
  const contact = await handles.contacts.get("1", { include: "pets" }, {});
  assert.deepEqual(contact.pets, [pet]);
});
