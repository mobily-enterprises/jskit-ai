import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createPackageTestKnex, createTestResourceRuntime } from "../src/test/index.js";

// What changed since a horizon, on PostgreSQL, with real concurrent transactions. Each row carries the transaction
// that last wrote it, an xid8 change stamp that a trigger sets on every insert and update, whatever the write sent, read
// through an xid8 field with changedSince (>=) and changedBefore (<) filters. A reader takes
// changeHorizon() before it reads; every transaction below the horizon had finished, so a later read of the rows
// stamped at or above it finds everything the first read could not see. Each test works in a schema of its own in
// TEST_DB_NAME (createPackageTestKnex); other sessions on the server may hold the horizon lower, never higher, so the
// tests check what a read must include and what it must leave out.

const skip = process.env.DB_CLIENT === "pg" ? false : "a PostgreSQL test: it runs on a DB_CLIENT=pg run, with TEST_DB_NAME";
const WORKSPACE = Object.freeze({ context: Object.freeze({ workspace: Object.freeze({ id: "1" }) }) });

const messageResource = defineTableResource({
  name: "messages",
  tableName: "messages",
  ownership: "workspace",
  defaultSort: ["id"],
  schema: {
    id: { type: "id", primary: true },
    workspaceId: { type: "id", nullable: true, search: true, storage: { column: "workspace_id" } },
    body: { type: "string", required: true, search: true },
    // The database stamps it; nothing writes it.
    changed: { type: "xid8", nullable: true }
  },
  searchSchema: {
    changedSince: { type: "xid8", actualField: "changed", filterOperator: ">=" },
    changedBefore: { type: "xid8", actualField: "changed", filterOperator: "<" }
  }
});

async function database(t) {
  const knex = await createPackageTestKnex(t, { environment: process.env });
  await knex.schema.createTable("messages", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("body").notNullable();
    table.specificType("changed", "xid8").notNullable().defaultTo(knex.raw("pg_current_xact_id()"));
  });
  await knex.raw(
    "create function messages_changed() returns trigger language plpgsql as $$ " +
    "begin new.changed := pg_current_xact_id(); return new; end $$"
  );
  await knex.raw("create trigger messages_changed before insert or update on messages for each row execute function messages_changed()");
  const runtime = await createTestResourceRuntime({ knex });
  const { messages } = await runtime.own("messages.feature", [messageResource]);
  return { knex, messages };
}

const bodies = (records) => new Map(records.map(({ id, body }) => [String(id), body]));

test("a read from the change horizon finds what a transaction still open at the horizon wrote, which the highest id seen misses", { skip }, async (t) => {
  const { knex, messages } = await database(t);
  const [first] = (await messages.createMany([{ body: "first" }], { ...WORKSPACE, returning: "ids" })).map(String);

  // A writer still open when the reader reads: it changes the first message and adds one, taking its id now.
  const writer = await knex.transaction();
  t.after(() => (writer.isCompleted() ? undefined : writer.rollback()));
  await writer("messages").where({ id: first }).update({ body: "first, edited" });
  const [{ id: added }] = await writer("messages").insert({ workspace_id: 1, body: "added by the open writer" }, ["id"]);
  const [{ id: theirs }] = await writer("messages").insert({ workspace_id: 2, body: "another workspace's" }, ["id"]);
  const { rows: [{ xid: writerXid }] } = await writer.raw("select pg_current_xact_id()::text as xid");
  // A later writer adds one and commits at once, so its id is above the open writer's.
  const [later] = (await messages.createMany([{ body: "added later" }], { ...WORKSPACE, returning: "ids" })).map(String);

  const horizon = await messages.changeHorizon(WORKSPACE);
  const page = await messages.queryAll({}, WORKSPACE);
  assert.deepEqual([...bodies(page)], [[first, "first"], [later, "added later"]]);
  assert.match(horizon, /^\d{1,20}$/u);
  assert.ok(BigInt(horizon) <= BigInt(writerXid), `the open writer's transaction ${writerXid} is at or above the horizon ${horizon}`);

  await writer.commit();
  const caughtUp = bodies(await messages.queryAll({ filters: { changedSince: horizon } }, WORKSPACE));
  assert.equal(caughtUp.get(first), "first, edited", "the change of an older message");
  assert.equal(caughtUp.get(String(added)), "added by the open writer", "the message whose id was taken before it committed");
  assert.equal(caughtUp.has(String(theirs)), false, "another workspace's message stays out");
  // "Past the highest id seen" misses both: the edit kept its id, and the added message's id is below the later one's.
  const highestSeen = Math.max(...page.map(({ id }) => Number(id)));
  assert.deepEqual([Number(first) < highestSeen, Number(added) < highestSeen], [true, true]);
});

test("changedSince and changedBefore read the window between two horizons; what the window leaves out, the next read from its end finds", { skip }, async (t) => {
  const { messages } = await database(t);
  const start = await messages.changeHorizon(WORKSPACE);
  const [a] = (await messages.createMany([{ body: "a" }], { ...WORKSPACE, returning: "ids" })).map(String);
  const end = await messages.changeHorizon(WORKSPACE);
  const [b] = (await messages.createMany([{ body: "b" }], { ...WORKSPACE, returning: "ids" })).map(String);

  const window = bodies(await messages.queryAll({ filters: { changedSince: start, changedBefore: end } }, WORKSPACE));
  const next = bodies(await messages.queryAll({ filters: { changedSince: end } }, WORKSPACE));
  // b was written after the end horizon was read, so its transaction is at or above it: never in the window.
  assert.equal(window.has(b), false);
  assert.equal(next.get(b), "b");
  // a is in the window or, while another session held the end horizon below a's transaction, in the next read.
  assert.equal(window.get(a) ?? next.get(a), "a");
  assert.ok(BigInt(start) <= BigInt(end), "the horizon never moves back");
});

test("a stamp compares as a transaction id: from a row's own stamp it is found, from the next one not, a malformed cursor is refused, and a patch moves the stamp on", { skip }, async (t) => {
  const { knex, messages } = await database(t);
  // The trigger stamps the writing transaction whatever the write sends.
  const [created] = await messages.createMany([{ body: "one", changed: "1" }], { ...WORKSPACE, returning: "records" });
  const stamp = BigInt(created.changed);
  assert.ok(stamp > 1n, `stamped ${created.changed}`);
  const found = async (filters) => (await messages.queryAll({ filters }, WORKSPACE)).map(({ body }) => body);
  const next = String(stamp + 1n);
  assert.deepEqual(
    [await found({ changedSince: created.changed }), await found({ changedSince: next }), await found({ changedBefore: created.changed }), await found({ changedBefore: next })],
    [["one"], [], [], ["one"]]
  );
  // They compare as numbers, not as text, where "9" would sort above a stamp starting with a lower digit.
  assert.deepEqual([await found({ changedSince: "9" }), await found({ changedBefore: "9" })], [["one"], []]);
  assert.deepEqual(await found({ changedSince: "18446744073709551615" }), []);
  // A cursor is decimal text below 2^64, leading zeros allowed; anything else is refused before any statement.
  assert.deepEqual(await found({ changedSince: `000${created.changed}` }), ["one"]);
  const statements = [];
  const counted = ({ sql }) => statements.push(sql);
  knex.on("query", counted);
  for (const cursor of ["not a position", "-1", "18446744073709551616", "1.5"]) {
    await assert.rejects(found({ changedSince: cursor }), { code: "REST_API_VALIDATION" }, cursor);
  }
  knex.off("query", counted);
  assert.deepEqual(statements, []);
  await messages.patch(created.id, { body: "one, edited" }, { ...WORKSPACE, returning: "none" });
  const [{ changed: moved }] = await knex("messages").where({ id: created.id }).select(knex.raw("changed::text as changed"));
  assert.ok(BigInt(moved) > stamp, "a patch stamps its own transaction");
  assert.deepEqual(await found({ changedSince: next }), ["one, edited"]);
});

test("changeHorizon() reads in the caller's transaction and checks the call's context, as every handle call does", { skip }, async (t) => {
  const { messages } = await database(t);
  const inside = await messages.withTransaction(WORKSPACE, async (txOptions) => {
    await messages.create({ body: "x" }, { ...txOptions, returning: "none" });
    return messages.changeHorizon(txOptions);
  });
  assert.match(inside, /^\d{1,20}$/u);
  await assert.rejects(messages.changeHorizon({}), { code: "RESOURCE_MISSING_SCOPE" });
});
