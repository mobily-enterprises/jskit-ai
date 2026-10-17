import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { claudeMessageBlocks, deleteClaudeConversationHistory, readClaudeHistory, requireClaudeSessionId, retireClaudeConversationHistory } from "./claudeHistory.js";
import { bindClaudeConversationAccount, claudeCodeArguments, createClaudeAccountQueries, createClaudeCodeProcess, stopClaudeCodeProcess } from "./claudeProcess.js";
import { claudeApplicationToolResponse } from "./claudeTools.js";
import { createClaudeConversationAdapter } from "./providers/claude.js";

function failure(message, code = "assistant_claude_turn_failed") {
  return Object.assign(new Error(message), { code });
}

const text = value => String(value ?? "").trim();
const now = () => new Date().toISOString();

function hasPendingClaudeStartup(entry) {
  return entry.startupCleanup?.pending === true && entry.startupCleanup.executionId === entry.executionId;
}

export function claudeNativeMessageId(id) {
  const value = createHash("sha256").update(String(id)).digest("hex");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}

/** Wait on the conversation's existing completion and cleanup owner. */
export async function waitForClaudeConversationTurn(conversation, input = {}, {
  signal, defaultTimeoutMs = 180_000, maximumTimeoutMs = Infinity, createError = failure,
  interruptedMessage = "Claude was interrupted when the application disconnected."
} = {}) {
  const entry = conversation.state;
  if (entry.executionId && !entry.process && !hasPendingClaudeStartup(entry)) await conversation.stop(interruptedMessage);
  if (!entry.turn?.active) return conversation.read(input);
  const timeoutMs = Math.min(
    Number(input.timeoutMs) > 0 ? Number(input.timeoutMs) : defaultTimeoutMs,
    maximumTimeoutMs
  );
  let timer;
  let timedOut = false;
  const abort = () => { void conversation.interrupt().catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  try {
    if (timeoutMs === Infinity) return await entry.completion.promise;
    return await Promise.race([entry.completion.promise, new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(createError("Claude did not finish within the time limit."));
      }, timeoutMs);
    })]);
  } catch (failure) {
    if (timedOut) await conversation.interrupt();
    throw failure;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

/** Native renewal receipt, completion and cleanup moved from the session provider. */
export async function runClaudeRenewalTurn(conversation, {
  clientMessageId, prompt, outputSchema, expectedThreadId, forbiddenThreadId,
  requireFreshHistory = false, timeoutMs = 180_000
}, {
  createError = failure, unreadableCode = "assistant_claude_turn_unreadable",
  failedCode = "assistant_claude_turn_failed", acceptedField = "inputAccepted"
} = {}) {
  const uuid = claudeNativeMessageId(clientMessageId);
  const entry = conversation.state;
  if ((expectedThreadId && expectedThreadId !== entry.id) ||
      (requireFreshHistory && forbiddenThreadId === entry.id)) {
    throw createError("The Claude renewal conversation does not match the expected native history.");
  }
  const history = await conversation.readHistory();
  if (requireFreshHistory && history.userIds.some((id) => id !== uuid)) throw createError("The successor Claude conversation already contains unrelated messages.");
  const accepted = history.userIds.includes(uuid);
  let result;
  try {
    if (accepted) {
      if (entry.turn?.id === uuid && entry.turn.active && entry.process) {
        result = await conversation.wait({ conversationId: entry.id, timeoutMs });
        if (result.status !== "completed") throw createError(result.error || "Claude did not complete the renewal turn.", failedCode);
      } else {
        if (entry.turn?.id !== uuid || entry.turn.state !== "completed" || entry.turn.active) {
          throw createError("The accepted Claude renewal turn has no confirmed completion; it will not be submitted again.", unreadableCode);
        }
        result = { text: history.messages.filter((message) => message.userId === uuid && message.role === "assistant").map((message) => message.text).join("\n"),
          threadId: entry.id, turnId: uuid, reconciled: true };
        if (!result.text) throw createError("The accepted Claude renewal turn has no readable result; it will not be submitted again.", unreadableCode);
      }
    } else {
      if (entry.turn?.active && entry.process) throw createError("Stop the current turn before renewing this conversation.");
      await conversation.send({ message: prompt, messageId: clientMessageId, outputSchema }, { renewal: true });
      result = await conversation.wait({ conversationId: entry.id, timeoutMs });
      if (result.status !== "completed") throw createError(result.error || "Claude did not complete the renewal turn.", failedCode);
    }
    return { ...result, clientMessageId,
      freshThread: history.userIds.length === 0, processExitProof: await conversation.stop() };
  } catch (failure) {
    failure.details = { ...failure.details, clientMessageId, [acceptedField]: accepted || entry.lastMessageId === uuid,
      threadId: entry.id, turnId: entry.turn?.id || uuid };
    await conversation.stop(failure.message);
    throw failure;
  }
}

export function createClaudeConversationGoals({ conversationId, readHistory, readState, interrupt, send, readRetainedGoal, saveRetainedGoal }) {
  // These checks run before interrupt/send. Native execution and receipt
  // failures keep their own codes and must not be treated as safe rejections.
  const goalError = message => Object.assign(failure(message, "conversation_invalid_goal"), {
    statusCode: 400, delivery: "not-sent"
  });

  async function read(history = null) {
    const { goal = null } = history || await readHistory();
    const retained = readRetainedGoal?.();
    if (retained) return { ...retained };
    const state = readState();
    return goal ? { ...goal, status: ["complete", "blocked"].includes(goal.status) ? goal.status :
      state.running && state.active ? "active" : "paused" } : null;
  }

  async function update(input = {}, { interrupt: interruptGoal = interrupt, send: sendGoal = send, signal } = {}) {
    const goal = await read();
    signal?.throwIfAborted();
    const action = input.action;
    if (action !== "set" && (!goal || input.threadId !== conversationId ||
        input.createdAt !== goal.createdAt || input.objective !== goal.objective)) {
      throw goalError("The Claude goal changed. Refresh before trying again.");
    }
    if (input.tokenBudget != null) throw goalError("Claude goals do not support a token budget.");
    if (action === "pause" || action === "block") {
      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (action === "block" && (!reason || reason.length > 1000 || goal.status !== "active")) {
        throw goalError("An active Claude goal needs a blocker reason of up to 1,000 characters.");
      }
      if (goal.status !== "complete") await saveRetainedGoal({ ...goal,
        status: action === "block" ? "blocked" : "paused", ...(action === "block" ? { reason } : {}) });
      await interruptGoal();
    } else if (action === "cancel") {
      await interruptGoal();
      await sendGoal({ message: "/goal clear", signal });
    } else if (action === "set" || action === "resume") {
      const objective = String((action === "set" ? input.objective : goal.objective) ?? "").trim();
      if (!objective || objective.length > 4000 || /^(clear|stop|off|reset|none|cancel)$/iu.test(objective)) {
        throw goalError("Enter a goal condition of up to 4,000 characters.");
      }
      if (action === "set" && goal && goal.status !== "complete") {
        throw goalError("Cancel the existing goal before setting another.");
      }
      await sendGoal({ message: `/goal ${objective}`, signal });
    } else throw goalError("Unknown Claude goal action.");
  }

  return Object.freeze({ read, update });
}

/** The original retained entry and command owner; hosts supply authorized storage and message effects. */
export function createClaudeConversationOwner({
  configRoot, store, preparation, process, onEvent, createError = failure,
  disconnectedMessage = "Claude was interrupted when the application disconnected."
}) {
  const entries = new Map();
  const applicationCall = new AsyncLocalStorage();
  const closingSessions = new Set();
  let closing = false;
  const createProcess = process.create || createClaudeCodeProcess;
  const saveAccount = store.save;

  function createAccountQueries({ accountIdentity, createProcess }) {
    return createClaudeAccountQueries({ accountIdentity,
      processes: () => entries.values(), isClosing: () => closing, createProcess });
  }

  function snapshot(entry) {
    return entry?.turn ? { ...entry.turn, threadId: entry.id,
      ...(entry.turn.active && entry.observationError ? { status: "observation_lost", error: entry.observationError } : {}),
      phase: entry.turn.active && !entry.observationError ? text(entry.turn.phase) : "" } : null;
  }

  function currentApplicationCommand(entry, command, owner = command?.nativeOwner) {
    const native = entry?.nativeTurn.read();
    return Boolean(owner && entry && !closing && !closingSessions.has(entry.context.key) &&
      entries.get(entry.key) === entry && entry.command === command && command.entry === entry &&
      command.admitted && !command.signal.aborted && !command.toolFailure &&
      !entry.disposed && !entry.stopping && !entry.stopPending && !entry.goalToolStop && !entry.observationError &&
      entry.process === owner.process && entry.executionId === owner.executionId &&
      entry.accountIdentity === owner.accountIdentity && entry.id === owner.threadId &&
      entry.turn?.id === owner.turnId && entry.turn.active && native.turnId === owner.turnId && native.active);
  }

  function readRetainedTurn(contextKey, conversationId, state) {
    const entry = entries.get(`${contextKey}\0${conversationId}`);
    if (state.current) return currentApplicationCommand(entry, entry?.command) ? snapshot(entry) : null;
    const saved = state.saved;
    return state.nativeResult?.turn || (entry ? snapshot(entry) : saved?.turnId ? {
      id: saved.turnId, threadId: conversationId, state: saved.state,
      active: ["starting", "active", "finalizing"].includes(saved.state)
    } : null);
  }

  // This lookup uses only the existing current entry and native receipt owner.
  function readFinalAssistantResult(contextKey, conversationId = "", turnId = "") {
    if (!text(contextKey) || !text(conversationId) || !text(turnId) || closing || closingSessions.has(contextKey)) return null;
    const entry = entries.get(`${contextKey}\0${conversationId}`);
    if (!entry || entry.disposed || entry.stopping || entry.observationError ||
        entry.id !== conversationId || entry.context.key !== contextKey || entry.turn?.id !== turnId) return null;
    return entry.nativeTurn.readFinalAssistantResult(conversationId, turnId);
  }

  function readHistory(entry) {
    return readClaudeHistory({ configRoot, workdir: entry.nativeWorkdir, conversationId: entry.id });
  }

  async function open(context, { conversationId = "", mainId, create = false,
    cleanupExecutionId, recoveringCleanup = false, nativeWorkdir = context.workdir } = {}) {
    const main = !conversationId || conversationId === mainId;
    const id = conversationId || text(mainId) ||
      [...entries.values()].find(entry => entry.main && entry.context.key === context.key)?.id || randomUUID();
    requireClaudeSessionId(id);
    if (!conversationId) {
      const selected = store.select(context, id);
      if (selected) await selected;
    }
    const key = `${context.key}\0${id}`;
    if (entries.has(key)) {
      const entry = entries.get(key);
      entry.context = context;
      return entry;
    }
    let saved = store.read(context, id);
    if (saved && typeof saved.then === "function") saved = await saved;
    if (!main && !saved && !create && !recoveringCleanup) throw createError("This Claude conversation is unavailable.");
    const state = saved ? JSON.parse(saved) : {};
    const entry = { id, key, main, persistent: state.persistent === true, context, process: null, startupCleanup: null,
      executionId: state.executionId || (recoveringCleanup ? cleanupExecutionId : ""), preparationRevision: 0,
      accountIdentities: state.accountIdentities || (state.accountIdentity ? { anthropic: state.accountIdentity } : {}),
      accountIdentity: state.accountIdentity || "", sent: state.sent === true, nativeWorkdir: state.nativeWorkdir || nativeWorkdir,
      lastMessageId: state.lastMessageId || "", pausedGoal: state.pausedGoal || null, blockedGoal: state.blockedGoal || null, turn: state.turnId ? {
        id: state.turnId, active: ["starting", "active", "finalizing"].includes(state.state),
        state: state.state, startedAt: now(), updatedAt: now()
      } : null };
    for (const [field, status] of [["pausedGoal", "paused"], ["blockedGoal", "blocked"]]) {
      const retained = entry[field];
      if (retained && (retained.threadId !== id || typeof retained.objective !== "string" ||
          !retained.objective.trim() || !Number.isFinite(retained.createdAt) || retained.status !== status ||
          status === "blocked" && (typeof retained.reason !== "string" || !retained.reason.trim() || retained.reason.length > 1000))) {
        throw createError("The retained Claude goal is invalid. Restore its saved conversation state.");
      }
    }
    if (entry.pausedGoal && entry.blockedGoal) throw createError("The saved Claude goal cannot be both paused and blocked.");
    entry.nativeTurn = createClaudeConversationTurn({ conversationId: id, entry,
      onEvent: event => onEvent(entry, event),
      process: {
        stopExecution: process.stopExecution,
        ...(store.releaseExecution ? { releaseExecution: () => store.releaseExecution(entry) } : {}),
        getProcess: () => entry.stopping ? null : entry.process,
        isActive: () => store.releaseExecution ? entry.nativeTurn.read().active : Boolean(entry.turn?.active),
        startProcess: input => startProcess(entry, input),
        stopProcess: reason => entry.process || entry.executionId
          ? entry.nativeTurn.stopProcess(reason, { preparing: true }) : Promise.resolve()
      }
    });
    entry.goals = createClaudeConversationGoals({ conversationId: id,
      readHistory: () => readHistory(entry),
      readRetainedGoal: () => entry.pausedGoal || entry.blockedGoal,
      async saveRetainedGoal(goal) {
        const previous = { pausedGoal: entry.pausedGoal, blockedGoal: entry.blockedGoal };
        entry.pausedGoal = goal.status === "paused" ? goal : null;
        entry.blockedGoal = goal.status === "blocked" ? goal : null;
        try { await store.save(entry); }
        catch (error) { Object.assign(entry, previous); throw error; }
      },
      readState: () => ({ running: Boolean(entry.process), active: store.releaseExecution ? entry.nativeTurn.read().active : Boolean(entry.turn?.active) }),
      interrupt: () => interrupt(entry), send: input => send(entry, input) });
    entries.set(key, entry);
    await store.save(entry);
    return entry;
  }

  async function acquire(context, conversationId = "", { create = false, cleanupExecutionId, operation, input } = {}) {
    const ctx = await preparation.context(context);
    const prepared = preparation.entry(ctx, context, conversationId, { create, cleanupExecutionId, operation, input });
    const entry = await open(ctx, prepared.options);
    prepared.check(entry);
    return entry;
  }

  async function createConversation(input = {}, { context, acquire }) {
    const entry = await acquire(context, randomUUID(), { create: true });
    const executionProfile = input.executionProfile;
    if (executionProfile !== undefined) entry.profile = executionProfile;
    entry.persistent = input.persistent === true;
    await store.save(entry);
    return { ok: true, conversationId: entry.id, ephemeral: input.ephemeral === true, status: "ready" };
  }

  async function bindAccount(entry) {
    const account = preparation.account(entry);
    const identity = await account.identity;
    const providerId = account.providerId;
    if (entry.accountIdentity !== identity) entry.nativeTurn.invalidateFinalAssistantResult();
    try {
      await bindClaudeConversationAccount(entry, { identity, providerId, allowAccountChange: account.allowAccountChange === true,
        stop: (entry, reason) => entry.nativeTurn.stopProcess(reason, { preparing: true }), save: saveAccount });
    } catch (failure) {
      if (failure.code !== "claude_account_changed") throw failure;
      throw createError(failure.message, account.changedCode || failure.code);
    }
  }

  async function ensureReady(entry) {
    if (entry.process) await ensureProcess(entry);
    else {
      await bindAccount(entry);
      if (entry.executionId && !hasPendingClaudeStartup(entry)) await entry.nativeTurn.stopProcess("Claude's previous process exit could not be confirmed.");
      // The first Send prepares host hooks before starting the native process.
    }
    return { ok: true, thread: { id: entry.id }, turn: snapshot(entry), workdir: entry.context.workdir };
  }

  async function ensureProcess(entry, input = {}) {
    const revision = entry.preparationRevision;
    const application = preparation.checkConfiguration?.(entry, input);
    if (entry.disposed || closing || closingSessions.has(entry.context.key) || application?.sessionClosing) {
      throw createError("This session is closing.");
    }
    if (preparation.account) await bindAccount(entry);
    const configuration = await preparation.configuration(entry, input);
    if (revision !== entry.preparationRevision || entry.disposed || closing || closingSessions.has(entry.context.key)) {
      throw createError("Claude preparation was stopped while this session was closing or changing.");
    }
    return entry.nativeTurn.prepare(configuration);
  }

  async function readContextUsage(entry, input = {}) {
    input.signal?.throwIfAborted();
    const native = await ensureProcess(entry, input);
    input.signal?.throwIfAborted();
    const usage = await native.client.request({ subtype: "get_context_usage", detail: "summary" });
    input.signal?.throwIfAborted();
    const usedTokens = usage?.totalTokens;
    const maximum = usage?.maxTokens;
    const threshold = usage?.autoCompactThreshold ?? maximum;
    if (!Number.isSafeInteger(usedTokens) || usedTokens < 0 ||
        !Number.isSafeInteger(maximum) || maximum < 1 ||
        !Number.isSafeInteger(threshold) || threshold < 1 || typeof usage.model !== "string" || !usage.model) {
      throw createError("Claude's current context usage is unavailable.");
    }
    return { model: usage.model, usedTokens,
      windowTokens: usage.isAutoCompactEnabled === false ? maximum : Math.min(maximum, threshold) };
  }

  async function stopForTerminal(entry, application) {
    if (entry.turn?.active) throw createError("Stop the current turn before opening the Claude Code terminal.");
    if (closing || closingSessions.has(entry.context.key) || application?.sessionClosing) throw createError("This session is closing.");
    await bindAccount(entry);
    await entry.nativeTurn.stopProcess();
  }

  async function prepareTerminal(entry, context) {
    const history = await readClaudeHistory({ configRoot, workdir: context.workdir, conversationId: entry.id });
    entry.sent ||= history.exists;
    const configuration = await process.configureTerminal(entry, context);
    const options = { terminal: true, sessionId: entry.id, resume: entry.sent,
      instructionArguments: entry.nativeTurn.instructionArguments({ systemPrompt: await configuration.systemPrompt }),
      model: configuration.model, effort: configuration.effort };
    return { args: claudeCodeArguments({ permissionMode: configuration.permissionMode, settings: configuration.settings, ...options }),
      env: { ...configuration.env, DISABLE_AUTOUPDATER: "1" } };
  }

  async function startProcess(entry, configuration) {
    const context = entry.context;
    const revision = entry.preparationRevision;
    const assertPreparing = () => {
      if (revision !== entry.preparationRevision || entry.disposed || closing || closingSessions.has(context.key)) {
        throw createError("Claude preparation was stopped while this session was closing or changing.");
      }
    };
    assertPreparing();
    let prepared = process.prepare ? process.prepare(entry, configuration, context) : { workdir: entry.nativeWorkdir };
    if (prepared && typeof prepared.then === "function") prepared = await prepared;
    entry.nativeWorkdir = prepared.workdir;
    const history = await readHistory(entry);
    entry.sent ||= history.exists;
    entry.stopping = false;
    entry.profile = configuration.profile;
    let options = process.configure(entry, configuration, { context, prepared });
    if (options && typeof options.then === "function") options = await options;
    assertPreparing();
    let startupCleanup;
    let retainedGoalClear;
    let startedExecutionId;
    try { entry.process = await createProcess({ ...options,
      workdir: entry.nativeWorkdir, sessionId: entry.id, resume: entry.sent,
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
        // A retained Pause disarms only the native goal hook before a new
        // authored input is admitted. This local command is not an AI turn.
        if (retainedGoalClear) {
          if (frame.type === "result" && frame.user_message_uuid === retainedGoalClear.id) {
            if (frame.local_command === "goal" && frame.is_error !== true && frame.subtype === "success") retainedGoalClear.resolve();
            else retainedGoalClear.reject(createError("Claude could not suspend its retained goal checker."));
          }
          return;
        }
        const current = entry.command;
        if (current && frame.type === "assistant" && !frame.parent_tool_use_id) {
          for (const tool of frame.message?.content || []) if (tool.type === "tool_use" && tool.id && tool.name?.startsWith("mcp__application__")) {
            if (current.nativeToolCount >= current.maximumToolCalls && !current.nativeTools.has(tool.id)) {
              throw new Error("Claude exceeded the application tool-call limit.");
            }
            if (!current.nativeTools.has(tool.id)) {
              current.nativeToolCount++;
              current.nativeTools.set(tool.id, { name: tool.name, input: tool.input, messageId: current.messageId });
            }
          }
        }
        await entry.nativeTurn.receive(frame);
      },
      ...(store.releaseExecution || options.applicationTools || entry.command?.tools ? {
        async onControlRequest(request, { signal }) {
          const active = entry.command;
          const suppliedTools = !store.releaseExecution && active?.tools;
          const owner = active?.nativeOwner;
          const work = applicationCall.run({ entry, command: active, owner,
            toolUseId: request.message?.params?._meta?.["claudecode/toolUseId"] },
          () => claudeApplicationToolResponse(request, { schemas: entry.toolSchemas || [], turn: active, signal,
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
        retainedGoalClear?.reject(error);
        if (store.releaseExecution) {
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
      if (store.releaseExecution && error.stopProof?.scopeEmpty) {
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
    if (entry.pausedGoal || entry.blockedGoal) {
      const completion = Promise.withResolvers();
      completion.promise.catch(() => {});
      retainedGoalClear = { ...completion, id: randomUUID() };
      const timer = setTimeout(() => completion.reject(createError("Claude timed out suspending its retained goal checker.")), 30_000);
      try {
        await entry.process.client.send("/goal clear", { messageId: retainedGoalClear.id, sessionId: entry.id });
        await completion.promise;
        const cleared = await readHistory(entry);
        if (cleared.goal || cleared.goalCommandId !== retainedGoalClear.id) {
          throw createError("Claude has not saved the retained goal's native clear receipt.");
        }
        assertPreparing();
      } catch (error) {
        await entry.nativeTurn.stopProcess(error.message);
        throw Object.assign(error, { delivery: "not-sent" });
      } finally {
        clearTimeout(timer);
        retainedGoalClear = null;
      }
    }
    return entry.process;
  }

  async function send(entry, input = {}, { renewal = false, command, applicationCommand } = {}) {
    const message = command ? input.text : text(input.message || input.prompt);
    if (!command && !message) throw createError("Enter a message for Claude.");
    const context = entry.context;
    const messageId = command ? input.messageId : text(input.messageId) || randomUUID();
    const uuid = claudeNativeMessageId(messageId);
    if (!command) {
      if (entry.main && await store.hasMessage(context, messageId)) {
        return { ok: true, delivered: true, duplicate: true, thread: { id: entry.id }, turn: snapshot(entry) };
      }
      preparation.check(entry, context);
      const history = await readHistory(entry);
      if (history.userIds.includes(uuid)) {
        return { ok: true, delivered: true, duplicate: true, thread: { id: entry.id }, turn: snapshot(entry) };
      }
    }
    let native;
    try {
      native = command ? command.steering ? entry.process : await entry.nativeTurn.prepare(command.prepared) : await ensureProcess(entry, input);
    } catch (error) {
      // Preparation may start or resume the process, but has not written this
      // authored input. Keep its failure distinct from a lost native receipt.
      throw Object.assign(error, { delivery: "not-sent" });
    }
    if (command && !command.steering) command.signal.throwIfAborted();
    const steering = command ? command.steering === true : Boolean(entry.turn?.active);
    const sendNow = steering && native.client.supportsSendNow?.() === true;
    if (input.signal?.aborted) throw Object.assign(createError("The goal command was stopped before delivery."), { delivery: "not-sent" });
    if (steering) {
      if (command) {
        await command.beforeDispatch({ threadId: entry.id });
        command.signal.throwIfAborted();
      }
      try {
        await entry.nativeTurn.interruptGeneration(command ? entry.process.client : native.client,
          { ...(command ? { timeoutMs: command.timeoutMs } : {}), sendNow });
        if (command) command.interrupted = !sendNow;
      } catch (error) {
        if (!command) await entry.nativeTurn.stopProcess(error.message);
        // Interruption precedes this input's pipe write. Preserve that definite
        // non-delivery so a failed interrupt cannot strand an attempted receipt.
        throw Object.assign(error, { delivery: "not-sent" });
      }
    }
    const prompt = command ? undefined : await preparation.message(entry, input, { context, message, steering, renewal });
    if (command) {
      await command.beforeDispatch({ threadId: entry.id });
      command.signal.throwIfAborted();
    }
    if (!steering) {
      entry.renewal = renewal;
      entry.nativeTurn.begin({ id: uuid, maxOutputCharacters: command ? command.maximumOutput : entry.profile?.limits.maxOutputCharacters });
      entry.observationError = "";
      entry.turn = { id: uuid, active: true, state: "starting", startedAt: now(), updatedAt: now(), error: "" };
      if (!command) entry.completion = Promise.withResolvers();
      if (!command) await entry.nativeTurn.updateState("starting");
    }
    entry.onEvent = context.onEvent;
    entry.lastMessageId = uuid;
    const actorMetadata = command ? undefined : await onEvent(entry, { type: "message-metadata", input, context });
    const nativeOwner = applicationCommand ? { process: native, executionId: entry.executionId,
      accountIdentity: entry.accountIdentity, threadId: entry.id, turnId: entry.turn.id } : null;
    let conversationTurn;
    function deliveryResult() {
      return { ok: true, delivered: true, deliveryMode: steering ? "steer" : "new_turn",
        thread: { id: entry.id }, turn: snapshot(entry), workdir: context.workdir, conversationTurn };
    }
    async function accept() {
      (command || input).onNativeReceipt?.();
      // The new native ACK retires old effect custody while its canonical
      // admission/commit is awaited; it cannot retag a delayed old failure.
      if (applicationCommand) applicationCommand.active.nativeOwner = null;
      if (command) {
        if (!steering) await onEvent(entry, { type: "binding-admitted" });
        await command.accept();
        if (steering) {
          command.active.messageId = input.messageId;
          command.active.nativeToolCount = 0;
        } else command.active.admitted = true;
        command.admitted = true;
      } else {
        const admission = onEvent(entry, { type: "admit-message", input, context, renewal, message, messageId, uuid, actorMetadata });
        if (admission) conversationTurn = await admission;
      }
      if (!command) await entry.nativeTurn.updateState("active");
      (command || input).onReceiptPersisted?.();
      if (applicationCommand && conversationTurn) {
        const value = deliveryResult();
        const active = applicationCommand.active;
        const previousCompletion = active.completion;
        if (active.finishIfCurrent) {
          active.completion = Promise.withResolvers();
          active.completion.promise.catch(() => {});
        }
        active.delivery = { value, completion: active.finishIfCurrent ? active.completion.promise : entry.completion?.promise };
        if (active.finishIfCurrent) previousCompletion.resolve();
        // The original canonical admission and publication precede Core's same
        // accepted-request gate; native tools cannot race an unaccepted user.
        await applicationCommand.accept({ nativeResult: { value }, conversationTurn, nativeTurnId: entry.turn?.id });
        if (entry.process !== nativeOwner.process || entry.executionId !== nativeOwner.executionId ||
            entry.accountIdentity !== nativeOwner.accountIdentity || entry.id !== nativeOwner.threadId ||
            entry.turn?.id !== nativeOwner.turnId || entry.disposed || entry.stopping || entry.stopPending) {
          throw new Error("Claude's admitted tools no longer belong to this native process.");
        }
        applicationCommand.active.nativeOwner = nativeOwner;
        applicationCommand.active.messageId = messageId;
        if (steering) applicationCommand.active.nativeToolCount = 0;
        applicationCommand.active.admitted = true;
      }
    }
    try {
      if (command) command.attempted = true;
      else await input.onPromptSending?.({ threadId: entry.id, displayAttachments: input.displayAttachments, turnMetadata: actorMetadata });
      if (input.signal?.aborted) throw Object.assign(createError("The goal command was stopped before delivery."), { delivery: "not-sent" });
      await entry.nativeTurn.send(command ? entry.process.client : native.client, command ? preparation.message(entry, input) : prompt,
        { messageId: uuid, accept, sendNow, ...(command ? { timeoutMs: command.timeoutMs } : {}) });
    } catch (error) {
      if (!command) await entry.nativeTurn.stopProcess(error.message);
      throw error;
    }
    return deliveryResult();
  }

  async function startTurn(entry, input = {}) {
    entry.persistent ||= input.persistent === true;
    if (entry.turn?.active && entry.process && input.steer !== true) throw createError("This conversation is still working.");
    await send(entry, input);
    return { ...entry.nativeTurn.readResult(), ok: true, started: true };
  }

  async function interrupt(entry) {
    if (!entry.turn?.active) return { ok: true, interrupted: false, turn: snapshot(entry) };
    await entry.nativeTurn.cancel(entry.process?.client, () => entry.nativeTurn.stopProcess());
    return { ok: true, interrupted: true, thread: { id: entry.id }, turn: snapshot(entry) };
  }

  async function read(entry, input = {}) {
    if (entry.executionId && !entry.process && !hasPendingClaudeStartup(entry)) await entry.nativeTurn.stopProcess(disconnectedMessage);
    const history = await readHistory(entry);
    const messages = new Map(history.messages.map(message => [message.id, message]));
    const savedOutputs = new Map(history.messages.filter(message => message.outputId).map(message => [message.outputId, message]));
    const current = entry.nativeTurn.read();
    for (const message of current.messages) {
      const saved = savedOutputs.get(message.outputId);
      if (saved && saved.id !== message.id && saved.userId === message.userId) {
        // Native history can contain the completed block before its frame has
        // drained through live callbacks. Keep that text once, retaining a
        // verified Stop's commentary classification rather than inventing a FINAL.
        messages.set(saved.id, { ...saved,
          ...(current.status === "interrupted" && message.complete && message.role === "commentary" ? { role: "commentary" } : {}) });
      } else messages.set(message.id, { ...messages.get(message.id), ...message });
    }
    const requestIds = new Map((input.requestMessageIds || [input.messageId]).filter(id => typeof id === "string" && id)
      .map(id => [claudeNativeMessageId(id), id]));
    return { ...entry.nativeTurn.readResult(), ok: true,
      messages: [...messages.values()].map(message => ({ ...message,
        ...(message.userId ? { requestMessageId: requestIds.get(message.userId) || "" } : {}) })), text: current.text || history.text,
      admitted: history.userIds.includes(claudeNativeMessageId(input.messageId || "")) };
  }

  async function inspectAdmission(entry, input) {
    if (input.threadId && input.threadId !== entry.id) return { ok: true, admission: "unknown", messageId: input.messageId, threadId: entry.id };
    const history = await readHistory(entry);
    const turnId = claudeNativeMessageId(input.messageId);
    const accepted = history.userIds.includes(turnId);
    return { ok: true, admission: accepted ? "accepted" : "unknown", messageId: input.messageId,
      threadId: entry.id, turnId: accepted ? turnId : "" };
  }

  async function hasActiveTemporaryConversation(context, { acquire }) {
    await restoreSessionEntries(context, { acquire });
    return [...entries.values()].some((entry) => entry.context.key === context.key && !entry.main && entry.turn?.active);
  }

  function hasActiveConversation(binding) {
    return [...entries.values()].some((entry) => entry.id === binding.conversationId &&
      (entry.turn?.active || entry.process || entry.executionId));
  }

  function retireConversationHistory(prepared) {
    const { binding, application } = prepared;
    return retireClaudeConversationHistory({ configRoot: prepared.configRoot, binding,
      beforeDelete: prepared.beforeDelete, signal: prepared.signal,
      requireIdle: async () => {
        const saved = application.saved;
        const active = hasActiveConversation(binding);
        if (saved?.executionId || active || application.terminalRunning) {
          throw createError("Stop the saved Claude process and its terminal before retiring native history.");
        }
      }
    });
  }

  async function reconcileSessions(sessions, options = {}, application) {
    const results = [];
    for (const session of sessions) {
      const ctx = await application.readContext({ ...options, session, sessionId: session.sessionId });
      await recover(await restoreSessionEntries(ctx, { acquire }));
      results.push({ ok: true, sessionId: session.sessionId, resumed: false });
    }
    return { ok: true, results, failed: [], sessionCount: results.length };
  }

  async function restoreSessionEntries(context, { acquire }) {
    let saved = store.readSessionConversations(context);
    if (saved && typeof saved.then === "function") saved = await saved;
    for (const conversationId of saved.ids) await acquire(saved.context, conversationId);
    return [...entries.values()].filter((entry) => entry.context.key === context.key);
  }

  async function closeSession(context, application) {
    const ctx = await application.readContext(context);
    closingSessions.add(ctx.key);
    try {
      await restoreSessionEntries(ctx, { acquire });
      const proofs = await drain(ctx.key);
      const terminal = await application.terminals.close(ctx.sessionId);
      if (terminal?.ok !== false && context.forgetConversationBinding === true) {
        forget(ctx.key);
      }
      return { ok: terminal?.ok !== false, closed: proofs.length + Number(terminal?.closed || 0),
        processExitProof: proofs.at(-1) || { exited: true, scopeEmpty: true }, processExitProofs: proofs };
    } finally {
      closingSessions.delete(ctx.key);
    }
  }

  async function closeProject(input = {}, application) {
    const root = text(input.projectContextRoot);
    const contexts = new Map([...entries.values()]
      .filter((entry) => !root || path.resolve(store.projectContextRoot(entry)) === path.resolve(root))
      .map((entry) => [entry.context.key, entry.context]));
    let closed = 0;
    let ok = true;
    for (const ctx of contexts.values()) {
      const result = await closeSession(ctx, application);
      closed += result.closed;
      ok &&= result.ok;
    }
    return { ok, closed };
  }

  async function invalidateRuntimes(input = {}, application, account) {
    if (input.provider && input.provider !== "claude") return { ok: true, closed: 0 };
    if (input.modelProviderId) {
      return stopSelected(entry => store.modelProviderId(entry) === input.modelProviderId,
        "The provider connection changed.");
    }
    closing = true;
    try {
      await account.queries.invalidate().catch(account.failure);
      return await closeProject(undefined, application);
    } finally {
      closing = input.reason === "server-shutdown";
    }
  }

  async function drain(key) {
    const selected = [...entries.values()].filter(entry => entry.context.key === key);
    // Startup already lends cleanup before initialization completes. Stop it
    // first; waiting for the preparation queue first can exhaust host shutdown.
    for (const entry of selected) await entry.nativeTurn.stopProcess();
    await Promise.allSettled(selected.map(entry => entry.nativeTurn.whenIdle()));
    const proofs = [];
    for (const entry of selected) proofs.push(await entry.nativeTurn.stopProcess());
    return proofs;
  }

  function forget(contextKey) {
    for (const [key, entry] of entries) if (entry.context.key === contextKey) entries.delete(key);
  }

  async function close(entry) {
    await entry.nativeTurn.stopProcess("Conversation closed.");
    entry.disposed = true;
    await entry.nativeTurn.whenIdle().catch(() => {});
    await entry.nativeTurn.stopProcess("Conversation closed.");
    if (entries.get(entry.key) === entry) entries.delete(entry.key);
  }

  async function deleteConversation(entry) {
    await entry.nativeTurn.stopProcess();
    await deleteClaudeConversationHistory({ configRoot, workdir: entry.nativeWorkdir, conversationId: entry.id });
    await store.remove(entry);
    entries.delete(entry.key);
    return { ok: true, deleted: true, conversationId: entry.id };
  }

  async function recover(restoredEntries) {
    for (const entry of restoredEntries) {
      if (!entry.process && !hasPendingClaudeStartup(entry) && (entry.executionId || entry.turn?.active)) await entry.nativeTurn.stopProcess(disconnectedMessage);
    }
  }

  async function stopSelected(select, reason) {
    let closed = 0;
    for (const entry of entries.values()) if (select(entry)) {
      await entry.nativeTurn.stopProcess(reason); closed++;
    }
    return { ok: true, closed };
  }

  async function wait(entry, input, { context, acquire }) {
    return waitForClaudeConversationTurn({ state: entry,
      stop: reason => entry.nativeTurn.stopProcess(reason),
      read: async current => read(await acquire(context, current.conversationId || current.threadId), current),
      interrupt: () => interrupt(entry)
    }, input, { signal: context.signal, defaultTimeoutMs: entry.persistent ? Infinity : 180_000,
      maximumTimeoutMs: entry.profile?.limits.timeoutMs || Infinity, createError,
      interruptedMessage: disconnectedMessage });
  }

  async function stopConversation(entry, reason) {
    await entry.nativeTurn.stopProcess(reason);
    return { ok: true, stopped: true, conversationId: entry.id };
  }

  async function readGoal(entry) {
    await bindAccount(entry);
    const history = await readHistory(entry);
    return { status: "available", threadId: entry.id, goal: await entry.goals.read(history), goalCommandId: history.goalCommandId || null };
  }

  async function updateGoal(entry, input, operations) {
    await bindAccount(entry);
    const call = applicationCall.getStore();
    const selfStop = ["pause", "block"].includes(input.action) && call?.entry === entry &&
      call.toolUseId && currentApplicationCommand(entry, call.command, call.owner);
    const messageId = input.messageId || randomUUID();
    await entry.goals.update(input, { ...operations,
      ...(selfStop ? { interrupt: async () => {} } : {}),
      send: command => operations?.send ? operations.send(command) : send(entry, { ...command, messageId }) });
    if (selfStop && currentApplicationCommand(entry, call.command, call.owner)) {
      // This scope identifies the already-authorized native invocation; it does
      // not grant tool authority. Retain its exact process until its tool_result
      // arrives instead of interrupting the MCP request that is returning here.
      const pending = { process: call.owner.process, executionId: call.owner.executionId, toolUseId: call.toolUseId };
      pending.stop = (reason = "") => {
        if (entry.goalToolStop !== pending || pending.stopping) return;
        clearTimeout(pending.timer);
        if (entry.process !== pending.process || entry.executionId !== pending.executionId) {
          entry.goalToolStop = null;
          return;
        }
        pending.stopping = true;
        const work = reason || !entry.turn?.active ? entry.nativeTurn.stopProcess(reason) : interrupt(entry);
        void work.catch(error => call.command.failure.reject(error));
      };
      entry.goalToolStop = pending;
      pending.timer = setTimeout(() => pending.stop("Claude did not acknowledge its goal tool response before the time limit."), 30_000);
      pending.timer.unref();
    } else if (!selfStop && ["pause", "block"].includes(input.action)) await entry.nativeTurn.stopProcess();
    let result;
    if (!["pause", "block"].includes(input.action)) {
      const deadline = Date.now() + (operations?.attachmentTimeoutMs ?? 30_000);
      for (;;) {
        const history = await readHistory(entry);
        if (history.goalCommandId === claudeNativeMessageId(messageId)) {
          if (entry.pausedGoal || entry.blockedGoal) { entry.pausedGoal = null; entry.blockedGoal = null; await store.save(entry); }
          result = { status: "available", threadId: entry.id, goal: await entry.goals.read(history), goalCommandId: history.goalCommandId };
          break;
        }
        if (operations?.signal?.aborted) throw operations.signal.reason;
        if (Date.now() >= deadline) throw Object.assign(failure(
          "Claude accepted the goal command, but its goal attachment is not available yet. Check its original receipt before trying again.",
          "assistant_claude_goal_attachment_pending"), { delivery: "accepted", statusCode: 503 });
        await delay(Math.min(250, Math.max(1, deadline - Date.now())), undefined, { signal: operations?.signal });
      }
    }
    await onEvent(entry, { type: "goal-updated" });
    return { ok: true, ...(result || await readGoal(entry)) };
  }

  function renewal(entry, input, options, { context, acquire }) {
    return runClaudeRenewalTurn({ state: entry, readHistory: () => readHistory(entry),
      send: (message, sendOptions) => send(entry, message, sendOptions),
      wait: async current => wait(await acquire(context, current.conversationId || current.threadId), current, { context, acquire }),
      stop: reason => entry.nativeTurn.stopProcess(reason)
    }, input, options);
  }

  async function cancel(control, { context, acquire, reportFailure, entry }) {
    if (store.releaseExecution) {
      await entry.nativeTurn.stopProcess("Work stopped.");
      return;
    }
    try {
      const value = await interrupt(await acquire(context || control.current?.context));
      if (control.cleanupFailure) {
        await reportFailure(control.cleanupFailure, { recovered: true });
        control.cleanupFailure = null;
      }
      return value;
    } catch (error) {
      error.cleanupFailed = true;
      control.cleanupFailure = error;
      control.current?.failure.reject(error);
      await reportFailure(error);
      throw error;
    }
  }

  async function dispatch(control, command, { acquire, entry: selectedEntry, dispatch: nativeDispatch }) {
    if (store.releaseExecution) {
      await send(selectedEntry, command.input, { command: nativeDispatch });
      return;
    }
    command.signal.throwIfAborted();
    const entry = await acquire(command.context);
    const active = control.current;
    const applicationCommand = active && (active.tools || active.finishIfCurrent) ? { active, accept: command.accept } : null;
    if (applicationCommand) {
      if (entry.disposed || entry.command && entry.command !== active) throw new Error("This Claude conversation is closed or already working.");
      if (active.entry && active.entry !== entry) throw new Error("Claude's application tools belong to another native conversation.");
      active.entry = entry;
      entry.command = active;
      entry.toolSchemas = active.tools?.schemas || [];
    }
    const value = await send(entry, { ...command.input.nativeMessage, signal: command.input.signal, onPromptSending: command.beforeDispatch,
      onNativeReceipt: command.onNativeReceipt, onReceiptPersisted: command.onReceiptPersisted }, { applicationCommand });
    const completion = value.conversationTurn ? entry.completion?.promise : null;
    const delivered = { value, completion };
    if (!applicationCommand && value.delivered === true && value.conversationTurn) {
      if (control.current) control.current.delivery = delivered;
      await command.accept({ nativeResult: { value }, conversationTurn: value.conversationTurn, nativeTurnId: value.turn?.id });
    }
    return delivered;
  }

  function steer(control, command, options) {
    if (!store.releaseExecution) return dispatch(control, command, options).then(delivered => ({ value: delivered.value }));
    if (!control.current?.steer || !control.current.entry.nativeTurn.read().active) throw new Error("Claude has no active turn to steer.");
    return control.current.steer(command);
  }

  async function run(control, command, { acquire, reportFailure, entry: selectedEntry, maximumOutput, maximumToolCalls = 32, timeoutMs } = {}) {
    if (control.disposed || control.current) throw new Error("This Claude conversation is closed or already working.");
    const binding = Boolean(store.releaseExecution);
    const { configuration, context, input, tools, signal, beforeDispatch, accept, onMessage, onEvent, onNativeToolUse } = command;
    const completion = Promise.withResolvers();
    completion.promise.catch(() => {});
    const active = { completion, onMessage, onEvent, onNativeToolUse, signal, tools, admitted: false, nativeTools: new Map(),
      messageId: input.messageId, goal: input.goal, nativeToolCount: 0, toolWork: new Set(), maximumToolCalls,
      context, finishIfCurrent: command.finishIfCurrent, failure: Promise.withResolvers() };
    let failure;
    active.failure.promise.catch(error => { failure = error; });
    control.current = active;
    const ready = Promise.withResolvers();
    ready.promise.catch(() => {});
    active.steer = async ({ input, beforeDispatch, accept, onNativeReceipt, onReceiptPersisted }) => {
      await ready.promise;
      const nativeDispatch = { active, signal, beforeDispatch, accept, onNativeReceipt, onReceiptPersisted,
        timeoutMs, steering: true, interrupted: false, attempted: false, admitted: false };
      try { await dispatch(control, { input, context, signal }, { acquire, entry, dispatch: nativeDispatch }); }
      catch (error) {
        if (nativeDispatch.attempted && !nativeDispatch.admitted && error.delivery !== "not-sent") error.delivery = "uncertain";
        if (nativeDispatch.interrupted || nativeDispatch.attempted) completion.reject(error);
        throw error;
      }
    };
    const nativeDispatch = { active, signal, beforeDispatch, accept, onNativeReceipt: command.onNativeReceipt,
      onReceiptPersisted: command.onReceiptPersisted, timeoutMs, maximumOutput, attempted: false, admitted: false };
    let entry;
    let cancellation;
    let problem;
    let delivered;
    function abort() {
      if (cancellation) return;
      if (binding) {
        cancellation = entry.nativeTurn.cancel(entry.process?.client, () => entry.nativeTurn.stopProcess("Work stopped."));
        cancellation.then(() => completion.reject(signal.reason), error => completion.reject(error));
      } else {
        cancellation = cancel(control, { context, acquire, reportFailure }).then(() => { throw signal.reason; });
        cancellation.catch(active.failure.reject);
      }
    }
    try {
      if (binding) {
        entry = selectedEntry;
        if (entry.disposed || entry.command) throw new Error("This Claude conversation is closed or already working.");
        active.entry = entry;
        entry.command = active;
        entry.completion = completion;
        entry.toolSchemas = tools?.schemas || [];
        active.delivery = { completion: completion.promise };
        nativeDispatch.prepared = await preparation.configuration(entry, { configuration, context, signal, tools });
      }
      signal.addEventListener("abort", abort, { once: true });
      let dispatchFailure;
      try {
        delivered = await dispatch(control, command, { acquire, entry, dispatch: nativeDispatch });
        if (binding) ready.resolve();
      } catch (error) { dispatchFailure = error; }
      for (;;) {
        const settling = active.delivery;
        let result;
        problem = dispatchFailure || failure;
        if (!problem && settling?.completion) {
          try { result = await Promise.race([settling.completion, active.failure.promise]); }
          catch (error) { problem = error; }
        }
        if (command.finishIfCurrent && !await command.finishIfCurrent(() => active.delivery === settling)) continue;
        if (!problem && typeof result === "function") {
          try { result = await result(); }
          catch (error) { problem = error; }
        }
        problem = dispatchFailure || failure || problem;
        if (!problem && settling?.completion && (binding ? result.status !== "completed" : !result.ok)) {
          problem = Object.assign(new Error(result.error || (binding ? "Claude interrupted this answer." : `Claude turn ${result.status}.`)), { status: result.status });
        }
        break;
      }
    } catch (error) { problem = error; }
    ready.reject(problem || new Error("Claude work ended."));
    signal.removeEventListener("abort", abort);
    if (binding) {
      try {
        if (problem || signal.aborted) await (cancellation || entry.nativeTurn.stopProcess(problem?.message || "Work stopped."));
      } catch (error) {
        if (problem && error !== problem) error.cause ||= problem;
        problem = error;
      }
      finally {
        await Promise.allSettled([...active.toolWork]);
        if (entry?.command === active) entry.command = null;
      }
    } else {
      await cancellation?.catch(() => {});
      if (active.entry) {
        try {
          // A failed Stop already retained custody for the caller's retry.
          // Do not race that retry with another implicit cleanup attempt.
          if ((problem || signal.aborted) && !problem?.cleanupFailed) {
            await active.entry.nativeTurn.stopProcess(problem?.message || "Work stopped.");
          }
        } catch (error) {
          if (problem && error !== problem) error.cause ||= problem;
          problem = error;
        }
        finally {
          await Promise.allSettled([...active.toolWork]);
          if (active.entry.command === active) active.entry.command = null;
        }
      }
    }
    if (control.current === active) control.current = null;
    if (problem) {
      if (binding && nativeDispatch.attempted && !nativeDispatch.admitted && problem.delivery !== "not-sent") problem.delivery = "uncertain";
      throw problem;
    }
    if (!binding) return { value: delivered.value };
  }

  return Object.freeze({ applicationToolsSupported: true, entries, closingSessions, get closing() { return closing; }, createAccountQueries, open, acquire, createConversation, snapshot, readRetainedTurn, readFinalAssistantResult, readHistory, ensureReady, ensureProcess, readContextUsage, stopForTerminal, prepareTerminal, send, startTurn,
    interrupt, read, inspectAdmission, hasActiveTemporaryConversation, hasActiveConversation, retireConversationHistory, reconcileSessions, restoreSessionEntries, closeSession, closeProject, invalidateRuntimes, drain, forget, close, deleteConversation, recover, stopSelected, wait, stopConversation,
    readGoal, updateGoal, renewal, run, steer, cancel });
}

/** Native turn handling moved from the production session provider; hosts persist its events. */
export function createClaudeConversationTurn({ conversationId, onEvent = async () => {}, process, entry } = {}) {
  if (!conversationId) throw new TypeError("A Claude conversation id is required.");
  const instructions = process ? createClaudeConversationAdapter(process) : null;
  const publish = entry ? publishEntryEvent : onEvent;
  const messages = new Map();
  const pendingAssistantMessages = new Map();
  const assistantRoles = new Map();
  const admissions = new Map();
  const inFlight = new Set();
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
  let steering;
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
    const current = read();
    const failed = entry.turn?.state === "failed";
    let status = "completed";
    if (entry.turn?.active) status = "inProgress";
    else if (failed) status = "failed";
    else if (entry.turn?.state === "interrupted") status = "interrupted";
    return { ok: !failed, conversationId: entry.id, threadId: entry.id,
      runId: entry.turn?.id || "", turnId: entry.turn?.id || "", text: current.text,
      messages: current.messages, error: entry.turn?.error || "", status };
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
    setState(state, message);
    await onEvent({ type: "save" });
    if (expectedGeneration !== generation) return false;
    await onEvent({ type: "state", state, active, message });
    return expectedGeneration === generation;
  }

  function setState(state, message = "") {
    if (!entry.turn) return;
    const active = ["starting", "active", "finalizing"].includes(state);
    Object.assign(entry.turn, { active, state, error: message, updatedAt: new Date().toISOString(),
      phase: active && !entry.observationError ? String(entry.turn.phase ?? "").trim() : "" });
  }

  async function stopProcess(reason = "", { preparing = false } = {}) {
    clearTimeout(entry.goalToolStop?.timer);
    entry.goalToolStop = null;
    if (!preparing) entry.preparationRevision++;
    invalidateFinalAssistantResult();
    // Runtime bindings commit execution release before dropping the handle.
    // Retained host entries keep their original post-proof checkpoint order.
    const binding = Boolean(process.releaseExecution);
    if (entry.stopPending) return entry.stopPending;
    const active = read().active;
    if (!binding) entry.stopping = true;
    const operation = async () => {
      const startup = entry.startupCleanup?.executionId === entry.executionId ? entry.startupCleanup : null;
      let proof;
      try {
        if (!binding || entry.process || entry.executionId) {
          proof = await stopClaudeCodeProcess({ process: entry.process || startup, executionId: entry.executionId,
            stopExecution: process.stopExecution });
        }
      } catch (error) {
        if (binding || error.code !== "claude_stop_unconfirmed") throw error;
        entry.observationError = reason || "Claude process exit has not been confirmed. Try Stop again.";
        await onEvent({ type: "save" });
        await onEvent({ type: "stop-unconfirmed" });
        throw error;
      }
      if (binding && (entry.process || entry.executionId)) await process.releaseExecution();
      entry.process = null;
      entry.executionId = "";
      entry.exitProof = proof;
      stop(binding ? reason : reason || "Claude stopped before acknowledging the prompt.");
      if (binding) {
        if (entry.startupCleanup === startup) entry.startupCleanup = null;
        if (active) entry.completion?.resolve({ status: "interrupted", error: reason || "Work stopped." });
        return;
      }
      if (entry.turn?.active) {
        try { await updateState("interrupted", reason); }
        catch (error) {
          // Native cleanup is verified even when the host refuses its checkpoint.
          // Retain that refusal without publishing a completed answer or active work.
          setState("interrupted", error.message);
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
    entry.stopPending = operation().catch(error => { if (binding) error.cleanupFailed = true; throw error; })
      .finally(() => { entry.stopPending = null; });
    return entry.stopPending;
  }

  async function publishEntryEvent(event, deferred = false) {
    if (entry.stopping) return;
    if (event.type === "settled" && event.generation !== generation) return;
    const binding = Boolean(process.releaseExecution);
    const command = entry.command;
    if (event.type === "settled" && !binding && !deferred && command?.finishIfCurrent && command !== checkpointedCommand) {
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
              throw failure("Claude's completion belongs to a retired native input.");
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
      if (binding) setState("active");
      else await updateState("active");
    } else if (event.type === "admitted") {
      if (event.userEcho) entry.sent = true;
      if (!binding) await onEvent({ type: "save" });
    } else if (event.type === "phase") {
      entry.turn.phase = event.phase;
      if (!binding) await updateState(entry.turn.state);
    } else if (event.type === "settled") {
      const state = event.status === "interrupted" ? "interrupted" : event.status === "failed" ? "failed" : "completed";
      if (binding) setState(state, event.error);
      else if (!await updateState(state, event.error, event.generation)) return;
    }
    const published = await onEvent(event);
    if (event.type === "provider-event") {
      const frame = event.event;
      const change = frame.type === "active_goal" ? "goal" : frame.type === "rate_limit_event" ? "usage" : "";
      if (change) await onEvent({ type: "provider-update", change });
    }
    if (event.type === "settled") {
      if (event.generation !== generation) return;
      if (event.source === "result") await onEvent({ type: "provider-update", change: "goal" });
      resolveCompletion(binding ? event : readResult());
    }
    return published;
  }

  function checkOutput(value, role = "assistant") {
    if (value.length > (role === "thinking" ? 4 * 1024 * 1024 : maximumOutput)) {
      throw failure("Claude output exceeded its size limit.");
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
    if (frame.session_id && frame.session_id !== conversationId) throw failure("Claude returned a different conversation id.");
    if (frame.parent_tool_use_id) return; // Nested agents do not replace the main reply.
    await publish({ type: "provider-event", event: frame });
    const continuation = (frame.type === "user" && frame.origin?.kind === "task-notification") ||
      (frame.type === "command_lifecycle" && frame.state === "started") ||
      (frame.type === "stream_event" && frame.event?.type === "message_start") || frame.type === "assistant";
    if (continuation && turnId && !cancelling) {
      const wasActive = active;
      if (outcome || !active) {
        generation++;
        outcome = null;
        result = "";
        clearFinalAssistantResult();
      }
      active = true;
      if (!wasActive) await publish({ type: "continued", source: frame.type });
    }
    if (frame.type === "command_lifecycle" || frame.type === "user") {
      const uuid = frame.type === "user" ? frame.uuid : frame.command_uuid;
      if (frame.type === "user" && !inFlight.has(uuid) && !admissions.has(uuid)) return;
      // Native notifications have their own lifecycle UUIDs, including work
      // folded into this input. They must not steal its receipt/result owner.
      if ((frame.state === "started" || frame.type === "user") && inFlight.has(uuid)) currentCommandId = uuid;
      if (frame.state === "completed") inFlight.delete(uuid);
      if (frame.state === "cancelled" && steering) {
        inFlight.delete(uuid);
        steering.resolve();
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
        if (nextPhase !== phase) {
          phase = nextPhase;
          await publish({ type: "phase", phase });
        }
      }
      if (frame.subtype === "local_command_output" && frame.content) {
        await publishMessage({ id: `claude_${frame.uuid}`, role: "commentary", text: frame.content, complete: true,
          data: { native: { engineId: "claude", type: "system", subtype: "local_command_output" } } });
      }
      const previousTaskCount = tasks.size;
      if (frame.subtype === "background_tasks_changed") {
        tasks.clear();
        for (const task of frame.tasks || []) if (task.task_id && !task.ambient) tasks.add(task.task_id);
      }
      if (frame.subtype === "task_started" && frame.task_id && !frame.ambient) tasks.add(frame.task_id);
      if (["task_notification", "task_updated"].includes(frame.subtype) &&
          ["completed", "failed", "stopped", "killed"].includes(frame.status || frame.patch?.status)) {
        tasks.delete(frame.task_id);
      }
      // Inventory removal can precede the task notification and the main model's
      // response to it. A foreground result written while that worker was live
      // cannot complete this follow-up or retire its admitted application tools.
      if (tasks.size < previousTaskCount) outcome = null;
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
        // Native split frames arrive before their block's stop event. Keep that
        // existing live identity without replacing the saved frame UUID.
        if (typeof messageId === "string" && messageId && frame.message.id === messageId && frame.message.content.length === 1) {
          const prefix = `claude_${messageId}_`;
          const live = [...messages.values()].filter(message => !message.complete && message.role === block.role &&
            message.id.startsWith(prefix) && /^\d+$/u.test(message.id.slice(prefix.length)));
          if (live.length === 1 && (!Object.hasOwn(frame, "apiBlockIndex") ||
              Number.isSafeInteger(frame.apiBlockIndex) && frame.apiBlockIndex >= 0 &&
              live[0].id === `${prefix}${frame.apiBlockIndex}`)) {
            block.outputId = live[0].id;
            block.userId = live[0].userId || block.userId;
          }
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
      const message = failed ? (frame.errors || []).join("; ") || output || frame.subtype : "";
      result = failed ? "" : output;
      if (result && ![...messages.values()].some((block) => block.complete && block.role === "assistant" && block.text === result)) {
        await publishMessage({ id: `claude_${frame.uuid || turnId}_result`, role: "assistant", text: result, complete: true,
          ...(typeof frame.local_command === "string" && frame.local_command ? {
            data: { native: { engineId: "claude", type: "result", command: frame.local_command, output: "stdout" } }
          } : {}) });
      }
      inFlight.delete(currentCommandId);
      if (steering) {
        steering.resolve();
        return;
      }
      if (cancelling) return;
      outcome = { status: interrupted ? "interrupted" : failed ? "failed" : "completed", error: message };
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
    inputOwner = null;
    acceptedInput = null;
    clearFinalAssistantResult();
    for (const pending of admissions.values()) {
      pending.reject(failure(reason));
    }
    admissions.clear();
    inFlight.clear();
    tasks.clear();
    // Verified process cleanup can precede Claude's terminal generation frame.
    // Retain already displayed text for the existing transcript reader, with
    // its original input/output identity and no completed-answer receipt.
    for (const pending of pendingAssistantMessages.values()) for (const block of pending) {
      if (block.outputId && block.outputId !== block.id) messages.delete(block.outputId);
      messages.set(block.id, { ...block, role: "commentary" });
    }
    for (const [id, block] of messages) {
      if (block.complete === false && block.role === "assistant" && block.text) {
        messages.set(id, { ...block, complete: true, role: "commentary" });
      }
    }
    pendingAssistantMessages.clear();
    assistantRoles.clear();
    steering?.reject(failure(reason));
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

  return Object.freeze({
    receive, read, stop, interrupt, readFinalAssistantResult, invalidateFinalAssistantResult,
    ...(entry ? { readResult, updateState, stopProcess } : {}),
    ...(instructions ? {
      prepare: instructions.prepare,
      whenIdle: instructions.whenIdle,
      instructionArguments: instructions.instructionArguments,
      invalidateInstructions: instructions.invalidate
    } : {}),
    begin({ id, maxOutputCharacters = 4 * 1024 * 1024 } = {}) {
      if (active) throw failure("This Claude turn is still working.");
      if (!id || !Number.isSafeInteger(maxOutputCharacters) || maxOutputCharacters < 1) throw new TypeError("Invalid Claude turn configuration.");
      generation++;
      inputOwner = null;
      acceptedInput = null;
      clearFinalAssistantResult();
      turnId = id;
      maximumOutput = maxOutputCharacters;
      messages.clear();
      pendingAssistantMessages.clear();
      assistantRoles.clear();
      result = "";
      phase = "";
      messageId = "";
      currentCommandId = "";
      outcome = null;
      cancelling = false;
      stopped = false;
      active = true;
    },
    reset() {
      if (active || inFlight.size || tasks.size) throw failure("Stop Claude before resetting its turn view.");
      messages.clear();
      pendingAssistantMessages.clear();
      assistantRoles.clear();
      result = "";
      outcome = null;
      inputOwner = null;
      acceptedInput = null;
      clearFinalAssistantResult();
    },
    async send(client, message, { messageId: uuid, accept, timeoutMs = 30_000, sendNow = false } = {}) {
      if (!active || stopped || cancelling) throw Object.assign(
        failure("Claude has no active turn for this message.", !active && !stopped && !cancelling
          ? "conversation_steer_turn_finished" : "assistant_claude_turn_failed"),
        { delivery: "not-sent", ...(!active && !stopped && !cancelling ? { statusCode: 409 } : {}) }
      );
      if (!uuid || typeof accept !== "function" || admissions.has(uuid)) throw new TypeError("A distinct message id and admission writer are required.");
      clearFinalAssistantResult();
      acceptedInput = null;
      inputOwner = entry ? { commandId: uuid, process: entry.process, executionId: entry.executionId,
        accountIdentity: entry.accountIdentity } : null;
      const receiptOwner = inputOwner;
      const admitted = Promise.withResolvers();
      void admitted.promise.catch(() => {});
      inFlight.add(uuid);
      const timer = setTimeout(() => admitted.reject(Object.assign(
        failure("Claude has not acknowledged this prompt. Its delivery is uncertain.", "assistant_claude_admission_unknown"),
        { delivery: "uncertain" }
      )), timeoutMs);
      admissions.set(uuid, { ...admitted, accept, timer, receiptOwner });
      try {
        await Promise.all([client.send(message, { messageId: uuid, sessionId: conversationId, ...(sendNow ? { sendNow: true } : {}) }), admitted.promise]);
      } catch (error) {
        if (inputOwner === receiptOwner) invalidateFinalAssistantResult();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
    async interruptGeneration(client, { timeoutMs = 30_000, sendNow = false } = {}) {
      if (!active || steering || cancelling) {
        const completed = !active && !steering && !stopped && !cancelling && outcome?.status === "completed";
        throw Object.assign(failure("This Claude turn cannot accept steering now.", completed
          ? "conversation_steer_turn_finished" : "assistant_claude_turn_failed"),
        { delivery: "not-sent", ...(completed ? { statusCode: 409 } : {}) });
      }
      // Targeted Send now admits the new input before asking the native loop to
      // make way; unlike plain Stop it preserves background agents. A completed
      // main loop also has no further interruption result to wait for.
      if (sendNow || outcome && inFlight.size === 0) {
        // The next input owns completion now. A task finishing during host
        // preparation must not settle this turn using the previous result.
        outcome = null;
        acceptedInput = null;
        clearFinalAssistantResult();
        await publish({ type: "diagnostic", stage: sendNow ? "steering_send_now" : "steering_background_only", backgroundTasks: tasks.size });
        return;
      }
      // Streaming user input otherwise queues behind the entire running turn.
      // Claude's supported steering path interrupts generation, then continues
      // the same native history with the new instruction.
      acceptedInput = null;
      clearFinalAssistantResult();
      steering = Promise.withResolvers();
      let timer;
      try {
        await publish({ type: "diagnostic", stage: "steering_requested", pendingCommands: inFlight.size, backgroundTasks: tasks.size });
        await Promise.all([client.interrupt(), Promise.race([
          steering.promise,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(failure(
              "Claude did not confirm the interrupted generation. This instruction was not sent; retry after reconnecting.",
              "assistant_claude_interrupt_timeout"
            ), { statusCode: 503 })), timeoutMs);
          })
        ])]);
        await publish({ type: "diagnostic", stage: "steering_confirmed", pendingCommands: inFlight.size, backgroundTasks: tasks.size });
      } catch (error) {
        await publish({ type: "diagnostic", stage: "steering_failed", pendingCommands: inFlight.size, backgroundTasks: tasks.size });
        throw error;
      }
      finally { clearTimeout(timer); steering = null; }
    },
    async cancel(client, stopProcess) {
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
  });
}
