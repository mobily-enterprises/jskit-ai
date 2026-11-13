import assert from "node:assert/strict";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createResourceHost } from "../../src/server/resourceHost.js";
import { createResourceRuntime } from "../../src/server/resourceRuntime.js";

// lockWhere's sort and limit, on every database the runtime supports: the rows are locked in the sort's order, then by
// id, and limit locks only the first of them, so a lock of one row by its unique key costs what lock(id) costs. And
// lockPages, which locks every row a page at a time in id order, each page one locking read that sees the latest rows.
// Each database's test file runs these cases on its own connection.

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

/**
 * `count` slots in each of workspaces 1 and 2, codes C0000 up, their turns in the codes' reverse order, and a system
 * scope for background work on them.
 * @param {import("knex").Knex} knex
 * @param {number} count
 * @param {{ requestRowLimit?: number }} [settings]
 */
async function slotsOf(knex, count, settings = {}) {
  await knex.schema.createTable("slots", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("code").notNullable();
    table.integer("turn").notNullable();
    table.unique(["workspace_id", "code"]);
    // An index that reads a workspace's rows in id order, which lockPages needs on MySQL and MariaDB.
    table.index(["workspace_id"], "slots_workspace");
  });
  const rows = [1, 2].flatMap((workspace) => Array.from({ length: count }, (_, index) => ({ workspace_id: workspace, code: codeOf(index), turn: count - index })));
  for (let start = 0; start < rows.length; start += 200) {
    await knex("slots").insert(rows.slice(start, start + 200));
  }
  const api = await createResourceHost({ knex, logger: silentLogger });
  const runtime = createResourceRuntime({ api, ...settings });
  const { slots } = await runtime.own("slots.feature", [slotResource]);
  const system = runtime.declareSystemScope("slots.feature", "count every workspace's slots")("count the slots");
  return { slots, system, api };
}

/** Every page lockPages answers. Past 10 pages it throws, so a lockPages that never ends fails its case at once. */
async function pagesOf(pages) {
  const all = [];
  for await (const page of pages) {
    all.push(page);
    if (all.length > 10) {
      throw new Error("lockPages answered more than 10 pages: its pages never end");
    }
  }
  return all;
}

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function lockWhereOrderCases(connect) {
  return [
    ["lockWhere locks and answers the rows in sort order, then id, and limit takes the first of them", async (t) => {
      const knex = await connect(t, "da_lw_order");
      const { slots } = await slotsOf(knex, 4);
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
        const { slots } = await slotsOf(knex, count);
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
    }],

    ["lockPages locks every row a page at a time in id order, the same statements for 3 pages among 25 rows and 250", async (t) => {
      const sizes = [];
      for (const [count, pageSize] of [[25, 10], [250, 100]]) {
        const knex = await connect(t, `da_lp_pages_${count}`);
        const { slots } = await slotsOf(knex, count);
        const lockAll = (tx) => pagesOf(slots.lockPages({}, { ...tx, pageSize, fields: ["code"] }));
        // MySQL and MariaDB read a table's indexes once per process and set of filtered columns: not this measure.
        await slots.withTransaction(IN_WORKSPACE_A, lockAll);
        const { result: pages, count: statements } = await slots.withTransaction(IN_WORKSPACE_A, (tx) => countQueries(knex, () => lockAll(tx)));
        assert.deepEqual(pages.flat().map(({ code }) => code), Array.from({ length: count }, (_, index) => codeOf(index)));
        sizes.push({ pages: pages.map((page) => page.length), statements });
      }
      assert.deepEqual(sizes.map(({ pages }) => pages), [[10, 10, 5], [100, 100, 50]]);
      assert.equal(sizes[1].statements, sizes[0].statements);
    }],

    ["lockPages locks the rows committed since the transaction first read plainly", async (t) => {
      const knex = await connect(t, "da_lp_current");
      if (knex.client.config.client === "better-sqlite3") {
        t.skip("SQLite has one writer, so no row commits while the transaction is open");
        return;
      }
      const { slots } = await slotsOf(knex, 3);
      const codes = await slots.withTransaction(IN_WORKSPACE_A, async (tx) => {
        // A plain read first: on MySQL and MariaDB it fixes the transaction's snapshot.
        assert.equal((await slots.queryAll({}, tx)).length, 3);
        await knex("slots").insert({ workspace_id: 1, code: "C0100", turn: 0 });
        return (await pagesOf(slots.lockPages({}, { ...tx, pageSize: 2 }))).flat().map(({ code }) => code);
      });
      assert.deepEqual(codes, ["C0000", "C0001", "C0002", "C0100"]);
    }],

    ["lockPages throws at the request row limit, locks without one in background work, and refuses sort, limit and a bad pageSize", async (t) => {
      const knex = await connect(t, "da_lp_limit");
      const { slots, system } = await slotsOf(knex, 7, { requestRowLimit: 5 });
      const read = [];
      await assert.rejects(slots.withTransaction(IN_WORKSPACE_A, async (tx) => {
        for await (const page of slots.lockPages({}, { ...tx, pageSize: 3 })) {
          read.push(page.length);
        }
      }), (error) => error.code === "RESOURCE_ROW_LIMIT" && /slots\.lockPages\(\) read more than 5 rows inside a request/u.test(error.message));
      assert.deepEqual(read, [3]);
      const job = await slots.withTransaction({ context: system.forWorkspace("1") }, (tx) => pagesOf(slots.lockPages({}, { ...tx, pageSize: 3 })));
      assert.deepEqual(job.map((page) => page.length), [3, 3, 1]);
      for (const options of [{ sort: ["code"] }, { limit: 2 }, { pageSize: 0 }, { pageSize: 1001 }, { pageSize: 1.5 }]) {
        await assert.rejects(slots.withTransaction(IN_WORKSPACE_A, (tx) => pagesOf(slots.lockPages({}, { ...tx, ...options }))),
          (error) => error instanceof TypeError && /slots\.lockPages\(\)/u.test(error.message), JSON.stringify(options));
      }
    }],

    ["lockPages throws, rather than page forever, when its storage answers the page before again", async (t) => {
      const knex = await connect(t, "da_lp_stuck");
      const { slots, system, api } = await slotsOf(knex, 4);
      // A storage whose lockWhere ignores after, as json-rest-api's did before it took after, in background work,
      // which has no row limit to stop it.
      const storage = api.resources.slots;
      const lockWhere = storage.lockWhere;
      storage.lockWhere = (params, context) => lockWhere.call(storage, { ...params, after: undefined }, context);
      const read = [];
      await assert.rejects(slots.withTransaction({ context: system.forWorkspace("1") }, async (tx) => {
        for await (const page of slots.lockPages({}, { ...tx, pageSize: 2 })) {
          read.push(page.map(({ code }) => code));
          if (read.length > 10) {
            throw new Error("lockPages answered more than 10 pages: its pages never end");
          }
        }
      }), /slots\.lockPages\(\) read the row "2" again in the page after it/u);
      assert.deepEqual(read, [["C0000", "C0001"]]);
    }]
  ];
}

export { lockWhereOrderCases };
