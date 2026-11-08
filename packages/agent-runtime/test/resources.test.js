import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
import { SystemContextRequiredError } from "@jskit-ai/resource-runtime/server";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import { agentResources } from "../src/server/index.js";

// The store tests run on PostgreSQL only; this one owns the agent's tables on any database, so a table the resource
// runtime refuses fails every run, not only the PostgreSQL one.
test("an app can own the agent's tables, and each filters by its own id", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  const runtime = await createTestResourceRuntime({ knex, createTables: true });
  const handles = await runtime.own("agent.feature", Object.values(agentResources({ columns: { runs: { model: { type: "string", nullable: true } } } })));
  assert.deepEqual(Object.keys(handles).sort(), ["agentCommands", "agentGoals", "agentRuns", "agentSummaries", "agentSummaryQueue"]);
  const options = { context: runtime.declareSystemScope("agent.feature", "run conversations")("read a run") };
  await handles.agentRuns.create({ id: "11", started_at: "2026-11-08T00:00:00.000Z", heartbeat_at: "2026-11-08T00:00:00.000Z" }, { ...options, returning: "none" });
  assert.deepEqual((await handles.agentRuns.queryAll({ filters: { id: "11" } }, options)).map(({ id }) => id), ["11"]);
  assert.deepEqual(await handles.agentSummaryQueue.queryAll({ filters: { id: ["11", "12"] } }, options), []);
  assert.deepEqual(await handles.agentCommands.queryAll({ filters: { id: "1", conversation_id: "11" } }, options), []);
});

// The rows belong to conversations every server's stores reach in the owner's system context, so a request's context,
// or one derived for a workspace or a user, reaches none of them, even where the app adds a workspace or user column.
test("the agent's tables answer only the owner's system context, never a request's or a derived job's", async (t) => {
  const knex = knexLib({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
  t.after(() => knex.destroy());
  const runtime = await createTestResourceRuntime({ knex, createTables: true });
  const columns = { goals: { workspace_id: { type: "id", nullable: true }, user_id: { type: "id", nullable: true } } };
  const handles = await runtime.own("agent.feature", Object.values(agentResources({ columns })));
  const systemContext = runtime.declareSystemScope("agent.feature", "run conversations");
  const system = { context: systemContext("carry on goal rounds") };
  const goal = { conversation_id: "11", objective: "Ship it", status: "active", rounds: 0, max_rounds: 3, time_zone: "UTC", language: "",
    attempts: 0, created_at: "2026-11-08T00:00:00.000Z", updated_at: "2026-11-08T00:00:00.000Z", workspace_id: "1", user_id: "7" };
  await handles.agentGoals.create(goal, { ...system, returning: "none" });
  assert.equal((await handles.agentGoals.queryAll({ filters: { conversation_id: "11" } }, system)).length, 1);

  const contexts = [
    { workspace: { id: "1" }, visibilityContext: { userId: "7" } },
    systemContext("one workspace's goals").forWorkspaceUser("1", "7"),
    systemContext("one person's goals").forUser("7")
  ];
  for (const context of contexts) {
    for (const name of Object.keys(handles)) {
      await assert.rejects(handles[name].queryAll({}, { context }), SystemContextRequiredError, name);
    }
    await assert.rejects(handles.agentGoals.create({ ...goal, conversation_id: "12" }, { context, returning: "none" }), SystemContextRequiredError);
    await assert.rejects(handles.agentGoals.patchWhere({ conversation_id: "11" }, { status: "paused" }, { context }), SystemContextRequiredError);
  }
  assert.deepEqual((await handles.agentGoals.queryAll({}, system)).map(({ conversation_id: id, status }) => [String(id), status]), [["11", "active"]]);
});
