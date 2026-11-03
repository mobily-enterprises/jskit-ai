import { codexAppServerThreadStatus, normalizeCodexRunText, codexAppServerConversationTurnIsActive, codexAppServerNativeOuterTurnId } from "./codexTurnState.js";
import { ignoreCodexDetachedTurnEvent } from "./codexDetachedTurn.js";
import { readCodexToolFreeConfiguration } from "./codexIsolation.js";
import { codexAppServerAssistantItemText, codexAppServerContentText, classifyCodexAppServerEvent, codexAppServerNotificationThreadId, codexAppServerNotificationTurnId, codexAppServerNotificationTurnStatus } from "./codexEvents.js";
import {
  codexAppServerProviderThreadAssistantSegments,
  codexAppServerThreadRawValue,
  codexAppServerProviderTurnId,
  codexAppServerProviderTurnStatus,
  codexAppServerProviderTurnItems,
  codexAppServerProviderTurnClientIds,
  codexAppServerThreadTurnId,
  codexAppServerThreadError
} from "./codexThreadSnapshot.js";
import {
  codexAppServerEphemeralConversationSnapshot,
  createCodexConversationTurns,
  ignoreCodexConversationEvent,
  prepareCodexAppServerConversationThread
} from "./codexConversationTurns.js";
import {
  acquireCodexAppServerDetachedThread,
  codexAppServerDetachedThreadId,
  createCodexDetachedConversation,
  dispatchCodexAppServerDetachedTurn,
  runDetachedCodexAppServerTurn
} from "./codexDetachedConversation.js";
import { createCodexConversationStops } from "./codexConversationStops.js";

/** @typedef {Map<string, Map<string, object>>} CodexConversationRegistry Each session's native conversations, by id. */
/** @typedef {(sessionId?: string, conversationId?: string) => object | null} CodexConversationLookup */
/** @typedef {(state: object) => void} CodexConversationStateUpdate */
/** @typedef {(sessionId: string, conversationId: string, provider: import("./codexProvider.js").CodexAppServerAgentProvider) => object} CodexConversationObserver */
/** @typedef {{ release(): void }} CodexProviderBorrowHandle */
/** @typedef {(sessionId: string, input: object, options: object, borrow?: CodexProviderBorrowHandle | null) => Promise<any>} CodexConversationContextReader */
/** @typedef {(operation: () => Promise<any>) => Promise<any>} CodexConversationResult */
/** @typedef {(borrowing: boolean, operation: (borrow: CodexProviderBorrowHandle | null) => Promise<any>) => Promise<any>} CodexProviderBorrow */

/**
 * The scoped and Temporary conversation commands of a run owner: native conversations this server tracks, their
 * observation, and creating, starting, reading, waiting for, stopping and deleting them. The conversation and
 * turn-start collections keep the run owner's lifetime.
 * @param {object} dependencies
 * @param {import("./codexTurn.js").CodexCheckpoint} dependencies.checkpoint
 * @param {typeof import("./codexTurnState.js").codexAppServerConversationMessageId} dependencies.codexAppServerConversationMessageId
 * @param {import("./codexOutput.js").CodexAppServerOutput["streamMessage"]} dependencies.codexAppServerStreamMessage
 * @param {object} dependencies.conversationPreparation The application's conversation preparation.
 * @param {import("./codexTurn.js").CodexProviderSelection["ensureCodexAppServerProviderForActiveTurn"]} dependencies.ensureCodexAppServerProviderForActiveTurn
 * @param {string} dependencies.errorPrefix
 * @param {import("./codexHelperThreads.js").CodexHelperThreadLifecycle} dependencies.helperLifecycle
 * @param {string} dependencies.helperOwnershipError
 * @param {string} dependencies.interruptFailedCode
 * @param {import("./codexTurn.js").CodexSessionNamespace} dependencies.namespace
 * @param {import("./codexTurn.js").CodexProviderSessions} dependencies.providerSessions
 * @param {import("./codexTurn.js").CodexProviderSelection["ensureSessionProvider"]} dependencies.ensureSessionProvider
 * @param {import("./codexTurn.js").CodexProviderSelection["borrowSessionProvider"]} dependencies.borrowSessionProvider
 * @param {string} dependencies.steerFailedCode
 * @param {import("./codexTurn.js").CodexTurnOutcomes} dependencies.turnOutcomes
 */
export function createCodexConversationCommands({
  checkpoint,
  codexAppServerConversationMessageId,
  codexAppServerStreamMessage,
  conversationPreparation,
  ensureCodexAppServerProviderForActiveTurn,
  errorPrefix,
  helperLifecycle,
  helperOwnershipError,
  interruptFailedCode,
  namespace,
  providerSessions,
  ensureSessionProvider,
  borrowSessionProvider,
  steerFailedCode,
  turnOutcomes
}) {
  const codexAppServerConversations = new Map();
  const codexAppServerConversationTurnStarts = new Map();
  // Turns, detached runs and stops live in their own modules. Each receives the
  // registry above and the registry and context functions declared below.
  const {
    createPreparedCodexAppServerConversation,
    startPreparedCodexAppServerConversationTurn,
    waitForPreparedCodexAppServerConversationTurn
  } = createCodexConversationTurns({
    codexAppServerConversations,
    codexAppServerConversation,
    observeCodexConversation,
    holdWhileActive,
    namespace,
    errorPrefix,
    helperOwnershipError,
    steerFailedCode,
    interruptFailedCode
  });
  const { runDetachedCodexAppServerConversation } = createCodexDetachedConversation({
    conversationPreparation,
    codexAppServerConversationResult,
    codexAppServerConversationContext,
    helperLifecycle,
    helperOwnershipError
  });
  const {
    stopCodexAppServerConversation,
    stopPersistentCodexConversation,
    interruptDetachedCodexAppServerConversationTurn,
    deleteScopedCodexAppServerConversation,
    deleteDetachedCodexAppServerConversationThread,
    closeCodexAppServerConversations
  } = createCodexConversationStops({
    codexAppServerConversations,
    codexAppServerConversation,
    codexAppServerConversationContext,
    codexAppServerConversationResult,
    withProviderBorrow,
    forgetObservation,
    holdWhileActive,
    conversationPreparation,
    helperLifecycle,
    providerSessions,
    namespace,
    errorPrefix,
    interruptFailedCode,
    turnOutcomes
  });

  // Reads and Temporary chat commands borrow their provider instead of claiming
  // it: the operation returns its borrow when it finishes, and an unused
  // provider stops a short idle later. Without `borrowing`, it claims one.
  async function withProviderBorrow(borrowing, operation) {
    const borrow = borrowing ? { release() {} } : null;
    try {
      return await operation(borrow);
    } finally {
      borrow?.release();
    }
  }

  // A persistent conversation holds its borrowed provider only while it
  // observes native work running there: a turn, or an active goal.
  function holdWhileActive(state) {
    const active = state.persistent === true && Boolean(state.unsubscribe) &&
      (codexAppServerConversationTurnIsActive(state.status) || state.goal?.status === "active");
    if (active && !state.releaseProvider) {
      state.releaseProvider = providerSessions.owner.holdProvider(state.provider);
    } else if (!active && state.releaseProvider) {
      const release = state.releaseProvider;
      state.releaseProvider = null;
      release();
    }
  }

  function forgetObservation(state) {
    if (state.unsubscribe) state.unsubscribe();
    state.unsubscribe = null;
    holdWhileActive(state);
  }

  function codexAppServerConversation(sessionId = "", conversationId = "") {
    return codexAppServerConversations.get(
      namespace(sessionId)
    )?.get(conversationId) || null;
  }

  function hasActiveConversation(sessionId) {
    const conversations = codexAppServerConversations.get(
      namespace(sessionId)
    );
    return Boolean(conversations && [...conversations.values()].some((conversation) => (
      codexAppServerConversationTurnIsActive(conversation.status) ||
      conversation.goal?.status === "active" && !conversation.provider.observationFailure
    )));
  }

  async function withCodexAppServerConversationTurnStart(sessionId, input, operation) {
    const messageId = normalizeCodexRunText(input.messageId);
    const deliveryKey = messageId
      ? `${namespace(sessionId)}\0${normalizeCodexRunText(input.conversationId)}\0${messageId}`
      : "";
    const existing = deliveryKey ? codexAppServerConversationTurnStarts.get(deliveryKey) : null;
    if (existing) {
      return existing;
    }
    const start = operation();
    if (deliveryKey) {
      codexAppServerConversationTurnStarts.set(deliveryKey, start);
    }
    try {
      return await start;
    } finally {
      if (deliveryKey && codexAppServerConversationTurnStarts.get(deliveryKey) === start) {
        codexAppServerConversationTurnStarts.delete(deliveryKey);
      }
    }
  }

  function observeCodexConversation(sessionId, conversationId, provider) {
    const key = namespace(sessionId);
    const conversations = codexAppServerConversations.get(key) || new Map();
    let state = conversations.get(conversationId);
    if (state?.provider === provider && state.unsubscribe) return state;
    if (state) forgetObservation(state);
    state = { conversationId, provider, persistent: true, status: "ready", runId: "", error: "", turnOutcome: "",
      onEvent: ignoreCodexConversationEvent };
    state.unsubscribe = provider.subscribe((notification) => {
      if (codexAppServerNotificationThreadId(notification) !== conversationId) return;
      const turnId = codexAppServerNotificationTurnId(notification);
      if (turnId) state.runId = turnId;
      const status = codexAppServerNotificationTurnStatus(notification);
      if (status) state.status = status;
      const classification = classifyCodexAppServerEvent(notification);
      if (notification.method === "item/agentMessage/delta") {
        state.onEvent({ type: "text", text: notification.params.delta,
          messageId: notification.params.itemId, threadId: conversationId, turnId,
          message: codexAppServerStreamMessage(classification) });
      } else if (["assistant_started", "live_progress", "final_assistant_result"].includes(classification.kind)) {
        state.onEvent({ type: "message", threadId: conversationId, turnId,
          message: { ...codexAppServerStreamMessage(classification),
            ...(classification.kind !== "assistant_started" ? { text: classification.text } : {}) } });
      }
      if (notification.method === "thread/goal/updated") state.goal = notification.params.goal;
      if (notification.method === "thread/goal/cleared") state.goal = null;
      if (notification.method === "turn/completed") {
        state.onEvent = ignoreCodexConversationEvent;
        const completedTurnId = state.runId;
        const completedStatus = state.status;
        // A turn the person stopped reaches the checkpoint as cancelled, as Main turns do.
        const completedOutcome = state.turnOutcome;
        state.turnOutcome = "";
        void checkpoint(sessionId, {
          outerTurnId: codexAppServerNativeOuterTurnId(conversationId, completedTurnId),
          threadId: conversationId,
          turnId: completedTurnId,
          status: completedStatus,
          turnOutcome: completedOutcome
        }).catch(() => {});
      }
      holdWhileActive(state);
    });
    conversations.set(conversationId, state);
    codexAppServerConversations.set(key, conversations);
    return state;
  }

  async function readPersistentCodexConversation(sessionId, input, context) {
    const conversationId = normalizeCodexRunText(input.conversationId);
    const previous = codexAppServerConversation(sessionId, conversationId);
    const state = observeCodexConversation(sessionId, conversationId, context.provider);
    const thread = await context.provider.readThreadStatus(conversationId);
    if (codexAppServerThreadRawValue(thread).historyMode !== "paginated") {
      throw Object.assign(new Error("This conversation uses an unsupported Codex history format. Start a fresh conversation."), {
        code: `${errorPrefix}codex_history_unsupported`
      });
    }
    const turns = [];
    let cursor;
    do {
      const page = await context.provider.listThreadTurns(conversationId, {
        limit: 100, itemsView: "full", sortDirection: "asc", ...(cursor ? { cursor } : {})
      });
      turns.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    const latest = turns.at(-1);
    const runId = codexAppServerProviderTurnId(latest || {});
    let status = codexAppServerThreadStatus(thread);
    if (!codexAppServerConversationTurnIsActive(status) && latest) status = codexAppServerProviderTurnStatus(latest);
    let goal = (await context.provider.readGoal(conversationId)).goal;
    // A new backend observer cannot assume it saw the work preceding connection.
    // Stop it once; browser reloads reuse the existing backend observer.
    if (previous?.provider !== context.provider && (codexAppServerConversationTurnIsActive(status) || goal?.status === "active")) {
      Object.assign(state, { runId, status: "inProgress", goal });
      holdWhileActive(state);
      try {
        await context.provider.stopThreadForObservationLoss(conversationId, "");
      } catch (error) {
        await context.provider.failObservation(error);
        if (codexAppServerConversationTurnIsActive(state.status)) throw error;
      }
      status = "interrupted";
      goal = (await context.provider.readGoal(conversationId)).goal;
    }
    if (goal?.status === "active") status = "inProgress";
    Object.assign(state, { runId, status, goal });
    holdWhileActive(state);
    const messages = [];
    for (const turn of turns) {
      const turnId = codexAppServerProviderTurnId(turn);
      const complete = !codexAppServerConversationTurnIsActive(codexAppServerProviderTurnStatus(turn));
      const items = codexAppServerProviderTurnItems(turn);
      const finalIds = new Set(codexAppServerProviderThreadAssistantSegments({ turns: [turn] }, turnId).map(({ itemId }) => itemId));
      for (const [index, item] of items.entries()) {
        let role;
        if (item.type === "reasoning") role = "thinking";
        else if (item.type === "agentMessage") {
          const progress = item.phase === "commentary" || (!item.phase && !finalIds.has(item.id) && (complete || index < items.length - 1));
          role = progress ? "commentary" : "assistant";
        }
        else continue;
        const text = role === "thinking"
          ? normalizeCodexRunText(codexAppServerContentText(item.summary)) || codexAppServerContentText(item.content)
          : codexAppServerAssistantItemText(item);
        if (text) messages.push({
          id: codexAppServerConversationMessageId(conversationId, turnId, role, item.id || text),
          ...(item.id && role !== "thinking" ? { outputId: codexAppServerConversationMessageId(conversationId, turnId, "assistant-item", item.id) } : {}),
          role,
          text,
          complete
        });
      }
    }
    const latestText = latest ? codexAppServerProviderThreadAssistantSegments({ turns: [latest] }, runId)
      .map(({ text }) => text).join("\n\n") : "";
    return {
      conversationId,
      ok: true,
      status,
      runId,
      messages,
      goal,
      admitted: Boolean(input.messageId && turns.some((turn) => codexAppServerProviderTurnClientIds(turn).includes(input.messageId))),
      rawText: latestText.trim(),
      error: state.error || codexAppServerThreadError(thread)
    };
  }

  async function codexAppServerConversationResult(operation) {
    try {
      return await operation();
    } catch (error) {
      return conversationPreparation.failure(error);
    }
  }

  async function acquireCodexAppServerConversationContext(sessionId, prepared, input = {}, borrow = null) {
    if (prepared.result) return prepared.result;
    const { context } = prepared;
    if (context.assistantScope) {
      const providerOptions = prepared.providerOptions;
      const provider = await ensureSessionProvider(sessionId, providerOptions);
      const result = prepared.project(provider);
      result.isolationConfig = await readCodexToolFreeConfiguration(
        provider, context.workdir, conversationPreparation.isolation.assertCompatibility
      );
      return result;
    }
    let helperRestore = null;
    if (prepared.helperTurn) {
      const restoration = await prepared.helperRestoration;
      helperRestore = helperLifecycle.assertRestored(
        await helperLifecycle.restoreThreads(restoration.projectRuntimeRoot, restoration.context)
      );
    } else {
      const threadId = normalizeCodexRunText(input.threadId || input.codexSessionId || input.conversationId);
      if (threadId) {
        await helperLifecycle.assertOrdinaryThreadAvailable(prepared.projectRuntimeRoot, threadId);
      }
    }
    const managedIdentity = prepared.managedIdentity;
    const assertAdmitted = () => {
      const error = conversationPreparation.admissionError(sessionId);
      if (error) throw error;
    };
    assertAdmitted();
    const activeProvider = prepared.helperTurn
      ? null
      : await ensureCodexAppServerProviderForActiveTurn(context.session, managedIdentity);
    assertAdmitted();
    const providerOptions = activeProvider ? null : await prepared.providerOptions;
    assertAdmitted();
    let provider = activeProvider?.provider;
    // A Helper's provider keeps its own retained lifecycle.
    if (!provider && borrow && !prepared.helperTurn) {
      const borrowed = await borrowSessionProvider(sessionId, providerOptions);
      borrow.release = borrowed.release;
      provider = borrowed.provider;
    }
    provider ||= await ensureSessionProvider(sessionId, providerOptions);
    assertAdmitted();
    return prepared.project(provider, activeProvider?.providerOptions || providerOptions, helperRestore);
  }

  async function codexAppServerConversationContext(sessionId, input, options, borrow = null) {
    return acquireCodexAppServerConversationContext(sessionId,
      await conversationPreparation.context(sessionId, input, options), input, borrow);
  }

  async function codexAppServerEphemeralScopeContext(sessionId, input, scope) {
    return acquireCodexAppServerConversationContext(sessionId,
      await conversationPreparation.scope(sessionId, input, scope), input);
  }

  async function readPreparedPersistentCodexConversation(sessionId, input, context) {
    const result = await readPersistentCodexConversation(sessionId, input, context);
    return { ...result, ...conversationPreparation.response(result.rawText) };
  }

  async function createCodexAppServerConversation(sessionId, input = {}, options = {}) {
    return codexAppServerConversationResult(() => withProviderBorrow(input.persistent === true, async (borrow) => {
      const context = await codexAppServerConversationContext(sessionId, input, options, borrow);
      if (context.ok === false) return context;
      const execution = conversationPreparation.execution(sessionId, input, options, context, null, "create");
      return createPreparedCodexAppServerConversation(sessionId, input, {
        provider: context.provider,
        executionProfile: execution.executionProfile,
        helperIsolation: conversationPreparation.isolation,
        threadPreparation: () => execution.threadPreparation
      });
    }));
  }

  async function startCodexAppServerConversationTurn(sessionId, input = {}, options = {}) {
    const messageId = normalizeCodexRunText(input.messageId);
    return withCodexAppServerConversationTurnStart(sessionId, input, () => codexAppServerConversationResult(async () => {
      const conversationId = normalizeCodexRunText(input.conversationId);
      const prompt = normalizeCodexRunText(input.message || input.prompt);
      if (!conversationId || !prompt) {
        return {
          code: `${errorPrefix}agent_conversation_turn_input_required`,
          error: "Assistant conversation turns require a conversation and message.",
          ok: false
        };
      }
      return withProviderBorrow(input.persistent === true, async (borrow) => {
        const context = await codexAppServerConversationContext(sessionId, input, options, borrow);
        if (context.ok === false) return context;
        // A persistent turn is observed on the provider it runs on, which its
        // conversation then holds until the turn ends.
        const conversationState = input.persistent === true
          ? observeCodexConversation(sessionId, conversationId, context.provider)
          : codexAppServerConversation(sessionId, conversationId);
        const execution = conversationPreparation.execution(sessionId, input, options, context, conversationState, "start", { conversationId, prompt });
        if (input.ephemeral === true && !conversationState) {
          return {
            ...conversationPreparation.expired(conversationId, input),
            code: `${errorPrefix}temporary_conversation_expired`,
            ok: false,
          };
        }
        // Do not evaluate native preparation until the original duplicate/active
        // checks and Helper isolation capability checks have run.
        return startPreparedCodexAppServerConversationTurn(sessionId, input, {
          executionProfile: execution.executionProfile,
          helperIsolation: conversationPreparation.isolation,
          prepareTurn: execution.prepareTurn,
          authorized: execution.authorized,
          readOnly: execution.readOnly,
          actorMetadata: execution.actorMetadata,
          onEvent: execution.onEvent || ignoreCodexConversationEvent,
          projectResult: execution.projectResult,
          conversationId,
          messageId,
          prompt,
          provider: context.provider,
          conversationState,
          threadPreparation: () => execution.threadPreparation
        });
      });
    }));
  }

  async function readCodexAppServerConversation(sessionId, input = {}, options = {}) {
    return codexAppServerConversationResult(async () => {
      const conversationId = normalizeCodexRunText(input.conversationId);
      if (!conversationId) {
        return {
          code: `${errorPrefix}agent_conversation_id_required`,
          error: "Assistant conversation id is required.",
          ok: false
        };
      }
      const conversationState = codexAppServerConversation(sessionId, conversationId);
      if (conversationState && !input.persistent) {
        return codexAppServerEphemeralConversationSnapshot(conversationState);
      }
      if (input.ephemeral === true) {
        return conversationPreparation.expired(conversationId, input);
      }
      if (input.persistent && conversationState?.persistent && conversationState.provider.isAvailable() &&
          !conversationState.provider.observationFailure && !conversationPreparation.admissionError(sessionId)) {
        // Poll the already observed native thread. Execution environment setup
        // belongs to Send and reconnection, not every history read. The read
        // holds that provider so its idle release cannot stop it mid-read.
        const release = providerSessions.owner.holdProvider(conversationState.provider);
        try {
          return await readPreparedPersistentCodexConversation(sessionId, input, { provider: conversationState.provider });
        } finally {
          release();
        }
      }
      // Reading history or status is not a use that keeps Codex running.
      return withProviderBorrow(true, async (borrow) => {
        const context = await codexAppServerConversationContext(sessionId, input, options, borrow);
        if (context.ok === false) {
          return context;
        }
        if (input.persistent) return readPreparedPersistentCodexConversation(sessionId, input, context);
        const thread = await context.provider.readThread(conversationId);
        const runId = normalizeCodexRunText(input.runId) || codexAppServerThreadTurnId(thread);
        const status = codexAppServerThreadStatus(thread);
        const text = runId
          ? codexAppServerProviderThreadAssistantSegments(thread, runId)
            .map((segment) => segment.text)
            .join("\n\n")
          : "";
        return {
          conversationId,
          error: codexAppServerThreadError(thread),
          ok: true,
          runId,
          status,
          ...conversationPreparation.response(text)
        };
      });
    });
  }

  async function waitForCodexAppServerConversationTurn(sessionId, input = {}, {
    assistantScope = null,
    onEvent = ignoreCodexDetachedTurnEvent
  } = {}) {
    return codexAppServerConversationResult(async () => {
      const conversationId = normalizeCodexRunText(input.conversationId);
      const runId = normalizeCodexRunText(input.runId);
      if (!conversationId || !runId) {
        return {
          code: `${errorPrefix}agent_conversation_run_required`,
          error: "Waiting for an assistant conversation requires conversation and run ids.",
          ok: false
        };
      }
      const scoped = assistantScope && codexAppServerConversation(sessionId, conversationId);
      if (scoped?.executionProfile) {
        if (scoped.runId !== runId || !scoped.completion) throw new Error("The scoped helper turn is unavailable.");
        const result = await scoped.completion;
        return { ...result, conversationId, ok: true, runId };
      }
      return withProviderBorrow(input.persistent === true, async (borrow) => {
        const context = await codexAppServerConversationContext(sessionId, input, {
          assistantScope
        }, borrow);
        if (context.ok === false) {
          return context;
        }
        const result = await waitForPreparedCodexAppServerConversationTurn(sessionId, input, {
          provider: context.provider,
          onEvent
        });
        return { ...result, ...conversationPreparation.response(result.rawText) };
      });
    });
  }

  return Object.freeze({
    codexAppServerConversations,
    codexAppServerConversationTurnStarts,
    codexAppServerConversation,
    hasActiveConversation,
    observeCodexConversation,
    readPersistentCodexConversation,
    prepareCodexAppServerConversationThread,
    codexAppServerConversationContext,
    codexAppServerEphemeralScopeContext,
    createCodexAppServerConversation,
    runDetachedCodexAppServerConversation,
    startCodexAppServerConversationTurn,
    readCodexAppServerConversation,
    waitForCodexAppServerConversationTurn,
    stopCodexAppServerConversation,
    deleteScopedCodexAppServerConversation,
    closeCodexAppServerConversations,
    interruptDetachedCodexAppServerConversationTurn,
    deleteDetachedCodexAppServerConversationThread,
    acquireCodexAppServerDetachedThread,
    codexAppServerDetachedThreadId,
    dispatchCodexAppServerDetachedTurn,
    runDetachedCodexAppServerTurn,
    stopPersistentCodexConversation
  });
}

/** @typedef {ReturnType<typeof createCodexConversationCommands>} CodexConversationCommands */
