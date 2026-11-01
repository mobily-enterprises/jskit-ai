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
 * @typedef {object} AgentExecutor Where commands run (gvisorExecutor, localExecutor).
 * @property {string} kind
 * @property {() => boolean} available
 * @property {(command: { script: string, cwd: string, mounts?: { source: string }[] }) => Promise<import("node:child_process").ChildProcess>} spawn
 */

export {};
