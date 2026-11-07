import assert from "node:assert/strict";
import test from "node:test";
import { createGoals, createSummaries } from "../src/server/index.js";

// Construction touches neither the database nor the hooks, so these stand-ins are never called: the
// owner's handles are only checked and named, and its system context is only made.
const handle = Object.freeze({ withTransaction: unusedHandle });
const resources = Object.freeze({ agentGoals: handle, agentSummaries: handle, agentSummaryQueue: handle });
const systemContext = () => Object.freeze({});
const unused = async () => assert.fail("a required hook is not called at construction");
async function unusedHandle() {
  assert.fail("a handle is not called at construction");
}
const goalHooks = { resources, systemContext, runs: {}, find: unused, respond: unused, claim: unused, record: unused };

test("a goal or summary hook given as null fails at construction with a TypeError naming it", () => {
  for (const hook of ["notify", "owner", "spent", "track", "background"]) {
    assert.throws(() => createGoals({ ...goalHooks, [hook]: null }), {
      name: "TypeError",
      message: `createGoals: ${hook} must be a function, or left out for its default.`
    });
  }
  for (const hook of ["track", "summarize"]) {
    assert.throws(() => createSummaries({ resources, systemContext, history: unused, [hook]: null }), {
      name: "TypeError",
      message: `createSummaries: ${hook} must be a function, or left out for its default.`
    });
  }
});

test("goal and summary hooks left out take their named defaults", () => {
  assert.equal(typeof createGoals(goalHooks).afterTurn, "function");
  assert.equal(typeof createSummaries({ resources, systemContext, history: unused }).compact, "function");
});
