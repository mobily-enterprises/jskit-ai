import { z } from "zod";
import { createTool } from "@jskit-ai/agent/server";
import { refusePlanningKnex, requirePlanning } from "./arguments.js";

// Keeping a long job in mind: a to-do list the person sees, as one card in the chat updated in
// place, and private notes. Both are shown to the model at every turn (planningNotes), so they
// outlast summaries, goal rounds and restarts.
//
// The list is a message of kind "todos" ({ list: conversation id, items: [{ text, status }],
// updatedAt }) among the app's messages; the notes are its conversation's job notes. Both live in
// the app's own tables, which `planning` (AgentPlanning, types.js) reads and writes for it.
// `post(messages)` adds messages to the chat and tells open pages; `post([])` only tells them.

/**
 * The to-do and notes tools, for one turn in one conversation; the to-do list only with `post`.
 * @param {object} options
 * @param {import("./types.js").AgentPlanning} options.planning The app's to-do cards and job notes.
 * @param {number | string} options.conversationId
 * @param {((messages: object[]) => Promise<unknown>) | null} [options.post]
 */
export function planningTools({ planning, conversationId, post, ...removed }) {
  refusePlanningKnex("planningTools", removed);
  requirePlanning("planningTools", planning);
  async function keepNotes({ notes }) {
    await planning.setJobNotes(conversationId, notes);
    return { status: notes.length ? "saved" : "cleared" };
  }

  async function updateTodos({ items }) {
    const doing = items.filter((item) => item.status === "doing");
    if (doing.length > 1) return { error: `Only one item can be doing at a time; these are all doing: ${doing.map((item) => item.text).join("; ")}.` };
    const card = await planning.currentTodos(conversationId);
    const body = { list: String(conversationId), items, updatedAt: new Date().toISOString() };
    // A finished list stays as it was; the next job's list is a new card.
    if (card && card.body.items.some((item) => item.status !== "done")) {
      await planning.mergeTodos(card.id, body);
      await post([]);
    } else {
      await post([{ kind: "todos", role: "bot", body }]);
    }
    const finished = items.every((item) => item.status === "done");
    return { status: "saved", ...(finished ? { note: "Everything on the list is done: check the result, then reply with it." } : {}) };
  }

  return {
    keepNotes: createTool(Object.freeze({
      id: "keep_notes",
      description: "Keep notes for the job in hand: facts you found and will need later in a long job (file names, record ids, what was decided, what's left to check). They're shown to you at every turn, even after the conversation is summarised. Send the whole list every time; send an empty list when the job is over. The person doesn't see them.",
      inputSchema: z.object({ notes: z.array(z.string().min(1).max(300)).max(30) }),
      execute: (input) => keepNotes(input)
    })),
    ...(post ? {
      updateTodos: createTool(Object.freeze({
        id: "update_todos",
        description: "Write your to-do list for a job of more than three steps; the person sees it live as a card in the chat. Send the whole list every time: each item a short step, its status todo, doing or done, with exactly one item doing while you work. Tick an item off as soon as it's done. Skip it for quick answers.",
        inputSchema: z.object({
          items: z.array(z.object({
            text: z.string().min(1).max(200),
            status: z.enum(["todo", "doing", "done"])
          })).min(1).max(20)
        }),
        execute: (input) => updateTodos(input)
      }))
    } : {})
  };
}

/**
 * The open to-do list and the notes, for the model's state note at every turn.
 * @param {import("./types.js").AgentPlanning} planning The app's to-do cards and job notes.
 * @param {number | string} conversationId
 */
export async function planningNotes(planning, conversationId) {
  requirePlanning("planningNotes", planning);
  const card = await planning.currentTodos(conversationId);
  const notes = (await planning.jobNotes(conversationId)) || [];
  const mark = { todo: "[ ]", doing: "[doing]", done: "[x]" };
  return [
    card && card.body.items.some((item) => item.status !== "done")
      ? `Your to-do list for this job (keep it up to date with update_todos):\n${card.body.items.map((item) => `${mark[item.status]} ${item.text}`).join("\n")}`
      : "",
    notes.length ? `Your notes for the job in hand (keep them up to date with keep_notes):\n${notes.map((note) => `- ${note}`).join("\n")}` : ""
  ].filter(Boolean);
}
