import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { claudeMessageBlocks } from "./claudeHistory.js";
import { stopClaudeCodeProcess } from "./claudeProcess.js";
import { createClaudeConversationAdapter } from "./providers/claude.js";

// messageCode names the sentence, since one turn-failure code covers several.
export function claudeTurnFailure(message, { code = "assistant_claude_turn_failed", messageCode } = {}) {
  return Object.assign(new Error(message), { code, ...(messageCode ? { messageCode, messageParams: {} } : {}) });
}

// Input for a turn that already finished is the caller's refusal; input that
// meets a stopping turn stays an internal turn failure.
function steeringRefusal(message, { messageCode, finished }) {
  return finished
    ? new AppError(409, message, { code: "conversation_steer_turn_finished", messageCode })
    : Object.assign(claudeTurnFailure(message), { messageCode, messageParams: {} });
}

const CLAUDE_SIGNED_OUT_MESSAGE = "Claude isn't connected. Sign in to Claude, then send your message again.";

function setClaudeTurnState(entry, state, message = "") {
  if (!entry.turn) return;
  const active = ["starting", "active", "finalizing"].includes(state);
  Object.assign(entry.turn, { active, state, error: message, updatedAt: new Date().toISOString(),
    phase: active && !entry.observationError ? String(entry.turn.phase ?? "").trim() : "" });
}

// The entry's turn result, with the text and messages the native view holds.
function claudeTurnResult(entry, current) {
  const failed = entry.turn?.state === "failed";
  let status = "completed";
  if (entry.turn?.active) status = "inProgress";
  else if (failed) status = "failed";
  else if (entry.turn?.state === "interrupted") status = "interrupted";
  return { ok: !failed, conversationId: entry.id, threadId: entry.id,
    runId: entry.turn?.id || "", turnId: entry.turn?.id || "", text: current.text,
    messages: current.messages, error: entry.turn?.error || "", status };
}

// The provider state a native frame changes: its goal or its usage.
function claudeProviderChange(frame) {
  return frame.type === "active_goal" ? "goal" : frame.type === "rate_limit_event" ? "usage" : "";
}

// A frame that shows Claude working on this turn again.
function continuesClaudeTurn(frame) {
  return (frame.type === "user" && frame.origin?.kind === "task-notification") ||
    (frame.type === "command_lifecycle" && frame.state === "started") ||
    (frame.type === "stream_event" && frame.event?.type === "message_start") || frame.type === "assistant";
}

// The native background tasks a system frame starts, lists or finishes.
function updateClaudeBackgroundTasks(tasks, frame) {
  if (frame.subtype === "background_tasks_changed") {
    tasks.clear();
    for (const task of frame.tasks || []) if (task.task_id && !task.ambient) tasks.add(task.task_id);
  }
  if (frame.subtype === "task_started" && frame.task_id && !frame.ambient) tasks.add(frame.task_id);
  if (["task_notification", "task_updated"].includes(frame.subtype) &&
      ["completed", "failed", "stopped", "killed"].includes(frame.status || frame.patch?.status)) {
    tasks.delete(frame.task_id);
  }
}

// Native split frames arrive before their block's stop event. The one live
// block a frame continues keeps that identity without replacing the saved frame UUID.
function liveClaudeBlock(messages, messageId, frame, role) {
  if (typeof messageId === "string" && messageId && frame.message.id === messageId && frame.message.content.length === 1) {
    const prefix = `claude_${messageId}_`;
    const live = [...messages.values()].filter(message => !message.complete && message.role === role &&
      message.id.startsWith(prefix) && /^\d+$/u.test(message.id.slice(prefix.length)));
    if (live.length === 1 && (!Object.hasOwn(frame, "apiBlockIndex") ||
        Number.isSafeInteger(frame.apiBlockIndex) && frame.apiBlockIndex >= 0 &&
        live[0].id === `${prefix}${frame.apiBlockIndex}`)) return live[0];
  }
  return null;
}

// A conversation whose account signed out under it ends its next request
// at once with Claude Code's own "Not logged in" answer.
function claudeResultError(frame, output) {
  return /^Not logged in\b/u.test(output) ? CLAUDE_SIGNED_OUT_MESSAGE
    : (frame.errors || []).join("; ") || output || frame.subtype;
}

// The final answer a result frame carries, with the local command that wrote it.
function claudeResultMessage(frame, turnId, result) {
  return { id: `claude_${frame.uuid || turnId}_result`, role: "assistant", text: result, complete: true,
    ...(typeof frame.local_command === "string" && frame.local_command ? {
      data: { native: { engineId: "claude", type: "result", command: frame.local_command, output: "stdout" } }
    } : {}) };
}

// Verified process cleanup can precede Claude's terminal generation frame.
// Retain already displayed text for the transcript reader, with each block's
// input/output identity and no completed-answer receipt.
function retainStoppedClaudeMessages(messages, pendingAssistantMessages) {
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

/**
 * The owner's control of one native process, as a native turn uses it.
 * @typedef {import("./providers/claude.js").ClaudeProcessControl & {
 *   stopExecution?: (executionId: string, options?: object) => Promise<object>,
 *   releaseExecution?: () => Promise<unknown>,
 *   ownerClosing?: () => boolean
 * }} ClaudeTurnProcess
 */

/**
 * One native Claude turn: its admission, events and results; hosts persist its events.
 * A turn with an owner's retained entry also reads results and stops its process.
 * @param {{
 *   conversationId: string,
 *   onEvent: (event: Record<string, any>) => unknown,
 *   process?: ClaudeTurnProcess,
 *   entry?: Record<string, any>,
 *   bound?: boolean
 * }} options
 */
export function createClaudeConversationTurn({ conversationId, onEvent, process, entry, bound = false }) {
  if (!conversationId) throw new TypeError("A Claude conversation id is required.");
  const instructions = process ? createClaudeConversationAdapter(process) : null;
  const publish = entry ? publishEntryEvent : onEvent;
  const messages = new Map();
  const pendingAssistantMessages = new Map();
  const assistantRoles = new Map();
  const admissions = new Map();
  const inFlight = new Set();
  // Inputs Claude has begun reading. A queued steer joins the running loop, so
  // one result can finish several of them; queued-only input stays in flight.
  const startedInputs = new Set();
  // Steers written into a running loop that Claude has not begun reading. Claude
  // Code reads queued input only when the running tool call returns.
  const waitingSteers = new Set();
  let steeringClient = null;
  const tasks = new Set();
  let turnId = "";
  let messageId = "";
  let currentCommandId = "";
  let result = "";
  let phase = "";
  let outcome;
  let active = false;
  let generation = 0;
  let stopped = false;
  let cancelling = false;
  let maximumOutput = 4 * 1024 * 1024;
  let inputOwner = null;
  let acceptedInput = null;
  let publishedAssistant = null;
  let finalAssistantResult = null;
  let resolvedCompletion;
  let latestSettlement;
  // A common command fences its first checkpoint; later native continuations
  // keep the same input but cannot enqueue onto that already resolved command.
  let checkpointedCommand;

  function clearFinalAssistantResult() {
    publishedAssistant = null;
    finalAssistantResult = null;
  }

  function invalidateFinalAssistantResult() {
    inputOwner = null;
    acceptedInput = null;
    clearFinalAssistantResult();
  }

  function clearTurnView() {
    messages.clear();
    pendingAssistantMessages.clear();
    assistantRoles.clear();
    result = "";
    outcome = null;
    invalidateFinalAssistantResult();
  }

  // A waiting steer would otherwise sit behind a long foreground command (or a
  // wait loop) until it returns. Claude's Ctrl+B control moves foreground Bash
  // and subagents to the background: they keep running and report completion,
  // and the blocked tool call returns so Claude reads the steer now.
  function backgroundForegroundWork() {
    const client = steeringClient;
    if (!waitingSteers.size || !client?.request || stopped || cancelling) return;
    void client.request({ subtype: "background_tasks" }).then(
      () => publish({ type: "diagnostic", stage: "steering_backgrounded", pendingCommands: inFlight.size, backgroundTasks: tasks.size }),
      // An older CLI still reads the steer when its tool call returns.
      error => publish({ type: "diagnostic", stage: "steering_background_failed", error: error.message })
    ).catch(() => {});
  }

  function currentReceiptOwner(owner) {
    return Boolean(entry && owner && inputOwner === owner && acceptedInput === owner &&
      owner.commandId === currentCommandId && entry.process && entry.process === owner.process &&
      entry.executionId === owner.executionId && entry.accountIdentity === owner.accountIdentity &&
      entry.turn?.id === turnId && !entry.stopping && !entry.stopPending && !entry.disposed &&
      !entry.observationError && !entry.command?.toolWork.size && !entry.command?.toolFailure);
  }

  function readFinalAssistantResult(threadId, expectedTurnId) {
    if (threadId !== conversationId || expectedTurnId !== turnId || !finalAssistantResult ||
        active || stopped || cancelling || outcome?.status !== "completed" || outcome.error ||
        inFlight.size || tasks.size || admissions.size || !currentReceiptOwner(acceptedInput)) return null;
    return structuredClone(finalAssistantResult);
  }

  function read() {
    return { turnId, active, text: result, phase, status: active ? "inProgress" : outcome?.status || "ready",
      error: outcome?.error || "", messages: structuredClone([...messages.values()]),
      pendingCommands: inFlight.size, backgroundTasks: tasks.size };
  }

  function readResult() {
    return claudeTurnResult(entry, read());
  }

  function resolveCompletion(result) {
    entry.completion?.resolve(result);
    resolvedCompletion = entry.completion;
    if (entry.command?.finishIfCurrent) entry.command.completion.resolve(result);
  }

  async function updateState(state, message = "", expectedGeneration = generation) {
    if (!entry.turn || expectedGeneration !== generation) return false;
    const active = ["starting", "active", "finalizing"].includes(state);
    const checkpoint = onEvent({ type: "before-state", state, active, message });
    if (checkpoint) await checkpoint;
    if (expectedGeneration !== generation) return false;
    setClaudeTurnState(entry, state, message);
    await onEvent({ type: "save" });
    if (expectedGeneration !== generation) return false;
    await onEvent({ type: "state", state, active, message });
    return expectedGeneration === generation;
  }

  async function stopProcess(reason = "", { preparing = false } = {}) {
    clearTimeout(entry.goalToolStop?.timer);
    entry.goalToolStop = null;
    if (!preparing) entry.preparationRevision++;
    invalidateFinalAssistantResult();
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

  async function publishEntryEvent(event, deferred = false) {
    if (entry.stopping) return;
    if (event.type === "settled" && event.generation !== generation) return;
    const command = entry.command;
    if (event.type === "settled" && !bound && !deferred && command?.finishIfCurrent && command !== checkpointedCommand) {
      const delivery = command.delivery;
      const completion = entry.completion;
      const owner = acceptedInput;
      // Release the native queue before the common run joins reserved steering.
      // That same accepted delivery then performs the original retained checkpoint.
      command.completion.resolve(async () => {
        try {
          for (;;) {
            if (entry.command !== command || command.delivery !== delivery || entry.completion !== completion ||
                command.signal.aborted || !currentReceiptOwner(owner)) {
              throw claudeTurnFailure("Claude's completion belongs to a retired native input.");
            }
            // Follow-ups share this input, but can finish while its checkpoint
            // awaits storage. Apply the latest settlement after the same fence.
            if (active) return readResult();
            const settlement = latestSettlement;
            await publishEntryEvent(settlement, true);
            if (settlement === latestSettlement) return readResult();
          }
        } catch (error) {
          clearFinalAssistantResult();
          throw error;
        } finally {
          checkpointedCommand = command;
        }
      });
      return;
    }
    if (event.type === "continued") {
      if (entry.completion === resolvedCompletion) entry.completion = Promise.withResolvers();
      if (bound) setClaudeTurnState(entry, "active");
      else await updateState("active");
    } else if (event.type === "admitted") {
      if (event.userEcho) entry.sent = true;
      if (!bound) await onEvent({ type: "save" });
    } else if (event.type === "phase") {
      entry.turn.phase = event.phase;
      if (!bound) await updateState(entry.turn.state);
    } else if (event.type === "settled") {
      const state = event.status === "interrupted" ? "interrupted" : event.status === "failed" ? "failed" : "completed";
      if (bound) setClaudeTurnState(entry, state, event.error);
      else if (!await updateState(state, event.error, event.generation)) return;
    }
    const published = await onEvent(event);
    const change = event.type === "provider-event" ? claudeProviderChange(event.event) : "";
    if (change) await onEvent({ type: "provider-update", change });
    if (event.type === "settled") {
      if (event.generation !== generation) return;
      if (event.source === "result") await onEvent({ type: "provider-update", change: "goal" });
      resolveCompletion(bound ? event : readResult());
    }
    return published;
  }

  function checkOutput(value, role = "assistant") {
    if (value.length > (role === "thinking" ? 4 * 1024 * 1024 : maximumOutput)) {
      throw claudeTurnFailure("Claude output exceeded its size limit.", { messageCode: "assistant.claude.outputTooLarge" });
    }
  }

  async function publishMessage(message) {
    if (!message.userId && currentCommandId) message = { ...message, userId: currentCommandId };
    messages.set(message.id, message);
    const owner = acceptedInput;
    const completeAssistant = message.complete && message.role === "assistant";
    if (completeAssistant) clearFinalAssistantResult();
    const conversationTurn = await publish({ type: "message", message });
    if (completeAssistant && message.text && currentReceiptOwner(owner) && !stopped && !cancelling &&
        conversationTurn && typeof conversationTurn === "object" && !Array.isArray(conversationTurn)) {
      publishedAssistant = { owner, itemId: message.id, outputId: message.outputId || message.id,
        text: message.text, conversationTurn: structuredClone(conversationTurn) };
    }
    return conversationTurn;
  }

  async function flushAssistantMessages(apiMessageId, role) {
    assistantRoles.set(apiMessageId, role);
    const pending = pendingAssistantMessages.get(apiMessageId) || [];
    pendingAssistantMessages.delete(apiMessageId);
    for (const block of pending) {
      await publishMessage({ ...block, role });
      if (block.outputId) {
        if (block.outputId !== block.id) messages.delete(block.outputId);
        await publish({ type: "message-complete", messageId: block.outputId });
      }
    }
  }

  async function receive(frame) {
    if (stopped) return;
    if (frame.session_id && frame.session_id !== conversationId) throw claudeTurnFailure("Claude returned a different conversation id.");
    if (frame.parent_tool_use_id) return; // Nested agents do not replace the main reply.
    await publish({ type: "provider-event", event: frame });
    if (continuesClaudeTurn(frame) && turnId && !cancelling) {
      const wasActive = active;
      if (outcome || !active) {
        generation++;
        outcome = null;
        result = "";
        clearFinalAssistantResult();
      }
      active = true;
      if (!wasActive) await publish({ type: "continued", source: frame.type });
      if (phase === "background") {
        phase = "";
        await publish({ type: "phase", phase });
      }
    }
    if (frame.type === "command_lifecycle" || frame.type === "user") {
      const uuid = frame.type === "user" ? frame.uuid : frame.command_uuid;
      if (frame.type === "user" && !inFlight.has(uuid) && !admissions.has(uuid)) return;
      // Native notifications have their own lifecycle UUIDs, including work
      // folded into this input. They must not steal its receipt/result owner.
      if ((frame.state === "started" || frame.type === "user") && inFlight.has(uuid)) {
        currentCommandId = uuid;
        startedInputs.add(uuid);
      }
      if (frame.state !== "queued") waitingSteers.delete(uuid);
      if (frame.state === "completed") {
        inFlight.delete(uuid);
        startedInputs.delete(uuid);
      }
      if (frame.state === "queued" || frame.type === "user") {
        const pending = admissions.get(uuid);
        if (pending) {
          // Once acknowledged, storage owns the admission decision. Its write
          // must not race a native-ack timeout and a second submission.
          clearTimeout(pending.timer);
          try {
            await pending.accept();
            if (inputOwner === pending.receiptOwner && !stopped && !cancelling) acceptedInput = pending.receiptOwner;
            admissions.delete(uuid);
            pending.resolve();
          } catch (error) {
            acceptedInput = null;
            clearFinalAssistantResult();
            pending.reject(error);
            throw error;
          }
        }
        await publish({ type: "admitted", messageId: uuid, userEcho: frame.type === "user" });
      }
    } else if (frame.type === "system") {
      if (active && ["status", "compact_boundary"].includes(frame.subtype)) {
        const nextPhase = frame.subtype === "status" && frame.status === "compacting" ? "compacting" : "";
        // An idle status does not end a wait that only background tasks own.
        if (nextPhase !== phase && (nextPhase || phase !== "background")) {
          phase = nextPhase;
          await publish({ type: "phase", phase });
        }
      }
      if (frame.subtype === "local_command_output" && frame.content) {
        await publishMessage({ id: `claude_${frame.uuid}`, role: "commentary", text: frame.content, complete: true,
          data: { native: { engineId: "claude", type: "system", subtype: "local_command_output" } } });
      }
      const previousTaskCount = tasks.size;
      updateClaudeBackgroundTasks(tasks, frame);
      // A command Claude started before reading a waiting steer would hold it too.
      if (frame.subtype === "task_started") backgroundForegroundWork();
      // Inventory removal can precede the task notification and the main model's
      // response to it. A foreground result written while that worker was live
      // cannot complete this follow-up or retire its admitted application tools.
      if (tasks.size < previousTaskCount) outcome = null;
      if (phase === "background" && !outcome) {
        phase = "";
        await publish({ type: "phase", phase });
      }
      if (["background_tasks_changed", "task_started", "task_notification", "task_updated"].includes(frame.subtype)) {
        if (tasks.size && turnId && !active && !cancelling) {
          generation++;
          active = true;
          clearFinalAssistantResult();
          await publish({ type: "continued", source: frame.subtype });
        }
        await publish({ type: "diagnostic", stage: "background_tasks", nativeEvent: frame.subtype,
          active, pendingCommands: inFlight.size, backgroundTasks: tasks.size });
      }
    } else if (frame.type === "stream_event") {
      const event = frame.event || {};
      if (event.type === "message_start") messageId = event.message?.id || frame.uuid;
      const id = `claude_${messageId}_${event.index}`;
      if (event.type === "content_block_start" && ["text", "thinking"].includes(event.content_block?.type)) {
        messages.set(id, { id, outputId: id, userId: currentCommandId, complete: false, role: event.content_block.type === "thinking" ? "thinking" : "assistant",
          text: event.content_block.text || event.content_block.thinking || "" });
      } else if (event.type === "content_block_delta") {
        const block = messages.get(id);
        const delta = event.delta?.text ?? event.delta?.thinking;
        if (block && typeof delta === "string") {
          block.text += delta;
          checkOutput(block.text, block.role);
          await publishMessage(block);
          await publish({ type: block.role === "thinking" ? "thinking" : "text", text: delta, messageId: id });
        }
      } else if (event.type === "content_block_stop") {
        if (![...pendingAssistantMessages.values()].some(blocks => blocks.some(block => block.outputId === id))) {
          messages.delete(id);
          await publish({ type: "message-complete", messageId: id });
        }
      } else if (event.type === "message_delta" && event.delta?.stop_reason) {
        await flushAssistantMessages(messageId, event.delta.stop_reason === "tool_use" ? "commentary" : "assistant");
      }
    } else if (frame.type === "assistant") {
      const apiMessageId = frame.message?.id;
      if (apiMessageId && frame.message.content?.some(block => block.type === "tool_use")) {
        await flushAssistantMessages(apiMessageId, "commentary");
      }
      for (const block of claudeMessageBlocks(frame)) {
        block.userId = currentCommandId;
        checkOutput(block.text, block.role);
        const live = liveClaudeBlock(messages, messageId, frame, block.role);
        if (live) {
          block.outputId = live.id;
          block.userId = live.userId || block.userId;
        }
        if (apiMessageId && block.role === "assistant") {
          const role = assistantRoles.get(apiMessageId);
          if (role) await publishMessage({ ...block, role });
          else {
            const pending = pendingAssistantMessages.get(apiMessageId) || [];
            pending.push(block);
            pendingAssistantMessages.set(apiMessageId, pending);
          }
        } else await publishMessage(block);
      }
      if (apiMessageId && frame.message.stop_reason) {
        await flushAssistantMessages(apiMessageId, frame.message.stop_reason === "tool_use" ? "commentary" : "assistant");
      }
    } else if (frame.type === "result") {
      const failed = frame.is_error || frame.subtype !== "success";
      const interrupted = ["aborted_streaming", "aborted_tools"].includes(frame.terminal_reason);
      const role = failed || interrupted ? "commentary" : "assistant";
      for (const id of pendingAssistantMessages.keys()) await flushAssistantMessages(id, role);
      const output = typeof frame.structured_output === "object" ? JSON.stringify(frame.structured_output) : String(frame.result || "");
      checkOutput(output);
      const message = !failed ? "" : claudeResultError(frame, output);
      result = failed ? "" : output;
      if (result && ![...messages.values()].some((block) => block.complete && block.role === "assistant" && block.text === result)) {
        await publishMessage(claudeResultMessage(frame, turnId, result));
      }
      inFlight.delete(currentCommandId);
      for (const uuid of startedInputs) inFlight.delete(uuid);
      startedInputs.clear();
      if (cancelling) return;
      outcome = { status: interrupted ? "interrupted" : failed ? "failed" : "completed", error: message };
      // The reply is final, but native background tasks still own the turn
      // (and may continue it). Keep it active and say what it is waiting for.
      if (active && tasks.size && !inFlight.size && phase !== "background") {
        phase = "background";
        await publish({ type: "phase", phase });
      }
      await publish({ type: "diagnostic", stage: "native_result", status: outcome.status,
        terminalReason: frame.terminal_reason, active, pendingCommands: inFlight.size, backgroundTasks: tasks.size });
    }
    if ((frame.type === "system" || frame.type === "result" || frame.type === "command_lifecycle" && frame.state === "completed") &&
        active && !cancelling && outcome && inFlight.size === 0 && tasks.size === 0) {
      active = false;
      phase = "";
      const candidate = publishedAssistant;
      finalAssistantResult = outcome.status === "completed" && !outcome.error && !stopped && !cancelling &&
        admissions.size === 0 && candidate && currentReceiptOwner(candidate.owner) && candidate.text === result
        ? { threadId: conversationId, turnId, inputMessageId: candidate.owner.commandId,
          itemId: candidate.itemId, outputId: candidate.outputId, text: candidate.text,
          conversationTurn: candidate.conversationTurn } : null;
      latestSettlement = { type: "settled", ...read(), generation, source: frame.type };
      try { await publish(latestSettlement); }
      catch (error) { clearFinalAssistantResult(); throw error; }
    }
  }

  function stop(reason = "Claude stopped before acknowledging the prompt.") {
    generation++;
    stopped = true;
    invalidateFinalAssistantResult();
    for (const pending of admissions.values()) {
      pending.reject(claudeTurnFailure(reason));
    }
    admissions.clear();
    inFlight.clear();
    startedInputs.clear();
    waitingSteers.clear();
    steeringClient = null;
    tasks.clear();
    retainStoppedClaudeMessages(messages, pendingAssistantMessages);
    pendingAssistantMessages.clear();
    assistantRoles.clear();
    if (active) outcome = { status: "interrupted", error: reason };
    active = false;
    phase = "";
  }

  async function interrupt(client) {
    cancelling = true;
    clearFinalAssistantResult();
    if (client) await client.interrupt();
    // The process host still must drain its owned scope and call stop().
  }

  function begin({ id, maxOutputCharacters = 4 * 1024 * 1024 } = {}) {
    if (active) throw claudeTurnFailure("This Claude turn is still working.", { messageCode: "assistant.claude.turnStillWorking" });
    if (!id || !Number.isSafeInteger(maxOutputCharacters) || maxOutputCharacters < 1) throw new TypeError("Invalid Claude turn configuration.");
    generation++;
    clearTurnView();
    turnId = id;
    maximumOutput = maxOutputCharacters;
    phase = "";
    messageId = "";
    currentCommandId = "";
    cancelling = false;
    stopped = false;
    active = true;
  }

  function reset() {
    if (active || inFlight.size || tasks.size) throw claudeTurnFailure("Stop Claude before resetting its turn view.", { messageCode: "assistant.claude.stopBeforeReset" });
    clearTurnView();
  }

  async function send(client, message, { messageId: uuid, accept, timeoutMs = 30_000, steer = false } = {}) {
    if (!active || stopped || cancelling) {
      throw Object.assign(steeringRefusal("Claude has no active turn for this message.", {
        messageCode: "assistant.claude.noActiveTurn", finished: !active && !stopped && !cancelling }), { delivery: "not-sent" });
    }
    if (!uuid || typeof accept !== "function" || admissions.has(uuid)) throw new TypeError("A distinct message id and admission writer are required.");
    clearFinalAssistantResult();
    acceptedInput = null;
    inputOwner = entry ? { commandId: uuid, process: entry.process, executionId: entry.executionId,
      accountIdentity: entry.accountIdentity } : null;
    const receiptOwner = inputOwner;
    const admitted = Promise.withResolvers();
    void admitted.promise.catch(() => {});
    inFlight.add(uuid);
    if (steer) {
      waitingSteers.add(uuid);
      steeringClient = client;
    }
    const timer = setTimeout(() => admitted.reject(Object.assign(
      claudeTurnFailure("Claude has not acknowledged this prompt. Its delivery is uncertain.", { code: "assistant_claude_admission_unknown" }),
      { delivery: "uncertain" }
    )), timeoutMs);
    admissions.set(uuid, { ...admitted, accept, timer, receiptOwner });
    try {
      await Promise.all([client.send(message, { messageId: uuid, sessionId: conversationId })
        .then(() => { if (steer) backgroundForegroundWork(); }), admitted.promise]);
    } catch (error) {
      waitingSteers.delete(uuid);
      if (inputOwner === receiptOwner) invalidateFinalAssistantResult();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function prepareSteering() {
    if (!active || cancelling) {
      const completed = !active && !stopped && !cancelling && outcome?.status === "completed";
      throw Object.assign(steeringRefusal("This Claude turn cannot accept steering now.", {
        messageCode: "assistant.claude.steeringUnavailable", finished: completed }),
        { delivery: "not-sent" });
    }
    // Claude Code acknowledges streamed input as queued and folds it into the
    // running turn after the current tool call, or starts it once the main
    // loop is idle. Interrupting instead would kill a running foreground tool;
    // send() moves such a tool to the background so the steer is read now.
    // The next input owns completion now: a result or task finishing before
    // it starts must not settle this turn with the previous answer.
    outcome = null;
    acceptedInput = null;
    clearFinalAssistantResult();
    await publish({ type: "diagnostic", stage: "steering_queued", pendingCommands: inFlight.size, backgroundTasks: tasks.size });
  }

  async function cancel(client, stopProcess) {
    try {
      await interrupt(client);
    } catch {
      // A verified managed-scope stop also handles an unresponsive control pipe.
    } finally {
      // A control acknowledgement is not a process-exit proof. Draining also
      // cancels queued steering prompts and native background tools.
      await stopProcess();
    }
  }

  return Object.freeze({
    receive,
    read,
    stop,
    interrupt,
    readFinalAssistantResult,
    invalidateFinalAssistantResult,
    ...(entry ? { readResult, updateState, stopProcess } : {}),
    ...(instructions ? {
      prepare: instructions.prepare,
      whenIdle: instructions.whenIdle,
      instructionArguments: instructions.instructionArguments,
      invalidateInstructions: instructions.invalidate
    } : {}),
    begin,
    reset,
    send,
    prepareSteering,
    cancel
  });
}
