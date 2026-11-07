import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { RUN_LIMITS, createRuns, startResumer } from "../src/server/index.js";
import { testDatabase } from "./database.js";

// What createRuns answers and keeps today, pinned before its table moves onto a resource: the
// shapes of saved() and of a taken-over run, what a claim of a stale run keeps, what save() does
// to a conversation nobody claimed, the staleness limit, takeOverStalled's count, and the
// `resumable(query)` hook, which receives the store's query builder.
const call = { type: "tool-call", toolCallId: "c1", toolName: "list_files", input: { path: "." } };
const result = { type: "tool-result", toolCallId: "c1", toolName: "list_files", output: { type: "json", value: { entries: ["notes.txt"], nested: { deep: [1, null, true] } } } };
const steps = [{ role: "assistant", content: [call] }, { role: "tool", content: [result] }];

const quiet = (knex, conversationId) => knex("agent_runs").where({ conversation_id: conversationId }).update({ heartbeat_at: knex.raw("now() - interval '5 minutes'") });

test("createRuns answers a conversation's saved state in fixed shapes", async (context) => {
  requireTestDatabase(process.env);
  const knex = await testDatabase(context);
  const runs = createRuns({ knex });
  assert.equal(runs.limits, RUN_LIMITS, "the default limits object itself");
  assert.deepEqual(RUN_LIMITS, { staleSeconds: 60, heartbeatMs: 15000 });
  assert.deepEqual(Object.keys(runs).sort(), ["claim", "heartbeat", "limits", "release", "save", "saved", "takeOverStalled"]);
  assert.ok(Object.isFrozen(runs));

  assert.equal(await runs.saved(1), undefined, "a conversation never claimed has nothing saved");
  assert.equal(await runs.claim(1), true);
  assert.deepEqual(await runs.saved(1), { steps: null, input: null }, "claimed, nothing saved yet: both null");
  await runs.save(1, steps, { human: true, answers: 5 });
  assert.deepEqual(await runs.saved(1), { steps, input: { human: true, answers: 5 } }, "the JSON comes back whole");
  await runs.save(1, [], null);
  assert.deepEqual(await runs.saved(1), { steps: [], input: null }, "a later save replaces both");
  assert.equal(await runs.claim("1"), false, "a string id names the same conversation");
  assert.equal(await runs.claim(2), true, "another conversation is claimed on its own");
  assert.deepEqual(await runs.saved(2), { steps: null, input: null });
});

test("save() writes nothing for a conversation nobody claimed, and keeps a run alive", async (context) => {
  requireTestDatabase(process.env);
  const knex = await testDatabase(context);
  await knex.schema.alterTable("agent_runs", (table) => table.bigInteger("bot_id"));
  const runs = createRuns({ knex });

  await runs.save(2, steps, { human: true });
  assert.equal(await runs.saved(2), undefined, "no row is created by save()");
  await runs.heartbeat(2);
  await runs.release(2);
  assert.equal(await runs.saved(2), undefined, "heartbeat and release of an unknown conversation do nothing");

  assert.equal(await runs.claim(3, { bot_id: 7 }), true);
  await runs.save(3, steps, { human: true });
  await quiet(knex, 3);
  await runs.save(3, steps, { human: false });
  assert.equal(await runs.claim(3), false, "save() beats the heartbeat too");
  assert.deepEqual(await runs.takeOverStalled(), []);

  await quiet(knex, 3);
  assert.equal(await runs.claim(3, { bot_id: 8 }), true, "a stale run is claimed afresh");
  assert.deepEqual(await runs.saved(3), { steps, input: { human: false } },
    "a stale claim keeps the stopped reply's steps and input");
  await quiet(knex, 3);
  const [taken] = await runs.takeOverStalled();
  assert.equal(taken.bot_id, "7", "a stale claim leaves the app's owner columns as the first claim wrote them");
});

test("takeOverStalled answers whole rows, at most `count`, of stale runs with steps", async (context) => {
  requireTestDatabase(process.env);
  const knex = await testDatabase(context);
  const runs = createRuns({ knex });
  const old = knex.raw("now() - interval '5 minutes'");
  await knex("agent_runs").insert([
    { conversation_id: 10, heartbeat_at: old, steps: JSON.stringify(steps), input: JSON.stringify({ human: true }) },
    { conversation_id: 11, heartbeat_at: old, steps: JSON.stringify(steps), input: JSON.stringify({ human: true }) },
    { conversation_id: 12, heartbeat_at: old, steps: JSON.stringify([]), input: JSON.stringify({ human: false }) },
    { conversation_id: 13, heartbeat_at: old },
    { conversation_id: 14, steps: JSON.stringify(steps), input: JSON.stringify({ human: true }) }
  ]);
  const before = Date.now();
  const first = await runs.takeOverStalled({ count: 2 });
  assert.equal(first.length, 2, "count bounds one call");
  const second = await runs.takeOverStalled();
  assert.equal(second.length, 1, "the next call takes the rest");
  assert.deepEqual(await runs.takeOverStalled(), []);
  const all = [...first, ...second];
  assert.deepEqual(all.map((run) => run.conversation_id).sort(), ["10", "11", "12"],
    "stale runs with steps (an empty list counts), ids as strings; none without steps, none still beating");
  for (const run of all) {
    assert.deepEqual(Object.keys(run).sort(), ["conversation_id", "heartbeat_at", "input", "started_at", "steps"]);
    assert.ok(run.started_at instanceof Date && run.heartbeat_at instanceof Date);
    assert.ok(run.heartbeat_at.getTime() >= before - 5000, "taken over now: its heartbeat is fresh");
    assert.equal(await runs.claim(Number(run.conversation_id)), false, "and it is this server's");
  }
  assert.deepEqual(all.find((run) => run.conversation_id === "12").steps, []);
  assert.deepEqual(all.find((run) => run.conversation_id === "10").steps, steps);
  assert.deepEqual(all.find((run) => run.conversation_id === "10").input, { human: true });
});

test("the staleness limit is the runs' own", async (context) => {
  requireTestDatabase(process.env);
  const knex = await testDatabase(context);
  const limits = { staleSeconds: 3600, heartbeatMs: 1000 };
  const runs = createRuns({ knex, limits });
  assert.equal(runs.limits, limits);
  assert.equal(await runs.claim(20), true);
  await runs.save(20, steps, {});
  await quiet(knex, 20);
  assert.equal(await runs.claim(20), false, "five minutes quiet is not stale under an hour's limit");
  assert.deepEqual(await runs.takeOverStalled(), []);
  assert.equal(await createRuns({ knex }).claim(20), true, "while the default minute's limit finds it stale");
});

test("resumable(query) narrows takeOverStalled and the resumer with the store's query builder", async (context) => {
  requireTestDatabase(process.env);
  const knex = await testDatabase(context);
  const runs = createRuns({ knex });
  const old = knex.raw("now() - interval '5 minutes'");
  await knex("agent_runs").insert([
    { conversation_id: 30, heartbeat_at: old, steps: JSON.stringify(steps), input: JSON.stringify({ human: true }) },
    { conversation_id: 31, heartbeat_at: old, steps: JSON.stringify(steps), input: JSON.stringify({ human: false }) }
  ]);
  // Callers narrow with Knex query-builder methods today (whereRaw on the jsonb input).
  const resumable = (query) => query.whereRaw("input->>'human' = 'false'");
  const resumed = [];
  const resumer = startResumer({ runs, resumable, resume: async (run) => resumed.push(run.conversation_id), everyMs: 60000 });
  for (let tries = 0; tries < 40 && !resumed.length; tries += 1) await new Promise((resolve) => setTimeout(resolve, 25));
  await resumer.drain(1000);
  assert.deepEqual(resumed, ["31"], "the resumer hands resume() the whole taken-over row");
  assert.deepEqual((await runs.takeOverStalled()).map((run) => run.conversation_id), ["30"]);
});

// Incidental today: the writes answer Knex's count of rows touched. Nothing in the package reads
// these; pinned so a conversion that changes them does it on purpose.
test("heartbeat, release and save answer the number of rows they touched", async (context) => {
  requireTestDatabase(process.env);
  const knex = await testDatabase(context);
  const runs = createRuns({ knex });
  assert.equal(await runs.claim(40), true);
  assert.equal(await runs.heartbeat(40), 1);
  assert.equal(await runs.save(40, steps, {}), 1);
  assert.equal(await runs.release(40), 1);
  assert.equal(await runs.heartbeat(40), 0);
  assert.equal(await runs.save(40, steps, {}), 0);
  assert.equal(await runs.release(40), 0);
});
