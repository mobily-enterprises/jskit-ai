import assert from "node:assert/strict";
import test from "node:test";
import { GOAL_LIMITS, createGoals, createRuns, goalTools } from "../src/server/index.js";
import { DATABASE, agentOwner, testDatabase } from "./database.js";

// Goal rounds (after DeepSeek Harness P3–P5), with scripted turns in place of the model: a reply
// that stops short is sent another round until it marks the goal complete; "blocked" needs real
// attempts; the round cap and the cost limit end it; only the person's own turn opens one.
async function setup(context, script, { limits = {}, spent = 0 } = {}) {
  const knex = await testDatabase(context);
  const agent = await agentOwner(knex);
  const runs = createRuns(agent);
  const recorded = [];
  const notified = [];
  const prompts = [];
  let goals = null;
  const turn = async (row, options) => {
    prompts.push(options.prompt);
    return script(goalTools(goals.operationsFor(row, { human: !options.goalTurn, ...options })), options.prompt);
  };
  goals = createGoals({
    ...agent,
    runs,
    limits: { ...GOAL_LIMITS, retryMs: 200, ...limits },
    find: async (goal) => ({ conversation_id: goal.conversation_id }),
    respond: turn,
    claim: (row) => runs.claim(row.conversation_id),
    record: async (_row, event) => recorded.push(event),
    notify: async (_row, event) => notified.push(event.type),
    spent: async () => spent
  });
  // The person's own turn, then whatever rounds it leads to.
  const ask = async (conversationId = 1) => {
    await turn({ conversation_id: conversationId }, { prompt: "", goalTurn: false });
    await goals.afterTurn(conversationId);
    await goals.runDue();
  };
  const goalOf = (conversationId = 1) => knex("agent_goals").where({ conversation_id: conversationId }).orderBy("id", "desc").first();
  return { knex, runs, goals, ask, goalOf, recorded, notified, prompts };
}

test("a reply that stops short gets another round and finishes the goal", { skip: DATABASE }, async (context) => {
  const { ask, goalOf, recorded, prompts } = await setup(context, async (tools, prompt) => {
    if (!prompt) return tools.createGoal.execute({ objective: "Make the report and check it." });
    assert.match(prompt, /<goal_round>/u);
    assert.match(prompt, /Round: 1\/24/u);
    assert.match(prompt, /inspect them instead of assuming earlier narration/u);
    const done = await tools.updateGoal.execute({ action: "complete" });
    assert.match(done.note, /closing message/u);
    return done;
  });
  await ask();
  const goal = await goalOf();
  assert.equal(goal.status, "complete");
  assert.equal(goal.rounds, 1, "one round was enough");
  assert.equal(prompts.length, 2);
  assert.deepEqual(recorded.map((event) => event.text), ["Working on a goal", "Goal complete"]);
});

test("blocked is refused before three rounds", { skip: DATABASE }, async (context) => {
  const answers = [];
  const { ask, goalOf, recorded } = await setup(context, async (tools, prompt) => {
    if (!prompt) return tools.createGoal.execute({ objective: "Do something hard." });
    answers.push(await tools.updateGoal.execute({ action: "blocked", reason: "stuck" }));
    return null;
  }, { limits: { maxRounds: 5 } });
  await ask();
  assert.match(answers[0].error, /at least 3 rounds/u, "round 1 can't give up");
  assert.match(answers[1].error, /at least 3 rounds/u, "nor round 2");
  assert.equal(answers[2].status, "blocked", "round 3 can");
  assert.match(answers[2].note, /concrete blocking condition/u);
  const goal = await goalOf();
  assert.equal(goal.status, "blocked");
  assert.equal(goal.rounds, 3);
  assert.equal(goal.reason, "stuck");
  assert.equal(recorded.at(-1).detail, "Blocked: Do something hard.. stuck");
});

test("the round cap stops a goal that never completes, and says so", { skip: DATABASE }, async (context) => {
  const { ask, goalOf, recorded, notified } = await setup(context, async (tools, prompt) => (prompt ? null : tools.createGoal.execute({ objective: "Endless." })), { limits: { maxRounds: 3 } });
  await ask();
  const goal = await goalOf();
  assert.equal(goal.status, "blocked");
  assert.equal(goal.rounds, 3);
  assert.match(goal.reason, /limit of 3 rounds/u);
  assert.equal(recorded.at(-1).text, "Stopped working on the goal", "the person is told");
  assert.match(recorded.at(-1).detail, /^Stopped after 3 rounds without finishing: Endless\.\. Ask to carry on to continue\.$/u);
  assert.equal(notified.at(-1), "messages");
});

test("only the person's own turn opens a goal, one at a time", { skip: DATABASE }, async (context) => {
  const { goals, goalOf } = await setup(context, async () => null);
  const row = { conversation_id: 1 };
  assert.match((await goals.operationsFor(row).create("A routine's goal")).error, /only be set up in reply to the person's own message/u);
  assert.equal(await goalOf(), undefined);
  const made = await goals.operationsFor(row, { human: true, timeZone: "Europe/Rome", language: "it" }).create("Plan the trip");
  assert.equal(made.status, "created");
  assert.deepEqual(made.goal, { objective: "Plan the trip", status: "active", rounds: 0, maxRounds: 24 });
  assert.match((await goals.operationsFor(row, { human: true }).create("Another one")).error, /already a goal here/u);
  const goal = await goalOf();
  assert.equal(goal.time_zone, "Europe/Rome");
  assert.equal(goal.language, "it");
  assert.deepEqual(await goals.operationsFor(row).get(), { goal: made.goal });
  assert.equal((await goals.operationsFor(row).update({ action: "edit", objective: "Plan the whole trip" })).status, "edited");
  assert.match((await goals.operationsFor(row).update({ action: "edit" })).error, /new objective/u);
  assert.match((await goals.operationsFor(row).update({ action: "explode" })).error, /Use edit, pause, complete or blocked/u);
  assert.equal((await goals.operationsFor(row).update({ action: "pause" })).status, "paused");
  assert.equal((await goalOf()).status, "paused");
  await goals.afterTurn(1);
  assert.equal((await goalOf()).round_at, null, "a paused goal gets no round");
  await goals.resume(1);
  assert.equal((await goalOf()).status, "active", "the person carrying on makes it active again");
  assert.match((await goals.operationsFor({ conversation_id: 2 }).update({ action: "complete" })).error, /no open goal/u);
});

test("a reply that ran out of steps carries on by itself", { skip: DATABASE }, async (context) => {
  const { goals, goalOf, prompts } = await setup(context, async (tools) => tools.updateGoal.execute({ action: "complete" }));
  const opened = await goals.openFor({ conversation_id: 1 }, "Tidy up all my files", { timeZone: "UTC" });
  assert.equal(opened.status, "created");
  await goals.afterTurn(1);
  await goals.runDue();
  const goal = await goalOf();
  assert.equal(goal.objective, "Finish what the person asked: Tidy up all my files");
  assert.equal(goal.status, "complete", "its round finished the job");
  assert.match(prompts[0], /<goal_round>/u, "carried on in a round, not by the person");
});

test("a job stops at its cost limit and says so", { skip: DATABASE }, async (context) => {
  const { ask, goalOf, recorded } = await setup(context, async (tools, prompt) => (prompt ? null : tools.createGoal.execute({ objective: "A big job." })), { limits: { costUsd: 0.5 }, spent: 0.75 });
  await ask();
  const goal = await goalOf();
  assert.equal(goal.status, "blocked");
  assert.equal(goal.rounds, 0, "no round after the limit");
  assert.match(goal.reason, /cost limit of \$0.5/u);
  assert.match(recorded.at(-1).detail, /cost limit \(\$0.5\)/u);
});

test("a reply running in the conversation goes first; the round waits, and an error pauses the goal", { skip: DATABASE }, async (context) => {
  let fail = false;
  const { runs, goals, goalOf, prompts } = await setup(context, async (tools, prompt) => {
    if (!prompt) return tools.createGoal.execute({ objective: "Wait your turn." });
    if (fail) throw new Error("the model is unavailable");
    return tools.updateGoal.execute({ action: "complete" });
  });
  await goals.operationsFor({ conversation_id: 1 }, { human: true }).create("Wait your turn.");
  assert.equal(await runs.claim(1), true, "the person's reply holds the conversation");
  await goals.afterTurn(1);
  await goals.runDue();
  const waiting = await goalOf();
  assert.equal(waiting.rounds, 0, "no round while the reply runs");
  assert.ok(new Date(waiting.round_at) > new Date(Date.now() - 1000), "tried again shortly");
  assert.equal(waiting.lease_until, null);
  await runs.release(1);
  await new Promise((resolve) => setTimeout(resolve, 400));
  await goals.runDue();
  assert.equal((await goalOf()).status, "complete");
  assert.equal(prompts.length, 1);

  fail = true;
  await goals.operationsFor({ conversation_id: 3 }, { human: true }).create("Fails.");
  await goals.afterTurn(3);
  await goals.runDue();
  const failed = await goalOf(3);
  assert.equal(failed.status, "paused", "an error stops the rounds");
  assert.equal(failed.reason, "the model is unavailable");
  assert.equal(await runs.saved(3), undefined, "and frees the conversation");
});

// A round that cannot start (its goal row cannot be written) stops renewing its lease and frees the
// conversation, as a round that fails later does: the renewal used to start before it and run forever.
test("a round that cannot start frees the conversation and stops renewing its lease", { skip: DATABASE }, async (context) => {
  const knex = await testDatabase(context);
  const agent = await agentOwner(knex);
  const runs = createRuns(agent);
  const handle = agent.resources.agentGoals;
  let failStart = true;
  const agentGoals = { ...handle, patch: (id, changes, options) => {
    if (failStart && Object.hasOwn(changes, "rounds")) {
      failStart = false;
      return Promise.reject(new Error("the goal could not be saved"));
    }
    return handle.patch(id, changes, options);
  } };
  const intervals = new Set();
  const realSetInterval = globalThis.setInterval;
  const realClearInterval = globalThis.clearInterval;
  globalThis.setInterval = (...args) => { const timer = realSetInterval(...args); intervals.add(timer); return timer; };
  globalThis.clearInterval = (timer) => { intervals.delete(timer); return realClearInterval(timer); };
  context.after(() => {
    for (const timer of intervals) realClearInterval(timer);
    globalThis.setInterval = realSetInterval;
    globalThis.clearInterval = realClearInterval;
  });
  const goals = createGoals({
    ...agent, resources: { ...agent.resources, agentGoals }, runs, limits: { ...GOAL_LIMITS, retryMs: 200 },
    find: async (goal) => ({ conversation_id: goal.conversation_id }),
    respond: async () => assert.fail("a round that could not start never replies"),
    claim: (row) => runs.claim(row.conversation_id),
    record: async () => {},
    notify: async () => {}
  });
  await goals.operationsFor({ conversation_id: 5 }, { human: true }).create("Start fails.");
  await goals.afterTurn(5);
  await goals.runDue();
  assert.equal(intervals.size, 0, "the lease renewal stopped");
  assert.equal(await runs.saved(5), undefined, "the conversation is free again");
  const goal = await knex("agent_goals").where({ conversation_id: 5 }).first();
  assert.equal(goal.status, "paused", "the rounds stopped");
  assert.equal(goal.reason, "the goal could not be saved");
});
