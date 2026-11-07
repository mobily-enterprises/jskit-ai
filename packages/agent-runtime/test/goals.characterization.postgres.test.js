import assert from "node:assert/strict";
import test from "node:test";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { GOAL_LIMITS, createGoals, createRuns } from "../src/server/index.js";
import { BOT_COLUMN, agentOwner, testDatabase } from "./database.js";

// What createGoals answers and keeps today, pinned before its table moves onto a resource: the
// goal row openGoal() answers and the view the tools answer, the cuts on objective and reason,
// conversations kept apart, what closes a goal and what reopens it, the wake notice, the lease
// that lets only one server run a round, and a round whose conversation is gone.
const CREATED_NOTE = "Work on it now. If this turn ends before it's done, you'll get another round to carry on.";

async function setup(context, { respond = async () => null, claim = null, find = null, limits = {}, owner, notices, columns = false } = {}) {
  const knex = await testDatabase(context);
  if (columns) await knex.schema.alterTable("agent_goals", (table) => table.bigInteger("bot_id"));
  const agent = await agentOwner(knex, columns ? { columns: { goals: BOT_COLUMN } } : {});
  const runs = createRuns(agent);
  const recorded = [];
  const responded = [];
  const make = () => createGoals({
    ...agent,
    runs,
    notices,
    limits: { ...GOAL_LIMITS, ...limits },
    find: find || (async (goal) => ({ conversation_id: goal.conversation_id })),
    respond: async (row, options) => {
      responded.push(row.conversation_id);
      return respond(row, options);
    },
    claim: claim || ((row) => runs.claim(row.conversation_id)),
    record: async (_row, event) => recorded.push(event),
    ...(owner ? { owner } : {})
  });
  const goals = make();
  const rowsOf = (conversationId) => knex("agent_goals").where({ conversation_id: conversationId }).orderBy("id");
  return { knex, runs, goals, make, recorded, responded, rowsOf };
}

test("a goal's row and its view have fixed shapes", async (context) => {
  requireTestDatabase(process.env);
  const { goals, recorded } = await setup(context, { columns: true, owner: (row) => ({ bot_id: row.bot_id }) });
  assert.deepEqual(Object.keys(goals).sort(), ["afterTurn", "openFor", "openGoal", "operationsFor", "resume", "runDue", "start"]);
  assert.ok(Object.isFrozen(goals));
  const long = "x".repeat(2100);
  const made = await goals.operationsFor({ conversation_id: 1, bot_id: 5 }, { human: true }).create(long);
  assert.deepEqual(made, { status: "created", goal: { objective: "x".repeat(2000), status: "active", rounds: 0, maxRounds: 24 }, note: CREATED_NOTE },
    "the objective is cut to 2000 characters; no reason key while there is none");
  assert.deepEqual(recorded, [{ text: "Working on a goal", detail: `Goal set: ${"x".repeat(2000)}` }]);

  const open = await goals.openGoal(1);
  assert.deepEqual(Object.keys(open).sort(), ["attempts", "bot_id", "conversation_id", "created_at", "id", "language", "lease_until",
    "max_rounds", "objective", "reason", "round_at", "rounds", "status", "time_zone", "updated_at"]);
  assert.equal(typeof open.id, "string", "bigint ids come back as strings");
  assert.equal(open.conversation_id, "1");
  assert.equal(open.bot_id, "5", "with the app's owner columns");
  assert.equal(open.status, "active");
  assert.equal(open.rounds, 0);
  assert.equal(open.max_rounds, 24);
  assert.equal(open.reason, null);
  assert.equal(open.time_zone, "UTC", "operationsFor's default time zone");
  assert.equal(open.language, "", "and language");
  assert.equal(open.round_at, null);
  assert.equal(open.lease_until, null);
  assert.equal(open.attempts, 0);
  assert.ok(open.created_at instanceof Date && open.updated_at instanceof Date);
  assert.equal(await goals.openGoal(2), undefined, "no goal: undefined, not null");
  assert.deepEqual(await goals.operationsFor({ conversation_id: 2 }).get(), { goal: null });
});

test("conversations keep their own goals", async (context) => {
  requireTestDatabase(process.env);
  const { goals, rowsOf } = await setup(context);
  await goals.operationsFor({ conversation_id: 1 }, { human: true }).create("First conversation's goal");
  await goals.operationsFor({ conversation_id: 2 }, { human: true, timeZone: "Europe/Rome", language: "it" }).create("Second conversation's goal");
  assert.equal((await goals.operationsFor({ conversation_id: 1 }).get()).goal.objective, "First conversation's goal");
  assert.equal((await goals.operationsFor({ conversation_id: 2 }).get()).goal.objective, "Second conversation's goal");
  assert.equal((await goals.operationsFor({ conversation_id: 2 }).update({ action: "pause" })).status, "paused");
  assert.equal((await goals.openGoal(1)).status, "active", "pausing one conversation's goal leaves the other's");
  await goals.afterTurn(2);
  assert.equal((await goals.openGoal(1)).round_at, null, "a turn in one conversation queues nothing in another");
  await goals.resume(1);
  assert.equal((await goals.openGoal(2)).status, "paused", "resume is per conversation");
  assert.equal((await rowsOf(2))[0].time_zone, "Europe/Rome");
  assert.equal((await rowsOf(2))[0].language, "it");
});

test("complete and blocked close a goal: it is no longer open, resume leaves it, a new one may open", async (context) => {
  requireTestDatabase(process.env);
  const { knex, goals, recorded, rowsOf } = await setup(context);
  const row = { conversation_id: 1 };
  await goals.operationsFor(row, { human: true }).create("Finish it");
  await knex("agent_goals").where({ conversation_id: 1 }).update({ updated_at: knex.raw("now() - interval '1 minute'") });
  const before = (await goals.openGoal(1)).updated_at;
  assert.deepEqual(await goals.operationsFor(row).update({ action: "edit", objective: "y".repeat(2100) }), { status: "edited" });
  const edited = await goals.openGoal(1);
  assert.equal(edited.objective, "y".repeat(2000), "an edit is cut to 2000 characters too");
  assert.ok(edited.updated_at > before, "and moves updated_at");

  assert.equal((await goals.operationsFor(row).update({ action: "complete" })).status, "complete");
  assert.equal(await goals.openGoal(1), undefined);
  assert.deepEqual(await goals.operationsFor(row).get(), { goal: null });
  assert.deepEqual(await goals.operationsFor(row).update({ action: "pause" }), { error: "There's no open goal here." });
  await goals.resume(1);
  assert.equal((await rowsOf(1))[0].status, "complete", "resume reopens only a paused goal");
  assert.equal((await rowsOf(1))[0].round_at, null);

  await goals.operationsFor(row, { human: true }).create("A second job");
  await knex("agent_goals").where({ conversation_id: 1, status: "active" }).update({ rounds: 3 });
  const blocked = await goals.operationsFor(row).update({ action: "blocked", reason: "r".repeat(1100) });
  assert.equal(blocked.status, "blocked");
  const rows = await rowsOf(1);
  assert.deepEqual(rows.map((goal) => goal.status), ["complete", "blocked"], "closed goals stay, one row each");
  assert.equal(rows[1].reason, "r".repeat(1000), "a blocked reason is cut to 1000 characters");

  await goals.operationsFor(row, { human: true }).create("A third job");
  await knex("agent_goals").where({ conversation_id: 1, status: "active" }).update({ rounds: 3 });
  await goals.operationsFor(row).update({ action: "blocked" });
  assert.equal((await rowsOf(1))[2].reason, "", "blocked without a reason stores an empty reason, not null");
  assert.equal(recorded.at(-1).detail, "Blocked: A third job. ", "and its event line ends in a space");
});

test("a goal an error paused stays open, with its reason in the view, and resume keeps that reason", async (context) => {
  requireTestDatabase(process.env);
  const { goals } = await setup(context, {
    respond: async () => {
      throw new Error("the model is unavailable");
    }
  });
  const row = { conversation_id: 1 };
  await goals.operationsFor(row, { human: true }).create("Try something");
  await goals.afterTurn(1);
  await goals.runDue();
  const view = { objective: "Try something", status: "paused", rounds: 1, maxRounds: 24, reason: "the model is unavailable" };
  assert.deepEqual(await goals.operationsFor(row).get(), { goal: view });
  assert.deepEqual(await goals.operationsFor(row, { human: true }).create("Another"), {
    error: "There's already a goal here; read it with get_goal, or update it.",
    goal: view
  });
  const paused = await goals.openGoal(1);
  assert.equal(paused.round_at, null);
  assert.equal(paused.lease_until, null);
  await goals.resume(1);
  // The reason of the error is kept after the person carries on.
  assert.deepEqual(await goals.operationsFor(row).get(), { goal: { ...view, status: "active" } });
});

test("afterTurn queues one round and wakes the other servers; pause cancels the queued round", async (context) => {
  requireTestDatabase(process.env);
  const published = [];
  const notices = {
    publish: async (channel, key, payload) => published.push({ channel, key, payload }),
    subscribe: () => () => {}
  };
  // The conversation is busy, so the round waits retryMs.
  const { goals, responded } = await setup(context, { notices, claim: async () => false, limits: { retryMs: 60000 } });
  const row = { conversation_id: 1 };
  await goals.operationsFor(row, { human: true }).create("Wait for it");
  assert.deepEqual(published, [], "opening a goal wakes nobody");
  await goals.afterTurn(1);
  await goals.runDue();
  assert.deepEqual(published, [{ channel: "agent-goals", key: "all", payload: {} }]);
  const waiting = await goals.openGoal(1);
  assert.ok(waiting.round_at instanceof Date && waiting.round_at.getTime() > Date.now() + 30000, "retried retryMs later");
  assert.equal(waiting.lease_until, null);
  assert.equal(waiting.rounds, 0);
  assert.deepEqual(responded, []);

  await goals.afterTurn(1);
  await goals.runDue();
  assert.equal((await goals.openGoal(1)).round_at.getTime(), waiting.round_at.getTime(), "a queued round is not queued again");
  assert.equal(published.length, 2, "though each turn wakes the servers");

  await goals.operationsFor(row).update({ action: "pause" });
  const paused = await goals.openGoal(1);
  assert.equal(paused.status, "paused");
  assert.equal(paused.round_at, null, "pausing drops the queued round");
});

test("a due round runs on one server only, and not while another server's lease holds it", async (context) => {
  requireTestDatabase(process.env);
  let release;
  let gate = new Promise((resolve) => (release = resolve));
  let reached;
  const started = new Promise((resolve) => (reached = resolve));
  let goalsA = null;
  const { knex, make, responded } = await setup(context, {
    respond: async (row) => {
      reached();
      await gate;
      return goalsA.operationsFor(row).update({ action: "complete" });
    }
  });
  goalsA = make();
  const goalsB = make();
  await goalsA.operationsFor({ conversation_id: 1 }, { human: true }).create("One server at a time");
  await goalsA.afterTurn(1);
  await started;
  await goalsB.runDue();
  assert.deepEqual(responded, ["1"], "the other server finds nothing to run");
  release();
  await goalsA.runDue();
  const done = await knex("agent_goals").where({ conversation_id: 1 }).first();
  assert.equal(done.status, "complete");
  assert.equal(done.rounds, 1);
  assert.equal(done.round_at, null);
  assert.equal(done.lease_until, null, "a finished round lets its lease go");
  assert.equal(done.attempts, 0);

  gate = Promise.resolve();
  await goalsA.operationsFor({ conversation_id: 2 }, { human: true }).create("Held by a lease");
  await knex("agent_goals").where({ conversation_id: 2 }).update({ round_at: knex.fn.now(), lease_until: knex.raw("now() + interval '1 minute'") });
  await goalsB.runDue();
  assert.deepEqual(responded, ["1"], "a live lease keeps a due round from other servers");
  await knex("agent_goals").where({ conversation_id: 2 }).update({ lease_until: knex.raw("now() - interval '1 second'") });
  await goalsB.runDue();
  assert.deepEqual(responded, ["1", "2"], "an expired lease is taken over");
});

test("a round whose conversation is gone pauses its goal without running", async (context) => {
  requireTestDatabase(process.env);
  const { goals, responded, rowsOf } = await setup(context, { find: async () => null });
  await goals.operationsFor({ conversation_id: 1 }, { human: true }).create("Gone");
  await goals.afterTurn(1);
  await goals.runDue();
  const [goal] = await rowsOf(1);
  assert.equal(goal.status, "paused");
  assert.equal(goal.rounds, 0);
  assert.equal(goal.round_at, null);
  assert.equal(goal.lease_until, null);
  assert.equal(goal.reason, null, "with no reason");
  assert.deepEqual(responded, []);
});
