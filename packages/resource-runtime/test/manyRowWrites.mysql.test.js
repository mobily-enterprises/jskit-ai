import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { UnsupportedDatabaseError } from "../src/server/index.js";
import { createTestResourceRuntime } from "../src/test/index.js";

// patchWhere and deleteWhere on MySQL or MariaDB, under two concurrent writers: each checks its filters on the row
// once it holds the row's lock, so of two writers whose filters both matched a row, the one that waited for the
// other's lock leaves the row out when it no longer matches (a compare-and-set on the filters).

const WORKSPACE = Object.freeze({ workspace: { id: "1" } });
const RUNTIME_MYSQL = Object.freeze({ supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" });

const slotResource = defineTableResource({
  name: "slots",
  tableName: "slots",
  ownership: "workspace",
  defaultSort: ["id"],
  schema: {
    id: { type: "id", primary: true },
    workspaceId: { type: "id", nullable: true, search: true, storage: { column: "workspace_id" } },
    status: { type: "string", defaultTo: "open", search: true },
    takenBy: { type: "string", nullable: true, storage: { column: "taken_by" } }
  }
});

/**
 * A database of the test's own beside TEST_DB_NAME, with one slots table, dropped after the test. Every connection
 * runs with MariaDB's innodb_snapshot_isolation set to `snapshotIsolation` (default off). A server without the
 * setting (MySQL, older MariaDB) behaves as off, so asking it for on answers null.
 */
async function ownDatabase(context, suffix, { snapshotIsolation = false } = {}) {
  const name = `${requireTestDatabase(process.env)}_${suffix}`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  const [variables] = await admin.raw("SHOW VARIABLES LIKE 'innodb_snapshot_isolation'");
  if (snapshotIsolation && variables.length === 0) {
    await admin.destroy();
    return null;
  }
  await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  await admin.raw("CREATE DATABASE ??", [name]);
  const setting = variables.length === 0 ? null : `SET SESSION innodb_snapshot_isolation = ${snapshotIsolation ? "ON" : "OFF"}`;
  const knex = knexLib({
    client: "mysql2",
    connection: { ...server, database: name, ...RUNTIME_MYSQL },
    pool: { min: 0, max: 6, ...(setting ? { afterCreate: (connection, done) => connection.query(setting, (error) => done(error, connection)) } : {}) }
  });
  context.after(async () => {
    await knex.destroy();
    await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    await admin.destroy();
  });
  await knex.schema.createTable("slots", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("status").notNullable().defaultTo("open");
    table.string("taken_by").nullable();
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { slots } = await runtime.own("slots.feature", [slotResource]);
  return { knex, slots };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits until `count` transactions on this test's database wait for a row lock. A server that keeps INNODB_TRX from
 * the test user gets a fixed pause instead, long enough for both writers to reach the lock.
 */
async function bothWaiting(knex, count) {
  for (let waited = 0; waited < 10_000; waited += 25) {
    let waiting;
    try {
      const [[row]] = await knex.raw(
        "SELECT COUNT(*) AS waiting FROM information_schema.INNODB_TRX t JOIN information_schema.PROCESSLIST p " +
        "ON p.ID = t.trx_mysql_thread_id WHERE t.trx_state = 'LOCK WAIT' AND p.DB = DATABASE()"
      );
      waiting = Number(row.waiting);
    } catch {
      await pause(500);
      return;
    }
    if (waiting >= count) return;
    await pause(25);
  }
  assert.fail(`${count} writers did not reach the row's lock within 10 s`);
}

/** Holds the row's lock while both writers start, until both wait on it, then lets them go one after the other. */
async function raceOnLockedRow(knex, id, writers) {
  const holder = await knex.transaction();
  try {
    await holder("slots").where({ id }).forUpdate().select("id");
    const running = writers.map((write) => write().then((value) => ({ value }), (error) => ({ error })));
    await bothWaiting(knex, writers.length);
    await holder.commit();
    return await Promise.all(running);
  } finally {
    if (!holder.isCompleted()) await holder.rollback();
  }
}

async function takeTwice(t, suffix, options) {
  const database = await ownDatabase(t, suffix, options);
  if (!database) {
    t.skip("the server has no innodb_snapshot_isolation setting");
    return;
  }
  const { knex, slots } = database;
  const [id] = await slots.createMany([{ status: "open" }], { context: WORKSPACE, returning: "ids" });
  const take = (taker) => () => slots.patchWhere({ id, status: "open" }, { status: "taken", takenBy: taker }, { context: WORKSPACE, returning: "ids" });
  const outcomes = await raceOnLockedRow(knex, id, [take("first"), take("second")]);
  assert.deepEqual(outcomes.filter(({ error }) => error), [], "neither writer fails");
  assert.deepEqual(outcomes.map(({ value }) => value.length).sort(), [0, 1], "exactly one writer takes the row");
  const row = await knex("slots").where({ id }).first("status", "taken_by");
  assert.equal(row.status, "taken");
  assert.equal(row.taken_by, outcomes[0].value.length === 1 ? "first" : "second");
}

test("of two concurrent patchWhere calls whose filters both matched one row, exactly one writes it", async (t) => {
  requireTestDatabase(process.env);
  await takeTwice(t, "da_pw_race");
});

test("with innodb_snapshot_isolation on, the waiting patchWhere fails as changed since its read and runs again, leaving the row out", async (t) => {
  requireTestDatabase(process.env);
  await takeTwice(t, "da_pw_snapshot", { snapshotIsolation: true });
});

test("a deleteWhere whose filter matched a row a concurrent patchWhere changed leaves it in place", async (t) => {
  requireTestDatabase(process.env);
  const { knex, slots } = await ownDatabase(t, "da_dw_race");
  const [id] = await slots.createMany([{ status: "open" }], { context: WORKSPACE, returning: "ids" });
  const outcomes = await raceOnLockedRow(knex, id, [
    () => slots.patchWhere({ id, status: "open" }, { status: "taken", takenBy: "first" }, { context: WORKSPACE, returning: "ids" }),
    () => slots.deleteWhere({ id, status: "open" }, { context: WORKSPACE, returning: "ids" })
  ]);
  assert.deepEqual(outcomes.filter(({ error }) => error), []);
  const [patched, deleted] = outcomes.map(({ value }) => value.length);
  const row = await knex("slots").where({ id }).first("status");
  // Whichever went first wins; the other finds the row changed (or gone) and leaves it.
  assert.deepEqual([patched + deleted, row ? row.status : "deleted"], [1, patched === 1 ? "taken" : "deleted"]);
});

test("changeHorizon() throws on MySQL and MariaDB, which stamp no row with its transaction, before any statement", async (t) => {
  const { knex, slots } = await ownDatabase(t, "horizon");
  const statements = [];
  knex.on("query", ({ sql }) => statements.push(sql));
  await assert.rejects(slots.changeHorizon({ context: WORKSPACE }), UnsupportedDatabaseError);
  assert.deepEqual(statements, []);
});
