import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { passedOn } from "../src/server/index.js";
import { createPackageTestKnex, createTestResourceRuntime } from "../src/test/index.js";

// SQLite in memory, or a PostgreSQL schema of its own on a DB_CLIENT=pg run (see createPackageTestKnex).
const testKnex = (t) => createPackageTestKnex(t, { environment: process.env });

// A call's settings (returning, missing, format, lockVersion...) are for that one call. What it hands on, to the work
// of a transaction, to an afterWrite hook or to the handle's own nested calls, is its context and transaction only.

const WORKSPACE = Object.freeze({ context: Object.freeze({ workspace: { id: "1" } }) });
// Every setting a caller may have spread into the options it hands on.
const SETTINGS = Object.freeze({ returning: "none", missing: "skip", format: "jsonapi", fields: ["title"], lockVersion: 3 });
const notFound = (error) => error.code === "REST_API_RESOURCE" && error.subtype === "not_found";

async function createNotes(t, hooks) {
  const knex = await testKnex(t);
  await knex.schema.createTable("notes", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("title").notNullable();
    table.integer("lock_version").notNullable().defaultTo(0);
  });
  await knex.schema.createTable("counters", (table) => {
    table.string("id").primary();
    table.integer("value").notNullable();
  });
  // lockOrCreate creates on the id alone, so it runs on a table without owners.
  const counters = defineTableResource({
    name: "counters",
    tableName: "counters",
    ownership: "public",
    schema: { id: { type: "string", primary: true }, value: { type: "integer", required: true } }
  });
  const resource = defineTableResource({
    name: "notes",
    tableName: "notes",
    ownership: "workspace",
    lockVersionField: "lockVersion",
    schema: {
      id: { type: "id", primary: true },
      workspaceId: { type: "id", nullable: true, search: true, storage: { column: "workspace_id" } },
      title: { type: "string", required: true, search: true },
      lockVersion: { type: "integer", defaultTo: 0, storage: { column: "lock_version" } }
    }
  });
  const runtime = await createTestResourceRuntime({ knex });
  const owned = await runtime.own("notes.feature", [hooks ? { resource, hooks } : resource, { normalizeId: String, resource: counters }]);
  return { notes: owned.notes, counters: owned.counters };
}

test("withTransaction's work receives the context and the transaction, never the caller's settings", async (t) => {
  const { notes } = await createNotes(t);
  const keys = await notes.withTransaction({ ...WORKSPACE, ...SETTINGS }, async (txOptions) => {
    // A create inside answers its record: an outer returning: "none" never reached it.
    const created = await notes.create({ title: "inside" }, txOptions);
    assert.equal(created.title, "inside");
    // A get of a missing record throws: an outer missing: "skip" never reached it.
    await assert.rejects(notes.get("999", {}, txOptions), notFound);
    // Inside the caller's transaction too.
    const nested = await notes.withTransaction({ ...txOptions, ...SETTINGS }, async (inner) => Object.keys(inner).sort());
    assert.deepEqual(nested, ["context", "trx"]);
    return Object.keys(txOptions).sort();
  });
  assert.deepEqual(keys, ["context", "trx"]);
  assert.deepEqual(Object.keys(passedOn({ ...WORKSPACE, ...SETTINGS })), ["context"]);
});

test("an afterWrite hook and lockOrCreate's work receive only the context and the transaction", async (t) => {
  const seen = [];
  const { notes, counters } = await createNotes(t, { afterWrite: ({ options }) => { seen.push(Object.keys(options).sort()); } });
  await notes.create({ title: "hooked" }, { ...WORKSPACE, returning: "id" });
  await notes.withTransaction(WORKSPACE, (txOptions) => notes.create({ title: "inside" }, { ...txOptions, returning: "none" }));
  assert.deepEqual(seen, [["context", "trx"], ["context", "trx"]]);

  const outside = await counters.lockOrCreate({ id: "visits", value: 0 }, { ...WORKSPACE, returning: "none" }, (row, txOptions) => Object.keys(txOptions).sort());
  assert.deepEqual(outside, ["context", "trx"]);
  const inside = await counters.withTransaction(WORKSPACE, (txOptions) => counters.lockOrCreate(
    { id: "visits", value: 5 },
    { ...txOptions, returning: "none" },
    (row, work) => [row.value, Object.keys(work).sort()]
  ));
  assert.deepEqual(inside, [0, ["context", "trx"]]);
});

test("findOrCreate answers the record under an outer returning: none, and a patch keeps its own format", async (t) => {
  const { notes } = await createNotes(t);
  const found = await notes.findOrCreate({ id: 7, title: "first" }, { ...WORKSPACE, returning: "none" });
  assert.equal(found.title, "first");
  assert.equal((await notes.findOrCreate({ id: 7, title: "again" }, { ...WORKSPACE, returning: "none" })).title, "first");

  // The patch's own settings still reach its own write and read inside the transaction it opens for its lockVersion.
  const document = await notes.patch(7, { title: "second" }, { ...WORKSPACE, lockVersion: 0, format: "jsonapi" });
  assert.equal(document.data.attributes.title, "second");
  const advanced = await notes.patch(7, {}, { ...WORKSPACE, lockVersion: 1, format: "jsonapi" });
  assert.equal(advanced.data.attributes.lockVersion, 2);
  assert.equal((await notes.patch(7, {}, { ...WORKSPACE, format: "jsonapi" })).data.id, "7");
});
