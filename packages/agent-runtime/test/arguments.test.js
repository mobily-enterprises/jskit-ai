import assert from "node:assert/strict";
import test from "node:test";
import { createCommands, createGoals, createRuns, createSummaries, defaultTools, planningNotes, planningTools } from "../src/server/index.js";

// A Knex as the earlier API took it: a function with a client.
const knex = Object.assign(() => {}, { client: {} });
const handle = Object.freeze({ withTransaction: async (options, work) => work(options) });
const systemContext = () => ({});

const STORES = [
  ["createRuns", createRuns, ["agentRuns"]],
  ["createGoals", createGoals, ["agentGoals"]],
  ["createSummaries", createSummaries, ["agentSummaries", "agentSummaryQueue"]],
  ["createCommands", createCommands, ["agentCommands"]]
];

test("each store refuses the earlier knex and tables, naming the owner feature to set up", () => {
  for (const [name, factory] of STORES) {
    for (const old of [{ knex }, { knex, tables: {} }, { table: "agent_runs" }]) {
      assert.throws(() => factory(old), {
        name: "TypeError",
        message: new RegExp(`^${name} no longer takes (knex|table): it reads and writes through the agent tables' handles; ` +
          "list agentResources\\(\\)'s tables in the owns of one feature")
      }, name);
    }
  }
});

test("each store asserts its handles and system context before it builds anything", () => {
  for (const [name, factory, resourceNames] of STORES) {
    assert.throws(() => factory({ systemContext }), {
      message: new RegExp(`^${name} requires resources\\.${resourceNames.join(" and resources\\.")}, the handles of the agent's tables`)
    }, name);
    const resources = Object.fromEntries(resourceNames.map((resourceName) => [resourceName, handle]));
    assert.throws(() => factory({ resources }), { message: new RegExp(`^${name} requires systemContext, the owner feature's system context factory`) }, name);
  }
  assert.throws(() => createSummaries({ resources: { agentSummaries: handle }, systemContext }), /requires resources\.agentSummaryQueue,/u);
});

test("the planning tools refuse a Knex and table names, and assert the app's planning store", async () => {
  const planning = {
    currentTodos: async () => undefined,
    mergeTodos: async () => {},
    jobNotes: async () => ["a note"],
    setJobNotes: async () => {}
  };
  assert.throws(() => defaultTools({ root: "/tmp", knex, conversationId: 1 }), /^TypeError: defaultTools no longer takes knex: pass planning/u);
  assert.throws(() => defaultTools({ root: "/tmp", tables: {}, conversationId: 1 }), /defaultTools no longer takes tables/u);
  assert.throws(() => planningTools({ knex, conversationId: 1 }), /planningTools no longer takes knex/u);
  assert.throws(() => defaultTools({ root: "/tmp", planning: { currentTodos() {} }, conversationId: 1 }),
    /defaultTools takes planning, the app's store for to-do cards and job notes \(AgentPlanning: currentTodos, mergeTodos, jobNotes, setJobNotes\)/u);
  await assert.rejects(planningNotes(knex, 1), /planningNotes takes planning, the app's store/u);

  assert.deepEqual(await planningNotes(planning, 1), ["Your notes for the job in hand (keep them up to date with keep_notes):\n- a note"]);
  assert.equal(typeof defaultTools({ root: "/tmp", planning, conversationId: 1 }).keepNotes, "object");
  assert.equal(defaultTools({ root: "/tmp", conversationId: 1 }).keepNotes, undefined);
});
