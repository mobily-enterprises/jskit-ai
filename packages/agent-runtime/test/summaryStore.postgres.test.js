import assert from "node:assert/strict";
import test from "node:test";
import { SUMMARY_LIMITS } from "@jskit-ai/agent/server";
import { createSummaries } from "../src/server/index.js";
import { DATABASE, testDatabase } from "./database.js";

// Summarising conversations in the background: past a size, a conversation is queued; one server
// summarises all but its latest turns, folding in the previous summary; replies read the summary
// plus every message after it word for word; messages that arrive while it runs stay as they are;
// failures wait and try again; a first summary takes in what the conversation inherited.
const limits = { ...SUMMARY_LIMITS, compactAt: 500, keepTurns: 2, keepTokens: 400, minTokens: 50 };

async function conversations(context) {
  const knex = await testDatabase(context);
  await knex.schema.createTable("chat_messages", (table) => {
    table.bigIncrements("id").primary();
    table.bigInteger("conversation_id").notNullable();
    table.string("kind", 20).notNullable().defaultTo("text");
    table.string("role", 20).notNullable();
    table.jsonb("body").notNullable();
  });
  const inherited = new Map();
  const say = (conversationId, role, text) => knex("chat_messages").insert({ conversation_id: conversationId, role, body: { text } });
  // The app's side: its stored messages after a summary, what a conversation inherits, and how it
  // turns messages into model messages.
  const history = async (conversationId, { after }) => ({
    messages: await knex("chat_messages").where({ conversation_id: conversationId }).where("id", ">", after).orderBy("id"),
    inherited: inherited.get(conversationId) || [],
    toModel: async (messages) => messages.map((message) => ({ role: message.role === "user" ? "user" : "assistant", content: message.body.text })),
    named: false
  });
  return { knex, say, history, inherited };
}

test("long conversations are summarised in the background, once, and replies read the summary", { skip: DATABASE }, async (context) => {
  const { knex, say, history } = await conversations(context);
  const summaries = [];
  let summarizer = async ({ previous, text }) => {
    summaries.push({ previous, text });
    return `SUMMARY ${summaries.length}`;
  };
  const tracked = [];
  const store = createSummaries({ knex, history, limits, summarize: (input) => summarizer(input), track: (conversationId, work) => (tracked.push(conversationId), work()) });
  const queued = () => knex("agent_summary_queue").where({ conversation_id: 1 }).first();
  const exchange = async (n, size) => {
    await say(1, "user", `${n === 1 ? "My name is Ada and my budget is 4,200 euros. " : `Message ${n}. `}${"More detail. ".repeat(size)}`);
    await say(1, "bot", `Answer ${n}`);
  };

  await exchange(1, 20);
  assert.equal(await store.consider(1), false);
  assert.equal(await queued(), undefined, "below the size nothing is queued");
  for (let n = 2; n <= 6; n += 1) await exchange(n, 30);
  assert.equal(await store.consider(1), true);
  assert.ok(await queued(), "queued once the conversation grew past the limit");
  assert.deepEqual(await store.current(1), { summary: "", after: 0 }, "no summary yet: a reply reads everything");

  // Two servers try at once: one summarises.
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  summarizer = async ({ previous, text }) => {
    await gate;
    summaries.push({ previous, text });
    return `SUMMARY ${summaries.length}`;
  };
  const first = store.runOne();
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(await store.runOne(), false, "the other server finds nothing to claim");
  // A message arriving while the summary is written stays word for word after it.
  await say(1, "user", "Arrived during the summary.");
  release();
  assert.equal(await first, true);
  const [summary] = await knex("agent_summaries").where({ conversation_id: 1 });
  assert.equal(summaries.length, 1);
  assert.match(summaries[0].text, /^Person: My name is Ada and my budget is 4,200 euros\./mu);
  assert.match(summaries[0].text, /^Bot: Answer 1$/mu);
  assert.ok(!summaries[0].text.includes("Arrived during the summary."));
  assert.deepEqual(tracked.map(Number), [1], "metered to the conversation");
  assert.equal(await queued(), undefined, "done, and nothing more queued while the rest is small");

  // A reply reads the summary and only the messages after it.
  const { summary: text, after } = await store.current(1);
  assert.equal(text, "SUMMARY 1");
  assert.equal(after, Number(summary.covers_up_to));
  const { messages } = await history(1, { after });
  assert.equal(messages[0].role, "user", "it starts at a turn");
  assert.ok(messages.some((message) => message.body.text === "Arrived during the summary."));
  assert.ok(!messages.some((message) => /My name is Ada/u.test(message.body.text)), "summarised messages aren't read again");

  // A failure waits and tries again later.
  for (let n = 7; n <= 12; n += 1) await exchange(n, 30);
  assert.equal(await store.consider(1), true);
  summarizer = async () => {
    throw new Error("model unavailable");
  };
  assert.equal(await store.runOne(), true);
  const failed = await queued();
  assert.equal(failed.attempts, 1);
  assert.match(failed.last_error, /model unavailable/u);
  assert.ok(new Date(failed.run_after) > new Date(), "tried again later");
  assert.equal(await store.runOne(), false, "not before its time");

  // The next summary folds in the previous one.
  await knex("agent_summary_queue").where({ conversation_id: 1 }).update({ run_after: knex.fn.now() });
  summarizer = async ({ previous, text: folded }) => {
    summaries.push({ previous, text: folded });
    return `SUMMARY ${summaries.length}`;
  };
  assert.equal(await store.runOne(), true);
  assert.equal(summaries.at(-1).previous, "SUMMARY 1");
  assert.ok(!summaries.at(-1).text.includes("My name is Ada"), "only what came after the previous summary");
  assert.equal((await store.current(1)).summary, "SUMMARY 2");
  assert.equal(await knex("chat_messages").where({ conversation_id: 1 }).count("* as n").first().then((row) => Number(row.n)), 25, "no message is deleted");
});

test("a first summary takes in what the conversation inherited", { skip: DATABASE }, async (context) => {
  const { knex, say, history, inherited } = await conversations(context);
  const captured = [];
  const store = createSummaries({ knex, history, limits: { ...limits, minTokens: 1 }, summarize: async ({ text }) => (captured.push(text), "ROOM SUMMARY") });
  inherited.set(2, [{ id: "0", role: "user", kind: "text", body: { text: "Inherited: the launch is on 3 March." } }]);
  for (let n = 0; n < 4; n += 1) {
    await say(2, "user", `Room message ${n}`);
    await say(2, "bot", `Room answer ${n}`);
  }
  const done = await store.compact(2);
  assert.equal(done.messages, 4, "all but the latest two turns");
  assert.match(captured[0], /^Person: Inherited: the launch is on 3 March\.$/mu);
  assert.match(captured[0], /^Person: Room message 0$/mu);
  assert.match(captured[0], /^Bot: Room answer 0$/mu);
  assert.equal((await knex("agent_summaries").where({ conversation_id: 2 }).first()).summary, "ROOM SUMMARY");
  assert.deepEqual(await createSummaries({ knex, history, limits }).compact(3), { skipped: "nothing to summarise yet" });
  await say(4, "user", "a");
  await say(4, "bot", "b");
  await say(4, "user", "c");
  assert.deepEqual(await createSummaries({ knex, history, limits: { ...limits, keepTurns: 1 } }).compact(4), { skipped: "too little to summarise" });
});

test("a reply summarises first, rather than dropping messages unseen, when summarising fell behind", { skip: DATABASE }, async (context) => {
  const { knex, say, history } = await conversations(context);
  const filler = "We talked about the garden, the weather and the week ahead. ".repeat(14);
  for (let n = 0; n < 12; n += 1) {
    await say(5, "user", `${n === 0 ? "My sister Lucia's birthday is 14 March. " : ""}${filler}`);
    await say(5, "bot", `Noted. ${filler}`);
  }
  const summaries = [];
  const store = createSummaries({
    knex,
    history,
    limits: { ...SUMMARY_LIMITS, compactAt: 1000000, summariseNowAt: 1500, keepTurns: 2, keepTokens: 400, minTokens: 50 },
    summarize: async ({ text }) => {
      summaries.push(text);
      return `SUMMARY: ${/Lucia's birthday is 14 March/u.test(text) ? "Lucia's birthday is 14 March." : "nothing"}`;
    }
  });
  await store.ensureWithin(5);
  assert.ok(summaries.length >= 1, "it summarised before the reply");
  const { summary, after } = await store.current(5);
  assert.match(summary, /Lucia's birthday is 14 March/u, "so the oldest fact isn't lost");
  assert.ok((await history(5, { after })).messages.length < 24, "while fewer messages are read word for word");
});

test("a notice wakes every server's loop, which summarises what's queued", { skip: DATABASE }, async (context) => {
  const { knex, say, history } = await conversations(context);
  const listeners = [];
  const published = [];
  const notices = {
    publish: async (channel, key) => {
      published.push(`${channel}:${key}`);
      for (const listener of listeners) listener();
    },
    subscribe: (_channel, _key, listener) => {
      listeners.push(listener);
      return () => listeners.splice(listeners.indexOf(listener), 1);
    }
  };
  const store = createSummaries({ knex, history, notices, limits, summarize: async () => "WOKEN SUMMARY" });
  const loop = store.start({ everyMs: 60000 });
  for (let n = 0; n < 6; n += 1) {
    await say(6, "user", `Message ${n}. ${"Detail. ".repeat(60)}`);
    await say(6, "bot", `Answer ${n}`);
  }
  assert.equal(await store.consider(6), true);
  assert.deepEqual(published, ["agent-summaries:all"]);
  for (let tries = 0; tries < 40 && !(await knex("agent_summaries").where({ conversation_id: 6 }).first()); tries += 1) await new Promise((resolve) => setTimeout(resolve, 50));
  await loop.drain(1000);
  assert.equal((await store.current(6)).summary, "WOKEN SUMMARY");
  assert.equal(listeners.length, 0, "drained, it stops listening");
});
