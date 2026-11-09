import assert from "node:assert/strict";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { createTestResourceRuntime } from "../../src/test/index.js";

// A locking read's include, on every database the runtime supports: lock, lockMany, lockWhere and claim lock the
// records their rows name too, after their own rows, through each related table's own handle, and answer them nested
// as a read's include does. Each database's test file runs these cases on its own connection.

const WORKSPACE_A = Object.freeze({ workspace: Object.freeze({ id: "1" }) });
const inRequest = (caller) => caller.kind === "user" || caller.kind === "anonymous";

const yardResource = defineTableResource({
  name: "yards",
  tableName: "yards",
  ownership: "public",
  schema: { name: { type: "string", required: true } }
});
const batchResource = defineTableResource({
  name: "batches",
  tableName: "batches",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    yardId: { type: "id", nullable: true, belongsTo: "yards", as: "yard", storage: { column: "yard_id" } },
    stage: { type: "string", required: true },
    archived: { type: "boolean", defaultTo: false },
    grader: { type: "string", nullable: true, hidden: true },
    slots: { type: "array", storage: { virtual: true }, relation: { kind: "collection", namespace: "slots", foreignKey: "batchId" } }
  }
});
const slotResource = defineTableResource({
  name: "slots",
  tableName: "slots",
  ownership: "workspace",
  searchSchema: { codes: { type: "array", actualField: "code", filterOperator: "in" } },
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    batchId: { type: "id", nullable: true, belongsTo: "batches", as: "batch", storage: { column: "batch_id" } },
    code: { type: "string", required: true }
  }
});

/**
 * Yard North; workspace 1's batches 1 (drying, at North) and 2 (archived, which only background work sees); its slots
 * A (batch 1), B (batch 2), C (batch 1) and D (no batch).
 */
async function slotsAndBatches(knex) {
  await knex.schema.createTable("yards", (table) => {
    table.increments("id");
    table.string("name").notNullable();
  });
  await knex.schema.createTable("batches", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.integer("yard_id").nullable();
    table.string("stage").notNullable();
    table.boolean("archived").notNullable().defaultTo(false);
    table.string("grader").nullable();
  });
  await knex.schema.createTable("slots", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.integer("batch_id").nullable();
    table.string("code").notNullable();
    table.index(["workspace_id", "code"]);
  });
  await knex("yards").insert({ name: "North" });
  await knex("batches").insert([
    { workspace_id: 1, yard_id: 1, stage: "drying", archived: false, grader: "lee" },
    { workspace_id: 1, yard_id: null, stage: "done", archived: true }
  ]);
  await knex("slots").insert([
    { workspace_id: 1, batch_id: 1, code: "A" },
    { workspace_id: 1, batch_id: 2, code: "B" },
    { workspace_id: 1, batch_id: 1, code: "C" },
    { workspace_id: 1, batch_id: null, code: "D" }
  ]);
  const runtime = await createTestResourceRuntime({ knex });
  const { yards, batches, slots } = await runtime.own("drying.feature", [yardResource, {
    resource: batchResource,
    rowPolicy: ({ query, column, caller }) => {
      if (inRequest(caller)) query.where(column("archived"), false);
      return true;
    }
  }, slotResource]);
  const job = runtime.declareSystemScope("drying.feature", "settle every workspace's batches")("settle").forWorkspace("1");
  return { yards, batches, slots, job: { context: job } };
}

// The tables each statement reads, in order: SELECTs and the locks' own.
const tablesOf = (queries) => queries.map((sql) => [...sql.matchAll(/from [`"](\w+)[`"]/giu)].map(([, table]) => table)[0]).filter(Boolean);

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function lockIncludesCases(connect) {
  return [
    ["a lock's include answers what a read's include answers, locking each included type once, after the lock's own rows", async (t) => {
      const knex = await connect(t, "da_li_same");
      const { slots } = await slotsAndBatches(knex);
      const request = { context: WORKSPACE_A };
      const ids = ["1", "2", "3", "4"];
      for (const include of [["batch"], ["batch.yard"], "batch.yard"]) {
        const read = await slots.queryAll({ filters: { id: ids }, include }, request);
        const { result: locked, queries } = await countQueries(knex, () => slots.withTransaction(request, (tx) => slots.lockMany(ids, { ...tx, include })));
        assert.deepEqual(locked, read, JSON.stringify(include));
        // The lock, the links it holds, then the batches it names, locked through their own handle; with the yards
        // included, the batches' links too. The yards are read once: their lock, or the check that each batch's yard is
        // one the caller sees, as any read of a batch's yardId makes.
        const reads = tablesOf(queries);
        const seen = `${JSON.stringify(include)}: ${reads.join(", ")}`;
        assert.deepEqual(reads.slice(0, 3), ["slots", "slots", "batches"], seen);
        assert.equal(reads.filter((table) => table === "batches").length, JSON.stringify(include).includes("yard") ? 2 : 1, seen);
        assert.equal(reads.filter((table) => table === "yards").length, 1, seen);
      }
      // A slot of the archived batch reads it as a link the caller may not see, as the read does.
      const [slotB] = await slots.withTransaction(request, (tx) => slots.lockMany(["2"], { ...tx, include: ["batch"] }));
      assert.deepEqual(slotB, { id: "2", workspaceId: 1, batchId: null, batch: undefined, code: "B" });
    }],

    ["lock, lockWhere and claim include too, with the fields the call names, and background work sees what a request may not", async (t) => {
      const knex = await connect(t, "da_li_calls");
      const { slots, job } = await slotsAndBatches(knex);
      const request = { context: WORKSPACE_A };
      const one = await slots.withTransaction(request, (tx) => slots.lock("1", { ...tx, fields: ["code"], include: ["batch"] }));
      assert.deepEqual(one, { id: "1", code: "A", batchId: "1", batch: { id: "1", workspaceId: 1, yardId: "1", stage: "drying", archived: false } });
      const where = await slots.withTransaction(request, (tx) => slots.lockWhere({ codes: ["B", "C", "D"] }, { ...tx, fields: ["code"], include: "batch" }));
      assert.deepEqual(where.map(({ code, batchId, batch }) => [code, batchId, batch?.stage ?? null]), [["B", null, null], ["C", "1", "drying"], ["D", null, null]]);
      const claimed = await slots.withTransaction(job, (tx) => slots.claim({ filters: { codes: ["B"] }, include: ["batch"] }, { ...tx, fields: ["code"] }));
      assert.deepEqual(claimed.map(({ code, batchId, batch }) => [code, batchId, batch?.stage]), [["B", "2", "done"]]);
      const claimedToo = await slots.withTransaction(job, (tx) => slots.claim({ filters: { codes: ["B"] } }, { ...tx, fields: ["code"], include: ["batch"] }));
      assert.deepEqual(claimedToo, claimed);
      // An included record leaves out its hidden fields, as any read does.
      assert.equal(Object.hasOwn(one.batch, "grader"), false);
      // include: [] includes nothing, as a read's does.
      assert.deepEqual(await slots.withTransaction(request, (tx) => slots.lock("1", { ...tx, fields: ["code"], include: [] })), { id: "1", code: "A" });
    }],

    ["a lock refuses, before any statement, an include that is no belongs-to relationship, and claim's include named twice", async (t) => {
      const knex = await connect(t, "da_li_refused");
      const { batches, slots } = await slotsAndBatches(knex);
      const request = { context: WORKSPACE_A };
      const { count } = await countQueries(knex, () => batches.withTransaction(request, async (tx) => {
        await assert.rejects(batches.lock("1", { ...tx, include: ["slots"] }),
          /^TypeError: batches\.lock\(\) includes "slots", which is no belongs-to relationship of batches: a lock includes only the records its rows name/u);
        await assert.rejects(slots.lockMany(["1"], { ...tx, include: ["nothing"] }), /slots\.lockMany\(\) includes "nothing", which is no belongs-to relationship/u);
        await assert.rejects(slots.claim({ filters: { codes: ["A"] }, include: ["batch"] }, { ...tx, include: ["batch"] }),
          /slots\.claim\(\) takes include once: in its params or in its options, not both/u);
      }));
      // The transaction's own BEGIN and COMMIT, where the database sends them; no read.
      assert.ok(count <= 2, `statements: ${count}`);
    }]
  ];
}

export { lockIncludesCases };
