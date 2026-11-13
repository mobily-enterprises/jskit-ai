import assert from "node:assert/strict";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { createTestResourceRuntime } from "../../src/test/index.js";

// lockWhere's sort and limit, on every database the runtime supports: the rows are locked in the sort's order, then by
// id, and limit locks only the first of them, so a lock of one row by its unique key costs what lock(id) costs. Each
// database's test file runs these cases on its own connection.

const WORKSPACE_A = Object.freeze({ workspace: Object.freeze({ id: "1" }) });
const IN_WORKSPACE_A = Object.freeze({ context: WORKSPACE_A });

const slotResource = defineTableResource({
  name: "slots",
  tableName: "slots",
  ownership: "workspace",
  searchSchema: { codes: { type: "array", actualField: "code", filterOperator: "in" } },
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    code: { type: "string", required: true, search: true },
    turn: { type: "integer", required: true }
  }
});

const codeOf = (index) => `C${String(index).padStart(4, "0")}`;

/** `count` slots in each of workspaces 1 and 2, codes C0000 up, their turns in the codes' reverse order. */
async function slotsOf(knex, count) {
  await knex.schema.createTable("slots", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("code").notNullable();
    table.integer("turn").notNullable();
    table.unique(["workspace_id", "code"]);
  });
  const rows = [1, 2].flatMap((workspace) => Array.from({ length: count }, (_, index) => ({ workspace_id: workspace, code: codeOf(index), turn: count - index })));
  for (let start = 0; start < rows.length; start += 200) {
    await knex("slots").insert(rows.slice(start, start + 200));
  }
  const runtime = await createTestResourceRuntime({ knex });
  const { slots } = await runtime.own("slots.feature", [slotResource]);
  return slots;
}

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function lockWhereOrderCases(connect) {
  return [
    ["lockWhere locks and answers the rows in sort order, then id, and limit takes the first of them", async (t) => {
      const knex = await connect(t, "da_lw_order");
      const slots = await slotsOf(knex, 4);
      const codes = (rows) => rows.map(({ code }) => code);
      const every = { codes: [0, 1, 2, 3].map(codeOf) };
      await slots.withTransaction(IN_WORKSPACE_A, async (tx) => {
        assert.deepEqual(codes(await slots.lockWhere(every, { ...tx, sort: ["-code"] })), ["C0003", "C0002", "C0001", "C0000"]);
        assert.deepEqual(codes(await slots.lockWhere(every, { ...tx, sort: "-code", limit: 2 })), ["C0003", "C0002"]);
        // A limit alone takes the lowest id: one of the unique key's rows is its one row.
        assert.deepEqual(codes(await slots.lockWhere({ code: "C0001" }, { ...tx, limit: 1 })), ["C0001"]);
        assert.deepEqual(await slots.lockWhere({ code: "C9999" }, { ...tx, limit: 1 }), []);
      });
      for (const options of [{ limit: 0 }, { limit: 1001 }, { sort: ["missing"] }]) {
        await assert.rejects(slots.withTransaction(IN_WORKSPACE_A, (tx) => slots.lockWhere(every, { ...tx, ...options })),
          (error) => error.code === "REST_API_VALIDATION", JSON.stringify(options));
      }
    }],

    ["lockWhere of one row with limit: 1 sends what lock(id) sends, among 4 rows and among 400", async (t) => {
      const costs = [];
      let client;
      for (const count of [4, 400]) {
        const knex = await connect(t, `da_lw_cost_${count}`);
        client = knex.client.config.client;
        const slots = await slotsOf(knex, count);
        const [{ id }] = await knex("slots").where({ workspace_id: 1, code: "C0001" }).select("id");
        const statements = async (lock) => {
          // MySQL and MariaDB read a table's indexes once per process and set of filtered columns: not this measure.
          await slots.withTransaction(IN_WORKSPACE_A, lock);
          return slots.withTransaction(IN_WORKSPACE_A, async (tx) => {
            const { result, count: sent } = await countQueries(knex, () => lock(tx));
            assert.equal([result].flat().length, 1);
            return sent;
          });
        };
        costs.push({
          lock: await statements((tx) => slots.lock(String(id), tx)),
          "lockWhere limit 1": await statements((tx) => slots.lockWhere({ code: "C0001" }, { ...tx, limit: 1 })),
          lockWhere: await statements((tx) => slots.lockWhere({ code: "C0001" }, tx))
        });
      }
      // SQLite's first lock in a transaction takes its write lock first. Without a limit, PostgreSQL reads again
      // under its locks, for rows that started to match while it waited.
      const one = client === "better-sqlite3" ? 2 : 1;
      const expected = { lock: one, "lockWhere limit 1": one, lockWhere: client === "pg" ? 2 : one };
      assert.deepEqual(costs, [expected, expected]);
    }]
  ];
}

export { lockWhereOrderCases };
