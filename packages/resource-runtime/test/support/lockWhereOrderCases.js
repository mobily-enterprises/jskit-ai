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

/**
 * Every page lockPages answers. Past `most` pages it throws, so a lockPages that never ends fails its case at once.
 * @param {AsyncIterable<object[]>} pages
 * @param {number} [most]
 */
async function pagesOf(pages, most = 10) {
  const all = [];
  for await (const page of pages) {
    all.push(page);
    if (all.length > most) {
      throw new Error(`lockPages answered more than ${most} pages: its pages never end`);
    }
  }
  return all;
}

// The links of actions, many to an action, as an export reads every link of a list of actions.
const linkResource = defineTableResource({
  name: "links",
  tableName: "links",
  ownership: "workspace",
  searchSchema: { actionIds: { type: "array", actualField: "actionId", filterOperator: "in" } },
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    actionId: { type: "integer", required: true, storage: { column: "action_id" } },
    target: { type: "string", required: true }
  }
});

/**
 * `perAction` links of each of `actions` actions in workspaces 1 and 2, inserted a link of every action at a time, so
 * an action's links are spread over the ids. Each link's target is `T<action>-<link>`.
 * @param {import("knex").Knex} knex
 * @param {number} actions
 * @param {number} perAction
 */
async function linksOf(knex, actions, perAction) {
  await knex.schema.createTable("links", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.integer("action_id").notNullable();
    table.string("target").notNullable();
    // lockPages in id order reads a workspace's rows in id order; by the action, each listed action's rows.
    table.index(["workspace_id"], "links_workspace");
    table.index(["workspace_id", "action_id"], "links_workspace_action");
  });
  const rows = [];
  for (let link = 0; link < perAction; link += 1) {
    for (let action = 1; action <= actions; action += 1) {
      rows.push(...[1, 2].map((workspace) => ({ workspace_id: workspace, action_id: action, target: `T${action}-${link}` })));
    }
  }
  for (let start = 0; start < rows.length; start += 200) {
    await knex("links").insert(rows.slice(start, start + 200));
  }
  const api = await createResourceHost({ knex, logger: silentLogger });
  const runtime = createResourceRuntime({ api });
  const { links } = await runtime.own("links.feature", [linkResource]);
  return { links };
}

// A row another transaction holds, as FOR UPDATE NOWAIT reports it: PostgreSQL 55P03, MySQL ER_LOCK_NOWAIT and MariaDB
// ER_LOCK_WAIT_TIMEOUT.
const isHeld = (error) => error?.code === "55P03" || /^ER_LOCK_(NOWAIT|WAIT_TIMEOUT)$/u.test(String(error?.code));

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
    }],

    ["lockPages with pageBy locks a list's rows by its column, then id, each once, the same statements among 30 actions and 300", async (t) => {
      // Ten listed actions of five links each; pages of 7 end inside an action's links, whose rest the next page takes.
      const listed = Array.from({ length: 10 }, (_, index) => (index + 1) * 3);
      const expected = listed.flatMap((action) => [0, 1, 2, 3, 4].map((link) => `T${action}-${link}`));
      const sizes = [];
      for (const actions of [30, 300]) {
        const knex = await connect(t, `da_lp_by_${actions}`);
        const { links } = await linksOf(knex, actions, 5);
        const lockListed = (tx) => pagesOf(links.lockPages({ actionIds: listed }, { ...tx, pageBy: "actionIds", pageSize: 7, fields: ["target"] }), 40);
        // MySQL and MariaDB read a table's indexes once per process and set of filtered columns: not this measure.
        await links.withTransaction(IN_WORKSPACE_A, lockListed);
        const { result: pages, count: statements } = await links.withTransaction(IN_WORKSPACE_A, (tx) => countQueries(knex, () => lockListed(tx)));
        assert.deepEqual(pages.flat().map(({ target }) => target), expected);
        sizes.push({ pages: pages.map((page) => page.length), statements });
      }
      assert.deepEqual(sizes.map(({ pages }) => pages), [[7, 3, 7, 3, 7, 3, 7, 3, 7, 3], [7, 3, 7, 3, 7, 3, 7, 3, 7, 3]]);
      assert.equal(sizes[1].statements, sizes[0].statements);

      const knex = await connect(t, "da_lp_by_refusals");
      const { links } = await linksOf(knex, 3, 2);
      await links.withTransaction(IN_WORKSPACE_A, async (tx) => {
        assert.deepEqual(await pagesOf(links.lockPages({ actionIds: [] }, { ...tx, pageBy: "actionIds" })), []);
        for (const [filters, pageBy] of [[{ actionIds: [1] }, "target"], [{ actionIds: [1] }, "missing"], [{ actionIds: 1 }, "actionIds"], [{}, "actionIds"]]) {
          await assert.rejects(pagesOf(links.lockPages(filters, { ...tx, pageBy })),
            (error) => error instanceof TypeError && /links\.lockPages\(\) pageBy names a filter/u.test(error.message), JSON.stringify([filters, pageBy]));
        }
      });
    }],

    ["lockPages with pageBy holds the listed values' rows and no other; in id order MySQL and MariaDB hold the rows between them too", async (t) => {
      const knex = await connect(t, "da_lp_by_held");
      const client = knex.client.config.client;
      if (client === "better-sqlite3") {
        t.skip("SQLite takes no row locks");
        return;
      }
      const { links } = await linksOf(knex, 12, 5);
      const idsOf = async (actions) => (await knex("links").where({ workspace_id: 1 }).whereIn("action_id", actions).orderBy("id").select("id")).map(({ id }) => id);
      const listed = [3, 6, 9];
      const listedIds = await idsOf(listed);
      const unlistedIds = await idsOf([4, 7, 10]);
      const free = (id) => knex.transaction((probe) => probe("links").where({ id }).forUpdate().noWait().select("id"))
        .then(() => true, (error) => {
          if (isHeld(error)) return false;
          throw error;
        });
      const held = (lockMode, pageBy) => links.withTransaction(IN_WORKSPACE_A, async (tx) => {
        const rows = (await pagesOf(links.lockPages({ actionIds: listed }, { ...tx, ...(pageBy ? { pageBy } : {}), pageSize: 4, lockMode, fields: ["target"] }), 40)).flat();
        assert.equal(rows.length, listedIds.length);
        const count = async (ids) => {
          let busy = 0;
          for (const id of ids) busy += (await free(id)) ? 0 : 1;
          return busy;
        };
        return { listed: await count(listedIds), unlisted: await count(unlistedIds) };
      });
      for (const lockMode of ["share", "update"]) {
        assert.deepEqual(await held(lockMode, "actionIds"), { listed: listedIds.length, unlisted: 0 }, lockMode);
      }
      // In id order the read follows the workspace's rows by id, so InnoDB locks every row of it it passes.
      const byId = await held("share", undefined);
      t.diagnostic(`in id order: ${byId.listed} listed rows held, ${byId.unlisted} of ${unlistedIds.length} unlisted rows held`);
      assert.equal(byId.listed, listedIds.length);
      if (client === "mysql2") {
        assert.ok(byId.unlisted > 0, "MySQL and MariaDB lock the unlisted rows an id-order read passes");
      } else {
        assert.equal(byId.unlisted, 0);
      }
    }]
  ];
}

export { lockWhereOrderCases };
