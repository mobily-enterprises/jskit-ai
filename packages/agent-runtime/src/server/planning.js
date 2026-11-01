import { z } from "zod";
import { createTool } from "@jskit-ai/agent/server";

// Keeping a long job in mind: a to-do list the person sees, as one card in the chat updated in
// place, and private notes. Both are shown to the model at every turn (planningNotes), so they
// outlast summaries, goal rounds and restarts.
//
// The list is a message of kind "todos" ({ list: conversation id, items: [{ text, status }],
// updatedAt }) in the messages table; the notes are the conversation's `job_notes` (jsonb array).
// `post(messages)` adds messages to the chat and tells open pages; `post([])` only tells them.
export const PLANNING_TABLES = { messages: "agent_messages", conversations: "agent_conversations" };

export function currentTodos(knex, conversationId, tables = PLANNING_TABLES) {
  return knex(tables.messages).where({ kind: "todos" }).whereRaw("body->>'list' = ?", [String(conversationId)]).orderBy("id", "desc").first();
}

export function planningTools({ knex, conversationId, post, tables = PLANNING_TABLES }) {
  return {
    keepNotes: createTool({
      id: "keep_notes",
      description: "Keep notes for the job in hand: facts you found and will need later in a long job (file names, record ids, what was decided, what's left to check). They're shown to you at every turn, even after the conversation is summarised. Send the whole list every time; send an empty list when the job is over. The person doesn't see them.",
      inputSchema: z.object({ notes: z.array(z.string().min(1).max(300)).max(30) }),
      execute: async ({ notes }) => {
        await knex(tables.conversations).where({ id: conversationId }).update({ job_notes: JSON.stringify(notes) });
        return { status: notes.length ? "saved" : "cleared" };
      }
    }),
    ...(post ? {
      updateTodos: createTool({
        id: "update_todos",
        description: "Write your to-do list for a job of more than three steps; the person sees it live as a card in the chat. Send the whole list every time: each item a short step, its status todo, doing or done, with exactly one item doing while you work. Tick an item off as soon as it's done. Skip it for quick answers.",
        inputSchema: z.object({
          items: z.array(z.object({
            text: z.string().min(1).max(200),
            status: z.enum(["todo", "doing", "done"])
          })).min(1).max(20)
        }),
        execute: async ({ items }) => {
          const doing = items.filter((item) => item.status === "doing");
          if (doing.length > 1) return { error: `Only one item can be doing at a time; these are all doing: ${doing.map((item) => item.text).join("; ")}.` };
          const card = await currentTodos(knex, conversationId, tables);
          const body = { list: String(conversationId), items, updatedAt: new Date().toISOString() };
          // A finished list stays as it was; the next job's list is a new card.
          if (card && card.body.items.some((item) => item.status !== "done")) {
            await knex(tables.messages).where({ id: card.id }).update({ body: knex.raw("body || ?::jsonb", [JSON.stringify(body)]) });
            await post([]);
          } else {
            await post([{ kind: "todos", role: "bot", body }]);
          }
          const finished = items.every((item) => item.status === "done");
          return { status: "saved", ...(finished ? { note: "Everything on the list is done: check the result, then reply with it." } : {}) };
        }
      })
    } : {})
  };
}

// The open to-do list and the notes, for the model's state note at every turn.
export async function planningNotes(knex, conversationId, tables = PLANNING_TABLES) {
  const card = await currentTodos(knex, conversationId, tables);
  const notes = (await knex(tables.conversations).where({ id: conversationId }).first("job_notes"))?.job_notes || [];
  const mark = { todo: "[ ]", doing: "[doing]", done: "[x]" };
  return [
    card && card.body.items.some((item) => item.status !== "done")
      ? `Your to-do list for this job (keep it up to date with update_todos):\n${card.body.items.map((item) => `${mark[item.status]} ${item.text}`).join("\n")}`
      : "",
    notes.length ? `Your notes for the job in hand (keep them up to date with keep_notes):\n${notes.map((note) => `- ${note}`).join("\n")}` : ""
  ].filter(Boolean);
}
