import assert from "node:assert/strict";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { GroupLimitError, RowLimitError } from "../../src/server/index.js";
import { createTestResourceRuntime } from "../../src/test/index.js";

// Reads larger than one statement answers, on every database the runtime supports: queryPages() and its request row
// limit, and a grouped aggregate's group limit. Each database's test file runs these cases on its own connection.

const WORKSPACE_A = Object.freeze({ workspace: Object.freeze({ id: "1" }) });
const WORKSPACE_B = Object.freeze({ workspace: Object.freeze({ id: "2" }) });

// Notes whose pages hold 3 rows, as do a grouped aggregate's, and of which a request reads at most 5. json-rest-api's
// own default page, 2, is smaller than the most a statement answers.
const noteResource = defineTableResource({
  name: "notes",
  tableName: "notes",
  ownership: "workspace",
  queryDefaultLimit: 2,
  queryMaxLimit: 3,
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    title: { type: "string", required: true, search: true },
    status: { type: "string", defaultTo: "open", search: true }
  }
});

async function createNotes(knex) {
  await knex.schema.createTable("notes", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("title").notNullable();
    table.string("status").notNullable().defaultTo("open");
  });
  const runtime = await createTestResourceRuntime({ knex, serverPageSize: 3, requestRowLimit: 5 });
  const { notes } = await runtime.own("notes.feature", [noteResource]);
  const system = runtime.declareSystemScope("notes.feature", "settle every workspace's notes")("settle the notes");
  return { notes, system };
}

async function pagesOf(pages) {
  const read = [];
  for await (const records of pages) {
    read.push(records.map(({ title }) => title));
  }
  return read;
}

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function pagedReadsCases(connect) {
  return [
    ["queryPages() hands every row over a server page at a time, one statement each, and a write between pages that changes what the filters match skips none", async (t) => {
      const knex = await connect(t, "da_pr_pages");
      const { notes, system } = await createNotes(knex);
      await notes.createMany(Array.from({ length: 7 }, (_, index) => ({ title: `n${index}` })), { context: WORKSPACE_A, returning: "none" });
      await notes.createMany([{ title: "theirs" }], { context: WORKSPACE_B, returning: "none" });
      const job = { context: system.forWorkspace("1") };

      const { result: pages, count } = await countQueries(knex, () => pagesOf(notes.queryPages({ filters: { status: "open" }, fields: ["title"] }, job)));
      assert.deepEqual(pages, [["n0", "n1", "n2"], ["n3", "n4", "n5"], ["n6"]]);
      assert.equal(count, 3);

      // A job settles each page as it reads it: the next page starts after the last row read, not at an offset the
      // settled rows moved.
      const settled = await notes.withTransaction(job, async (tx) => {
        const titles = [];
        for await (const records of notes.queryPages({ filters: { status: "open" }, fields: ["title"] }, tx)) {
          await notes.patchWhere({ id: records.map(({ id }) => id) }, { status: "done" }, tx);
          titles.push(...records.map(({ title }) => title));
        }
        return titles;
      });
      assert.deepEqual(settled, ["n0", "n1", "n2", "n3", "n4", "n5", "n6"]);
      assert.deepEqual(await pagesOf(notes.queryPages({ filters: { status: "open" } }, job)), []);
      assert.deepEqual(await pagesOf(notes.queryPages({}, { context: WORKSPACE_B })), [["theirs"]]);
      // A filter that matches no row reads nothing.
      const none = await countQueries(knex, () => pagesOf(notes.queryPages({ filters: { id: [] } }, job)));
      assert.deepEqual([none.result, none.count], [[], 0]);
    }],

    ["queryPages() in a request throws at the request row limit instead of answering the page that passes it; pageLimits() names the limit", async (t) => {
      const knex = await connect(t, "da_pr_limit");
      const { notes } = await createNotes(knex);
      await notes.createMany(Array.from({ length: 7 }, (_, index) => ({ title: `n${index}` })), { context: WORKSPACE_A, returning: "none" });
      assert.deepEqual(notes.pageLimits(), { request: 3, server: 3, requestRows: 5 });
      const read = [];
      await assert.rejects(async () => {
        for await (const records of notes.queryPages({ fields: ["title"] }, { context: WORKSPACE_A })) {
          read.push(records.length);
        }
      }, (error) => error instanceof RowLimitError && error.status === 400 && error.code === "RESOURCE_ROW_LIMIT" &&
        error.messageParams.rowLimit === 5 && /notes\.queryPages\(\) read more than 5 rows inside a request\. .*queryPages\(\) reads them a page at a time/u.test(error.message));
      assert.deepEqual(read, [3]);
      await assert.rejects(notes.queryAll({}, { context: WORKSPACE_A }), /notes\.queryAll\(\) read more than 5 rows/u);
      await assert.rejects(pagesOf(notes.queryPages({ page: { size: 2 } }, { context: WORKSPACE_A })), /notes\.queryPages\(\) does not take page/u);
    }],

    ["a grouped aggregate without a page answers every group one statement holds and throws past them, never part; a page answers its groups", async (t) => {
      const knex = await connect(t, "da_pr_groups");
      const { notes } = await createNotes(knex);
      const options = { context: WORKSPACE_A };
      await notes.createMany(["a", "b", "b", "c"].map((status, index) => ({ title: `n${index}`, status })), { ...options, returning: "none" });
      const byStatus = { groupBy: ["status"], measures: { notes: { count: "*" } }, sort: ["status"] };

      // Three groups, more than json-rest-api's default page of two, in one statement.
      const { result: groups, count } = await countQueries(knex, () => notes.aggregate(byStatus, options));
      assert.deepEqual(groups, [{ status: "a", notes: 1 }, { status: "b", notes: 2 }, { status: "c", notes: 1 }]);
      assert.equal(count, 1);

      await notes.create({ title: "n4", status: "d" }, { ...options, returning: "none" });
      await assert.rejects(notes.aggregate(byStatus, options), (error) => error instanceof GroupLimitError && error.status === 400 &&
        error.code === "RESOURCE_GROUP_LIMIT" && error.messageCode === "resource.groupLimit" && error.messageParams.groupLimit === 3 &&
        /notes\.aggregate\(\) has more than 3 groups, the most one statement answers\. Read them in pages/u.test(error.message));
      const page = (number) => notes.aggregate({ ...byStatus, page: { size: 2, number } }, options);
      assert.deepEqual((await page(1)).map(({ status }) => status), ["a", "b"]);
      assert.deepEqual((await page(2)).map(({ status }) => status), ["c", "d"]);
      assert.deepEqual(await page(3), []);
      await assert.rejects(notes.aggregate({ ...byStatus, page: { number: 2 } }, options), /notes\.aggregate\(\) page needs size/u);
      // Without groupBy an aggregate is one row, whatever the number of rows.
      assert.deepEqual(await notes.aggregate({ measures: { notes: { count: "*" } } }, options), [{ notes: 5 }]);
    }]
  ];
}

export { pagedReadsCases };
