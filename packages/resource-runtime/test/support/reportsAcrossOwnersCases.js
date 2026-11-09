import assert from "node:assert/strict";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { countQueries } from "@jskit-ai/database-runtime/server/testDatabases";
import { createTestResourceRuntime } from "../../src/test/index.js";

// Reports over two owners' rows, on every database the runtime supports: the projects' owner asks which of its
// projects have, or lack, rows of the tasks' owner, and counts them, each in one statement through the tasks' join
// source, so the tasks' ownership and row policy decide which tasks count. Each database's test file runs these cases
// on its own connection.

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
    status: { type: "string", required: true, search: true },
    confidential: { type: "boolean", defaultTo: false }
  }
});

/**
 * Workspace 1's projects Alpha (an open and a done task), Beta (a done task, and an open task of workspace 2's that
 * names it) and Gamma (a confidential open task, which only background work sees); workspace 2's Delta (an open task).
 */
async function projectsAndTasks(knex) {
  await knex.schema.createTable("projects", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.string("name").notNullable();
  });
  await knex.schema.createTable("tasks", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable();
    table.integer("project_id").notNullable().index();
    table.string("status").notNullable();
    table.boolean("confidential").notNullable().defaultTo(false);
  });
  await knex("projects").insert([
    { workspace_id: 1, name: "Alpha" },
    { workspace_id: 1, name: "Beta" },
    { workspace_id: 1, name: "Gamma" },
    { workspace_id: 2, name: "Delta" }
  ]);
  await knex("tasks").insert([
    { workspace_id: 1, project_id: 1, status: "open", confidential: false },
    { workspace_id: 1, project_id: 1, status: "done", confidential: false },
    { workspace_id: 1, project_id: 2, status: "done", confidential: false },
    { workspace_id: 1, project_id: 3, status: "open", confidential: true },
    { workspace_id: 2, project_id: 4, status: "open", confidential: false },
    { workspace_id: 2, project_id: 2, status: "open", confidential: false }
  ]);
  const runtime = await createTestResourceRuntime({ knex });
  const { projects } = await runtime.own("projects.feature", [projectResource]);
  const { tasks } = await runtime.own("tasks.feature", [{
    resource: taskResource,
    rowPolicy: ({ query, column, caller }) => {
      if (inRequest(caller)) query.where(column("confidential"), false);
      return true;
    }
  }]);
  const job = runtime.declareSystemScope("projects.feature", "review every workspace's projects")("review").forWorkspace("1");
  return { projects, tasks, job: { context: job } };
}

/**
 * The projects owner's reports, as its repository holds them, each one statement: `tasks` is the tasks owner's API,
 * of which they use only joinSource().
 */
function projectReports({ projects, tasks }) {
  const projectId = projects.column("id", "p");
  // Knex: report - the caller's projects that have a task the caller sees, matching the tasks' filters
  async function withTasks(filters, options) {
    const task = await tasks.joinSource({ alias: "k", filters }, options);
    const { query } = await projects.scopedQuery({ alias: "p" }, options);
    return query
      .whereExists(task.query.select(task.column("id")).whereColumn(task.column("projectId"), projectId))
      .select({ name: projects.column("name", "p") })
      .orderBy(projectId);
  }
  // Knex: report - the caller's projects with no task the caller sees
  async function withoutTasks(options) {
    const task = await tasks.joinSource({ alias: "k" }, options);
    const { query } = await projects.scopedQuery({ alias: "p" }, options);
    return query
      .whereNotExists(task.query.select(task.column("id")).whereColumn(task.column("projectId"), projectId))
      .select({ name: projects.column("name", "p") })
      .orderBy(projectId);
  }
  // Knex: totals - each of the caller's projects with how many tasks the caller sees, none counted as 0
  async function taskCounts(options) {
    const task = await tasks.joinSource({ alias: "k" }, options);
    const counted = task.query
      .select({ projectId: task.column("projectId") })
      .count({ tasks: task.column("id") })
      .groupBy(task.column("projectId"))
      .as("c");
    const { query } = await projects.scopedQuery({ alias: "p" }, options);
    const rows = await query
      .leftJoin(counted, "c.projectId", projectId)
      .select({ name: projects.column("name", "p"), tasks: "c.tasks" })
      .orderBy(projectId);
    return rows.map(({ name, tasks: count }) => ({ name, tasks: Number(count ?? 0) }));
  }
  return { withTasks, withoutTasks, taskCounts };
}

/**
 * A console's reports, in a feature that owns neither table and requires both owners: each roots at the projects'
 * join source and ties the tasks' to it, in one statement.
 */
function consoleReports({ projects, tasks }) {
  // Knex: report - the caller's projects with no task the caller sees, for a console that owns neither table
  async function idle(options) {
    const project = await projects.joinSource({ alias: "p" }, options);
    const task = await tasks.joinSource({ alias: "k" }, options);
    return project.query
      .whereNotExists(task.query.select(task.column("id")).whereColumn(task.column("projectId"), project.column("id")))
      .select({ name: project.column("name") })
      .orderBy(project.column("id"));
  }
  // Knex: totals - each of the caller's projects with how many tasks the caller sees, for a console that owns neither table
  async function counts(options) {
    const project = await projects.joinSource({ alias: "p" }, options);
    const task = await tasks.joinSource({ alias: "k" }, options);
    const counted = task.query
      .select({ projectId: task.column("projectId") })
      .count({ tasks: task.column("id") })
      .groupBy(task.column("projectId"))
      .as("c");
    const rows = await project.query
      .leftJoin(counted, "c.projectId", project.column("id"))
      .select({ name: project.column("name"), tasks: "c.tasks" })
      .orderBy(project.column("id"));
    return rows.map(({ name, tasks: count }) => ({ name, tasks: Number(count ?? 0) }));
  }
  return { idle, counts };
}

const names = (rows) => rows.map(({ name }) => name);

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function reportsAcrossOwnersCases(connect) {
  return [
    ["a report asks, in one statement, which of its rows have or lack another owner's rows, and counts them, through that owner's join source and row policy", async (t) => {
      const knex = await connect(t, "da_ro_exists");
      const handles = await projectsAndTasks(knex);
      const { withTasks, withoutTasks, taskCounts } = projectReports(handles);
      const request = { context: WORKSPACE_A };

      const open = await countQueries(knex, () => withTasks({ status: "open" }, request));
      // Beta's open task is workspace 2's, and Gamma's is confidential.
      assert.deepEqual([names(open.result), open.count], [["Alpha"], 1]);
      assert.deepEqual(names(await withTasks({ status: "open" }, handles.job)), ["Alpha", "Gamma"]);
      assert.deepEqual(names(await withTasks(undefined, request)), ["Alpha", "Beta"]);

      const none = await countQueries(knex, () => withoutTasks(request));
      assert.deepEqual([names(none.result), none.count], [["Gamma"], 1]);
      assert.deepEqual(names(await withoutTasks(handles.job)), []);

      const counts = await countQueries(knex, () => taskCounts(request));
      assert.deepEqual([counts.result, counts.count], [[{ name: "Alpha", tasks: 2 }, { name: "Beta", tasks: 1 }, { name: "Gamma", tasks: 0 }], 1]);
      assert.deepEqual(await taskCounts(handles.job), [{ name: "Alpha", tasks: 2 }, { name: "Beta", tasks: 1 }, { name: "Gamma", tasks: 1 }]);
    }],

    ["a console's report, in a feature that owns none of the tables, roots at one owner's join source and ties the others' to it, in one statement", async (t) => {
      const knex = await connect(t, "da_ro_console");
      const handles = await projectsAndTasks(knex);
      const { idle, counts } = consoleReports(handles);
      const request = { context: WORKSPACE_A };

      const none = await countQueries(knex, () => idle(request));
      assert.deepEqual([names(none.result), none.count], [["Gamma"], 1]);
      assert.deepEqual(names(await idle(handles.job)), []);

      const counted = await countQueries(knex, () => counts(request));
      assert.deepEqual([counted.result, counted.count], [[{ name: "Alpha", tasks: 2 }, { name: "Beta", tasks: 1 }, { name: "Gamma", tasks: 0 }], 1]);
      assert.deepEqual(await counts(handles.job), [{ name: "Alpha", tasks: 2 }, { name: "Beta", tasks: 1 }, { name: "Gamma", tasks: 1 }]);
    }]
  ];
}

export { reportsAcrossOwnersCases };
