import assert from "node:assert/strict";
import test from "node:test";
import knexLib from "knex";
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
