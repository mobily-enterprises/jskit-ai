import assert from "node:assert/strict";
import test from "node:test";
import { SUMMARY_LIMITS } from "@jskit-ai/agent/server";
import { requireTestDatabase } from "@jskit-ai/database-runtime/server/testDatabases";
import { createSummaries } from "../src/server/index.js";
import { OTHER_DATABASE, agentOwner, testDatabase } from "./database.js";

// What createSummaries answers and keeps today, pinned before its tables move onto resources: the
// shapes of current() and compact(), summaries kept per conversation, the newest-summary-wins rule
// between servers, how many summaries are kept, the queue's order, lease, idempotency, failure
// back-off and empty-summary error, and a job whose compact is skipped.
const limits = { ...SUMMARY_LIMITS, compactAt: 100, summariseNowAt: 1000000, keepTurns: 1, keepTokens: 50, minTokens: 10, keepSummaries: 2 };
const words = (n) => `Message ${n}. ${"Some detail here. ".repeat(11)}`;

async function conversations(context) {
  const knex = await testDatabase(context);
  const agent = await agentOwner(knex);
  await knex.schema.createTable("chat_messages", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("conversation_id").notNullable();
    table.string("kind", 20).notNullable().defaultTo("text");
    table.string("role", 20).notNullable();
    table.jsonb("body").notNullable();
  });
  const say = (conversationId, role, text) => knex("chat_messages").insert({ conversation_id: conversationId, role, body: { text } });
  const exchanges = async (conversationId, from, to) => {
    for (let n = from; n <= to; n += 1) {
      await say(conversationId, "user", words(n));
      await say(conversationId, "bot", `Answer ${n}`);
    }
  };
  const history = async (conversationId, { after }) => ({
    messages: await knex("chat_messages").where({ conversation_id: conversationId }).where("id", ">", after).orderBy("id"),
    inherited: [],
    toModel: async (messages) => messages.map((message) => ({ role: message.role === "user" ? "user" : "assistant", content: message.body.text }))
  });
  const queued = (conversationId) => knex("agent_summary_queue").where({ conversation_id: conversationId }).first();
  return { knex, agent, say, exchanges, history, queued };
}

test("current() and compact() answer fixed shapes, per conversation", { skip: OTHER_DATABASE }, async (context) => {
  requireTestDatabase(process.env);
  const { knex, agent, exchanges, history } = await conversations(context);
  const store = createSummaries({ ...agent, history, limits, summarize: async () => "SUMMARY ONE" });
  assert.deepEqual(Object.keys(store).sort(), ["compact", "consider", "current", "ensureWithin", "runOne", "start"]);
  assert.ok(Object.isFrozen(store));
  assert.deepEqual(await store.current(1), { summary: "", after: 0 });

  await exchanges(1, 1, 4);
  await exchanges(2, 1, 1);
  const done = await store.compact(1);
  assert.deepEqual(Object.keys(done).sort(), ["coversUpTo", "messages"]);
  assert.equal(typeof done.coversUpTo, "number", "a message id, as a number");
  assert.equal(done.messages, 6, "every turn but the latest");
  const [, , , , , sixth] = await knex("chat_messages").where({ conversation_id: 1 }).orderBy("id");
  assert.equal(done.coversUpTo, Number(sixth.id));
  assert.deepEqual(await store.current(1), { summary: "SUMMARY ONE", after: done.coversUpTo });
  assert.deepEqual(await store.current(2), { summary: "", after: 0 }, "another conversation has no summary");
  assert.deepEqual(await store.compact(2), { skipped: "nothing to summarise yet" });
  assert.deepEqual(await store.current(2), { summary: "", after: 0 });
});

test("only the newest summaries are kept, and a reply reads the newest", { skip: OTHER_DATABASE }, async (context) => {
  requireTestDatabase(process.env);
  const { knex, agent, exchanges, history } = await conversations(context);
  let count = 0;
  const store = createSummaries({ ...agent, history, limits, summarize: async ({ previous }) => `SUMMARY ${++count} after [${previous}]` });
  await exchanges(3, 1, 4);
  await store.compact(3);
  await exchanges(3, 5, 7);
  await store.compact(3);
  await exchanges(3, 8, 10);
  const last = await store.compact(3);
  const rows = await knex("agent_summaries").where({ conversation_id: 3 }).orderBy("id");
  assert.deepEqual(rows.map((row) => row.summary), ["SUMMARY 2 after [SUMMARY 1 after []]", "SUMMARY 3 after [SUMMARY 2 after [SUMMARY 1 after []]]"],
    "keepSummaries of them, the oldest dropped");
  assert.deepEqual(await store.current(3), { summary: rows[1].summary, after: last.coversUpTo });
});

test("another server's newer summary wins, and the losing compact still answers what it covered", { skip: OTHER_DATABASE }, async (context) => {
  requireTestDatabase(process.env);
  const { knex, agent, exchanges, history } = await conversations(context);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let reached;
  const started = new Promise((resolve) => (reached = resolve));
  const slow = createSummaries({ ...agent, history, limits, summarize: async () => {
    reached();
    await gate;
    return "SLOW SERVER";
  } });
  const fast = createSummaries({ ...agent, history, limits, summarize: async () => "FAST SERVER" });
  await exchanges(4, 1, 4);
  const losing = slow.compact(4);
  await started;
  const winning = await fast.compact(4);
  release();
  assert.deepEqual(await losing, winning, "the same answer, though nothing was written");
  assert.deepEqual((await knex("agent_summaries").where({ conversation_id: 4 })).map((row) => row.summary), ["FAST SERVER"]);
  assert.equal((await slow.current(4)).summary, "FAST SERVER");
});

test("the queue keeps one request per conversation, runs the oldest first and leaves a leased one alone", { skip: OTHER_DATABASE }, async (context) => {
  requireTestDatabase(process.env);
  const { knex, agent, exchanges, history, queued } = await conversations(context);
  const order = [];
  const store = createSummaries({ ...agent, history, limits, summarize: async () => "QUEUED SUMMARY", track: (conversationId, work) => (order.push(conversationId), work()) });
  await exchanges(5, 1, 4);
  await exchanges(6, 1, 4);
  assert.equal(await store.consider(5), true);
  const first = await queued(5);
  assert.equal(await store.consider(5), true, "asking again answers true again");
  assert.equal((await knex("agent_summary_queue").where({ conversation_id: 5 })).length, 1, "one request per conversation");
  assert.equal((await queued(5)).requested_at.getTime(), first.requested_at.getTime(), "the first request keeps its place");
  assert.equal(await store.consider(6), true);
  assert.equal(first.attempts, 0);
  assert.equal(first.last_error, null);
  assert.equal(first.lease_until, null);

  assert.equal(await store.runOne(), true);
  assert.deepEqual(order.map(String), ["5"], "oldest request first");
  assert.equal(await queued(5), undefined, "done and removed, with nothing left too long");

  await knex("agent_summary_queue").where({ conversation_id: 6 }).update({ lease_until: knex.raw("now() + interval '1 minute'") });
  assert.equal(await store.runOne(), false, "a job another server holds is left alone");
  await knex("agent_summary_queue").where({ conversation_id: 6 }).update({ lease_until: knex.raw("now() - interval '1 second'") });
  assert.equal(await store.runOne(), true, "an expired lease is taken over");
  assert.deepEqual(order.map(String), ["5", "6"]);
  assert.equal(await store.runOne(), false, "nothing left");
});

test("an empty summary is an error; failures back off 1, then 2 minutes", { skip: OTHER_DATABASE }, async (context) => {
  requireTestDatabase(process.env);
  const { knex, agent, exchanges, history, queued } = await conversations(context);
  const store = createSummaries({ ...agent, history, limits, summarize: async () => "" });
  await exchanges(7, 1, 4);
  await assert.rejects(store.compact(7), (error) => error instanceof Error && error.message === "The summary came back empty.");
  assert.equal(await store.consider(7), true);
  assert.equal(await store.runOne(), true);
  const once = await queued(7);
  assert.equal(once.attempts, 1);
  assert.equal(once.last_error, "The summary came back empty.");
  assert.equal(once.lease_until, null);
  const firstWait = once.run_after.getTime() - Date.now();
  assert.ok(firstWait > 30000 && firstWait < 90000, `about a minute (${firstWait} ms)`);
  await knex("agent_summary_queue").where({ conversation_id: 7 }).update({ run_after: knex.fn.now() });
  assert.equal(await store.runOne(), true);
  const twice = await queued(7);
  assert.equal(twice.attempts, 2);
  const secondWait = twice.run_after.getTime() - Date.now();
  assert.ok(secondWait > 90000 && secondWait < 150000, `about two minutes (${secondWait} ms)`);
  assert.deepEqual(await store.current(7), { summary: "", after: 0 }, "nothing was written");
});

// Likely a bug, pinned as it is: a conversation over compactAt whose compact is skipped (here one
// long turn, so there is no turn boundary to cut at) is removed from the queue and queued again
// at once by the same runOne() (with a wake notice), so the loop takes it up again straight away,
// up to 20 times a tick, without ever summarising it.
test("a queued conversation whose compact is skipped is queued again at once", { skip: OTHER_DATABASE }, async (context) => {
  requireTestDatabase(process.env);
  const { agent, say, history, queued } = await conversations(context);
  const summarized = [];
  const store = createSummaries({ ...agent, history, limits, summarize: async (input) => (summarized.push(input), "NEVER") });
  await say(8, "user", "One long turn. ".repeat(60));
  await say(8, "bot", "A long answer. ".repeat(60));
  assert.equal(await store.consider(8), true);
  const before = await queued(8);
  assert.deepEqual(await store.compact(8), { skipped: "nothing to summarise yet" });
  assert.equal(await store.runOne(), true);
  const again = await queued(8);
  assert.ok(again, "queued again");
  assert.equal(again.attempts, 0);
  assert.equal(again.last_error, null);
  assert.ok(again.requested_at.getTime() >= before.requested_at.getTime(), "as a new request");
  assert.equal(await store.runOne(), true, "and taken up again straight away");
  assert.deepEqual(summarized, [], "without ever summarising");
});
