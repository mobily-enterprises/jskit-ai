import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createTestResourceRuntime } from "../../src/test/index.js";

// Whole numbers stored in BIGINT columns that are not ids (a counter, a byte count, a read position), read through a
// handle on MariaDB/MySQL and on PostgreSQL alike. Both drivers answer BIGINT as text (mysql2 with the runtime's
// bigNumberStrings, pg for every int8); a field of type "integer" reads back as a number on every handle read, and an
// id field as text.

const WORKSPACE = Object.freeze({ workspace: { id: "1" } });
const RUNTIME_MYSQL = Object.freeze({ supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" });
// The largest whole number a JavaScript number holds exactly (2^53 - 1), and the next odd one past it.
const LARGEST_SAFE = "9007199254740991";
const PAST_SAFE = "9007199254740993";

// A PostgreSQL test on a run for another database, such as CI's MariaDB run, is left to the PostgreSQL run.
const POSTGRES_ELSEWHERE = process.env.DB_CLIENT && process.env.DB_CLIENT !== "pg"
  ? `a PostgreSQL test, on a ${process.env.DB_CLIENT} run`
  : false;

const counterResource = defineTableResource({
  name: "counters",
  tableName: "counters",
  ownership: "workspace",
  defaultSort: ["id"],
  schema: {
    id: { type: "id", primary: true },
    workspaceId: { type: "id", nullable: true, search: true, storage: { column: "workspace_id" } },
    total: { type: "integer", search: true },
    readUpTo: { type: "integer", nullable: true, storage: { column: "read_up_to" } },
    hiddenCount: { type: "integer", nullable: true, hidden: true, storage: { column: "hidden_count" } },
    lastMessageId: { type: "id", nullable: true, storage: { column: "last_message_id" } }
  }
});
const FIELDS = Object.freeze(["workspaceId", "total", "readUpTo", "hiddenCount", "lastMessageId"]);

/** A MariaDB/MySQL database of the test's own beside TEST_DB_NAME, dropped after it. */
async function mysqlKnex(context, suffix) {
  const name = `${requireTestDatabase(process.env)}_${suffix}`;
  const server = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306, user: process.env.DB_USER, password: process.env.DB_PASSWORD };
  const admin = knexLib({ client: "mysql2", connection: server, pool: { min: 0, max: 1 } });
  await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
  await admin.raw("CREATE DATABASE ??", [name]);
  const knex = knexLib({ client: "mysql2", connection: { ...server, database: name, ...RUNTIME_MYSQL }, pool: { min: 0, max: 2 } });
  context.after(async () => {
    await knex.destroy();
    await admin.raw("DROP DATABASE IF EXISTS ??", [name]);
    await admin.destroy();
  });
  return knex;
}

/** A PostgreSQL schema of the test's own in TEST_DB_NAME, dropped after it. */
async function postgresKnex(context, suffix) {
  const database = requireTestDatabase(process.env);
  const schema = `${database}_${suffix}_${process.pid}`;
  const connection = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database };
  const admin = knexLib({ client: "pg", connection, pool: { min: 0, max: 1 } });
  await admin.raw("DROP SCHEMA IF EXISTS ?? CASCADE", [schema]);
  await admin.raw("CREATE SCHEMA ??", [schema]);
  const knex = knexLib({ client: "pg", connection, searchPath: [schema], pool: { min: 0, max: 2 } });
  context.after(async () => {
    await knex.destroy();
    await admin.raw("DROP SCHEMA IF EXISTS ?? CASCADE", [schema]);
    await admin.destroy();
  });
  return knex;
}

// The record fields a test compares: their values with their types.
const typed = (record) => Object.fromEntries(
  ["id", ...FIELDS].filter((field) => Object.hasOwn(record, field)).map((field) => [field, record[field]])
);

/**
 * Registers the stored-integer tests on one database.
 * @param {"mysql" | "postgres"} dialect
 */
function storedIntegerCases(dialect) {
  const skip = dialect === "postgres" ? POSTGRES_ELSEWHERE : false;
  const openKnex = dialect === "postgres" ? postgresKnex : mysqlKnex;

  async function counters(context) {
    const knex = await openKnex(context, "stored_ints");
    await knex.schema.createTable("counters", (table) => {
      table.bigIncrements("id");
      table.bigInteger("workspace_id").nullable();
      table.bigInteger("total").notNullable();
      table.bigInteger("read_up_to").nullable();
      table.bigInteger("hidden_count").nullable();
      table.bigInteger("last_message_id").nullable();
    });
    const runtime = await createTestResourceRuntime({ knex });
    const { counters: handle } = await runtime.own("counters.feature", [counterResource]);
    return { knex, counters: handle };
  }

  test(`${dialect}: a non-id BIGINT field of type integer reads back as a number on every handle read; an id as text`, { skip }, async (context) => {
    const { counters: handle } = await counters(context);
    const options = { context: WORKSPACE };
    const expected = { id: "1", workspaceId: "1", total: 5, readUpTo: Number(LARGEST_SAFE), hiddenCount: 3, lastMessageId: "11" };

    const created = await handle.create({ workspaceId: "1", total: 5, readUpTo: Number(LARGEST_SAFE), hiddenCount: 3, lastMessageId: "11" }, options);
    const { hiddenCount, ...visible } = expected;
    assert.equal(hiddenCount, 3);
    assert.deepEqual(typed(created), visible, "create answers the stored record without its hidden field");
    assert.deepEqual(typed(await handle.get(created.id, { fields: FIELDS }, options)), expected);
    assert.deepEqual((await handle.query({ fields: FIELDS, page: { size: 10 } }, options)).records.map(typed), [expected]);
    assert.deepEqual((await handle.queryAll({ fields: FIELDS }, options)).map(typed), [expected]);
    assert.deepEqual(typed(await handle.patch(created.id, { total: 6 }, options)), { ...visible, total: 6 });
    assert.deepEqual(
      (await handle.patchMany([{ id: created.id, total: 7 }], { ...options, returning: "records" })).map(typed),
      [{ ...visible, total: 7 }]
    );
    assert.deepEqual(
      (await handle.createMany([{ workspaceId: "1", total: 8 }], { ...options, returning: "records" })).map(typed),
      [{ id: "2", workspaceId: "1", total: 8, readUpTo: null, lastMessageId: null }]
    );
    const locked = await handle.withTransaction(options, async (txOptions) => ({
      lockMany: await handle.lockMany([created.id], { ...txOptions, fields: FIELDS }),
      claim: await handle.claim({ filters: { total: 7 }, take: 1 }, { ...txOptions, fields: FIELDS })
    }));
    assert.deepEqual(locked.lockMany.map(typed), [{ ...expected, total: 7 }]);
    assert.deepEqual(locked.claim.map(typed), [{ ...expected, total: 7 }]);
    const totals = await handle.aggregate({
      measures: { total: { sum: "total" }, highest: { max: "readUpTo" }, lowest: { min: "total" }, rows: { count: "*" } }
    }, options);
    assert.deepEqual(totals.map((row) => ({ ...row })), [{ total: 15, highest: Number(LARGEST_SAFE), lowest: 7, rows: 2 }]);
  });

  test(`${dialect}: past 2^53 a stored integer keeps its digits as text, never a rounded number; scopedQuery rows are the driver's text`, { skip }, async (context) => {
    const { knex, counters: handle } = await counters(context);
    const options = { context: WORKSPACE };
    await knex("counters").insert({ workspace_id: 1, total: PAST_SAFE, read_up_to: LARGEST_SAFE, hidden_count: PAST_SAFE });

    const [record] = await handle.queryAll({ fields: FIELDS }, options);
    assert.deepEqual(typed(record), { id: "1", workspaceId: "1", total: PAST_SAFE, readUpTo: Number(LARGEST_SAFE), hiddenCount: PAST_SAFE, lastMessageId: null });

    // A report's own builder answers what the driver read: BIGINT as text on both drivers, ids and counters alike,
    // and a COUNT too, which both databases answer as a BIGINT.
    const { query } = await handle.scopedQuery({ filters: {} }, options);
    const rows = await query.select("id", "total", "read_up_to");
    assert.deepEqual(rows.map((row) => ({ ...row })), [{ id: "1", total: PAST_SAFE, read_up_to: LARGEST_SAFE }]);
    const { query: counting } = await handle.scopedQuery({ filters: {} }, options);
    assert.deepEqual((await counting.count({ rows: "*" })).map((row) => ({ ...row })), [{ rows: "1" }]);
  });
}

export { storedIntegerCases };
