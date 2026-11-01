import assert from "node:assert/strict";
import test from "node:test";
import { PLANNING_TABLES, currentTodos, planningNotes, planningTools } from "../src/server/index.js";
import { DATABASE, testDatabase } from "./database.js";

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
  return { knex, conversationId: id, post, told };
}

test("the to-do card is made, ticked off in place, remembered, and replaced for the next job", { skip: DATABASE }, async (context) => {
  const { knex, conversationId, post, told } = await chat(context);
  const tools = planningTools({ knex, conversationId, post });
  const cards = () => knex(PLANNING_TABLES.messages).where({ kind: "todos" }).orderBy("id");
  const made = await tools.updateTodos.execute({ items: [{ text: "Read the CRM", status: "doing" }, { text: "Add the field", status: "todo" }, { text: "Test it", status: "todo" }] });
  assert.deepEqual(made, { status: "saved" });
  assert.match((await tools.updateTodos.execute({ items: [{ text: "A", status: "doing" }, { text: "B", status: "doing" }] })).error, /Only one item can be doing at a time; these are all doing: A; B\./u);
  await tools.updateTodos.execute({ items: [{ text: "Read the CRM", status: "done" }, { text: "Add the field", status: "doing" }, { text: "Test it", status: "todo" }] });
  let list = await cards();
  assert.equal(list.length, 1, "one card, updated in place");
  assert.deepEqual(list[0].body.items.map((item) => item.status), ["done", "doing", "todo"]);
  assert.deepEqual(told, [1, 0], "open pages are told each time");
  const [state] = await planningNotes(knex, conversationId);
  assert.equal(state, "Your to-do list for this job (keep it up to date with update_todos):\n[x] Read the CRM\n[doing] Add the field\n[ ] Test it");

  const last = await tools.updateTodos.execute({ items: [{ text: "Read the CRM", status: "done" }, { text: "Add the field", status: "done" }, { text: "Test it", status: "done" }] });
  assert.match(last.note, /Everything on the list is done/u);
  assert.deepEqual(await planningNotes(knex, conversationId), [], "a finished list isn't carried");
  await tools.updateTodos.execute({ items: [{ text: "Plan the trip", status: "doing" }] });
  list = await cards();
  assert.equal(list.length, 2, "the next job gets its own card");
  assert.equal((await currentTodos(knex, conversationId)).body.items[0].text, "Plan the trip");
  assert.equal(planningTools({ knex, conversationId }).updateTodos, undefined, "no card without a chat to show it");
});

test("job notes are kept for the model, shown at the next turn, and cleared", { skip: DATABASE }, async (context) => {
  const { knex, conversationId } = await chat(context);
  const tools = planningTools({ knex, conversationId });
  assert.deepEqual(await planningNotes(knex, conversationId), []);
  assert.equal((await tools.keepNotes.execute({ notes: ["The CRM table is contacts", "Due date goes after Stage"] })).status, "saved");
  assert.deepEqual(await planningNotes(knex, conversationId), ["Your notes for the job in hand (keep them up to date with keep_notes):\n- The CRM table is contacts\n- Due date goes after Stage"]);
  assert.equal((await tools.keepNotes.execute({ notes: [] })).status, "cleared");
  assert.deepEqual(await planningNotes(knex, conversationId), [], "and gone once cleared");
  assert.equal(await knex(PLANNING_TABLES.messages).count("* as n").first().then((row) => Number(row.n)), 0, "nothing shows in the chat");
});
