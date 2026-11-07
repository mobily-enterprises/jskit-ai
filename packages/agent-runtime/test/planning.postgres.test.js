import assert from "node:assert/strict";
import test from "node:test";
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";
import { createTestResourceRuntime } from "@jskit-ai/resource-runtime/test";
import { planningNotes, planningTools } from "../src/server/index.js";
import { DATABASE, testDatabase } from "./database.js";

// The app's chat tables, as an app keeps them, and its planning store on their table resources.
const PLANNING_TABLES = { messages: "agent_messages", conversations: "agent_conversations" };

/** The to-do cards of one conversation: its messages of kind "todos" whose body names it. */
function todosOf(query, list, { column }) {
  query.where(column("kind"), "todos").whereRaw("??->>'list' = ?", [column("body"), list]);
}

async function planningStore(knex) {
  const runtime = await createTestResourceRuntime({ knex });
  const { chatMessages, chatConversations } = await runtime.own("chat.test", [
    defineTableResource({
      name: "chatMessages",
      tableName: PLANNING_TABLES.messages,
      schema: { kind: { type: "string" }, role: { type: "string" }, body: { type: "object" } },
      searchSchema: { todosOf: { type: "string", applyFilter: todosOf } }
    }),
    defineTableResource({ name: "chatConversations", tableName: PLANNING_TABLES.conversations, schema: { job_notes: { type: "array", nullable: true } } })
  ]);
  const options = { context: runtime.createSystemContext({ feature: "chat.test", systemScope: "the planning tools, under test", reason: "the planning tools read and write any conversation under test" }) };
  return {
    async currentTodos(conversationId) {
      const { records } = await chatMessages.query({ filters: { todosOf: String(conversationId) }, sort: ["-id"], page: { size: 1 } }, options);
      return records[0];
    },
    async mergeTodos(cardId, body) {
      await chatMessages.patchWhereIds([cardId], { body: chatMessages.raw("body || ?::jsonb", [JSON.stringify(body)]) }, { ...options, missing: "skip" });
    },
    async jobNotes(conversationId) {
      return (await chatConversations.get(conversationId, { fields: ["job_notes"] }, options))?.job_notes;
    },
    async setJobNotes(conversationId, notes) {
      await chatConversations.patchWhereIds([conversationId], { job_notes: notes }, { ...options, missing: "skip" });
    }
  };
}

// A to-do list the person sees, as one card updated in place, and notes only the model sees; the
// open list and the notes are in the state note at every turn.
async function chat(context) {
  const knex = await testDatabase(context);
  await knex.schema.createTable(PLANNING_TABLES.conversations, (table) => {
    table.bigIncrements("id").primary();
    table.jsonb("job_notes");
  });
  await knex.schema.createTable(PLANNING_TABLES.messages, (table) => {
    table.bigIncrements("id").primary();
    table.string("kind", 20).notNullable();
    table.string("role", 20).notNullable();
    table.jsonb("body").notNullable();
  });
  const [{ id }] = await knex(PLANNING_TABLES.conversations).insert({}).returning("id");
  const told = [];
  const post = async (messages) => {
    told.push(messages.length);
    for (const message of messages) await knex(PLANNING_TABLES.messages).insert(message);
  };
  return { knex, planning: await planningStore(knex), conversationId: id, post, told };
}

test("the to-do card is made, ticked off in place, remembered, and replaced for the next job", { skip: DATABASE }, async (context) => {
  const { knex, planning, conversationId, post, told } = await chat(context);
  const tools = planningTools({ planning, conversationId, post });
  const cards = () => knex(PLANNING_TABLES.messages).where({ kind: "todos" }).orderBy("id");
  const made = await tools.updateTodos.execute({ items: [{ text: "Read the CRM", status: "doing" }, { text: "Add the field", status: "todo" }, { text: "Test it", status: "todo" }] });
  assert.deepEqual(made, { status: "saved" });
  assert.match((await tools.updateTodos.execute({ items: [{ text: "A", status: "doing" }, { text: "B", status: "doing" }] })).error, /Only one item can be doing at a time; these are all doing: A; B\./u);
  await tools.updateTodos.execute({ items: [{ text: "Read the CRM", status: "done" }, { text: "Add the field", status: "doing" }, { text: "Test it", status: "todo" }] });
  let list = await cards();
  assert.equal(list.length, 1, "one card, updated in place");
  assert.deepEqual(list[0].body.items.map((item) => item.status), ["done", "doing", "todo"]);
  assert.deepEqual(told, [1, 0], "open pages are told each time");
  const [state] = await planningNotes(planning, conversationId);
  assert.equal(state, "Your to-do list for this job (keep it up to date with update_todos):\n[x] Read the CRM\n[doing] Add the field\n[ ] Test it");

  const last = await tools.updateTodos.execute({ items: [{ text: "Read the CRM", status: "done" }, { text: "Add the field", status: "done" }, { text: "Test it", status: "done" }] });
  assert.match(last.note, /Everything on the list is done/u);
  assert.deepEqual(await planningNotes(planning, conversationId), [], "a finished list isn't carried");
  await tools.updateTodos.execute({ items: [{ text: "Plan the trip", status: "doing" }] });
  list = await cards();
  assert.equal(list.length, 2, "the next job gets its own card");
  assert.equal((await planning.currentTodos(conversationId)).body.items[0].text, "Plan the trip");
  assert.equal(planningTools({ planning, conversationId }).updateTodos, undefined, "no card without a chat to show it");
});

test("job notes are kept for the model, shown at the next turn, and cleared", { skip: DATABASE }, async (context) => {
  const { knex, planning, conversationId } = await chat(context);
  const tools = planningTools({ planning, conversationId });
  assert.deepEqual(await planningNotes(planning, conversationId), []);
  assert.equal((await tools.keepNotes.execute({ notes: ["The CRM table is contacts", "Due date goes after Stage"] })).status, "saved");
  assert.deepEqual(await planningNotes(planning, conversationId), ["Your notes for the job in hand (keep them up to date with keep_notes):\n- The CRM table is contacts\n- Due date goes after Stage"]);
  assert.equal((await tools.keepNotes.execute({ notes: [] })).status, "cleared");
  assert.deepEqual(await planningNotes(planning, conversationId), [], "and gone once cleared");
  assert.equal(await knex(PLANNING_TABLES.messages).count("* as n").first().then((row) => Number(row.n)), 0, "nothing shows in the chat");
});
