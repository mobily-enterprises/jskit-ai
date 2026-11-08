import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { isDuplicateEntryError, retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { createTestResourceRuntime } from "../src/test/index.js";

const WORKSPACE_A = Object.freeze({ workspace: { id: "1" } });

// Requests keyed by a request key, unique in each workspace: a repeated request finds its first answer by the key.
async function createRequestFixture(t) {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("requests", (table) => {
    table.increments("id");
    table.integer("workspace_id").notNullable();
    table.string("request_key").notNullable();
    table.integer("amount").notNullable();
    table.unique(["workspace_id", "request_key"]);
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { requests } = await runtime.own("requests.feature", [defineTableResource({
    name: "requests",
    tableName: "requests",
    ownership: "workspace",
    schema: {
      workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
      requestKey: { type: "string", required: true, search: true, storage: { column: "request_key" } },
      amount: { type: "integer", required: true }
    }
  })]);
  return { knex, requests };
}

test("retryLostInsertRace runs a transaction whose insert lost a unique race once more, and the rerun finds the winner", async (t) => {
  const { knex, requests } = await createRequestFixture(t);
  const options = { context: WORKSPACE_A };
  // The winner commits after this request looked its key up: the first run reads no row, as a snapshot taken before
  // that commit does, so its insert fails on the key and its transaction rolls back.
  await requests.create({ requestKey: "k", amount: 5 }, options);
  let runs = 0;
  const answer = await retryLostInsertRace(options, () => requests.withTransaction(options, async (txOptions) => {
    runs += 1;
    const [existing] = runs === 1 ? [] : await requests.queryAll({ filters: { requestKey: "k" }, fields: ["amount"] }, txOptions);
    if (existing) {
      return existing;
    }
    await requests.create({ requestKey: "k", amount: 9 }, { ...txOptions, returning: "none" });
    return null;
  }));
  assert.equal(runs, 2);
  assert.equal(answer.amount, 5);
  assert.deepEqual(await knex("requests").pluck("amount"), [5]);

  // Inside the caller's transaction the failed insert fails that transaction: nothing runs again, and the caller
  // gets the duplicate.
  runs = 0;
  await assert.rejects(requests.withTransaction(options, (outer) => retryLostInsertRace(outer, () => requests.withTransaction(outer, (txOptions) => {
    runs += 1;
    return requests.create({ requestKey: "k", amount: 1 }, { ...txOptions, returning: "none" });
  }))), (error) => isDuplicateEntryError(error));
  assert.equal(runs, 1);
  assert.deepEqual(await knex("requests").pluck("amount"), [5]);
});
