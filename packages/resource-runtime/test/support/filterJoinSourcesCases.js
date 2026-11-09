import assert from "node:assert/strict";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { createTestResourceRuntime } from "../../src/test/index.js";

// Search filters that read other tables through their owners' join sources, on every database the runtime supports:
// a plain read (query, queryAll, aggregate) asks which of its rows have, or lack, another owner's rows, or whether any
// of its own rows match, in its one statement, the other table's ownership, row policy and hidden fields deciding what
// the filter sees. Each database's test file runs these cases on its own connection.

const WORKSPACE_A = Object.freeze({ workspace: Object.freeze({ id: "1" }) });
// A request hides what only background work may see.
const inRequest = (caller) => caller.kind === "user" || caller.kind === "anonymous";

const projectResource = defineTableResource({
  name: "projects",
  tableName: "projects",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    name: { type: "string", required: true }
  }
});

const taskResource = defineTableResource({
  name: "tasks",
  tableName: "tasks",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    projectId: { type: "id", required: true, storage: { column: "project_id" } },
    status: { type: "string", required: true },
    confidential: { type: "boolean", defaultTo: false },
    reviewNote: { type: "string", nullable: true, hidden: true, storage: { column: "review_note" } }
  }
});

// The tasks' owner's join source, which the projects' feature requires as `tasks`.
const tasksSource = ({ requires }) => requires.tasks;

/**
 * The projects owner's search filters, each reading the tasks through their owner's join source, or the projects
 * themselves through the feature's own handle.
 */
const projectSearch = Object.freeze({
  // Projects with a task in this status.
  taskStatus: {
    type: "string",
    joinSources: { k: tasksSource },
    applyFilter(query, status, { column, joinSource }) {
      const task = joinSource("k");
      query.whereExists(task.query.select(task.column("id")).whereColumn(task.column("projectId"), column("id")).where(task.column("status"), status));
    }
  },
  // Projects with no task the caller sees (true), or with one (false).
  idle: {
    type: "boolean",
    joinSources: { k: tasksSource },
    applyFilter(query, idle, { column, joinSource }) {
      const task = joinSource("k");
      const tasks = task.query.select(task.column("id")).whereColumn(task.column("projectId"), column("id"));
      if (idle) {
        query.whereNotExists(tasks);
      } else {
        query.whereExists(tasks);
      }
    }
  },
  // Projects named like the term; when no project the caller sees is, those with a task in the term's status.
  named: {
    type: "string",
    joinSources: { k: tasksSource, other: ({ owned }) => owned.projects },
    applyFilter(query, term, { column, joinSource }) {
      const other = joinSource("other");
      const task = joinSource("k");
      query.where((match) => match
        .where(column("name"), "like", `%${term}%`)
        .orWhere((fallback) => fallback
          .whereNotExists(other.query.select(other.column("id")).where(other.column("name"), "like", `%${term}%`))
          .whereExists(task.query.select(task.column("id")).whereColumn(task.column("projectId"), column("id")).where(task.column("status"), term))));
    }
  },
  // A filter on a column the tasks' join source does not carry.
  reviewed: {
    type: "string",
    joinSources: { k: tasksSource },
    applyFilter(query, note, { column, joinSource }) {
      const task = joinSource("k");
      query.whereExists(task.query.select(task.column("id")).whereColumn(task.column("projectId"), column("id")).where(task.column("reviewNote"), note));
    }
  }
});

/**
 * Workspace 1's projects Alpha (an open and a done task), Beta (a done task, and an open task of workspace 2's that
 * names it) and Gamma (a confidential open task, which only background work sees); workspace 2's Delta (an open task).
 */
async function projectsAndTasks(knex) {
  await knex.schema.createTable("projects", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.string("name").notNullable();
  });
  await knex.schema.createTable("tasks", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.integer("project_id").notNullable().index();
    table.string("status").notNullable();
    table.boolean("confidential").notNullable().defaultTo(false);
    table.string("review_note").nullable();
  });
  await knex("projects").insert([
    { workspace_id: 1, name: "Alpha" },
    { workspace_id: 1, name: "Beta" },
    { workspace_id: 1, name: "Gamma" },
    { workspace_id: 2, name: "Delta" }
  ]);
  await knex("tasks").insert([
    { workspace_id: 1, project_id: 1, status: "open", confidential: false, review_note: "ok" },
    { workspace_id: 1, project_id: 1, status: "done", confidential: false },
    { workspace_id: 1, project_id: 2, status: "done", confidential: false },
    { workspace_id: 1, project_id: 3, status: "open", confidential: true },
    { workspace_id: 2, project_id: 4, status: "open", confidential: false },
    { workspace_id: 2, project_id: 2, status: "open", confidential: false }
  ]);
  const runtime = await createTestResourceRuntime({ knex });
  const { tasks } = await runtime.own("tasks.feature", [{
    resource: taskResource,
    rowPolicy: ({ query, column, caller }) => {
      if (inRequest(caller)) query.where(column("confidential"), false);
      return true;
    }
  }]);
  const { projects } = await runtime.own("projects.feature", [{ resource: projectResource, searchSchema: projectSearch }], { requires: { tasks } });
  const job = runtime.declareSystemScope("projects.feature", "review every workspace's projects")("review").forWorkspace("1");
  return { runtime, projects, tasks, job: { context: job } };
}

const names = (rows) => rows.map(({ name }) => name);
const sorted = { sort: ["id"] };

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function filterJoinSourcesCases(connect) {
  return [
    ["a search filter asks, in a plain read's one statement, which of its rows have or lack another owner's rows, through that owner's join source and row policy", async (t) => {
      const knex = await connect(t, "da_fjs_exists");
      const { projects, job } = await projectsAndTasks(knex);
      const request = { context: WORKSPACE_A };

      const open = await countQueries(knex, () => projects.queryAll({ ...sorted, filters: { taskStatus: "open" } }, request));
      // Beta's open task is workspace 2's, and Gamma's is confidential.
      assert.deepEqual([names(open.result), open.count], [["Alpha"], 1]);
      assert.deepEqual(names(await projects.queryAll({ ...sorted, filters: { taskStatus: "open" } }, job)), ["Alpha", "Gamma"]);
      assert.deepEqual(names(await projects.queryAll({ ...sorted, filters: { taskStatus: "done" } }, request)), ["Alpha", "Beta"]);

      const idle = await countQueries(knex, () => projects.queryAll({ ...sorted, filters: { idle: true } }, request));
      assert.deepEqual([names(idle.result), idle.count], [["Gamma"], 1]);
      assert.deepEqual(names(await projects.queryAll({ ...sorted, filters: { idle: true } }, job)), []);
      assert.deepEqual(names(await projects.queryAll({ ...sorted, filters: { idle: false } }, request)), ["Alpha", "Beta"]);

      // A page, an aggregate and a join source take the filter as they take any other.
      const page = await countQueries(knex, () => projects.query({ ...sorted, filters: { idle: false }, page: { size: 1 } }, request));
      assert.deepEqual([names(page.result.records), page.result.page.hasMore, page.count], [["Alpha"], true, 1]);
      const counted = await countQueries(knex, () => projects.aggregate({ measures: { projects: { count: "*" } }, filters: { taskStatus: "done" } }, request));
      assert.deepEqual([counted.result, counted.count], [[{ projects: 2 }], 1]);
      const source = await projects.joinSource({ alias: "p", filters: { idle: true } }, request);
      assert.deepEqual(names(await source.query.select({ name: source.column("name") })), ["Gamma"]);
      const pages = [];
      for await (const records of projects.queryPages({ filters: { taskStatus: "done" } }, request)) {
        pages.push(names(records));
      }
      assert.deepEqual(pages, [["Alpha", "Beta"]]);
    }],

    ["a search filter asks whether any of the caller's own rows match, through the feature's own handle, and falls back on another owner's rows", async (t) => {
      const knex = await connect(t, "da_fjs_own");
      const { projects } = await projectsAndTasks(knex);
      const request = { context: WORKSPACE_A };
      const read = async (term) => {
        const { result, count } = await countQueries(knex, () => projects.queryAll({ ...sorted, filters: { named: term } }, request));
        return [names(result), count];
      };
      assert.deepEqual(await read("lph"), [["Alpha"], 1]);
      // No project the caller sees is named like "done" (workspace 2's Delta is not either), so the tasks decide.
      assert.deepEqual(await read("done"), [["Alpha", "Beta"], 1]);
      // Delta matches "elt", but it is workspace 2's, so workspace 1's projects fall back on their tasks, of which none
      // is in the status "elt".
      assert.deepEqual(await read("elt"), [[], 1]);
    }],

    ["a join source in a filter carries no hidden column but the ownership fields, as a report's does", async (t) => {
      const knex = await connect(t, "da_fjs_hidden");
      const { projects, job } = await projectsAndTasks(knex);
      for (const options of [{ context: WORKSPACE_A }, job]) {
        await assert.rejects(projects.queryAll({ filters: { reviewed: "ok" } }, options),
          /tasks\.joinSource\(\) carries no hidden field but its ownership fields, so it has no column for "reviewNote"/u);
      }
    }],

    ["own() refuses, at startup, join sources it cannot use: no alias map, a name that is no alias, an owner that is no function, a filter with no applyFilter", async (t) => {
      const knex = await connect(t, "da_fjs_startup");
      await knex.schema.createTable("things", (table) => {
        table.increments("id");
        table.integer("workspace_id").nullable();
        table.string("name").notNullable();
      });
      const runtime = await createTestResourceRuntime({ knex });
      const thing = defineTableResource({
        name: "things",
        tableName: "things",
        ownership: "workspace",
        schema: { workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } }, name: { type: "string" } }
      });
      const owning = (entry) => runtime.own("things.feature", [{ resource: thing, searchSchema: { linked: { type: "string", ...entry } } }]);
      const applyFilter = () => {};
      await assert.rejects(owning({ joinSources: {}, applyFilter }), /filter "linked" of "things" joinSources must name each join source by its alias/u);
      await assert.rejects(owning({ joinSources: { "1k": () => null }, applyFilter }), /names the join source "1k", which is no alias/u);
      await assert.rejects(owning({ joinSources: { k: "tasks" }, applyFilter }), /join source "k" must be a function answering its owner/u);
      await assert.rejects(owning({ joinSources: { k: () => null } }), /reads join sources, so it takes an applyFilter\(query, value, \{ column, joinSource \}\) and no oneOf/u);
      // The table resource's own search names no feature to answer its join sources.
      const sharedSearch = defineTableResource({ ...thing, searchSchema: { linked: { type: "string", joinSources: { k: () => null }, applyFilter } } });
      await assert.rejects(runtime.own("things.feature", [sharedSearch]),
        /filter "linked" of "things" names joinSources in the table resource, which names no feature to answer them; give the filter in the owns entry's searchSchema/u);
      // Nothing was owned by the refused calls, so a correct declaration owns the table.
      const { things } = await owning({ joinSources: { k: () => null }, applyFilter });
      await assert.rejects(things.queryAll({ filters: { linked: "x" } }, { context: WORKSPACE_A }), /things filter "linked" join source "k" names no owner with joinSource\(\{ alias \}, options\)/u);
    }],

    ["a write or a lock that chooses its rows by a join-source filter is refused on MySQL and MariaDB, which read the source from the snapshot; elsewhere it chooses the rows the filter matches", async (t) => {
      const knex = await connect(t, "da_fjs_writes");
      const { projects } = await projectsAndTasks(knex);
      const request = { context: WORKSPACE_A };
      const mysql = knex.client.config.client === "mysql2";
      if (mysql) {
        // A write answers json-rest-api's RestApiWriteError, whose cause is the refusal, as for a filter on another table's field.
        const refused = (method) => (error) => {
          const refusal = error.name === "RestApiWriteError" ? error.cause : error;
          return refusal.name === "RestApiValidationError" &&
            new RegExp(`${method} on 'projects' filters "idle" through another table's join source, which MySQL and MariaDB read from the transaction snapshot`, "u").test(refusal.message);
        };
        await assert.rejects(projects.patchWhere({ idle: true }, { name: "Quiet" }, request), refused("patchWhere"));
        await assert.rejects(projects.withTransaction(request, (tx) => projects.lockWhere({ idle: true }, tx)), refused("lockWhere"));
        assert.deepEqual(names(await projects.queryAll({ ...sorted, filters: { idle: true } }, request)), ["Gamma"]);
        return;
      }
      assert.deepEqual(names(await projects.withTransaction(request, (tx) => projects.lockWhere({ idle: true }, { ...tx, fields: ["name"] }))), ["Gamma"]);
      assert.deepEqual(await projects.patchWhere({ idle: true }, { name: "Quiet" }, { ...request, returning: "ids" }), ["3"]);
      assert.deepEqual(names(await projects.queryAll(sorted, request)), ["Alpha", "Beta", "Quiet"]);
    }]
  ];
}

export { filterJoinSourcesCases };
