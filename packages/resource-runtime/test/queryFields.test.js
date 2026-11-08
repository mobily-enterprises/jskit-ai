import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "../src/test/index.js";

const WORKSPACE_A = Object.freeze({ workspace: { id: "1" } });

test("a query field's select gets a value-only raw, column() and the read's filters, never Knex or its context", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  await knex.schema.createTable("receivals", (table) => {
    table.increments("id");
    table.integer("workspace_id");
    table.string("status").notNullable();
    table.integer("received_weight").notNullable();
    table.integer("processed_weight");
  });
  const receivalResource = defineTableResource({
    name: "receivals",
    tableName: "receivals",
    ownership: "workspace",
    schema: {
      workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
      status: { type: "string", required: true, search: true },
      receivedWeight: { type: "integer", required: true, storage: { column: "received_weight" } },
      processedWeight: { type: "integer", nullable: true, storage: { column: "processed_weight" } },
      remainingWeight: { type: "number", storage: { virtual: true } }
    }
  });
  let tools;
  const runtime = await createTestResourceRuntime({ knex });
  const { receivals } = await runtime.own("receivals.feature", [{
    resource: receivalResource,
    queryFields: {
      remainingWeight: {
        type: "number",
        select(given) {
          tools = given;
          return given.raw("?? - coalesce(??, 0)", [given.column("receivedWeight"), given.column("processedWeight")]);
        }
      }
    }
  }]);
  const options = { context: WORKSPACE_A };
  await receivals.createMany([
    { status: "open", receivedWeight: 10, processedWeight: 4 },
    { status: "open", receivedWeight: 7 },
    { status: "closed", receivedWeight: 3, processedWeight: 3 }
  ], options);

  const open = await receivals.queryAll({ filters: { status: "open" }, fields: ["remainingWeight"] }, options);
  assert.deepEqual(open.map(({ remainingWeight }) => remainingWeight), [6, 7]);
  assert.deepEqual(Object.keys(tools).sort(), ["column", "filters", "raw"]);
  assert.equal(tools.filters.status, "open");
  assert.equal(Object.isFrozen(tools.filters), true);

  // raw takes one SQL string and its bindings as an array, and is a value only: awaited, it answers itself and runs
  // nothing; run as a statement, it throws.
  assert.throws(() => tools.raw(42), /Query field "remainingWeight" raw\(\) takes one SQL expression as a string/u);
  assert.throws(() => tools.raw("?? + 1"), /needs the bindings of its placeholders/u);
  assert.throws(() => tools.raw("? + 1", { value: 1 }), /takes \(sql, bindings\)/u);
  assert.throws(() => tools.raw("? + 1", [1], "extra"), /takes \(sql, bindings\)/u);
  const statement = tools.raw("DELETE FROM receivals");
  assert.equal(await statement, statement);
  assert.throws(() => statement.asCallback(() => {}), /is a value inside a scoped query or a write/u);
  assert.equal((await knex("receivals")).length, 3);
});
