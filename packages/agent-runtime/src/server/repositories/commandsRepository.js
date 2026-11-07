import { AGENT_ROWS } from "../resources.js";
import { conversationKey, firstRow, rowOf } from "./rows.js";

/**
 * Every statement on commands (createCommands), on the agentCommands handle, in the owner's system
 * context (`options`).
 * @param {object} dependencies
 * @param {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} dependencies.commands
 * @param {Readonly<{ context: object }>} dependencies.options
 */
export function createCommandsRepository({ commands, options }) {
  const now = () => commands.raw("now()");
  const changed = async (id, changes, more = {}) => {
    const [row] = await commands.patchWhereIds([id], changes, { ...options, missing: "skip", returning: "records", ...more });
    return rowOf(AGENT_ROWS.commands, row);
  };

  /** The conversation's command by its number (digits, as the model gives it), or undefined. */
  async function find(conversationId, id) {
    const number = Number(id);
    if (!Number.isSafeInteger(number) || number < 1) {
      return undefined;
    }
    return firstRow(AGENT_ROWS.commands, await commands.query({ filters: { id: number, conversation_id: conversationKey(conversationId) }, page: { size: 1 } }, options));
  }

  /** A running command's new row; its heartbeat and start are the database's now, its `why` "" when left out. */
  async function start({ conversationId, why, script, server }) {
    const attributes = { conversation_id: conversationKey(conversationId), ...(why === undefined ? {} : { why }), script, status: "running", server };
    return rowOf(AGENT_ROWS.commands, await commands.create(attributes, options));
  }

  async function beat(id) {
    await commands.patchWhereIds([id], { heartbeat_at: now() }, { ...options, missing: "skip" });
  }

  /** The ended command's row. */
  function end(id, { status, exitCode, output, truncated }) {
    return changed(id, { status, exit_code: exitCode, output, truncated, ended_at: now() });
  }

  /** The command's row once marked stopped, or undefined when it was no longer running. */
  function markStopped(id, output) {
    return changed(id, { status: "stopped", output, ended_at: now() }, { onlyIf: { status: "running" } });
  }

  return Object.freeze({
    start,
    beat,
    end,
    find,
    markStopped
  });
}
