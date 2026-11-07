// The types @jskit-ai/agent-runtime's modules share.

/**
 * @typedef {object} AgentNotices Notices between servers (for example PostgreSQL LISTEN/NOTIFY), so
 * work queued on one server wakes every server's loop at once.
 * @property {(channel: string, key: string, payload: object) => Promise<void>} publish
 * @property {(channel: string, key: string, listener: () => void) => () => void} subscribe Returns
 * the function that stops listening.
 */

/** @typedef {ReturnType<typeof import("./runs.js").createRuns>} AgentRuns The replies in progress, one per conversation (createRuns). */

/** @typedef {ReturnType<ReturnType<typeof import("./goals.js").createGoals>["operationsFor"]>} AgentGoalOperations What the goal tools do in one turn of one conversation (goals.operationsFor). */

/** @typedef {ReturnType<typeof import("./tools/commands.js").createCommands>} AgentCommands The commands of every conversation (createCommands). */

/**
 * @typedef {object} AgentTodosCard A conversation's to-do card: one of the app's messages, of kind
 * "todos".
 * @property {number | string} id
 * @property {{ list: string, items: { text: string, status: "todo" | "doing" | "done" }[], updatedAt: string }} body
 */

/**
 * @typedef {object} AgentPlanning The app's store for the to-do cards and job notes (planningTools,
 * planningNotes), on the messages and conversations it owns. A new card is a message the tools hand
 * to `post`, as `{ kind: "todos", role: "bot", body }`.
 * @property {(conversationId: number | string) => Promise<AgentTodosCard | undefined>} currentTodos
 * The conversation's newest card (highest id) among its messages of kind "todos" whose
 * `body.list` is `String(conversationId)`; undefined when it has none.
 * @property {(cardId: number | string, body: AgentTodosCard["body"]) => Promise<unknown>} mergeTodos
 * Merges `body`'s keys into the card's stored body (PostgreSQL `body || ?::jsonb`): its list, items
 * and updatedAt replaced, any other keys kept.
 * @property {(conversationId: number | string) => Promise<string[] | null | undefined>} jobNotes
 * The conversation's job notes as last kept; null or undefined when none were ever kept or the
 * conversation is gone.
 * @property {(conversationId: number | string, notes: string[]) => Promise<unknown>} setJobNotes
 * Keeps the whole list as the conversation's job notes, an empty list as an empty list; a
 * conversation that is gone is left alone.
 */

/**
 * @typedef {object} AgentExecutor Where commands run (gvisorExecutor, localExecutor).
 * @property {string} kind
 * @property {() => boolean} available
 * @property {(command: { script: string, cwd: string, mounts?: { source: string }[] }) => Promise<import("node:child_process").ChildProcess>} spawn
 */

export {};
