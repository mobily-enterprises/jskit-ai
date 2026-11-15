import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "../src/test/index.js";
import { ownMysqlDatabase } from "./support/mysqlDatabase.js";

// A lock of a thousand rows on MariaDB holds those rows alone. InnoDB holds every row a locking read examines until
// the transaction ends, so each of the lock's reads names its rows through a key: the links a lock's include reads go
// through the primary key (left to choose, the optimizer scans a table that the list names much of, and holds every
// owner's rows), and a list filter of 1,000 values or more stays a list (MariaDB turns one that long into a join,
// which reads a key's leading columns and holds every row they match, every revision of the listed records below).
// MySQL 8.4 reads a list that names this large a share of a table through its whole primary key, and holds every row,
// as json-rest-api's scoped-reads guide says. Workspace 1 and workspace 2 each have 1,200 records with revisions 1 to 4 and a current one (10 for
// an even record, 11 for an odd one), and 1,200 tasks, each naming a stage of its own.

const RECORDS = 1200;
const WORKSPACE = Object.freeze({ context: Object.freeze({ workspace: Object.freeze({ id: "1" }) }) });
const currentOf = (record) => (record % 2 === 0 ? 10 : 11);

const workspaceId = { type: "id", nullable: true, storage: { column: "workspace_id" } };
const revisionResource = defineTableResource({
  name: "revisions",
  tableName: "revisions",
  ownership: "workspace",
  searchSchema: {
    recordIds: { type: "array", actualField: "recordId", filterOperator: "in" },
    numbers: { type: "array", actualField: "number", filterOperator: "in" }
  },
  schema: {
    workspaceId,
    recordId: { type: "integer", required: true, storage: { column: "record_id" } },
    number: { type: "integer", required: true },
    name: { type: "string", required: true }
  }
});
const stageResource = defineTableResource({
  name: "stages",
  tableName: "stages",
  ownership: "workspace",
  schema: { workspaceId, name: { type: "string", required: true } }
});
const taskResource = defineTableResource({
  name: "tasks",
  tableName: "tasks",
  ownership: "workspace",
  schema: {
    workspaceId,
    stageId: { type: "id", nullable: true, belongsTo: "stages", as: "stage", storage: { column: "stage_id" } },
    name: { type: "string", required: true }
  }
});

async function database(t, suffix) {
  const knex = await ownMysqlDatabase(t, suffix);
  await knex.schema.createTable("revisions", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.integer("record_id").notNullable();
    table.integer("number").notNullable();
    table.string("name").notNullable();
    table.unique(["workspace_id", "record_id", "number"], { indexName: "revisions_current" });
  });
  await knex.schema.createTable("stages", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.string("name").notNullable();
  });
  await knex.schema.createTable("tasks", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.integer("stage_id").nullable();
    table.string("name").notNullable();
  });
  const insert = async (tableName, rows) => {
    for (let start = 0; start < rows.length; start += 500) {
      await knex(tableName).insert(rows.slice(start, start + 500));
    }
  };
  const revisions = [];
  const stages = [];
  for (let record = 1; record <= RECORDS; record++) {
    for (const workspace of [1, 2]) {
      for (const number of [1, 2, 3, 4, currentOf(record)]) {
        revisions.push({ workspace_id: workspace, record_id: record, number, name: `R${record}.${number}` });
      }
      stages.push({ workspace_id: workspace, name: `S${record}` });
    }
  }
  await insert("revisions", revisions);
  await insert("stages", stages);
  await knex.raw("INSERT INTO tasks (workspace_id, stage_id, name) SELECT workspace_id, id, concat('T', name) FROM stages ORDER BY id");
  await knex.raw("ANALYZE TABLE revisions, stages, tasks");
  const runtime = await createTestResourceRuntime({ knex });
  const handles = await runtime.own("history.feature", [revisionResource, stageResource, taskResource]);
  const idOf = async (tableName, where) => String((await knex(tableName).where(where).first("id")).id);
  return { knex, ...handles, idOf };
}

/**
 * Whether another transaction can delete the row (a delete takes every index entry of it, as a lock read through a
 * secondary index holds the entry) without waiting. It never commits.
 */
async function free(knex, tableName, id) {
  const rolledBack = new Error("rolled back");
  try {
    await knex.transaction(async (probe) => {
      await probe.raw("SET SESSION innodb_lock_wait_timeout = 1");
      await probe(tableName).where({ id }).delete();
      throw rolledBack;
    });
  } catch (error) {
    if (error === rolledBack) {
      return true;
    }
    if (/^ER_LOCK_(NOWAIT|WAIT_TIMEOUT)$/u.test(error?.code ?? "")) {
      return false;
    }
    throw error;
  }
  throw new Error("The probe committed.");
}

// 1,000 records' current revisions; and 1,200 records' revisions numbered 10, the even records' current ones, as
// lockWhere locks 1,000 rows at most.
test("lockWhere of 1,000 and 1,200 records' current revisions, the records given as numbers, holds those revisions alone", async (t) => {
  const { knex, revisions, idOf } = await database(t, "da_ll_where");
  for (const { count, numbers, matched } of [{ count: 1000, numbers: [10, 11], matched: 1000 }, { count: 1200, numbers: [10], matched: 600 }]) {
    const recordIds = Array.from({ length: count }, (_, index) => index + 1);
    const revision = (record, number, workspace = 1) => idOf("revisions", { workspace_id: workspace, record_id: record, number });
    const rows = {
      current: await revision(6, 10),
      lastCurrent: await revision(count, 10),
      past: await revision(6, 1),
      lastPast: await revision(count, 2),
      unlisted: count < RECORDS ? await revision(1100, 10) : await revision(5, 11),
      otherWorkspace: await revision(6, 10, 2)
    };
    const held = await revisions.withTransaction(WORKSPACE, async (tx) => {
      const locked = await revisions.lockWhere({ recordIds, numbers }, { ...tx, fields: ["name"] });
      assert.equal(locked.length, matched);
      const answer = {};
      for (const [row, id] of Object.entries(rows)) {
        answer[row] = !(await free(knex, "revisions", id));
      }
      return answer;
    });
    assert.deepEqual(held, { current: true, lastCurrent: true, past: false, lastPast: false, unlisted: false, otherWorkspace: false }, `${count} records`);
  }
});

test("a lock of 1,000 tasks with their stages reads the tasks' links through the primary key, holding those tasks and stages alone", async (t) => {
  const { knex, tasks, idOf } = await database(t, "da_ll_include");
  const ids = (await knex("tasks").where({ workspace_id: 1 }).orderBy("id").limit(1000).pluck("id")).map(String);
  const rows = {
    task: ids[3],
    unlistedTask: await idOf("tasks", { workspace_id: 1, name: `TS${RECORDS}` }),
    otherWorkspaceTask: await idOf("tasks", { workspace_id: 2, name: "TS5" }),
    unlinkedStage: await idOf("stages", { workspace_id: 1, name: `S${RECORDS}` }),
    otherWorkspaceStage: await idOf("stages", { workspace_id: 2, name: "S5" })
  };
  const held = await tasks.withTransaction(WORKSPACE, async (tx) => {
    const locked = await tasks.lockMany(ids, { ...tx, include: ["stage"] });
    assert.equal(locked.length, 1000);
    assert.ok(locked.every((task) => task.stage?.id === String(task.stageId)));
    const answer = {};
    for (const [row, id] of Object.entries(rows)) {
      answer[row] = !(await free(knex, row.endsWith("Stage") ? "stages" : "tasks", id));
    }
    return answer;
  });
  assert.deepEqual(held, { task: true, unlistedTask: false, otherWorkspaceTask: false, unlinkedStage: false, otherWorkspaceStage: false });
});
