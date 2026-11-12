// Stopping a retained Claude entry's process, and the turn record its host saves.
import { stopClaudeCodeProcess } from "./claudeProcess.js";

/** Records the entry's turn state, as its host saves and shows it. */
export function setClaudeTurnState(entry, state, message = "") {
  if (!entry.turn) return;
  const active = ["starting", "active", "finalizing"].includes(state);
  Object.assign(entry.turn, { active, state, error: message, updatedAt: new Date().toISOString(),
    phase: active && !entry.observationError ? String(entry.turn.phase ?? "").trim() : "" });
}

/**
 * Stops an entry's Claude process for the entry's turn (`turn` carries the
 * entry, its host and the turn's own steps): proves the process exit, stops
 * the turn and runs the host's interrupted checkpoint. A Stop while another
 * is pending joins it.
 */
export async function stopClaudeEntryProcess(turn, reason = "", { preparing = false } = {}) {
  const { entry, bound, process, onEvent, read, stop, updateState, readResult, resolveCompletion } = turn;
  clearTimeout(entry.goalToolStop?.timer);
  entry.goalToolStop = null;
  if (!preparing) entry.preparationRevision++;
  turn.invalidateFinalAssistantResult();
  // Runtime bindings commit execution release before dropping the handle.
  // Retained host entries keep their original post-proof checkpoint order.
  if (entry.stopPending) return entry.stopPending;
  const active = read().active;
  if (!bound) entry.stopping = true;
  const operation = async () => {
    const startup = entry.startupCleanup?.executionId === entry.executionId ? entry.startupCleanup : null;
    let proof;
    try {
      if (!bound || entry.process || entry.executionId) {
        proof = await stopClaudeCodeProcess({ process: entry.process || startup, executionId: entry.executionId,
          stopExecution: process.stopExecution });
      }
    } catch (error) {
      if (bound || error.code !== "claude_stop_unconfirmed") throw error;
      entry.observationError = reason || "Claude process exit has not been confirmed. Try Stop again.";
      await onEvent({ type: "save" });
      await onEvent({ type: "stop-unconfirmed" });
      throw error;
    }
    if (bound && (entry.process || entry.executionId)) await process.releaseExecution();
    entry.process = null;
    entry.executionId = "";
    entry.exitProof = proof;
    stop(bound ? reason : reason || "Claude stopped before acknowledging the prompt.");
    if (bound) {
      if (entry.startupCleanup === startup) entry.startupCleanup = null;
      if (active) entry.completion?.resolve({ status: "interrupted", error: reason || "Work stopped." });
      return;
    }
    if (entry.turn?.active && process.ownerClosing()) {
      // At shutdown the turn's end belongs to the next server, as after a
      // crash: its saved record keeps the execution and the active turn, so
      // that server's recovery proves this exit, interrupts the turn and runs
      // the host's checkpoint. Run here, that checkpoint (a Git snapshot, say)
      // would hold the host's bounded shutdown for as long as it takes.
      resolveCompletion({ ...readResult(), status: "interrupted", error: reason });
      if (entry.startupCleanup === startup) entry.startupCleanup = null;
      return entry.exitProof;
    }
    if (entry.turn?.active) {
      try { await updateState("interrupted", reason); }
      catch (error) {
        // Native cleanup is verified even when the host refuses its checkpoint.
        // Retain that refusal without publishing a completed answer or active work.
        setClaudeTurnState(entry, "interrupted", error.message);
        await onEvent({ type: "save" });
        await onEvent({ type: "state", state: "interrupted", active: false, message: error.message });
        resolveCompletion(readResult());
        if (entry.startupCleanup === startup) entry.startupCleanup = null;
        throw error;
      }
    } else await onEvent({ type: "save" });
    resolveCompletion(readResult());
    if (entry.startupCleanup === startup) entry.startupCleanup = null;
    return entry.exitProof;
  };
  entry.stopPending = operation().catch(error => { if (bound) error.cleanupFailed = true; throw error; })
    .finally(() => { entry.stopPending = null; });
  return entry.stopPending;
}
