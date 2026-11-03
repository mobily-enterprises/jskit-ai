import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { claudeNativeMessageId, readClaudeHistory, requireClaudeSessionId, retireClaudeConversationHistory } from "./claudeHistory.js";
import { claudeTurnFailure, createClaudeConversationTurn } from "./claudeNativeTurn.js";
import { bindClaudeConversationAccount, claudeCodeArguments, createClaudeAccountQueries } from "./claudeProcess.js";
import { createClaudeCommandRun } from "./claudeCommandRun.js";
import { createClaudeProcessStart, hasPendingClaudeStartup } from "./claudeProcessStart.js";
import { createClaudePromptDelivery } from "./claudePromptDelivery.js";
import { createClaudeSessionCleanup } from "./claudeSessionCleanup.js";
import { normalizeNullableText } from "./normalize.js";

const text = normalizeNullableText;

// Claude records an admitted prompt in its history, and only a send in
// progress writes prompts to a live process. With neither left, a prompt
// missing from history can never arrive. A turn left marked active by a
// lost process does not change that.
function nativeWorkSettled(entry) {
  return !entry.sending && !entry.process && !entry.executionId && !entry.command && !entry.stopPending;
}

// Work this server is running: a send, command or stop in progress, a live
// process, or a startup still lending cleanup. A restored execution with none
// of these belongs to an earlier server; no Claude process outlives the
// server that started it.
function runsNativeWork(entry) {
  return Boolean(entry.sending || entry.process || entry.command || entry.stopPending || hasPendingClaudeStartup(entry));
}

/** Waits for the conversation's turn through its completion and cleanup owner. */
export async function waitForClaudeConversationTurn(conversation, input = {}, {
  signal, defaultTimeoutMs = 180_000, maximumTimeoutMs = Infinity, createError = claudeTurnFailure,
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
        reject(createError("Claude did not finish within the time limit.", { code: "conversation_claude_turn_timeout" }));
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

/** Runs one renewal turn: its native receipt, completion and cleanup. */
export async function runClaudeRenewalTurn(conversation, {
  clientMessageId, prompt, outputSchema, expectedThreadId, forbiddenThreadId,
  requireFreshHistory = false, timeoutMs = 180_000
}, {
  createError = claudeTurnFailure, unreadableCode = "assistant_claude_turn_unreadable",
  failedCode = "assistant_claude_turn_failed", acceptedField = "inputAccepted"
} = {}) {
  const uuid = claudeNativeMessageId(clientMessageId);
  const entry = conversation.state;
  if ((expectedThreadId && expectedThreadId !== entry.id) ||
      (requireFreshHistory && forbiddenThreadId === entry.id)) {
    throw createError("The Claude renewal conversation does not match the expected native history.", { code: "conversation_claude_renewal_history_mismatch" });
  }
  const history = await conversation.readHistory();
  if (requireFreshHistory && history.userIds.some((id) => id !== uuid)) {
    throw createError("The successor Claude conversation already contains unrelated messages.", { code: "conversation_claude_renewal_unrelated_history" });
  }
  const accepted = history.userIds.includes(uuid);
  let result;
  try {
    if (accepted) {
      if (entry.turn?.id === uuid && entry.turn.active && entry.process) {
        result = await conversation.wait({ conversationId: entry.id, timeoutMs });
        if (result.status !== "completed") throw createError(result.error || "Claude did not complete the renewal turn.", { code: failedCode });
      } else {
        if (entry.turn?.id !== uuid || entry.turn.state !== "completed" || entry.turn.active) {
          throw createError("The accepted Claude renewal turn has no confirmed completion; it will not be submitted again.", { code: unreadableCode });
        }
        result = { text: history.messages.filter((message) => message.userId === uuid && message.role === "assistant").map((message) => message.text).join("\n"),
          threadId: entry.id, turnId: uuid, reconciled: true };
        if (!result.text) throw createError("The accepted Claude renewal turn has no readable result; it will not be submitted again.", { code: unreadableCode });
      }
    } else {
      if (entry.turn?.active && entry.process) {
        throw createError("Stop the current turn before renewing this conversation.", { code: "conversation_claude_renewal_turn_active" });
      }
      await conversation.send({ message: prompt, messageId: clientMessageId, outputSchema }, { renewal: true });
      result = await conversation.wait({ conversationId: entry.id, timeoutMs });
      if (result.status !== "completed") throw createError(result.error || "Claude did not complete the renewal turn.", { code: failedCode });
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

/**
 * One conversation's goal: Claude's own goal attachment, or the Pause or
 * blocker this owner retains while Claude's checker is suspended.
 * @param {{
 *   conversationId: string,
 *   readHistory: () => Promise<Record<string, any>>,
 *   readState: () => { running: boolean, active: boolean },
 *   interrupt: () => Promise<unknown>,
 *   send: (input: Record<string, any>) => Promise<unknown>,
 *   readRetainedGoal: () => Record<string, any> | null,
 *   saveRetainedGoal: (goal: Record<string, any>) => Promise<void>
 * }} options
 */
export function createClaudeConversationGoals({ conversationId, readHistory, readState, interrupt, send, readRetainedGoal, saveRetainedGoal }) {
  // These checks run before interrupt/send. Native execution and receipt
  // failures keep their own codes and must not be treated as safe rejections.
  const goalError = (message, { messageCode }) => Object.assign(
    new AppError(400, message, { code: "conversation_invalid_goal", messageCode }), { delivery: "not-sent" });

  async function read(history = null) {
    const { goal = null } = history || await readHistory();
    const retained = readRetainedGoal();
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
      throw goalError("The Claude goal changed. Refresh before trying again.", { messageCode: "assistant.claude.goalChanged" });
    }
    if (input.tokenBudget != null) throw goalError("Claude goals do not support a token budget.", { messageCode: "assistant.claude.goalTokenBudgetUnsupported" });
    if (action === "pause" || action === "block") {
      const reason = typeof input.reason === "string" ? input.reason.trim() : "";
      if (action === "block" && (!reason || reason.length > 1000 || goal.status !== "active")) {
        throw goalError("An active Claude goal needs a blocker reason of up to 1,000 characters.",
          { messageCode: "assistant.claude.goalBlockerReasonRequired" });
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
        throw goalError("Enter a goal condition of up to 4,000 characters.", { messageCode: "assistant.claude.goalConditionRequired" });
      }
      if (action === "set" && goal && goal.status !== "complete") {
        throw goalError("Cancel the existing goal before setting another.", { messageCode: "assistant.claude.goalAlreadySet" });
      }
      await sendGoal({ message: `/goal ${objective}`, signal });
    } else throw goalError("Unknown Claude goal action.", { messageCode: "assistant.claude.goalActionUnknown" });
  }

  return Object.freeze({
    read,
    update
  });
}

/**
 * A retained Claude conversation: its saved custody, native process, turn
 * view and the command that owns it.
 * @typedef {Record<string, any>} ClaudeConversationEntry
 */

/**
 * Where an owner keeps its conversations' records. A runtime binding's store
 * supplies releaseExecution; a store that retains entries supplies the rest.
 * @typedef {object} ClaudeConversationStore
 * @property {(context: Record<string, any>, conversationId: string) => string | null | Promise<string | null>} read
 * @property {(entry: ClaudeConversationEntry, options?: { execution?: boolean }) => Promise<unknown>} save
 * @property {(entry: ClaudeConversationEntry) => Promise<unknown>} [releaseExecution]
 * @property {(context: Record<string, any>, conversationId: string) => unknown} [select]
 * @property {(context: Record<string, any>, messageId: string) => Promise<boolean>} [hasMessage]
 * @property {(entry: ClaudeConversationEntry) => Promise<unknown>} [remove]
 * @property {(context: Record<string, any>) => Record<string, any> | Promise<Record<string, any>>} [readSessionConversations]
 * @property {(entry: ClaudeConversationEntry) => string} [projectContextRoot]
 * @property {(entry: ClaudeConversationEntry) => string} [modelProviderId]
 */

/**
 * How a host prepares an entry's work. A store that retains entries also
 * resolves contexts and entries, checks sends and binds accounts.
 * @typedef {object} ClaudeConversationPreparation
 * @property {(entry: ClaudeConversationEntry, input: Record<string, any>) => Promise<Record<string, any>>} configuration
 * @property {(entry: ClaudeConversationEntry, input: Record<string, any>, options?: Record<string, any>) => unknown} message
 * @property {(context: Record<string, any>) => Promise<Record<string, any>>} [context]
 * @property {(ctx: Record<string, any>, context: Record<string, any>, conversationId: string, options: Record<string, any>) => { options: Record<string, any>, check: (entry: ClaudeConversationEntry) => void }} [entry]
 * @property {(entry: ClaudeConversationEntry, context: Record<string, any>) => void} [check]
 * @property {(entry: ClaudeConversationEntry) => Record<string, any>} [account]
 * @property {(entry: ClaudeConversationEntry, input: Record<string, any>) => { sessionClosing?: boolean } | undefined} [checkConfiguration]
 */

/**
 * How a host runs an entry's Claude process.
 * @typedef {object} ClaudeConversationProcessHost
 * @property {(executionId: string, options?: Record<string, any>) => Promise<Record<string, any>>} stopExecution
 * @property {(entry: ClaudeConversationEntry, configuration: Record<string, any>, options: Record<string, any>) => Record<string, any> | Promise<Record<string, any>>} configure
 * @property {(options: Record<string, any>) => Promise<import("./claudeProcess.js").ClaudeCodeProcess>} [create]
 * @property {(entry: ClaudeConversationEntry, configuration: Record<string, any>, context: Record<string, any>) => Record<string, any> | Promise<Record<string, any>>} [prepare]
 * @property {(entry: ClaudeConversationEntry, context: Record<string, any>) => Promise<Record<string, any>>} [configureTerminal]
 */

/** @typedef {(entry: ClaudeConversationEntry, event: Record<string, any>) => unknown} ClaudeConversationEventHandler */

/** @typedef {(message: string, options: { code: string }) => Error} ClaudeConversationErrorFactory */

/**
 * The owner of a conversation's retained entries and their commands; hosts supply authorized storage and message effects.
 * Every refusal is built by `createError(message, { code })`, each with its own `conversation_claude_*` code.
 * @param {{
 *   configRoot: string,
 *   store: ClaudeConversationStore,
 *   preparation: ClaudeConversationPreparation,
 *   process: ClaudeConversationProcessHost,
 *   onEvent: ClaudeConversationEventHandler,
 *   createError?: ClaudeConversationErrorFactory,
 *   disconnectedMessage?: string
 * }} options
 */
export function createClaudeConversationOwner({
  configRoot, store, preparation, process, onEvent, createError = claudeTurnFailure,
  disconnectedMessage = "Claude was interrupted when the application disconnected."
}) {
  const entries = new Map();
  const applicationCall = new AsyncLocalStorage();
  const saveAccount = store.save;
  // Two hosts share this owner. A bound store (one with releaseExecution) is a
  // runtime binding: the native turn owns activity and execution release.
  // Otherwise the host retains entries and their original checkpoint order.
  const bound = Boolean(store.releaseExecution);
  const isTurnActive = entry => bound ? entry.nativeTurn.read().active : Boolean(entry.turn?.active);
  // What cleanup must stop: running work, or custody (an execution or an
  // active turn) that only a verified stop retires. An idle entry has nothing
  // to stop, and stopping it would only rewrite its saved record.
  const holdsNativeWork = entry => runsNativeWork(entry) || Boolean(entry.executionId) || isTurnActive(entry);
  const cleanup = createClaudeSessionCleanup({ entries, store, configRoot, acquire, savedState, holdsNativeWork, disconnectedMessage });
  const processStart = createClaudeProcessStart({ store, process, createError, onEvent, bound, readHistory,
    isClosing: cleanup.isClosing, applicationCall, currentApplicationCommand });
  const delivery = createClaudePromptDelivery({ store, preparation, createError, onEvent, readHistory, bindAccount, ensureProcess, snapshot });
  const commands = createClaudeCommandRun({ bound, preparation, send: delivery.send, interrupt });

  /**
   * @param {{
   *   accountIdentity: (context: Record<string, any>) => Promise<string>,
   *   createProcess: (request: { signal: AbortSignal, purpose: string }) => Promise<import("./claudeProcess.js").ClaudeCodeProcess>
   * }} options
   */
  function createAccountQueries({ accountIdentity, createProcess }) {
    return createClaudeAccountQueries({ accountIdentity, configRoot,
      processes: () => entries.values(), isClosing: () => cleanup.closing, createProcess });
  }

  function snapshot(entry) {
    return entry?.turn ? { ...entry.turn, threadId: entry.id,
      ...(entry.turn.active && entry.observationError ? { status: "observation_lost", error: entry.observationError } : {}),
      phase: entry.turn.active && !entry.observationError ? text(entry.turn.phase) : "" } : null;
  }

  function currentApplicationCommand(entry, command, owner = command?.nativeOwner) {
    const native = entry?.nativeTurn.read();
    return Boolean(owner && entry && !cleanup.isClosing(entry.context.key) &&
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

  // This lookup uses only the current entry and its native receipt owner.
  function readFinalAssistantResult(contextKey, conversationId = "", turnId = "") {
    if (!text(contextKey) || !text(conversationId) || !text(turnId) || cleanup.isClosing(contextKey)) return null;
    const entry = entries.get(`${contextKey}\0${conversationId}`);
    if (!entry || entry.disposed || entry.stopping || entry.observationError ||
        entry.id !== conversationId || entry.context.key !== contextKey || entry.turn?.id !== turnId) return null;
    return entry.nativeTurn.readFinalAssistantResult(conversationId, turnId);
  }

  function readHistory(entry) {
    return readClaudeHistory({ configRoot, workdir: entry.nativeWorkdir, conversationId: entry.id });
  }

  function savedState(saved, conversationId) {
    if (!saved) return {};
    try { return JSON.parse(saved); }
    catch {
      throw createError(`The saved Claude conversation ${conversationId} is unreadable. Restore its saved conversation state.`,
        { code: "conversation_claude_saved_state_unreadable" });
    }
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
    // readable-check: allow method-probe - data: a store reads a saved record synchronously or with a promise; a synchronous read opens the entry without yielding
    if (saved && typeof saved.then === "function") saved = await saved;
    if (!main && !saved && !create && !recoveringCleanup) throw createError("This Claude conversation is unavailable.", { code: "conversation_claude_unavailable" });
    const state = savedState(saved, id);
    const entry = { id, key, main, persistent: state.persistent === true, context, process: null, startupCleanup: null,
      executionId: state.executionId || (recoveringCleanup ? cleanupExecutionId : ""), preparationRevision: 0,
      accountIdentities: state.accountIdentities || (state.accountIdentity ? { anthropic: state.accountIdentity } : {}),
      accountIdentity: state.accountIdentity || "", sent: state.sent === true, nativeWorkdir: state.nativeWorkdir || nativeWorkdir,
      lastMessageId: state.lastMessageId || "", pausedGoal: state.pausedGoal || null, blockedGoal: state.blockedGoal || null, turn: state.turnId ? {
        id: state.turnId, active: ["starting", "active", "finalizing"].includes(state.state),
        state: state.state, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      } : null };
    for (const [field, status] of [["pausedGoal", "paused"], ["blockedGoal", "blocked"]]) {
      const retained = entry[field];
      if (retained && (retained.threadId !== id || typeof retained.objective !== "string" ||
          !retained.objective.trim() || !Number.isFinite(retained.createdAt) || retained.status !== status ||
          status === "blocked" && (typeof retained.reason !== "string" || !retained.reason.trim() || retained.reason.length > 1000))) {
        throw createError("The retained Claude goal is invalid. Restore its saved conversation state.", { code: "conversation_claude_retained_goal_invalid" });
      }
    }
    if (entry.pausedGoal && entry.blockedGoal) {
      throw createError("The saved Claude goal cannot be both paused and blocked.", { code: "conversation_claude_retained_goal_conflict" });
    }
    entry.nativeTurn = createClaudeConversationTurn({ conversationId: id, entry, bound,
      onEvent: event => onEvent(entry, event),
      process: {
        stopExecution: process.stopExecution,
        ...(bound ? { releaseExecution: () => store.releaseExecution(entry) } : {}),
        getProcess: () => entry.stopping ? null : entry.process,
        isActive: () => isTurnActive(entry),
        startProcess: input => processStart.startProcess(entry, input),
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
      readState: () => ({ running: Boolean(entry.process), active: isTurnActive(entry) }),
      interrupt: () => interrupt(entry), send: input => delivery.send(entry, input) });
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
      throw createError(failure.message, { code: account.changedCode || failure.code });
    }
  }

  async function ensureReady(entry) {
    if (entry.process) {
      // Status reads retain an active turn's instructions and account: an
      // account change never stops running work. Both apply at idle admission.
      if (!isTurnActive(entry)) await ensureProcess(entry);
    } else {
      await bindAccount(entry);
      if (entry.executionId && !hasPendingClaudeStartup(entry)) await entry.nativeTurn.stopProcess("Claude's previous process exit could not be confirmed.");
      // The first Send prepares host hooks before starting the native process.
    }
    return { ok: true, thread: { id: entry.id }, turn: snapshot(entry), workdir: entry.context.workdir };
  }

  async function ensureProcess(entry, input = {}) {
    const revision = entry.preparationRevision;
    // readable-check: allow optional-call - optional operation: a host that tracks its own sessions' closing supplies checkConfiguration
    const application = preparation.checkConfiguration?.(entry, input);
    if (entry.disposed || cleanup.isClosing(entry.context.key) || application?.sessionClosing) {
      throw createError("This session is closing.", { code: "conversation_claude_session_closing" });
    }
    if (preparation.account) await bindAccount(entry);
    const configuration = await preparation.configuration(entry, input);
    if (revision !== entry.preparationRevision || entry.disposed || cleanup.isClosing(entry.context.key)) {
      throw createError("Claude preparation was stopped while this session was closing or changing.", { code: "conversation_claude_preparation_stopped" });
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
      throw createError("Claude's current context usage is unavailable.", { code: "conversation_claude_context_usage_unavailable" });
    }
    return { model: usage.model, usedTokens,
      windowTokens: usage.isAutoCompactEnabled === false ? maximum : Math.min(maximum, threshold) };
  }

  async function stopForTerminal(entry, application) {
    if (entry.turn?.active) throw createError("Stop the current turn before opening the Claude Code terminal.", { code: "conversation_claude_terminal_turn_active" });
    if (cleanup.isClosing(entry.context.key) || application?.sessionClosing) {
      throw createError("This session is closing.", { code: "conversation_claude_session_closing" });
    }
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

  // Native /compact summarises Claude's own history in place, exactly like its
  // automatic compaction. It is not an AI turn and adds no chat message.
  async function compactContext(entry, input = {}) {
    input.signal?.throwIfAborted();
    if (entry.turn?.active || entry.nativeTurn.read().active) {
      throw new AppError(409, "Claude is still working. Wait for it to finish before freeing its context.", {
        code: "assistant_claude_compact_while_working", messageCode: "assistant.claude.compactWhileWorking" });
    }
    await ensureProcess(entry, input);
    input.signal?.throwIfAborted();
    await processStart.runLocalCommand(entry, "/compact", { name: "compact", timeoutMs: 15 * 60_000,
      failureMessage: "Claude could not summarise its context.", failureCode: "conversation_claude_compact_failed",
      timeoutMessage: "Claude timed out summarising its context.", timeoutCode: "conversation_claude_compact_timeout" });
  }

  async function startTurn(entry, input = {}) {
    entry.persistent ||= input.persistent === true;
    if (entry.turn?.active && entry.process && input.steer !== true) {
      throw createError("This conversation is still working.", { code: "conversation_claude_still_working" });
    }
    await delivery.send(entry, input);
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
    const admitted = history.userIds.includes(claudeNativeMessageId(input.messageId || ""));
    return { ...entry.nativeTurn.readResult(), ok: true,
      messages: [...messages.values()].map(message => ({ ...message,
        ...(message.userId ? { requestMessageId: requestIds.get(message.userId) || "" } : {}) })), text: current.text || history.text,
      admitted, notAdmitted: !admitted && Boolean(input.messageId) && nativeWorkSettled(entry) };
  }

  async function inspectAdmission(entry, input) {
    if (input.threadId && input.threadId !== entry.id) return { ok: true, admission: "unknown", messageId: input.messageId, threadId: entry.id };
    const history = await readHistory(entry);
    const turnId = claudeNativeMessageId(input.messageId);
    const accepted = history.userIds.includes(turnId);
    const admission = accepted ? "accepted" : nativeWorkSettled(entry) ? "not-admitted" : "unknown";
    return { ok: true, admission, messageId: input.messageId,
      threadId: entry.id, turnId: accepted ? turnId : "" };
  }

  // Temporary work this server runs. Saved conversations are not reopened to
  // answer: a turn an earlier server saved as active ended with that server.
  function hasActiveTemporaryConversation(context) {
    return [...entries.values()].some((entry) => entry.context.key === context.key && !entry.main &&
      isTurnActive(entry) && runsNativeWork(entry));
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
          throw createError("Stop the saved Claude process and its terminal before retiring native history.", { code: "conversation_claude_history_retire_busy" });
        }
      }
    });
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

  // A native Set, Resume or Cancel supersedes a retained Pause or blocker.
  async function releaseRetainedGoal(entry) {
    if (!entry.pausedGoal && !entry.blockedGoal) return;
    entry.pausedGoal = null;
    entry.blockedGoal = null;
    await store.save(entry);
  }

  async function updateGoal(entry, input, operations) {
    await bindAccount(entry);
    const call = applicationCall.getStore();
    const selfStop = ["pause", "block"].includes(input.action) && call?.entry === entry &&
      call.toolUseId && currentApplicationCommand(entry, call.command, call.owner);
    const messageId = input.messageId || randomUUID();
    await entry.goals.update(input, { ...operations,
      ...(selfStop ? { interrupt: async () => {} } : {}),
      send: command => operations?.send ? operations.send(command) : delivery.send(entry, { ...command, messageId }) });
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
          await releaseRetainedGoal(entry);
          result = { status: "available", threadId: entry.id, goal: await entry.goals.read(history), goalCommandId: history.goalCommandId };
          break;
        }
        if (operations?.signal?.aborted) throw operations.signal.reason;
        if (Date.now() >= deadline) throw Object.assign(new AppError(503,
          "Claude accepted the goal command, but its goal attachment is not available yet. Check its original receipt before trying again.",
          { code: "assistant_claude_goal_attachment_pending" }), { delivery: "accepted" });
        await delay(Math.min(250, Math.max(1, deadline - Date.now())), undefined, { signal: operations?.signal });
      }
    }
    await onEvent(entry, { type: "goal-updated" });
    return { ok: true, ...(result || await readGoal(entry)) };
  }

  function renewal(entry, input, options, { context, acquire }) {
    return runClaudeRenewalTurn({ state: entry, readHistory: () => readHistory(entry),
      send: (message, sendOptions) => delivery.send(entry, message, sendOptions),
      wait: async current => wait(await acquire(context, current.conversationId || current.threadId), current, { context, acquire }),
      stop: reason => entry.nativeTurn.stopProcess(reason)
    }, input, options);
  }

  return Object.freeze({
    applicationToolsSupported: true,
    entries,
    closingSessions: cleanup.closingSessions,
    get closing() { return cleanup.closing; },
    createAccountQueries,
    open,
    acquire,
    createConversation,
    snapshot,
    readRetainedTurn,
    readFinalAssistantResult,
    readHistory,
    nativeWorkSettled,
    ensureReady,
    ensureProcess,
    readContextUsage,
    compactContext,
    releaseRetainedGoal,
    stopForTerminal,
    prepareTerminal,
    send: delivery.send,
    startTurn,
    interrupt,
    read,
    inspectAdmission,
    hasActiveTemporaryConversation,
    hasActiveConversation,
    retireConversationHistory,
    reconcileSessions: cleanup.reconcileSessions,
    restoreSessionEntries: cleanup.restoreSessionEntries,
    closeSession: cleanup.closeSession,
    releaseSession: cleanup.releaseSession,
    closeProject: cleanup.closeProject,
    invalidateRuntimes: cleanup.invalidateRuntimes,
    drain: cleanup.drain,
    forget: cleanup.forget,
    close: cleanup.close,
    deleteConversation: cleanup.deleteConversation,
    recover: cleanup.recover,
    stopSelected: cleanup.stopSelected,
    wait,
    stopConversation,
    readGoal,
    updateGoal,
    renewal,
    run: commands.run,
    steer: commands.steer,
    cancel: commands.cancel
  });
}
