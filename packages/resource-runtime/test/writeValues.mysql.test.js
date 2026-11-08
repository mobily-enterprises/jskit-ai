import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createTestResourceRuntime } from "../src/test/index.js";

// Values a handle writes and compares on MySQL or MariaDB: timestamps a job sets itself, with milliseconds, on a
// table that stores whole seconds, and a patch's onlyIf with no changes, compared in SQL.

const WORKSPACE = Object.freeze({ workspace: { id: "1" } });
const RUNTIME_MYSQL = Object.freeze({ supportBigNumbers: true, bigNumberStrings: true, dateStrings: ["DATE"], timezone: "Z" });

const eventResource = defineTableResource({
  name: "events",
  tableName: "events",
  ownership: "workspace",
  defaultSort: ["id"],
  schema: {
    id: { type: "id", primary: true },
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    ownerUserId: { type: "id", nullable: true, storage: { column: "owner_user_id" } },
    title: { type: "string", required: true },
    secret: { type: "string", nullable: true, hidden: true },
    createdAt: { type: "dateTime", temporalPrecision: 0, readOnly: true, storage: { column: "created_at" } },
    updatedAt: { type: "dateTime", temporalPrecision: 0, readOnly: true, storage: { column: "updated_at" } }
  }
});

/** A database of the test's own beside TEST_DB_NAME, with one events table storing whole seconds, dropped after it. */
async function ownDatabase(context, suffix) {
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
  await knex.schema.createTable("events", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.integer("owner_user_id").nullable();
    table.string("title").notNullable();
    table.string("secret").nullable();
    table.datetime("created_at", { precision: 0 }).notNullable();
    table.datetime("updated_at", { precision: 0 }).notNullable();
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { events } = await runtime.own("events.feature", [eventResource]);
  const job = runtime.declareSystemScope("events.feature", "import past events")("import the events");
  return { knex, events, job };
}

// The stored timestamps of a row, as UTC text.
async function storedTimes(knex, id) {
  const row = await knex("events").where({ id }).first("created_at", "updated_at");
  return [row.created_at.toISOString(), row.updated_at.toISOString()];
}

test("a job's own timestamps with milliseconds are stored to the whole second on a temporalPrecision 0 table", async (t) => {
  const { knex, events, job } = await ownDatabase(t, "job_stamps");
  const options = { context: job };
  // A job's Date#toISOString(): its milliseconds are cut, as the handle cuts its own stamps, never rounded up.
  const created = await events.create(
    { workspaceId: "1", title: "imported", createdAt: "2026-01-02T03:04:05.956Z", updatedAt: "2026-01-02T03:04:06.250Z" },
    options
  );
  assert.deepEqual(await storedTimes(knex, created.id), ["2026-01-02T03:04:05.000Z", "2026-01-02T03:04:06.000Z"]);
  await events.patch(created.id, { title: "renamed", updatedAt: "2026-02-03T04:05:06.999Z" }, options);
  assert.deepEqual(await storedTimes(knex, created.id), ["2026-01-02T03:04:05.000Z", "2026-02-03T04:05:06.000Z"]);

  const ids = await events.createMany([
    { workspaceId: "1", title: "a", createdAt: "2026-03-04T05:06:07.123Z", updatedAt: "2026-03-04T05:06:07.123Z" },
    { workspaceId: "1", title: "b", createdAt: "2026-03-04T05:06:08.987Z", updatedAt: "2026-03-04T05:06:08.987Z" }
  ], { ...options, returning: "ids" });
  assert.deepEqual(await storedTimes(knex, ids[1]), ["2026-03-04T05:06:08.000Z", "2026-03-04T05:06:08.000Z"]);
  await events.patchMany([{ id: ids[0], updatedAt: "2026-04-05T06:07:08.765Z" }], options);
  assert.deepEqual(await storedTimes(knex, ids[0]), ["2026-03-04T05:06:07.000Z", "2026-04-05T06:07:08.000Z"]);
  await events.patchWhere({ id: ids[1] }, { updatedAt: "2026-05-06T07:08:09.5Z" }, options);
  assert.deepEqual(await storedTimes(knex, ids[1]), ["2026-03-04T05:06:08.000Z", "2026-05-06T07:08:09.000Z"]);

  // A request's timestamps are the handle's, whole seconds too.
  const requested = await events.create({ workspaceId: "1", title: "asked" }, { context: WORKSPACE });
  const [requestCreated] = await storedTimes(knex, requested.id);
  assert.match(requestCreated, /\.000Z$/u);
});

test("a patch with onlyIf and no changes compares in SQL: an id given as a number or as text, and a hidden field, match", async (t) => {
  const { events } = await ownDatabase(t, "only_if");
  const options = { context: WORKSPACE };
  const event = await events.create({ title: "talk", ownerUserId: "7", secret: "s1" }, options);
  // A record never answers the hidden secret, so only SQL can compare it.
  assert.equal(Object.hasOwn(event, "secret"), false);
  for (const missing of ["throw", "skip"]) {
    const call = { ...options, missing };
    // The id compares whether the caller gives it as a number or as text, however the record answers it.
    assert.equal((await events.patch(event.id, {}, { ...call, onlyIf: { ownerUserId: 7 } }))?.id, event.id, missing);
    assert.equal((await events.patch(event.id, {}, { ...call, onlyIf: { ownerUserId: "7" } }))?.id, event.id, missing);
    assert.equal((await events.patch(event.id, {}, { ...call, onlyIf: { ownerUserId: "7", secret: "s1" } }))?.id, event.id, missing);
    assert.equal(await events.patch(event.id, {}, { ...call, onlyIf: { ownerUserId: 8 } }), null, missing);
    assert.equal(await events.patch(event.id, {}, { ...call, onlyIf: { secret: "other" } }), null, missing);
    assert.equal(await events.patch(event.id, {}, { ...call, onlyIf: { secret: null } }), null, missing);
    assert.equal(await events.patch(event.id, {}, { ...call, onlyIf: { title: "talk" }, returning: "id" }), event.id, missing);
  }
  // Another workspace's caller does not see the record, whatever onlyIf holds.
  assert.equal(await events.patch(event.id, {}, { context: { workspace: { id: "2" } }, missing: "skip", onlyIf: { ownerUserId: 7 } }), null);
});
