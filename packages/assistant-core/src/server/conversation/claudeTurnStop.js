// A person's Stop of a native Claude turn: Claude's own interrupt, as Esc in Claude Code, which keeps the process
// and its background work; and the turn view a stopped turn keeps.
import { recordClaudeEntryInterrupted } from "./claudeEntryStop.js";

/** How long a person's Stop waits for Claude to answer its interrupt and end the turn. */
export const CLAUDE_INTERRUPT_TIMEOUT_MS = 15_000;
const EXPIRED = Symbol("Claude's interrupt expired");
const UNREAD = Symbol("no receipt read");

/**
 * What a native turn's Stop follows: the model loop Claude runs, from the frame
 * that starts it to its result (a Stop waits for the one under way); whether a
 * Stop that kept the process ended the turn (halted: its background tasks
 * still report, but only a new loop of Claude's reopens it); and the Stop
 * under way, which a second Stop joins.
 */
export function createClaudeStopState() {
  let loop = null;
  let halted = false;
  let stopping = null;
  function loopStarted() {
    loop ||= Promise.withResolvers();
    halted = false;
  }
  function loopEnded() {
    loop?.resolve();
    loop = null;
  }
  function runningLoop() {
    return loop;
  }
  function isHalted() {
    return halted;
  }
  function turnBegun() {
    halted = false;
  }
  // A Stop that kept the process halts the turn. A process stop ends it, and a Stop waiting for its loop with it.
  function turnStopped(processLives) {
    halted = processLives;
    if (!processLives) loopEnded();
  }
  function join(run) {
    stopping ||= run().finally(() => { stopping = null; });
    return stopping;
  }
  return Object.freeze({
    loopStarted,
    loopEnded,
    runningLoop,
    isHalted,
    turnBegun,
    turnStopped,
    join
  });
}

/**
 * A person's Stop, as Esc in Claude Code: interrupts Claude's running turn and
 * spares its background agents and commands, so the process lives on with
 * them; they report back, and the next message goes to the same process.
 * `turn` is the native turn's entry stop (see stopClaudeEntryProcess) with its
 * low-level `interrupt`, its `stopState`, its `inFlight` and `startedInputs`
 * and `isStopped()`. The process stops instead (stopProcess) when Claude does
 * not answer and end the turn within `timeoutMs`, or an input may still run,
 * and for `keepProcess: false`, a runtime binding, a turn without a live
 * process, lost observation, a stop under way or a closing owner.
 */
export function stopClaudeTurn(turn, client, stopProcess, { timeoutMs = CLAUDE_INTERRUPT_TIMEOUT_MS, keepProcess = true } = {}) {
  const { entry, bound, process, stopState } = turn;
  return stopState.join(async () => {
    if (!keepProcess || bound || !entry || !client || client !== entry.process?.client || entry.observationError ||
        entry.stopping || entry.stopPending || process.ownerClosing()) {
      return interruptThenStopClaude(() => turn.interrupt(client), stopProcess);
    }
    const ended = await turn.interrupt(client, () => interruptClaudeTurn(client, { timeoutMs, runningLoop: stopState.runningLoop,
      waiting: [...turn.inFlight].filter(uuid => !turn.startedInputs.has(uuid)) }));
    if (turn.isStopped()) return; // A process stop meanwhile has already ended the turn.
    if (!ended || entry.process?.client !== client) return stopProcess();
    turn.stop("Claude's turn was stopped before it acknowledged the prompt.", { processLives: true });
    // A loop Claude starts meanwhile (a background task's report) reopens the turn and owns its completion.
    await recordClaudeEntryInterrupted({ ...turn,
      resolveCompletion: result => { if (stopState.isHalted()) turn.resolveCompletion(result); } });
  });
}

/**
 * Claude's interrupt for a person's Stop. Claude's drain loop starts queued
 * input as soon as an interrupted turn ends, so `waiting` (the turn's inputs
 * Claude has not begun) are withdrawn first, in order on the pipe. The loop
 * under way where Claude wrote its receipt is the one the interrupt stops,
 * while one that starts later (a background task's report) runs on. Resolves
 * true once that loop has ended with none of `waiting` left to run.
 * @param {ReturnType<typeof import("./claudeClient.js").createClaudeJsonClient>} client
 * @param {{ waiting: string[], runningLoop: () => { promise: Promise<void> } | null, timeoutMs: number }} options
 */
async function interruptClaudeTurn(client, { waiting, runningLoop, timeoutMs }) {
  let timer;
  const expired = new Promise(resolve => { timer = setTimeout(resolve, timeoutMs, EXPIRED); });
  const within = promise => Promise.race([promise, expired]);
  // true: withdrawn; false: not in the queue (taken into the stopped loop); null: unanswered.
  const withdraw = uuid => client.request({ subtype: "cancel_async_message", message_uuid: uuid }, { timeoutMs })
    .then(response => response?.cancelled === true, () => null);
  try {
    const withdrawals = Promise.all(waiting.map(withdraw));
    let atReceipt = UNREAD;
    const receipt = await within(client.interrupt({ spareBackgroundTasks: true, timeoutMs,
      onReceipt: () => { atReceipt = runningLoop(); } }));
    if (receipt === EXPIRED) return false;
    // A client that reports no receipt's place (a stand-in) is read once its interrupt resolves.
    const interrupted = atReceipt === UNREAD ? runningLoop() : atReceipt;
    const answers = await within(withdrawals);
    if (answers === EXPIRED || answers.includes(null)) return false;
    // Inputs of ours the receipt still lists run unless withdrawn now.
    const survivors = (receipt?.still_queued || []).filter(uuid => waiting.includes(uuid));
    const retried = await within(Promise.all(survivors.map(withdraw)));
    if (retried === EXPIRED || !retried.every(Boolean)) return false;
    return !interrupted || await within(interrupted.promise) !== EXPIRED;
  } catch {
    // A refused or failed interrupt leaves the process stop to the caller.
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Interrupts the turn, then stops the process: a control acknowledgement is not
 * a process-exit proof, and the stop also ends queued input and native
 * background tools.
 */
async function interruptThenStopClaude(interrupt, stopProcess) {
  try {
    await interrupt();
  } catch {
    // A verified managed-scope stop also handles an unresponsive control pipe.
  } finally {
    await stopProcess();
  }
}

// Verified process cleanup can precede Claude's terminal generation frame.
// Retain already displayed text for the transcript reader, with each block's
// input/output identity and no completed-answer receipt.
export function retainStoppedClaudeMessages(messages, pendingAssistantMessages) {
  for (const pending of pendingAssistantMessages.values()) for (const block of pending) {
    if (block.outputId && block.outputId !== block.id) messages.delete(block.outputId);
    messages.set(block.id, { ...block, role: "commentary" });
  }
  for (const [id, block] of messages) {
    if (block.complete === false && block.role === "assistant" && block.text) {
      messages.set(id, { ...block, complete: true, role: "commentary" });
    }
  }
}
