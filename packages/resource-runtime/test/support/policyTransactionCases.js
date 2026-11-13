import assert from "node:assert/strict";
import knexLib from "knex";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "../../src/test/index.js";

// A row policy that asks another owner through its handle, during a write whose caller gave no transaction:
// json-rest-api opens the write's own, the policy runs inside it (the lookup before a patch, the read-back after a
// create), and its options name that transaction, so the owner's read joins it. On a client with one connection a read
// outside it would wait for the connection the write holds until the pool gives up. Each database's test file runs
// these cases on its own connection.

const asPerson = (userId) => ({ context: { actor: { id: userId }, workspace: { id: "1" } } });

const memberResource = defineTableResource({
  name: "teamMembers",
  tableName: "team_members",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    userId: { type: "string", required: true, search: true, storage: { column: "user_id" } },
    role: { type: "string", required: true, search: true }
  }
});
const taskResource = defineTableResource({
  name: "tasks",
  tableName: "tasks",
  ownership: "workspace",
  schema: {
    workspaceId: { type: "id", nullable: true, storage: { column: "workspace_id" } },
    createdBy: { type: "string", required: true, storage: { column: "created_by" } },
    title: { type: "string", required: true }
  }
});

/**
 * A client of `shared`'s database with one connection, which gives up waiting for it after 2 seconds; person 1 a
 * member and person 2 a lead of workspace 1's team; tasks whose policy shows a lead every task and anyone else theirs,
 * asking the teams' owner through its handle. `seen` records whether each of the owner's reads had a transaction.
 * @param {import("knex").Knex} shared
 */
async function teamsAndTasks(shared) {
  const { config } = shared.client;
  const knex = knexLib({ ...config, pool: { ...config.pool, min: 0, max: 1 }, acquireConnectionTimeout: 2000 });
  await knex.schema.createTable("team_members", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.string("user_id").notNullable();
    table.string("role").notNullable();
  });
  await knex.schema.createTable("tasks", (table) => {
    table.increments("id");
    table.integer("workspace_id").nullable().index();
    table.string("created_by").notNullable();
    table.string("title").notNullable();
  });
  await knex("team_members").insert([{ workspace_id: 1, user_id: "1", role: "member" }, { workspace_id: 1, user_id: "2", role: "lead" }]);
  const runtime = await createTestResourceRuntime({ knex });
  const { teamMembers } = await runtime.own("teams.feature", [{ resource: memberResource }]);
  const seen = new Set();
  const teams = {
    async isLead(userId, options) {
      seen.add(options.trx ? "in a transaction" : "in none");
      return (await teamMembers.queryAll({ filters: { userId, role: "lead" }, take: 1 }, options)).length > 0;
    }
  };
  const { tasks } = await runtime.own("tasks.feature", [{
    resource: taskResource,
    rowPolicy: async ({ query, caller, column, value, options, requires }) => {
      if (caller.kind !== "user") {
        return caller.kind !== "anonymous";
      }
      if (!(await requires.teams.isLead(caller.userId, options))) {
        query.where(column("createdBy"), value("createdBy", caller.userId));
      }
      return true;
    }
  }], { requires: { teams } });
  // What one call answers, and where the owner's reads ran during it.
  const call = async (run) => {
    seen.clear();
    const result = await run();
    return { result, seen: [...seen] };
  };
  return { knex, tasks, call };
}

/**
 * @param {(t: import("node:test").TestContext, suffix: string) => Promise<import("knex").Knex>} connect
 *   The test's own empty database; `suffix` names it where the database needs a name.
 */
function policyTransactionCases(connect) {
  return [
    ["a row policy that asks another owner's handle joins the transaction a write opened for a caller that named none", async (t) => {
      const { knex, tasks, call } = await teamsAndTasks(await connect(t, "da_pt"));
      try {
        const inOne = ["in a transaction"];
        const created = await call(() => tasks.create({ createdBy: "1", title: "first" }, asPerson("1")));
        assert.deepEqual({ title: created.result.title, seen: created.seen }, { title: "first", seen: inOne });
        const patched = await call(() => tasks.patch(created.result.id, { title: "second" }, asPerson("1")));
        assert.deepEqual({ title: patched.result.title, seen: patched.seen }, { title: "second", seen: inOne });
        // In the caller's own transaction, as before; and a read outside any reads the owner outside any too.
        const inCallers = await call(() => tasks.withTransaction(asPerson("1"), (tx) => tasks.patch(created.result.id, { title: "third" }, tx)));
        assert.deepEqual(inCallers.seen, inOne);
        const read = await call(() => tasks.queryAll({}, asPerson("2")));
        assert.deepEqual({ titles: read.result.map(({ title }) => title), seen: read.seen }, { titles: ["third"], seen: ["in none"] });
        // The owner's answer still decides: person 3, no lead, made no task.
        assert.deepEqual(await tasks.queryAll({}, asPerson("3")), []);
      } finally {
        await knex.destroy();
      }
    }]
  ];
}

export { policyTransactionCases };
