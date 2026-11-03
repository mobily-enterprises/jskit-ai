import { codexAppServerErrorMessage, codexAppServerInterruptFailure, codexAppServerConversationTurnIsActive } from "./codexTurnState.js";
import { codexAppServerRequestIsInvalid, codexAppServerThreadHasReadableHistory, codexAppServerThreadIsMissing } from "./codexProviderThreads.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * Stopping, interrupting, deleting and closing native conversations. The conversation registry, its observation
 * and context acquisition belong to the conversation commands, which pass them in.
 * @param {object} dependencies
 * @param {import("./codexConversations.js").CodexConversationRegistry} dependencies.codexAppServerConversations
 * @param {import("./codexConversations.js").CodexConversationLookup} dependencies.codexAppServerConversation
 * @param {import("./codexConversations.js").CodexConversationContextReader} dependencies.codexAppServerConversationContext
 * @param {import("./codexConversations.js").CodexConversationResult} dependencies.codexAppServerConversationResult
 * @param {import("./codexConversations.js").CodexProviderBorrow} dependencies.withProviderBorrow
 * @param {import("./codexConversations.js").CodexConversationStateUpdate} dependencies.forgetObservation
 * @param {import("./codexConversations.js").CodexConversationStateUpdate} dependencies.holdWhileActive
 * @param {object} dependencies.conversationPreparation The application's conversation preparation.
 * @param {import("./codexHelperThreads.js").CodexHelperThreadLifecycle} dependencies.helperLifecycle
 * @param {import("./codexTurn.js").CodexProviderSessions} dependencies.providerSessions
 * @param {import("./codexTurn.js").CodexSessionNamespace} dependencies.namespace
 * @param {string} dependencies.errorPrefix
 * @param {string} dependencies.interruptFailedCode
 * @param {import("./codexTurn.js").CodexTurnOutcomes} dependencies.turnOutcomes
 */
export function createCodexConversationStops({
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
}) {
  // A conversation whose provider lost its observation stops through that failure.
  async function stopThroughObservationFailure(state) {
    await state.provider.failObservation(state.provider.observationFailure);
    if (codexAppServerConversationTurnIsActive(state.status)) {
      throw new Error("Codex's stop is not yet confirmed.");
    }
  }

  async function stopCodexAppServerConversation(sessionId, input = {}, options = {}, {
    turnOutcome = turnOutcomes.USER_CANCELLED
  } = {}) {
    const conversationId = normalizeText(input.conversationId);
    const conversationState = codexAppServerConversation(sessionId, conversationId);
    if (conversationState?.provider.observationFailure) {
      await stopThroughObservationFailure(conversationState);
      return { conversationId, ok: true, runId: conversationState.runId, status: "interrupted" };
    }
    if (input.ephemeral === true && !conversationState) {
      return {
        conversationExpired: true,
        conversationId,
        ok: true,
        runId: normalizeText(input.runId),
        status: "interrupted"
      };
    }
    if (input.persistent) {
      return withProviderBorrow(true, async (borrow) => {
        const context = await codexAppServerConversationContext(sessionId, input, options, borrow);
        if (context.ok === false) return context;
        return stopPersistentCodexConversation({
          conversationId,
          conversationState,
          provider: context.provider,
          turnOutcome
        });
      });
    }
    const result = await interruptDetachedCodexAppServerConversationTurn(sessionId, {
      agentSettings: input.agentSettings,
      threadId: input.conversationId,
      turnId: input.runId
    }, options, conversationState);
    return {
      ...result,
      conversationId,
      runId: normalizeText(input.runId)
    };
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

  async function interruptDetachedCodexAppServerConversationTurn(sessionId, input = {}, options = {}, conversationState = null) {
    return interruptCodexAppServerConversation(conversationState, dispatch =>
      codexAppServerConversationControl(sessionId, input, options, "interrupt", dispatch));
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

  async function deleteScopedCodexAppServerConversation(sessionId, input = {}, options = {}) {
    const conversationId = normalizeText(input.conversationId);
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

  async function deleteDetachedCodexAppServerConversationThread(sessionId, input = {}, options = {}, conversation = null) {
    return deleteCodexAppServerConversation(conversation, dispatch =>
      codexAppServerConversationControl(sessionId, input, options, "delete", dispatch));
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
      const borrow = { release() {} };
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
        const policyResult = helperLifecycle.inspectControl(operation, input, {
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
          // readable-check: allow method-probe - optional operation: thread deletion is the one control a provider may lack, answered by its catalogued unavailable result
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
        failed.push({ code: normalizeText(error?.code), error: codexAppServerErrorMessage(error),
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

  // Close stops each persistent conversation through the provider that observes
  // it. A closing session refuses a rebuilt context, and a new connection could
  // not see the running turn anyway. One conversation's failure does not skip
  // the others; it stays registered so that a retried close stops it.
  async function stopObservedCodexConversation(state) {
    const { provider } = state;
    if (provider.observationFailure) {
      await stopThroughObservationFailure(state);
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
      error.details = { failed, sessionId: normalizeText(sessionId) };
      throw error;
    }
  }

  return Object.freeze({
    stopCodexAppServerConversation,
    stopPersistentCodexConversation,
    interruptDetachedCodexAppServerConversationTurn,
    deleteScopedCodexAppServerConversation,
    deleteDetachedCodexAppServerConversationThread,
    closeCodexAppServerConversations
  });
}

/** @typedef {ReturnType<typeof createCodexConversationStops>} CodexConversationStops */
