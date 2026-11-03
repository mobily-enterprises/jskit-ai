import {
  codexAppServerTurnStatusIsSuccessfulComplete,
  codexAppServerTurnStatusIsProviderFailure,
  normalizeCodexRunText,
  codexAppServerErrorMessage,
  codexAppServerSteerFailure,
  codexAppServerMessageRequiresNewTurn,
  codexAppServerMessageDeferred
} from "./codexTurnState.js";
import {
  codexAppServerRequestIsInvalid,
  codexLocalImageInput,
  codexAppServerDeliveredTurn,
  sendCodexAppServerPrompt
} from "./codexProvider.js";

function notifyNoPromptSending() {}

function notifyNoPromptRejected() {}

/**
 * Delivers one prompt to the native thread: it starts a new turn, or steers the active one. Each delivery owns its
 * user message until the native receipt arrives, and releases it when the provider refuses.
 * @param {object} dependencies
 * @param {import("./codexOutput.js").CodexAppServerOutput} dependencies.output
 * @param {import("./codexRunJournal.js").CodexRunJournal} dependencies.journal
 * @param {import("./codexTurnRecovery.js").CodexTurnRecovery} dependencies.recovery
 * @param {import("./codexThreadStatus.js").CodexThreadStatus} dependencies.threadStatus
 * @param {import("./codexMessageDelivery.js").CodexAppServerMessageDelivery} dependencies.delivery
 * @param {import("./codexTurn.js").CodexDebugError} dependencies.debugError
 * @param {import("./codexTurn.js").CodexDebugLog} dependencies.debugLog
 * @param {string} dependencies.steerFailedCode
 * @param {import("./codexTurn.js").CodexTurnStateReader} dependencies.turnState
 */
export function createCodexPromptDispatch({
  output,
  journal,
  recovery,
  threadStatus,
  delivery,
  debugError,
  debugLog,
  steerFailedCode,
  turnState
}) {
  const { splitReasoningTurn: splitCodexAppServerReasoningTurn } = output;
  const {
    markTurnIdle: markCodexAppServerTurnIdle,
    writeUserMessageOwnership: writeCodexAppServerUserMessageOwnership
  } = journal;
  const {
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure,
    completeTurn: completeCodexAppServerTurn,
    markTurnActive: markCodexAppServerTurnActive
  } = recovery;
  const { reconcileThreadStatus: reconcileCodexAppServerThreadStatus } = threadStatus;
  const {
    writeDeliveredUserMessage: writeCodexAppServerDeliveredUserMessage,
    pendingUserMessage: pendingCodexAppServerUserMessage
  } = delivery;

  async function startCodexAppServerTurn(sessionId, input = {}, context = {}) {
    const { runtime, provider, threadId, messageId, renderedPrompt, turnMetadata } = context;
    const { onPromptSending = notifyNoPromptSending, onPromptRejected = notifyNoPromptRejected } = input;
    let providerFailure = "";
    let delivery = null;
    const promptSessionId = normalizeCodexRunText(sessionId);
    const clientUserMessageId = messageId;
    await writeCodexAppServerUserMessageOwnership(runtime.store, sessionId, clientUserMessageId, {
      eventKind: "codex-app-server-user-message-owned",
      owned: true
    });
    try {
      await onPromptSending({ threadId: threadId, displayAttachments: input.displayAttachments, turnMetadata });
      const response = sendCodexAppServerPrompt({
        clientUserMessageId,
        prompt: renderedPrompt,
        attachments: input.attachments,
        provider,
        threadId
      }, context);
      const receipt = pendingCodexAppServerUserMessage(promptSessionId, clientUserMessageId)?.receipt;
      // An exact, persisted user-message receipt confirms delivery too.
      // Finish bookkeeping once; a late RPC reply must not hold admission
      // or change a turn that has already continued or completed.
      delivery = receipt
        ? await Promise.race([response, receipt.promise.then((turn) => ({ turn }))])
        : await response;
    } catch (error) {
      if (Number.isInteger(error?.code) && error.code < 0) await onPromptRejected();
      await writeCodexAppServerUserMessageOwnership(runtime.store, sessionId, clientUserMessageId, {
        eventKind: "codex-app-server-user-message-released",
        owned: false
      });
      await markCodexAppServerTurnIdle(sessionId, {
        error: codexAppServerErrorMessage(error, "Codex app-server prompt delivery failed."),
        status: "failed",
        threadId: threadId
      });
      return { error, turnFailureHandled: true };
    }
    const { turnId: deliveredTurnId, status: deliveredTurnStatus } = codexAppServerDeliveredTurn(delivery);
    if (!deliveredTurnId) {
      throw new Error("Codex app-server accepted the prompt without returning a turn id.");
    }
    pendingCodexAppServerUserMessage(promptSessionId, clientUserMessageId)?.onNativeReceipt();
    await markCodexAppServerTurnActive(sessionId, {
      requireTrackedTurn: true,
      status: "inProgress",
      threadId: threadId,
      turnId: deliveredTurnId
    });
    if (codexAppServerTurnStatusIsProviderFailure(deliveredTurnStatus)) {
      providerFailure = `Codex turn ${deliveredTurnStatus}.`;
      await stopCodexAppServerTurnWithProviderFailure(sessionId, threadId, deliveredTurnId, {
        provider,
        status: deliveredTurnStatus
      });
    } else if (codexAppServerTurnStatusIsSuccessfulComplete(deliveredTurnStatus)) {
      const completion = await completeCodexAppServerTurn(sessionId, threadId, deliveredTurnId, {
        provider,
        status: deliveredTurnStatus
      });
      if (completion?.ok === false) {
        providerFailure = normalizeCodexRunText(completion.error) || "Codex completed, but its response could not be processed.";
      }
    }
    return { delivery, deliveredTurnId, providerFailure };
  }

  async function steerCodexAppServerTurn(sessionId, input = {}, context = {}) {
    const { runtime, provider, threadId, turnId, message, displayMessage, messageId, clientUserMessageId, turnMetadata } = context;
    const { onPromptSending = notifyNoPromptSending, onPromptRejected = notifyNoPromptRejected } = input;
    let currentSession;
    await writeCodexAppServerUserMessageOwnership(runtime.store, sessionId, clientUserMessageId, {
      eventKind: "codex-app-server-user-message-owned",
      owned: true
    });
    debugLog("appServerMessage.activeTurn.start", {
      messageId,
      sessionId,
      threadId,
      turnId
    });
    async function recoverAfterSteerFailure(error = null) {
      await writeCodexAppServerUserMessageOwnership(runtime.store, sessionId, clientUserMessageId, {
        eventKind: "codex-app-server-user-message-released",
        owned: false
      });
      await reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
        source: "message_delivery_steer_race"
      }).catch(() => null);
      currentSession = await runtime.getSession(sessionId);
      const currentTurn = turnState(currentSession);
      const sameTurnIsActive = currentTurn.active === true &&
        normalizeCodexRunText(currentTurn.threadId) === threadId &&
        normalizeCodexRunText(currentTurn.turnId) === turnId &&
        currentTurn.state !== "finalizing";
      if (sameTurnIsActive) {
        return codexAppServerRequestIsInvalid(error, "turn/steer")
          ? { value: codexAppServerMessageDeferred({ threadId, turnId }, steerFailedCode), session: currentSession }
          : null;
      }
      debugLog("appServerMessage.newTurn", {
        error: debugError(error),
        messageId,
        reason: "active_turn_completed_before_delivery",
        sessionId,
        threadId,
        turnId
      });
      return { value: codexAppServerMessageRequiresNewTurn({
        reason: "active_turn_completed_before_delivery",
        threadId,
        turnId
      }), session: currentSession };
    }
    let result;
    try {
      await onPromptSending({ threadId, displayAttachments: input.displayAttachments, turnMetadata });
      const response = provider.steerTurn(
        threadId,
        turnId,
        context.preparedInput === undefined
          ? input.attachments?.some((attachment) => attachment.contentType?.startsWith("image/"))
            ? [message, ...codexLocalImageInput(input.attachments)]
            : message
          : context.preparedInput,
        {
          clientUserMessageId
        }
      );
      const receipt = pendingCodexAppServerUserMessage(sessionId, clientUserMessageId)?.receipt;
      result = receipt ? await Promise.race([response, receipt.promise]) : await response;
    } catch (error) {
      if (Number.isInteger(error?.code) && error.code < 0) await onPromptRejected();
      const recovered = await recoverAfterSteerFailure(error);
      if (recovered) {
        return recovered;
      }
      debugLog("appServerMessage.activeTurn.error", {
        error: debugError(error),
        messageId,
        sessionId,
        threadId,
        turnId
      });
      throw error;
    }
    const steerFailure = codexAppServerSteerFailure(result, steerFailedCode);
    if (steerFailure) {
      const recovered = await recoverAfterSteerFailure(result);
      if (recovered) {
        return recovered;
      }
      debugLog("appServerMessage.activeTurn.failed", {
        error: steerFailure.error,
        messageId,
        operationOutcome: steerFailure.operationOutcome,
        sessionId,
        threadId,
        turnId
      });
      return { value: {
        ...steerFailure,
        result,
        threadId,
        turnId
      } };
    }
    pendingCodexAppServerUserMessage(sessionId, clientUserMessageId)?.onNativeReceipt();
    const conversationTurn = await writeCodexAppServerDeliveredUserMessage(
      runtime,
      sessionId,
      displayMessage || message,
      messageId,
      turnMetadata,
      input.displayAttachments,
      { threadId, turnId }
    );
    splitCodexAppServerReasoningTurn(threadId, turnId);
    currentSession = await runtime.getSession(sessionId);
    debugLog("appServerMessage.activeTurn.done", {
      conversationTurnId: normalizeCodexRunText(conversationTurn?.turnId || conversationTurn?.id),
      messageId,
      sessionId,
      threadId,
      turnId
    });
    return { value: {
      conversationTurn,
      conversationTurns: [conversationTurn],
      delivered: true,
      deliveryMode: "active_turn",
      newTurnRequired: false,
      ok: true,
      operationOutcome: "delivered_to_active_turn",
      result,
      threadId,
      turnId
    }, session: currentSession };
  }

  return Object.freeze({
    startTurn: startCodexAppServerTurn,
    steerTurn: steerCodexAppServerTurn
  });
}

/** @typedef {ReturnType<typeof createCodexPromptDispatch>} CodexPromptDispatch */
