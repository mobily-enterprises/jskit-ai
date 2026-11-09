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

    ["queryAll() with take answers the first rows in its sort order, reading no row past them, and a request may name more than its row limit", async (t) => {
      const knex = await connect(t, "da_pr_take");
      const { notes, system } = await createNotes(knex);
      await notes.createMany(Array.from({ length: 7 }, (_, index) => ({ title: `n${index}` })), { context: WORKSPACE_A, returning: "none" });
      await notes.createMany([{ title: "theirs" }], { context: WORKSPACE_B, returning: "none" });
      const request = { context: WORKSPACE_A };
      const titles = (records) => records.map(({ title }) => title);

      // Pages of 3, the last no larger than the rows still wanted: 4 rows in 2 statements, the second asking for 1.
      const four = await countQueries(knex, () => notes.queryAll({ fields: ["title"], take: 4 }, request));
      assert.deepEqual(titles(four.result), ["n0", "n1", "n2", "n3"]);
      assert.equal(four.count, 2);
      // A request reads past its row limit, 5, when take names more; fewer rows than take answer them all.
      assert.deepEqual(titles(await notes.queryAll({ fields: ["title"], take: 7 }, request)), ["n0", "n1", "n2", "n3", "n4", "n5", "n6"]);
      const ten = await countQueries(knex, () => notes.queryAll({ fields: ["title"], take: 10 }, request));
      assert.equal(ten.result.length, 7);
      assert.equal(ten.count, 3);
      // In its sort order, filtered, and in its scope; background work takes too.
      assert.deepEqual(titles(await notes.queryAll({ sort: "-title", fields: ["title"], take: 2 }, request)), ["n6", "n5"]);
      assert.deepEqual(titles(await notes.queryAll({ filters: { title: "n4" }, fields: ["title"], take: 3 }, request)), ["n4"]);
      assert.deepEqual(titles(await notes.queryAll({ fields: ["title"], take: 1 }, { context: WORKSPACE_B })), ["theirs"]);
      assert.deepEqual(titles(await notes.queryAll({ fields: ["title"], take: 2 }, { context: system.forWorkspace("1") })), ["n0", "n1"]);
      // A whole record without fields, as queryAll() answers it.
      assert.deepEqual(await notes.queryAll({ take: 1 }, request), [{ id: "1", workspaceId: 1, title: "n0", status: "open" }]);
      // A filter that matches no row reads nothing.
      const none = await countQueries(knex, () => notes.queryAll({ filters: { id: [] }, take: 3 }, request));
      assert.deepEqual([none.result, none.count], [[], 0]);
      // take is a whole number from 1, checked before anything runs.
      for (const take of [0, -1, 1.5, "3", null]) {
        await assert.rejects(notes.queryAll({ take }, request), (error) => error instanceof TypeError &&
          /^notes\.queryAll\(\) take is the most records it answers, a whole number from 1\./u.test(error.message), String(take));
      }
      // Without take, or with take: undefined, a request still stops at its row limit, and background work reads every row.
      await assert.rejects(notes.queryAll({}, request), /notes\.queryAll\(\) read more than 5 rows/u);
      await assert.rejects(notes.queryAll({ take: undefined }, request), /notes\.queryAll\(\) read more than 5 rows/u);
      assert.equal((await notes.queryAll({ take: undefined }, { context: system.forWorkspace("1") })).length, 7);
      // queryPages() reads a page at a time already, and takes no take.
      await assert.rejects(pagesOf(notes.queryPages({ take: 2 }, request)), /notes\.queryPages\(\) does not take take/u);
    }],

    ["a grouped aggregate without a page answers every group one statement holds and throws past them, never part; a page answers its groups and whether more remain", async (t) => {
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
      // A page says whether groups remain, as query() does, and is no array a caller could take for every group.
      const first = await page(1);
      assert.equal(Array.isArray(first), false);
      assert.deepEqual(first.rows.map(({ status }) => status), ["a", "b"]);
      assert.deepEqual(first.page, { size: 2, number: 1, hasMore: true, next: 2 });
      const second = await page(2);
      assert.deepEqual(second.rows.map(({ status }) => status), ["c", "d"]);
      assert.deepEqual(second.page, { size: 2, number: 2, hasMore: false, next: null });
      assert.deepEqual(await page(3), { rows: [], page: { size: 2, number: 3, hasMore: false, next: null } });
      // A filter that matches no row answers an empty page without a statement.
      assert.deepEqual(
        await notes.aggregate({ ...byStatus, filters: { id: [] }, page: { size: 2 } }, options),
        { rows: [], page: { size: 2, number: 1, hasMore: false, next: null } }
      );
      await assert.rejects(notes.aggregate({ ...byStatus, page: { number: 2 } }, options), /notes\.aggregate\(\) page needs size/u);
      // Without groupBy an aggregate is one row, whatever the number of rows.
      assert.deepEqual(await notes.aggregate({ measures: { notes: { count: "*" } } }, options), [{ notes: 5 }]);
    }]
  ];
}

export { pagedReadsCases };
