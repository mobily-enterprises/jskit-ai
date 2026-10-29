import { codexAppServerTurnStatusIsSuccessfulComplete, codexAppServerTurnStatusIsProviderFailure, codexAppServerThreadStatus, normalizeCodexRunText, codexAppServerErrorMessage, codexAppServerSteerFailure, codexAppServerInterruptFailure, codexAppServerConversationTurnIsActive, codexAppServerNativeOuterTurnId } from "./codexTurnState.js";
import { CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS, createCodexAppServerDetachedTurnWatcher } from "./codexDetachedTurn.js";
import { assertCodexAppServerHelperAccountIdentity, readCodexAppServerAccountIdentity, sendPreparedCodexAppServerHelperTurn } from "./codexHelperExecution.js";
import { codexAppServerDeliveredTurn, codexAppServerRequestIsInvalid, codexAppServerThreadHasReadableHistory, codexAppServerThreadIsMissing, codexLocalImageInput, sendCodexAppServerPrompt } from "./codexProvider.js";
import { codexAppServerProjectHookTrustConfig, readCodexToolFreeConfiguration } from "./codexConfiguration.js";
import { codexAppServerAssistantItemText, codexAppServerContentText, classifyCodexAppServerEvent, codexAppServerNotificationThreadId, codexAppServerNotificationTurnId, codexAppServerNotificationTurnStatus, codexAppServerThreadRawValue, codexAppServerProviderThreadAssistantSegments, codexAppServerProviderTurnId, codexAppServerProviderTurnStatus, codexAppServerProviderTurnItems, codexAppServerProviderTurnClientIds, codexAppServerThreadTurnId, codexAppServerThreadError } from "./codexEvents.js";

// Internal command facet of the original run owner; the same native conversation
// and turn-start collections retain their original lifetime and public references.
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

  // Reads and Temporary chat commands borrow their provider instead of claiming
  // it: the operation returns its borrow when it finishes, and an unused
  // provider stops a short idle later.
  function providerBorrow() {
    return { release() {} };
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
    state.unsubscribe?.();
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
    state = { conversationId, provider, persistent: true, status: "ready", runId: "", error: "", turnOutcome: "" };
    state.unsubscribe = provider.subscribe((notification) => {
      if (codexAppServerNotificationThreadId(notification) !== conversationId) return;
      const turnId = codexAppServerNotificationTurnId(notification);
      if (turnId) state.runId = turnId;
      const status = codexAppServerNotificationTurnStatus(notification);
      if (status) state.status = status;
      const classification = classifyCodexAppServerEvent(notification);
      if (notification.method === "item/agentMessage/delta") {
        state.onEvent?.({ type: "text", text: notification.params.delta,
          messageId: notification.params.itemId, threadId: conversationId, turnId,
          message: codexAppServerStreamMessage(classification) });
      } else if (["assistant_started", "live_progress", "final_assistant_result"].includes(classification.kind)) {
        state.onEvent?.({ type: "message", threadId: conversationId, turnId,
          message: { ...codexAppServerStreamMessage(classification),
            ...(classification.kind !== "assistant_started" ? { text: classification.text } : {}) } });
      }
      if (notification.method === "thread/goal/updated") state.goal = notification.params.goal;
      if (notification.method === "thread/goal/cleared") state.goal = null;
      if (notification.method === "turn/completed") {
        state.onEvent = null;
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

  function codexAppServerEphemeralConversationSnapshot(state = {}) {
    return {
      conversationId: normalizeCodexRunText(state.conversationId),
      error: normalizeCodexRunText(state.error),
      message: normalizeCodexRunText(state.message),
      ok: true,
      outcome: state.outcome || null,
      progressUpdates: Array.isArray(state.progressUpdates)
        ? state.progressUpdates.map((update = {}) => ({
            id: normalizeCodexRunText(update.id),
            text: normalizeCodexRunText(update.text)
          })).filter((update) => update.id && update.text)
        : [],
      rawText: normalizeCodexRunText(state.rawText),
      messageId: normalizeCodexRunText(state.messageId),
      runId: normalizeCodexRunText(state.runId),
      status: normalizeCodexRunText(state.status) || "ready",
      turnMetadata: state.turnMetadata || null
    };
  }

  async function codexAppServerConversationResult(operation) {
    try {
      return await operation();
    } catch (error) {
      return conversationPreparation.failure(error);
    }
  }

  async function prepareCodexAppServerConversationThread(provider, preparation, helperIsolation) {
    if (preparation.inspection) {
      const enforcement = await helperIsolation.inspect(provider, preparation.inspection);
      return preparation.prepared(enforcement);
    }
    const config = preparation.projectHooks
      ? await codexAppServerProjectHookTrustConfig(provider, preparation.workdir)
      : null;
    return preparation.settings(config);
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
    return codexAppServerConversationResult(async () => {
      const borrow = input.persistent === true ? providerBorrow() : null;
      try {
        const context = await codexAppServerConversationContext(sessionId, input, options, borrow);
        if (context.ok === false) return context;
        const execution = conversationPreparation.execution(sessionId, input, options, context, null, "create");
        return await createPreparedCodexAppServerConversation(sessionId, input, {
          provider: context.provider,
          executionProfile: execution.executionProfile,
          helperIsolation: conversationPreparation.isolation,
          threadPreparation: () => execution.threadPreparation
        });
      } finally {
        borrow?.release();
      }
    });
  }

  async function runDetachedCodexAppServerConversation(sessionId, input = {}, options = {}) {
    const preparation = conversationPreparation.detached(sessionId, input);
    const { admission } = preparation;
    if (admission.ok === false) return admission;
    try {
      return await codexAppServerConversationResult(async () => {
        const unavailable = preparation.result;
        if (unavailable) return unavailable;
        const prompt = preparation.prompt;
        const context = await codexAppServerConversationContext(sessionId, input, options);
        if (context.ok === false) return context;
        const { provider, runtime, workdir } = context;
        const executionProfile = input.executionProfile && typeof input.executionProfile === "object" &&
          !Array.isArray(input.executionProfile) ? input.executionProfile : null;
        const helperTurn = Boolean(executionProfile);
        const emitDetachedEvent = event => {
          if (typeof options.onEvent === "function") options.onEvent(event);
        };
        const onRetired = ({ threadId }) => emitDetachedEvent({ threadId, type: "thread-retired" });
        if (helperTurn) {
          await assertCodexAppServerHelperAccountIdentity(provider, input.expectedAccountIdentitySignature, helperOwnershipError);
        }
        const execution = preparation.execution(context);
        const threadSettings = helperTurn ? null : await prepareCodexAppServerConversationThread(
          provider, execution.threadPreparation, conversationPreparation.isolation
        );
        const requestedThreadId = normalizeCodexRunText(input.threadId || input.codexSessionId);
        let helper = null;
        let thread;
        if (helperTurn) {
          const scope = { executionProfile, onRetired, projectRuntimeRoot: normalizeCodexRunText(runtime?.stateRoot),
            projectContextRoot: normalizeCodexRunText(runtime?.projectContextRoot), provider, sessionId, requestedThreadId, workdir,
            ...(requestedThreadId ? { record: helperLifecycle.threadForOperation({ executionProfile,
              projectRuntimeRoot: normalizeCodexRunText(runtime?.stateRoot), provider, sessionId,
              threadId: requestedThreadId, workdir }) } : {}) };
          helper = await helperLifecycle.prepareDetached(scope, execution.helperPreparation);
          thread = helper.thread;
        } else {
          thread = await acquireCodexAppServerDetachedThread(provider, requestedThreadId, threadSettings, input);
        }
        const threadId = codexAppServerDetachedThreadId(thread, requestedThreadId);
        emitDetachedEvent({ threadId, type: "thread" });
        const requestedTimeoutMs = Number(input.timeoutMs || 0);
        const profileTimeoutMs = Number(executionProfile?.limits?.timeoutMs || 0);
        let turnId = "";
        const result = await runDetachedCodexAppServerTurn({
          provider, threadId, onEvent: emitDetachedEvent,
          timeoutMs: helperTurn
            ? Math.min(requestedTimeoutMs > 0 ? requestedTimeoutMs : profileTimeoutMs, profileTimeoutMs)
            : requestedTimeoutMs > 0 ? requestedTimeoutMs : CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS,
          async onFailure(error, status) {
            await helper?.discard();
            return execution.failure(error, status);
          }
        }, async failDispatch => {
          let dispatched;
          if (helperTurn) {
            dispatched = await helper.dispatch(threadId, failDispatch);
          } else {
            try {
              dispatched = await dispatchCodexAppServerDetachedTurn({ provider, prompt, threadId }, execution.authorized);
            } catch (error) {
              await failDispatch(error);
            }
          }
          turnId = dispatched.turnId;
          return dispatched;
        });
        if (helperTurn) {
          try {
            await assertCodexAppServerHelperAccountIdentity(provider, input.expectedAccountIdentitySignature, helperOwnershipError);
            execution.validateOutput(result.text);
          } catch (error) {
            await helper.discard();
            throw error;
          }
          await helper.complete();
        }
        emitDetachedEvent({ status: result.status || "completed", text: result.text,
          threadId, turnId: result.turnId || turnId, type: "completed" });
        return { ok: true, text: result.text, threadId, turnId: result.turnId || turnId,
          ...(helperTurn ? { inputCharacters: prompt.length, outputCharacters: result.text.length, usage: result.usage || null } : {}) };
      });
    } finally {
      admission.release();
    }
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
      const borrow = input.persistent === true ? providerBorrow() : null;
      try {
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
        return await startPreparedCodexAppServerConversationTurn(sessionId, input, {
          executionProfile: execution.executionProfile,
          helperIsolation: conversationPreparation.isolation,
          prepareTurn: execution.prepareTurn,
          authorized: execution.authorized,
          readOnly: execution.readOnly,
          actorMetadata: execution.actorMetadata,
          onEvent: execution.onEvent,
          projectResult: execution.projectResult,
          conversationId,
          messageId,
          prompt,
          provider: context.provider,
          conversationState,
          threadPreparation: () => execution.threadPreparation
        });
      } finally {
        borrow?.release();
      }
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
      if (input.persistent && conversationState?.persistent && conversationState.provider.isAvailable?.() &&
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
      const borrow = providerBorrow();
      try {
        const context = await codexAppServerConversationContext(sessionId, input, options, borrow);
        if (context.ok === false) {
          return context;
        }
        if (input.persistent) return await readPreparedPersistentCodexConversation(sessionId, input, context);
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
      } finally {
        borrow.release();
      }
    });
  }

  async function waitForCodexAppServerConversationTurn(sessionId, input = {}, {
    assistantScope = null,
    onEvent = null
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
      const borrow = input.persistent === true ? providerBorrow() : null;
      try {
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
      } finally {
        borrow?.release();
      }
    });
  }

  async function stopCodexAppServerConversation(sessionId, input = {}, options = {}, {
    turnOutcome = turnOutcomes.USER_CANCELLED
  } = {}) {
    const conversationId = normalizeCodexRunText(input.conversationId);
    const conversationState = codexAppServerConversation(sessionId, conversationId);
    if (conversationState?.provider.observationFailure) {
      await conversationState.provider.failObservation(conversationState.provider.observationFailure);
      if (codexAppServerConversationTurnIsActive(conversationState.status)) {
        throw new Error("Codex's stop is not yet confirmed.");
      }
      return { conversationId, ok: true, runId: conversationState.runId, status: "interrupted" };
    }
    if (input.ephemeral === true && !conversationState) {
      return {
        conversationExpired: true,
        conversationId,
        ok: true,
        runId: normalizeCodexRunText(input.runId),
        status: "interrupted"
      };
    }
    if (input.persistent) {
      const borrow = providerBorrow();
      try {
        const context = await codexAppServerConversationContext(sessionId, input, options, borrow);
        if (context.ok === false) return context;
        return await stopPersistentCodexConversation({
          conversationId,
          conversationState,
          provider: context.provider,
          turnOutcome
        });
      } finally {
        borrow.release();
      }
    }
    const result = await interruptDetachedCodexAppServerConversationTurn(sessionId, {
      agentSettings: input.agentSettings,
      threadId: input.conversationId,
      turnId: input.runId
    }, options, conversationState);
    return {
      ...result,
      conversationId,
      runId: normalizeCodexRunText(input.runId)
    };
  }

  // A scope's delete stops only what this server runs for it: its live providers,
  // and a runtime whose earlier stop could not prove its exit. It never acquires
  // a provider, which would start a Codex app-server only to stop it, so it needs
  // no account, tool home or workdir. A runtime other providers share stays theirs.
  async function stopCodexScopeRuntimes(sessionKey) {
    const owner = providerSessions.owner;
    const attempted = new Set([...owner.providers]
      .filter(([providerKey]) => owner.providerOwners.get(providerKey)?.sessionKey === sessionKey)
      .map(([, provider]) => provider));
    const stopped = await owner.stopCachedProvidersForSession(sessionKey, { requireStopped: true });
    const failed = [...stopped.failed];
    const results = [...stopped.results];
    for (const record of [...owner.ownedRuntimes.values()]) {
      if (record.sessionKey !== sessionKey || attempted.has(record.provider) ||
          owner.runtimeIsShared(record.providerKey, record.providerOptions)) continue;
      try {
        // Its provider is no longer cached, so the runtime's own options name its lock.
        results.push(await owner.withLifecycle(() => owner.stopOwnedRuntime(record),
          record.providerKey, record.providerOptions));
      } catch (error) {
        failed.push({ code: normalizeCodexRunText(error?.code), error: codexAppServerErrorMessage(error),
          providerKey: record.providerKey, retryable: error?.retryable === true });
      }
    }
    if (failed.length) {
      const error = new Error(failed.map((failure) => failure.error).join(" "));
      error.code = failed[0].code;
      error.retryable = failed.every((failure) => failure.retryable);
      error.details = { failed };
      throw error;
    }
    return { ok: true, results, stopped: results.some((result) => result?.stopped === true) };
  }

  async function deleteScopedCodexAppServerConversation(sessionId, input = {}, options = {}) {
    const conversationId = normalizeCodexRunText(input.conversationId);
    const sessionKey = namespace(sessionId);
    const conversations = codexAppServerConversations.get(sessionKey);
    // An ephemeral native thread lives only in the process that created it, so
    // one this server no longer tracks has nothing left to delete.
    const conversationExpired = input.ephemeral === true && !conversations?.has(conversationId);
    let result;
    if (conversationExpired) {
      result = {
        conversationExpired: true
      };
    } else {
      result = await deleteDetachedCodexAppServerConversationThread(sessionId, {
        agentSettings: input.agentSettings,
        threadId: input.conversationId
      }, options, { conversationId, sessionKey, conversations });
      if (result.ok === false) {
        return { ...result, conversationId };
      }
    }
    const providerExit = options.assistantScope ? await stopCodexScopeRuntimes(sessionKey) : null;
    return {
      ...result,
      conversationId,
      ok: conversationExpired ? providerExit?.ok !== false : result?.ok !== false,
      ...(providerExit ? { providerExit } : {})
    };
  }

  // Close stops each persistent conversation through the provider that observes
  // it. A closing session refuses a rebuilt context, and a new connection could
  // not see the running turn anyway. One conversation's failure does not skip
  // the others; it stays registered so that a retried close stops it.
  async function stopObservedCodexConversation(state) {
    const { provider } = state;
    if (provider.observationFailure) {
      await provider.failObservation(provider.observationFailure);
      if (codexAppServerConversationTurnIsActive(state.status)) {
        throw new Error("Codex's stop is not yet confirmed.");
      }
      return;
    }
    // A provider its owner has since closed observes nothing left to stop here:
    // the owner stopped or detached its process, and reconnecting it would
    // start a process nothing owns.
    if (![...providerSessions.owner.providers].some(([, owned]) => owned === provider)) return;
    // Closing is not the person stopping the turn; its status alone decides the outcome.
    await stopPersistentCodexConversation({
      conversationId: state.conversationId, conversationState: state, provider, turnOutcome: ""
    });
  }

  async function closeCodexAppServerConversations(sessionId) {
    const key = namespace(sessionId);
    const conversations = codexAppServerConversations.get(key);
    const failed = [];
    for (const state of [...(conversations?.values() || [])]) {
      if (!state.persistent) {
        await deleteScopedCodexAppServerConversation(sessionId, { conversationId: state.conversationId }).catch(() => null);
        conversations.delete(state.conversationId);
        continue;
      }
      try {
        await stopObservedCodexConversation(state);
      } catch (error) {
        failed.push({ conversationId: state.conversationId, error: codexAppServerErrorMessage(error) });
        continue;
      }
      forgetObservation(state);
      conversations.delete(state.conversationId);
    }
    if (conversations && codexAppServerConversations.get(key) === conversations && !conversations.size) {
      codexAppServerConversations.delete(key);
    }
    if (failed.length) {
      const error = new Error(`Codex could not confirm that ${failed.length === 1 ? "a conversation" : `${failed.length} conversations`} stopped: ${
        failed.map(({ conversationId, error: reason }) => `${conversationId} (${reason})`).join("; ")}. Retry closing the session.`);
      error.code = `${errorPrefix}codex_conversation_close_failed`;
      error.retryable = true;
      error.details = { failed, sessionId: normalizeCodexRunText(sessionId) };
      throw error;
    }
  }

  async function codexAppServerConversationControl(sessionId, input, {
    assistantScope = null,
    runtime = null,
    session = null
  } = {}, operation, dispatch) {
    return codexAppServerConversationResult(async () => {
      const prepared = conversationPreparation.control(sessionId, input, operation);
      if (prepared.result) return prepared.result;
      const { admission, threadId, turnId } = prepared;
      // Stopping or deleting a thread is cleanup, not a use that keeps Codex running.
      const borrow = providerBorrow();
      try {
        let context = null;
        try {
          context = await codexAppServerConversationContext(sessionId, input, { assistantScope, runtime, session }, borrow);
        } catch (error) {
          const unavailable = prepared.unavailable();
          if (unavailable) return unavailable;
          throw error;
        }
        if (context.ok === false) return context;
        const unavailable = prepared.unavailable();
        if (unavailable) return unavailable;
        const policyResult = helperLifecycle?.inspectControl(operation, input, {
          sessionId, threadId, turnId,
          get retiredThreadIds() { return context.helperRestore?.retiredThreadIds; },
          get projectRuntimeRoot() { return context.runtime?.stateRoot; },
          get provider() { return context.provider; },
          get workdir() { return context.workdir; }
        });
        // The original Helper-retirement return releases admission before its
        // promise settles; only the native dispatch below is awaited here.
        if (policyResult !== undefined) return policyResult;
        if (operation === "interrupt") {
          const unavailable = prepared.unavailable();
          if (unavailable) return unavailable;
        } else if (typeof context.provider.deleteThread !== "function") {
          return {
            code: `${errorPrefix}codex_detached_thread_delete_unavailable`,
            error: "Codex app-server thread deletion is not available.",
            messageCode: "assistant.codex.threadDeleteUnavailable",
            messageParams: {},
            ok: false,
            statusCode: 409,
            threadId
          };
        }
        return await dispatch({ provider: context.provider, threadId, turnId });
      } finally {
        borrow.release();
        admission.release();
      }
    });
  }

  async function interruptDetachedCodexAppServerConversationTurn(sessionId, input = {}, options = {}, conversationState = null) {
    return interruptCodexAppServerConversation(conversationState, dispatch =>
      codexAppServerConversationControl(sessionId, input, options, "interrupt", dispatch));
  }

  async function deleteDetachedCodexAppServerConversationThread(sessionId, input = {}, options = {}, conversation = null) {
    return deleteCodexAppServerConversation(conversation, dispatch =>
      codexAppServerConversationControl(sessionId, input, options, "delete", dispatch));
  }

  async function createPreparedCodexAppServerConversation(sessionId, input, {
    provider,
    executionProfile,
    helperIsolation,
    threadPreparation
  } = {}) {
    const prepareThread = () => prepareCodexAppServerConversationThread(provider, threadPreparation(), helperIsolation);
    const thread = executionProfile
      ? (await helperIsolation.start(provider, prepareThread)).thread
      : await provider.startThread({
          ...await prepareThread(),
          ...(input.ephemeral === true ? { ephemeral: true } : {})
        });
    const conversationId = normalizeCodexRunText(thread.id || thread.response?.thread?.id);
    if (!conversationId) {
      throw new Error("Codex app-server did not return a conversation id.");
    }
    if (input.persistent === true) observeCodexConversation(sessionId, conversationId, provider);
    if (input.ephemeral === true) {
      const sessionKey = namespace(sessionId);
      const conversations = codexAppServerConversations.get(sessionKey) || new Map();
      conversations.set(conversationId, {
        conversationId,
        executionProfile,
        provider,
        error: "",
        message: "",
        messageId: "",
        nextProgressSequence: 0,
        outcome: null,
        progressUpdates: [],
        rawText: "",
        runId: "",
        status: "ready",
        turnMetadata: null,
        watcher: null
      });
      codexAppServerConversations.set(sessionKey, conversations);
    }
    return {
      conversationId,
      ok: true,
      status: "ready"
    };
  }

  async function steerCodexAppServerConversationTurn(input, {
    conversationId,
    conversationState,
    messageId,
    prompt,
    provider
  } = {}) {
    const images = codexLocalImageInput(input.attachments || []);
    const result = await provider.steerTurn(
      conversationId,
      conversationState.runId,
      images.length ? [prompt, ...images] : prompt,
      { clientUserMessageId: messageId }
    );
    const failure = codexAppServerSteerFailure(result, steerFailedCode);
    if (failure) return { ...failure, ok: false };
    conversationState.messageId = messageId;
    return {
      conversationId,
      messageId,
      ok: true,
      runId: conversationState.runId,
      status: "inProgress",
      deliveryMode: "steer"
    };
  }

  async function acquireCodexAppServerDetachedThread(provider, requestedThreadId, threadSettings, input = {}) {
    let thread = null;
    if (requestedThreadId) {
      thread = await provider.resumeThread(requestedThreadId, threadSettings);
    }
    if (!thread) {
      thread = await provider.startThread({
        ...threadSettings,
        ...(input.ephemeral === true ? { ephemeral: true } : {})
      });
    }
    return thread;
  }

  function codexAppServerDetachedThreadId(thread, requestedThreadId) {
    const threadId = normalizeCodexRunText(thread.id || thread.response?.thread?.id || requestedThreadId);
    if (!threadId) {
      throw new Error("Codex app-server did not return a detached chat thread id.");
    }
    return threadId;
  }

  async function dispatchCodexAppServerDetachedTurn({ provider, prompt, threadId }, authorized) {
    const delivery = await sendCodexAppServerPrompt({ provider, prompt, threadId }, authorized);
    return { delivery, ...codexAppServerDeliveredTurn(delivery) };
  }

  async function runDetachedCodexAppServerTurn({
    provider,
    threadId,
    timeoutMs,
    onEvent: emitDetachedEvent,
    onFailure
  } = {}, operation) {
    const watcher = createCodexAppServerDetachedTurnWatcher(provider, threadId, {
      onEvent: (classification) => {
        emitDetachedEvent({
          classification,
          threadId,
          turnId: classification.turnId,
          type: "notification"
        });
      },
      timeoutMs
    });
    const waitForResult = watcher.wait();
    void waitForResult.catch(() => null);
    const throwWatcherFailure = async (fallbackError, status = "", {
      waitForDetail = false
    } = {}) => {
      if (waitForDetail) {
        watcher.failAfterDetailGrace(fallbackError);
      } else {
        watcher.failNow(fallbackError);
      }
      const error = await waitForResult.then(
        () => fallbackError,
        (watcherError) => watcherError
      );
      throw await onFailure(error, status);
    };
    const { delivery, status, turnId } = await operation(throwWatcherFailure);
    watcher.setTurnId(turnId);
    emitDetachedEvent({
      status,
      threadId,
      turnId,
      type: "turn"
    });
    if (codexAppServerTurnStatusIsProviderFailure(status)) {
      const error = new Error(codexAppServerDeliveredTurn(delivery).error || `Codex app-server turn ${status}.`);
      await throwWatcherFailure(error, status, {
        waitForDetail: true
      });
    }
    if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
      await watcher.completeNow(status);
    }
    let result = null;
    try {
      result = await waitForResult;
    } catch (error) {
      throw await onFailure(error, status);
    }
    return result;
  }

  async function startPreparedCodexAppServerConversationTurn(sessionId, input, {
    conversationId,
    messageId,
    prompt,
    provider,
    conversationState,
    executionProfile,
    actorMetadata,
    onEvent,
    projectResult,
    helperIsolation,
    threadPreparation,
    prepareTurn,
    authorized,
    readOnly
  } = {}) {
    if (conversationState && messageId && conversationState.messageId === messageId) {
      return codexAppServerEphemeralConversationSnapshot(conversationState);
    }
    if (conversationState && codexAppServerConversationTurnIsActive(conversationState.status)) {
      if (input.steer === true) {
        return steerCodexAppServerConversationTurn(input, {
          conversationId,
          conversationState,
          messageId,
          prompt,
          provider
        });
      }
      return {
        code: `${errorPrefix}temporary_conversation_turn_active`,
        error: "Temporary AI is already working on this conversation.",
        messageCode: "assistant.codex.temporaryConversationBusy",
        messageParams: {},
        ok: false
      };
    }
    if (!conversationState || input.persistent === true) {
      const prepareThread = () => prepareCodexAppServerConversationThread(provider, threadPreparation(), helperIsolation);
      if (executionProfile) await helperIsolation.resume(provider, conversationId, prepareThread);
      else await provider.resumeThread(conversationId, await prepareThread());
    }
    let admittedAccountIdentitySignature = "";
    if (executionProfile) {
      admittedAccountIdentitySignature = await readCodexAppServerAccountIdentity(provider, helperOwnershipError);
    }
    let watcher = null;
    let waitForResult = null;
    if (conversationState && !input.persistent) {
      Object.assign(conversationState, {
        error: "",
        message: "",
        messageId,
        outcome: null,
        progressUpdates: [],
        rawText: "",
        runId: "",
        status: "starting",
        turnMetadata: actorMetadata
      });
      watcher = createCodexAppServerDetachedTurnWatcher(provider, conversationId, {
        includeThreadHistory: false,
        timeoutMs: executionProfile?.limits.timeoutMs || 0,
        onEvent(classification = {}) {
          const current = codexAppServerConversation(sessionId, conversationId);
          if (!current || (classification.turnId && current.runId && classification.turnId !== current.runId)) {
            return;
          }
          onEvent?.(classification, current);
        }
      });
      waitForResult = watcher.wait();
      void waitForResult.catch(() => null);
      conversationState.watcher = watcher;
    }
    let delivery = null;
    if (input.persistent && conversationState) Object.assign(conversationState, { onEvent, turnOutcome: "" });
    try {
      await input.onPromptSending?.({ threadId: conversationId });
      if (executionProfile) {
        const prepared = prepareTurn();
        delivery = await sendPreparedCodexAppServerHelperTurn(provider, prepared, helperIsolation);
      } else {
        delivery = await sendCodexAppServerPrompt({
          clientUserMessageId: input.messageId,
          outputSchema: input.outputSchema,
          prompt,
          attachments: input.attachments,
          provider,
          readOnly,
          threadId: conversationId
        }, authorized);
      }
    } catch (error) {
      if (input.persistent && conversationState) conversationState.onEvent = null;
      watcher?.failNow(error);
      await waitForResult?.catch(() => null);
      if (conversationState) {
        Object.assign(conversationState, {
          error: codexAppServerErrorMessage(error, "Temporary AI message could not be sent."),
          status: "failed",
          watcher: null
        });
        holdWhileActive(conversationState);
      }
      throw error;
    }
    const { turnId: runId, status } = codexAppServerDeliveredTurn(delivery);
    if (!runId) {
      watcher?.failNow(new Error("Codex app-server accepted a conversation turn without returning its id."));
      await waitForResult?.catch(() => null);
      throw new Error("Codex app-server accepted a conversation turn without returning its id.");
    }
    if (conversationState && !input.persistent) {
      let nativeCompleted = false;
      Object.assign(conversationState, {
        runId,
        status: !executionProfile && codexAppServerTurnStatusIsSuccessfulComplete(status) ? status : "inProgress"
      });
      watcher.setTurnId(runId);
      if (codexAppServerTurnStatusIsProviderFailure(status)) {
        watcher.failNow(new Error(`Codex app-server turn ${status}.`));
      } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
        await watcher.completeNow(status);
      }
      conversationState.completion = waitForResult.then(async (result = {}) => {
        const current = codexAppServerConversation(sessionId, conversationId);
        if (!current || current.runId !== runId) {
          return;
        }
        nativeCompleted = true;
        if (!executionProfile) current.status = result.status || "completed";
        if (executionProfile) {
          const completingRunId = current.runId;
          await assertCodexAppServerHelperAccountIdentity(provider, admittedAccountIdentitySignature, helperOwnershipError);
          if (codexAppServerConversation(sessionId, conversationId) !== current ||
              current.runId !== completingRunId || !codexAppServerConversationTurnIsActive(current.status)) {
            throw new Error("The scoped helper turn is unavailable.");
          }
        }
        const response = projectResult(result);
        Object.assign(current, {
          error: "",
          ...response,
          status: result.status || "completed",
          watcher: null
        });
        return codexAppServerEphemeralConversationSnapshot(current);
      }).catch(async (error) => {
        const current = codexAppServerConversation(sessionId, conversationId);
        if (!current || current.runId !== runId || current.status === "interrupted") {
          throw error;
        }
        if (executionProfile && !nativeCompleted && codexAppServerConversationTurnIsActive(current.status)) {
          try {
            const interrupted = await provider.interruptTurn(conversationId, runId);
            const failure = codexAppServerInterruptFailure(interrupted, interruptFailedCode);
            if (failure) throw new Error(failure.error);
          } catch {
            current.error = "The helper deadline ended, but Stop could not be confirmed. Retry Stop before reusing this helper.";
            current.watcher = null;
            throw new Error(current.error);
          }
        }
        Object.assign(current, {
          error: codexAppServerErrorMessage(error, "Temporary AI turn failed."),
          status: "failed",
          watcher: null
        });
        throw error;
      });
      void conversationState.completion.catch(() => null);
    }
    if (input.persistent && conversationState) {
      Object.assign(conversationState, { runId, status, messageId });
      holdWhileActive(conversationState);
    }
    return { conversationId, messageId, ok: true, runId, status };
  }

  async function interruptCodexAppServerConversation(conversationState, operation) {
    const result = await operation(async ({ provider, threadId, turnId }) => {
      const result = await provider.interruptTurn(threadId, turnId);
      const interruptFailure = codexAppServerInterruptFailure(result, interruptFailedCode);
      if (interruptFailure) {
        return {
          ...interruptFailure,
          result,
          threadId,
          turnId
        };
      }
      return {
        ok: true,
        result,
        status: "interrupted",
        threadId,
        turnId
      };
    });
    if (result.ok !== false && conversationState) {
      conversationState.status = "interrupted";
      conversationState.watcher?.failNow(new Error("Temporary AI turn was stopped."));
      conversationState.watcher = null;
      holdWhileActive(conversationState);
    }
    return result;
  }

  async function deleteCodexAppServerConversation(conversation, operation) {
    const result = await operation(async ({ provider, threadId }) => {
      try {
        const result = await provider.deleteThread(threadId);
        return {
          ok: true,
          result,
          status: "deleted",
          threadId
        };
      } catch (error) {
        if (
          codexAppServerRequestIsInvalid(error, "thread/delete") &&
          !await codexAppServerThreadHasReadableHistory(provider, threadId)
        ) {
          return {
            ok: true,
            status: "notFound",
            threadId
          };
        }
        throw error;
      }
    });
    if (result.ok !== false && conversation) {
      const { conversationId, sessionKey, conversations } = conversation;
      const state = conversations?.get(conversationId);
      state?.watcher?.failNow(new Error("Temporary AI conversation was closed."));
      if (state) forgetObservation(state);
      conversations?.delete(conversationId);
      if (conversations?.size === 0) {
        codexAppServerConversations.delete(sessionKey);
      }
    }
    return result;
  }

  async function stopPersistentCodexConversation({
    conversationId,
    conversationState,
    provider,
    turnOutcome = ""
  } = {}) {
    // Set before stopping: the provider can report turn/completed while it stops.
    if (conversationState && codexAppServerConversationTurnIsActive(conversationState.status)) {
      conversationState.turnOutcome = turnOutcome;
    }
    try {
      await provider.readThreadStatus(conversationId);
      await provider.stopThreadForObservationLoss(conversationId, "");
    } catch (error) {
      if (!codexAppServerThreadIsMissing(error, conversationId) || error.message.toLowerCase().startsWith("thread not loaded:")) {
        if (conversationState) conversationState.turnOutcome = "";
        throw error;
      }
    }
    if (conversationState) {
      conversationState.status = "interrupted";
      if (conversationState.goal?.status === "active") conversationState.goal = { ...conversationState.goal, status: "paused" };
      conversationState.watcher?.failNow(new Error("Temporary AI turn was stopped."));
      conversationState.watcher = null;
      holdWhileActive(conversationState);
    }
    return { ok: true, conversationId, status: "interrupted" };
  }

  async function waitForPreparedCodexAppServerConversationTurn(sessionId, input, {
    provider,
    onEvent = null
  } = {}) {
    const conversationId = normalizeCodexRunText(input.conversationId);
    const runId = normalizeCodexRunText(input.runId);
    const watcher = createCodexAppServerDetachedTurnWatcher(provider, conversationId, {
      onEvent,
      timeoutMs: Number(input.timeoutMs || 0) > 0
        ? Number(input.timeoutMs)
        : input.persistent === true ? 0 : CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS
    });
    const conversationState = codexAppServerConversation(sessionId, conversationId);
    if (input.persistent && conversationState) conversationState.watcher = watcher;
    const waitForResult = watcher.wait();
    void waitForResult.catch(() => {});
    watcher.setTurnId(runId);
    try {
      const current = await provider.readThread(conversationId);
      const status = codexAppServerThreadStatus(current);
      if (codexAppServerTurnStatusIsProviderFailure(status)) {
        watcher.failNow(new Error(
          codexAppServerThreadError(current) || `Codex app-server turn ${status}.`
        ));
      } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
        await watcher.completeNow(status);
      }
      const result = await waitForResult;
      return {
        conversationId,
        ok: true,
        runId,
        status: result.status || status || "completed",
        rawText: result.text
      };
    } catch (error) {
      watcher.failNow(error);
      throw error;
    } finally {
      if (conversationState?.watcher === watcher) conversationState.watcher = null;
    }
  }

  return {
    codexAppServerConversations,
    codexAppServerConversationTurnStarts,
    codexAppServerConversation,
    hasActiveConversation,
    withCodexAppServerConversationTurnStart,
    observeCodexConversation,
    readPersistentCodexConversation,
    codexAppServerEphemeralConversationSnapshot,
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
    steerCodexAppServerConversationTurn,
    acquireCodexAppServerDetachedThread,
    codexAppServerDetachedThreadId,
    dispatchCodexAppServerDetachedTurn,
    runDetachedCodexAppServerTurn,
    interruptCodexAppServerConversation,
    stopPersistentCodexConversation
  };
}
