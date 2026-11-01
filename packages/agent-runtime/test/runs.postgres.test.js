import assert from "node:assert/strict";
import test from "node:test";
import { createRuns, startResumer } from "../src/server/index.js";
import { DATABASE, testDatabase } from "./database.js";

// A reply saves its steps as each one finishes; one a stopped server left part-way is taken over
// by another server, once, and carried on from them.
const call = { type: "tool-call", toolCallId: "c1", toolName: "list_files", input: {} };
const result = { type: "tool-result", toolCallId: "c1", toolName: "list_files", output: { type: "json", value: { entries: ["notes.txt"] } } };
const steps = [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }];
const quiet = (knex) => knex.raw("now() - interval '5 minutes'");

test("a reply claims its conversation, saves its steps while it runs, and is gone once it ends", { skip: DATABASE }, async (context) => {
  const knex = await testDatabase(context);
  await knex.schema.alterTable("agent_runs", (table) => table.bigInteger("bot_id"));
  const runs = createRuns({ knex });
  assert.equal(await runs.claim(1, { bot_id: 9 }), true);
  assert.equal(await runs.claim(1), false, "one reply per conversation at a time");
  assert.equal((await knex("agent_runs").where({ conversation_id: 1 }).first()).bot_id, "9", "with the app's own columns");
  await runs.save(1, steps, { human: true, answers: 5 });
  const saved = await runs.saved(1);
  assert.deepEqual(saved.steps.map((message) => message.role), ["assistant", "tool"]);
  assert.deepEqual(saved.input, { human: true, answers: 5 });
  await knex("agent_runs").where({ conversation_id: 1 }).update({ heartbeat_at: quiet(knex) });
  await runs.heartbeat(1);
  assert.equal(await runs.claim(1), false, "a beating run stays its server's");
  await runs.release(1);
  assert.equal(await runs.saved(1), undefined);
  assert.equal(await runs.claim(1), true, "free again");
});

test("a run whose server stopped beating is taken over once, with its steps", { skip: DATABASE }, async (context) => {
  const knex = await testDatabase(context);
  const runs = createRuns({ knex });
  await knex("agent_runs").insert([
    { conversation_id: 2, heartbeat_at: quiet(knex), steps: JSON.stringify(steps), input: JSON.stringify({ human: true }) },
    { conversation_id: 3, heartbeat_at: quiet(knex), steps: JSON.stringify(steps), input: JSON.stringify({ human: false }) },
    { conversation_id: 4, heartbeat_at: quiet(knex) },
    { conversation_id: 5, steps: JSON.stringify(steps), input: JSON.stringify({ human: true }) }
  ]);
  const human = (query) => query.whereRaw("input->>'human' = 'true'");
  const taken = await runs.takeOverStalled({ resumable: human });
  assert.deepEqual(taken.map((run) => Number(run.conversation_id)), [2], "only stale runs with steps, of the kinds that count");
  assert.deepEqual(taken[0].steps.map((message) => message.role), ["assistant", "tool"]);
  assert.deepEqual(await runs.takeOverStalled({ resumable: human }), [], "taken over once");
  assert.equal(await runs.claim(4), true, "a stale run without steps can be claimed afresh");
  assert.equal(await runs.claim(5), false);
});

test("the resumer carries on what stopped servers left, then drains", { skip: DATABASE }, async (context) => {
  const knex = await testDatabase(context);
  const runs = createRuns({ knex });
  await knex("agent_runs").insert({ conversation_id: 6, heartbeat_at: quiet(knex), steps: JSON.stringify(steps), input: JSON.stringify({ human: true }) });
  const resumed = [];
  const resumer = startResumer({ runs, resume: async (run) => resumed.push(Number(run.conversation_id)), everyMs: 50 });
  for (let tries = 0; tries < 40 && !resumed.length; tries += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  await resumer.drain(1000);
  assert.deepEqual(resumed, [6]);
});
