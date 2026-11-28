import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { createPackageTestKnex, createTestResourceRuntime } from "../src/test/index.js";

// A patch that answers nothing, or only the id, sends no read of the row's columns before its UPDATE: on an inbox that
// reads each message's full text and HTML for nothing (issue #498).

const WORKSPACE_A = Object.freeze({ workspace: { id: "1" } });
const WORKSPACE_B = Object.freeze({ workspace: { id: "2" } });
// json-rest-api's not-found error, classified by its code (404 at the HTTP edge).
const notFound = (error) => error.code === "REST_API_RESOURCE" && error.subtype === "not_found";
// A mail's text and HTML at a realistic size: 64 KB each.
const WIDE_TEXT = "x".repeat(64 * 1024);

function messageResource(extra = {}) {
  return defineTableResource({
    name: "messages",
    tableName: "messages",
    ownership: "workspace",
    defaultSort: ["id"],
    schema: {
      id: { type: "id", primary: true },
      workspaceId: { type: "id", nullable: true, search: true, storage: { column: "workspace_id" } },
      subject: { type: "string", required: true },
      status: { type: "string", defaultTo: "new", search: true },
      folder: { type: "string", nullable: true, search: true },
      body: { type: "string", nullable: true },
      html: { type: "string", nullable: true }
    },
    ...extra
  });
}

async function createInbox(t, { owns = [messageResource()] } = {}) {
  const knex = await createPackageTestKnex(t, { environment: process.env });
  await knex.schema.createTable("messages", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("subject").notNullable();
    table.string("status").notNullable().defaultTo("new");
    table.string("folder").nullable();
    // MEDIUMTEXT on MySQL and MariaDB, whose TEXT holds 64 KB; TEXT on PostgreSQL and SQLite.
    table.text("body", "mediumtext");
    table.text("html", "mediumtext");
    table.index(["workspace_id"], "messages_workspace");
  });
  const runtime = await createTestResourceRuntime({ knex });
  const { messages } = await runtime.own("inbox.feature", owns);
  return { knex, messages };
}

// Inserts `count` wide messages for a workspace, a few at a time (each row is about 128 KB), and answers their ids.
async function addMessages(knex, workspaceId, count, { folder = "inbox" } = {}) {
  const before = await knex("messages").max({ last: "id" }).first();
  for (let start = 0; start < count; start += 10) {
    const rows = Array.from({ length: Math.min(10, count - start) }, (_, index) => ({
      workspace_id: workspaceId,
      subject: `message ${start + index}`,
      folder,
      body: WIDE_TEXT,
      html: WIDE_TEXT
    }));
    await knex("messages").insert(rows);
  }
  const ids = await knex("messages").where("id", ">", Number(before?.last ?? 0)).orderBy("id").pluck("id");
  return ids.map(String);
}

// What a statement is: its first word (begin, select, update, commit...).
const kindOf = (sql) => String(sql).trim().split(/\s+/u)[0].toLowerCase();
// The columns a SELECT names, between its select and its from.
const selectList = (sql) => /^\s*select\s+([\s\S]*?)\s+from\s/iu.exec(sql)?.[1] ?? "";
// A read of a message's own columns: one that selects every column, or any column but the id.
const readsColumns = (sql) => kindOf(sql) === "select" && /\bmessages\b/u.test(sql) &&
  /\*|subject|status|folder|body|html|workspace_id/u.test(selectList(sql));

test("a patch that answers nothing or its id reads none of the row's columns before its UPDATE, at any table size and row width", async (t) => {
  const { knex, messages } = await createInbox(t);
  const mysql = ["mysql", "mysql2"].includes(knex.client.config.client);
  const [mine] = await addMessages(knex, 1, 1);
  await addMessages(knex, 2, 1);
  const options = { context: WORKSPACE_A };
  let step = 0;
  const calls = {
    plain: (returning) => messages.patch(mine, { status: `triaged ${++step}` }, { ...options, returning }),
    "missing: skip": (returning) => messages.patch(mine, { status: `triaged ${++step}` }, { ...options, missing: "skip", returning }),
    onlyIf: (returning) => messages.patch(mine, { status: `triaged ${++step}` }, { ...options, onlyIf: { folder: "inbox" }, returning }),
    "onlyIf, missing: skip": (returning) =>
      messages.patch(mine, { status: `triaged ${++step}` }, { ...options, onlyIf: { folder: "inbox" }, missing: "skip", returning })
  };
  const measure = async () => {
    const measured = {};
    for (const [name, call] of Object.entries(calls)) {
      for (const returning of ["none", "id"]) {
        const { result, queries } = await countQueries(knex, () => call(returning));
        assert.equal(result, returning === "id" ? mine : undefined, `${name}, returning ${returning}`);
        measured[`${name}, returning ${returning}`] = queries;
      }
    }
    return measured;
  };

  const few = await measure();
  // The same calls on a table of 60 more wide messages, in both workspaces.
  await addMessages(knex, 1, 30);
  await addMessages(knex, 2, 30);
  const many = await measure();
  // Every call's statements, then what is wrong with them, so a failure shows every call at once.
  const report = Object.entries(few).map(([call, queries]) => `${call}: ${queries.length} statements\n  ${queries.join("\n  ")}`).join("\n");
  const problems = Object.entries(few).flatMap(([call, queries]) => {
    const reads = queries.filter((sql) => kindOf(sql) === "select" && /\bmessages\b/u.test(sql));
    return [
      ...(queries.some(readsColumns) ? [`${call} reads the row's columns before its UPDATE`] : []),
      // MySQL and MariaDB check the scope with a read of the id first, so an UPDATE never locks a row the caller cannot
      // see (an UPDATE there locks each row it looks at before it checks the rest of its WHERE).
      ...(reads.length > (mysql ? 1 : 0) ? [`${call} reads the table ${reads.length} times before its UPDATE`] : []),
      ...(queries.filter((sql) => kindOf(sql) === "update").length === 1 ? [] : [`${call} sends no one UPDATE`]),
      ...(many[call].map(kindOf).join() === queries.map(kindOf).join() ? [] : [`${call} sends ${many[call].map(kindOf).join(", ")} at 62 rows, ${queries.map(kindOf).join(", ")} at 2`])
    ];
  });
  assert.deepEqual(problems, [], report);
  const stored = await knex("messages").where({ id: mine }).first();
  assert.equal(stored.status, `triaged ${step}`);
  assert.equal(stored.body, WIDE_TEXT);
});

test("a patch that answers nothing or its id refuses another workspace's, a missing and a policy-hidden row as before, and keeps onlyIf's meaning", async (t) => {
  const hiddenFolder = ({ query, column }) => {
    query.where(column("folder"), "<>", "hidden");
    return true;
  };
  const { knex, messages } = await createInbox(t, { owns: [{ resource: messageResource(), rowPolicy: hiddenFolder }] });
  const [mine] = await addMessages(knex, 1, 1);
  const [theirs] = await addMessages(knex, 2, 1);
  const [hidden] = await addMessages(knex, 1, 1, { folder: "hidden" });
  const options = { context: WORKSPACE_A };
  for (const returning of ["none", "id"]) {
    for (const id of [theirs, hidden, "999999"]) {
      const label = `${id === theirs ? "another workspace's" : id === hidden ? "a hidden" : "a missing"} row, returning ${returning}`;
      await assert.rejects(messages.patch(id, { status: "taken" }, { ...options, returning }), notFound, label);
      await assert.rejects(messages.patch(id, { status: "taken" }, { ...options, returning, onlyIf: { folder: "inbox" } }), notFound, label);
      assert.equal(await messages.patch(id, { status: "taken" }, { ...options, returning, missing: "skip" }), null, label);
      assert.equal(await messages.patch(id, { status: "taken" }, { ...options, returning, missing: "skip", onlyIf: { folder: "inbox" } }), null, label);
    }
    // onlyIf that does not hold answers null and changes nothing, missing or not.
    assert.equal(await messages.patch(mine, { status: "taken" }, { ...options, returning, onlyIf: { folder: "archive" } }), null);
    assert.equal(await messages.patch(mine, { status: "taken" }, { ...options, returning, missing: "skip", onlyIf: { folder: "archive" } }), null);
    // A patch that stores the values the row already holds still finds the row.
    assert.equal(await messages.patch(mine, { status: "new" }, { ...options, returning }), returning === "id" ? mine : undefined);
    // Inside a caller's transaction a refused row fails the patch and then the transaction, and a skipped one fails
    // nothing.
    await assert.rejects(messages.withTransaction(options, async (txOptions) => {
      await assert.rejects(messages.patch(theirs, { status: "taken" }, { ...txOptions, returning }), (error) => notFound(error) && error.transactionOutcome === "pending");
    }), (error) => notFound(error) && error.transactionOutcome === "rolledBack");
    await messages.withTransaction(options, async (txOptions) => {
      assert.equal(await messages.patch(theirs, { status: "taken" }, { ...txOptions, returning, missing: "skip" }), null);
      assert.equal(await messages.patch(mine, { folder: "read" }, { ...txOptions, returning }), returning === "id" ? mine : undefined);
      assert.equal(await messages.patch(mine, { folder: "inbox" }, { ...txOptions, returning }), returning === "id" ? mine : undefined);
    });
  }
  const statuses = Object.fromEntries((await knex("messages").orderBy("id")).map((row) => [String(row.id), [row.status, row.folder]]));
  assert.deepEqual(statuses, { [mine]: ["new", "inbox"], [theirs]: ["new", "inbox"], [hidden]: ["new", "hidden"] });
  // The workspace's own rows still change.
  assert.equal(await messages.patch(mine, { status: "done" }, { ...options, returning: "none" }), undefined);
  assert.equal(await messages.patch(theirs, { status: "done" }, { context: WORKSPACE_B, returning: "id" }), theirs);
  assert.deepEqual((await knex("messages").whereIn("id", [mine, theirs]).orderBy("id")).map(({ status }) => status), ["done", "done"]);
});

test("a shared row refuses a patch that answers nothing with the shared-row error, before any change", async (t) => {
  const { knex, messages } = await createInbox(t, { owns: [messageResource({ ownership: "workspace_or_shared" })] });
  const [shared] = await addMessages(knex, null, 1);
  for (const returning of ["none", "id"]) {
    await assert.rejects(messages.patch(shared, { status: "taken" }, { context: WORKSPACE_A, returning }), (error) =>
      error.code === "REST_API_RESOURCE" && error.subtype === "forbidden" && /only be changed in a system context/u.test(error.message));
  }
  assert.equal((await knex("messages").where({ id: shared }).first()).status, "new");
});
