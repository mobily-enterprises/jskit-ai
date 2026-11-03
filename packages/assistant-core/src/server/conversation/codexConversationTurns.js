import { codexAppServerTurnStatusIsSuccessfulComplete, codexAppServerTurnStatusIsProviderFailure, codexAppServerThreadStatus, codexAppServerErrorMessage, codexAppServerSteerFailure, codexAppServerInterruptFailure, codexAppServerConversationTurnIsActive } from "./codexTurnState.js";
import { CODEX_APP_SERVER_DETACHED_TURN_TIMEOUT_MS, createCodexAppServerDetachedTurnWatcher } from "./codexDetachedTurn.js";
import { assertCodexAppServerHelperAccountIdentity, readCodexAppServerAccountIdentity, sendPreparedCodexAppServerHelperTurn } from "./codexHelperExecution.js";
import { codexAppServerProjectHookTrustConfig } from "./codexConfiguration.js";
import { codexAppServerThreadError } from "./codexThreadSnapshot.js";
import { codexAppServerDeliveredTurn, codexLocalImageInput, sendCodexAppServerPrompt } from "./codexProviderTurns.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** A conversation turn's listener when the application supplies none. */
export function ignoreCodexConversationEvent() {}

function notifyNoConversationPromptSending() {}

// What a read reports for a conversation this server tracks without a persistent native history.
export function codexAppServerEphemeralConversationSnapshot(state = {}) {
  return {
    conversationId: normalizeText(state.conversationId),
    error: normalizeText(state.error),
    message: normalizeText(state.message),
    ok: true,
    outcome: state.outcome || null,
    progressUpdates: Array.isArray(state.progressUpdates)
      ? state.progressUpdates.map((update = {}) => ({
          id: normalizeText(update.id),
          text: normalizeText(update.text)
        })).filter((update) => update.id && update.text)
      : [],
    rawText: normalizeText(state.rawText),
    messageId: normalizeText(state.messageId),
    runId: normalizeText(state.runId),
    status: normalizeText(state.status) || "ready",
    turnMetadata: state.turnMetadata || null
  };
}

// Thread settings for a conversation: a Helper's come from its isolation inspection, others from the
// application's settings with the project's hook trust when it asks for them.
export async function prepareCodexAppServerConversationThread(provider, preparation, helperIsolation) {
  if (preparation.inspection) {
    const enforcement = await helperIsolation.inspect(provider, preparation.inspection);
    return preparation.prepared(enforcement);
  }
  const config = preparation.projectHooks
    ? await codexAppServerProjectHookTrustConfig(provider, preparation.workdir)
    : null;
  return preparation.settings(config);
}

/**
 * Creating, starting, steering and waiting for turns on prepared native conversation threads. The conversation
 * registry and its observation belong to the conversation commands, which pass them in.
 * @param {object} dependencies
 * @param {import("./codexConversations.js").CodexConversationRegistry} dependencies.codexAppServerConversations
 * @param {import("./codexConversations.js").CodexConversationLookup} dependencies.codexAppServerConversation
 * @param {import("./codexConversations.js").CodexConversationObserver} dependencies.observeCodexConversation
 * @param {import("./codexConversations.js").CodexConversationStateUpdate} dependencies.holdWhileActive
 * @param {import("./codexTurn.js").CodexSessionNamespace} dependencies.namespace
 * @param {string} dependencies.errorPrefix
 * @param {string} dependencies.helperOwnershipError
 * @param {string} dependencies.steerFailedCode
 * @param {string} dependencies.interruptFailedCode
 */
export function createCodexConversationTurns({
  codexAppServerConversations,
  codexAppServerConversation,
  observeCodexConversation,
  holdWhileActive,
  namespace,
  errorPrefix,
  helperOwnershipError,
  steerFailedCode,
  interruptFailedCode
}) {
  async function createPreparedCodexAppServerConversation(sessionId, input, {
    provider,
    executionProfile,
    helperIsolation,
    threadPreparation
  }) {
    const prepareThread = () => prepareCodexAppServerConversationThread(provider, threadPreparation(), helperIsolation);
    const thread = executionProfile
      ? (await helperIsolation.start(provider, prepareThread)).thread
      : await provider.startThread({
          ...await prepareThread(),
          ...(input.ephemeral === true ? { ephemeral: true } : {})
        });
    const conversationId = normalizeText(thread.id || thread.response?.thread?.id);
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
  }) {
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
  }) {
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
          onEvent(classification, current);
        }
      });
      waitForResult = watcher.wait();
      void waitForResult.catch(() => null);
      conversationState.watcher = watcher;
    }
    let delivery = null;
    if (input.persistent && conversationState) Object.assign(conversationState, { onEvent, turnOutcome: "" });
    try {
      const { onPromptSending = notifyNoConversationPromptSending } = input;
      await onPromptSending({ threadId: conversationId });
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
      if (input.persistent && conversationState) conversationState.onEvent = ignoreCodexConversationEvent;
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

  async function waitForPreparedCodexAppServerConversationTurn(sessionId, input, {
    provider,
    onEvent
  }) {
    const conversationId = normalizeText(input.conversationId);
    const runId = normalizeText(input.runId);
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

  return Object.freeze({
    createPreparedCodexAppServerConversation,
    startPreparedCodexAppServerConversationTurn,
    waitForPreparedCodexAppServerConversationTurn
  });
}

/** @typedef {ReturnType<typeof createCodexConversationTurns>} CodexConversationTurns */
