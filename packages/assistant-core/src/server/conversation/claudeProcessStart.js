import { randomUUID } from "node:crypto";
import { createClaudeCodeProcess } from "./claudeProcess.js";
import { claudeApplicationToolResponse } from "./claudeTools.js";

export function hasPendingClaudeStartup(entry) {
  return entry.startupCleanup?.pending === true && entry.startupCleanup.executionId === entry.executionId;
}

/**
 * Starts a retained entry's Claude process: it fences preparation, routes the
 * process's frames and application tool calls, keeps startup custody, and
 * suspends a retained goal's checker: beside its Pause on a running process,
 * otherwise before the first prompt. Local commands (goal clear, compaction) run
 * on that process outside the turn view.
 * @param {{
 *   store: import("./claudeTurn.js").ClaudeConversationStore,
 *   process: import("./claudeTurn.js").ClaudeConversationProcessHost,
 *   createError: import("./claudeTurn.js").ClaudeConversationErrorFactory,
 *   onEvent: import("./claudeTurn.js").ClaudeConversationEventHandler,
 *   bound: boolean,
 *   readHistory: (entry: import("./claudeTurn.js").ClaudeConversationEntry) => Promise<Record<string, any>>,
 *   isClosing: (contextKey: string) => boolean,
 *   applicationCall: import("node:async_hooks").AsyncLocalStorage<Record<string, any>>,
 *   currentApplicationCommand: (entry: import("./claudeTurn.js").ClaudeConversationEntry, command: Record<string, any>, owner?: Record<string, any>) => boolean
 * }} options
 */
export function createClaudeProcessStart({
  store,
  process,
  createError,
  onEvent,
  bound,
  readHistory,
  isClosing,
  applicationCall,
  currentApplicationCommand
}) {
  const createProcess = process.create || createClaudeCodeProcess;
  const GOAL_CLEAR = Object.freeze({ name: "goal",
    failureMessage: "Claude could not suspend its retained goal checker.", failureCode: "conversation_claude_goal_suspend_failed",
    timeoutMessage: "Claude timed out suspending its retained goal checker.", timeoutCode: "conversation_claude_goal_suspend_timeout" });

  async function startProcess(entry, configuration) {
    const context = entry.context;
    const revision = entry.preparationRevision;
    const assertPreparing = () => {
      if (revision !== entry.preparationRevision || entry.disposed || isClosing(context.key)) {
        throw createError("Claude preparation was stopped while this session was closing or changing.", { code: "conversation_claude_preparation_stopped" });
      }
    };
    assertPreparing();
    let prepared = process.prepare ? process.prepare(entry, configuration, context) : { workdir: entry.nativeWorkdir };
    // readable-check: allow method-probe - data: a host prepares the workdir synchronously or with a promise; a synchronous one starts without yielding
    if (prepared && typeof prepared.then === "function") prepared = await prepared;
    entry.nativeWorkdir = prepared.workdir;
    if (!entry.sent) entry.sent = (await readHistory(entry)).exists;
    entry.stopping = false;
    entry.profile = configuration.profile;
    let options = process.configure(entry, configuration, { context, prepared });
    // readable-check: allow method-probe - data: a host configures the process synchronously or with a promise; a synchronous one starts without yielding
    if (options && typeof options.then === "function") options = await options;
    assertPreparing();
    let startupCleanup;
    let startedExecutionId;
    const processToken = {};
    // A process's MCP output cap is set when it starts, so its tool list declares the same result
    // limit: the one of the application tools it starts for.
    entry.toolResultBytes = entry.command?.tools?.maximumResultBytes;
    try { entry.process = await createProcess({ ...options,
      workdir: entry.nativeWorkdir, sessionId: entry.id, resume: entry.sent, maximumToolResultBytes: entry.toolResultBytes,
      onStarted: async (executionId, stop) => {
        startedExecutionId = executionId;
        if (typeof stop === "function") {
          startupCleanup = { executionId, stop, pending: true };
          entry.startupCleanup = startupCleanup;
        }
        if (entry.executionId !== executionId) {
          entry.executionId = executionId;
          await store.save(entry, { execution: true });
          await onEvent(entry, { type: "execution", context, executionId });
        }
        assertPreparing();
      },
      async onEvent(frame) {
        const pending = entry.goalToolStop;
        if (pending && pending.executionId === startedExecutionId && entry.process === pending.process &&
            frame.type === "user" && !frame.parent_tool_use_id && Array.isArray(frame.message?.content) &&
            frame.message.content.some(block => block.type === "tool_result" && block.tool_use_id === pending.toolUseId)) {
          // The CLI has consumed the tool response. Do not join process cleanup
          // on its event reader: interrupt/exit also needs that reader to drain.
          pending.stop();
        }
        // Local commands (retained goal clear, compaction) are not AI turns.
        // Their frames stay out of the turn view until their own result.
        const local = entry.localCommand;
        if (local?.processToken === processToken) {
          if (frame.type === "result" && frame.user_message_uuid === local.id) {
            if (frame.local_command === local.name && frame.is_error !== true && frame.subtype === "success") local.resolve();
            else local.reject(createError(local.failureMessage, { code: local.failureCode }));
          }
          return;
        }
        const current = entry.command;
        if (current && frame.type === "assistant" && !frame.parent_tool_use_id) {
          for (const tool of frame.message?.content || []) if (tool.type === "tool_use" && tool.id && tool.name?.startsWith("mcp__application__")) {
            if (current.nativeToolCount >= current.maximumToolCalls && !current.nativeTools.has(tool.id)) {
              throw Object.assign(new Error("Claude exceeded the application tool-call limit."), { messageCode: "assistant.claude.toolCallLimit", messageParams: {} });
            }
            if (!current.nativeTools.has(tool.id)) {
              current.nativeToolCount++;
              current.nativeTools.set(tool.id, { name: tool.name, input: tool.input, messageId: current.messageId });
            }
          }
        }
        await entry.nativeTurn.receive(frame);
      },
      ...(bound || options.applicationTools || entry.command?.tools ? {
        async onControlRequest(request, { signal }) {
          const active = entry.command;
          const suppliedTools = !bound && active?.tools;
          const owner = active?.nativeOwner;
          const work = applicationCall.run({ entry, command: active, owner,
            toolUseId: request.message?.params?._meta?.["claudecode/toolUseId"] },
          () => claudeApplicationToolResponse(request, { schemas: entry.toolSchemas || [], maximumResultBytes: entry.toolResultBytes,
            turn: active, signal,
            ...(suppliedTools ? {
              assertCurrent(native) {
                if (!currentApplicationCommand(entry, active, owner) || active.nativeOwner !== owner ||
                    native.messageId !== active.messageId) throw new Error("Claude's application call belongs to a retired input.");
              },
              onExecutionFailure(error, native) {
                // Already-invoked old work retains its original result. Only
                // this still-current authored input can fail this native run.
                if (currentApplicationCommand(entry, active, owner) && active.nativeOwner === owner &&
                    native.messageId === active.messageId) {
                  active.toolFailure = error;
                  active.failure.reject(error);
                }
              }
            } : {}) }));
          active?.toolWork.add(work);
          try { return await work; }
          finally { active?.toolWork.delete(work); }
        }
      } : {}),
      onFailure: async error => {
        if (entry.localCommand?.processToken === processToken) entry.localCommand.reject(error);
        if (bound) {
          entry.nativeTurn.invalidateInstructions();
          try { await entry.nativeTurn.stopProcess(error.message); }
          catch (cleanupError) { error = cleanupError; await context.reportFailure(cleanupError); }
          entry.command?.completion.reject(error);
          return;
        }
        entry.observationError = error.message;
        await entry.nativeTurn.stopProcess(error.message);
      }
    }); } catch (error) {
      if (error.executionId && error.stopProof?.scopeEmpty !== true && !entry.executionId) {
        // Streaming startup can fail after host admission, before onStarted.
        // Retain that custody through the same binding owner for Stop recovery.
        error.cleanupFailed = true;
        entry.executionId = error.executionId;
        try {
          await store.save(entry, { execution: true });
          await onEvent(entry, { type: "execution", context, executionId: entry.executionId });
        } catch (bindingError) { error.bindingError = bindingError; }
      }
      if (bound && error.stopProof?.scopeEmpty) {
        await store.releaseExecution(entry);
        if (entry.startupCleanup?.executionId === error.executionId) entry.startupCleanup = null;
      }
      throw error;
    } finally {
      if (startupCleanup) startupCleanup.pending = false;
    }
    try { assertPreparing(); }
    catch (error) {
      await entry.nativeTurn.stopProcess(error.message);
      throw error;
    }
    if (entry.startupCleanup?.executionId === entry.executionId) entry.startupCleanup = null;
    entry.processToken = processToken;
    if (entry.pausedGoal || entry.blockedGoal) {
      try {
        // A Pause that already stood the checker down leaves no second "Goal cleared" above the next message.
        if ((await readHistory(entry)).goal) {
          const id = await runLocalCommand(entry, "/goal clear", { ...GOAL_CLEAR, timeoutMs: 30_000 });
          const cleared = await readHistory(entry);
          if (cleared.goal || cleared.goalCommandId !== id) {
            throw createError("Claude has not saved the retained goal's native clear receipt.", { code: "conversation_claude_goal_clear_unconfirmed" });
          }
        }
        assertPreparing();
      } catch (error) {
        await entry.nativeTurn.stopProcess(error.message);
        throw Object.assign(error, { delivery: "not-sent" });
      }
    }
    return entry.process;
  }

  async function runLocalCommand(entry, command, { name, timeoutMs, failureMessage, failureCode, timeoutMessage, timeoutCode }) {
    const completion = Promise.withResolvers();
    completion.promise.catch(() => {});
    const local = { ...completion, id: randomUUID(), name, failureMessage, failureCode, processToken: entry.processToken };
    entry.localCommand = local;
    const timer = setTimeout(() => completion.reject(createError(timeoutMessage, { code: timeoutCode })), timeoutMs);
    try {
      await entry.process.client.send(command, { messageId: local.id, sessionId: entry.id });
      await completion.promise;
      return local.id;
    } finally {
      clearTimeout(timer);
      if (entry.localCommand === local) entry.localCommand = null;
    }
  }

  // A retained Pause or blocker stands Claude's own goal checker down at once, on the process still running, before it
  // stops, so its "Goal cleared" sits beside that Pause in Claude's history instead of above the person's next message.
  // Claude's own Pause first interrupts its turn. Without a running process, or when Claude cannot clear it in moments,
  // the process still stops and the next start clears it.
  async function suspendGoalChecker(entry, { interruptTurn = false } = {}) {
    try {
      if (!entry.process || !(entry.pausedGoal || entry.blockedGoal) || !(await readHistory(entry)).goal) return;
      if (entry.nativeTurn.read().active) {
        if (!interruptTurn) return;
        await entry.nativeTurn.interrupt(entry.process.client);
      }
      await runLocalCommand(entry, "/goal clear", { ...GOAL_CLEAR, timeoutMs: 10_000 });
    } catch {
      // The next start clears it.
    }
  }

  return Object.freeze({
    startProcess,
    runLocalCommand,
    suspendGoalChecker
  });
}
