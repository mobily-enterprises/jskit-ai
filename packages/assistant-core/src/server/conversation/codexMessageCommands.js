import {
  codexAppServerTurnStatusIsSuccessfulComplete,
  codexAppServerTurnStatusIsProviderFailure,
  normalizeCodexRunText,
  codexAppServerErrorMessage,
  codexAppServerSteerFailure,
  codexAppServerMessageRequiresNewTurn,
  codexAppServerMessageDeferred,
  codexAppServerMessageText,
  codexAppServerMessageDisplayText,
  codexPromptInputFromRequest
} from "./codexTurnState.js";
import {
  codexAppServerRequestIsInvalid,
  codexAppServerThreadIsMissing,
  codexLocalImageInput,
  ensureCodexAppServerThread,
  sendCodexAppServerPrompt
} from "./codexProvider.js";
import crypto from "node:crypto";
import { isPlainObject } from "./normalize.js";

// Original Main message admission, preparation, dispatch and steering.
// Prompt delivery and receipt state remain the same run-owner references.
export function createCodexMessageCommands({
  output,
  journal,
  recovery,
  threadStatus,
  selection,
  observer,
  delivery,
  promptDeliveries: codexAppServerPromptDeliveries,
  createRuntime,
  debugError,
  debugLog,
  errorPrefix,
  messageIdPrefix,
  messageMetadata,
  namespace,
  providerSessions,
  recoverAdmission,
  steerFailedCode,
  turnAlreadyRunningError,
  turnState
}) {
  const {
    submitAssistantResult: submitCodexAppServerAssistantResult,
    splitReasoningTurn: splitCodexAppServerReasoningTurn
  } = output;
  const {
    recoverAbandonedPromptClaim: recoverAbandonedCodexAppServerPromptClaim,
    claimMessageStart: claimCodexAppServerMessageStart,
    markTurnIdle: markCodexAppServerTurnIdle,
    writeUserMessageOwnership: writeCodexAppServerUserMessageOwnership
  } = journal;
  const {
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure,
    completeTurn: completeCodexAppServerTurn,
    markTurnActive: markCodexAppServerTurnActive
  } = recovery;
  const {
    reconcileThreadStatus: reconcileCodexAppServerThreadStatus
  } = threadStatus;
  const {
    codexAppServerMessageContext,
    codexAppServerSessionObserverOptions,
    rememberCodexAppServerPreparedThread
  } = selection;
  const {
    subscribeEvents: subscribeCodexAppServerEvents
  } = observer;
  const {
    writeDeliveredUserMessage: writeCodexAppServerDeliveredUserMessage,
    pendingUserMessages: codexAppServerPendingUserMessages
  } = delivery;

  async function selectCodexAppServerMessageTurn(sessionId, { messageId = "", startedAt = Date.now() } = {}, context = {}) {
    if (providerSessions) context = codexAppServerMessageContext(sessionId, context);
    const { runtime, session } = context;
    let currentSession = session;
    let turn = turnState(currentSession);
    if (
      turn.state === "starting" &&
      !turn.turnId &&
      !codexAppServerPromptDeliveries.has(namespace(sessionId))
    ) {
      const abandonedClaim = await (recoverAdmission || recoverAbandonedCodexAppServerPromptClaim)(
        runtime,
        currentSession,
        { promptDeliveryActive: false }
      );
      currentSession = abandonedClaim.session;
      turn = turnState(currentSession);
    }
    if (turn.status === "observation_lost") {
      if (turn.active) {
        throw Object.assign(new Error("Codex observation was lost and a stop is not yet verified. Retry after the service has stopped."), {
          code: `${errorPrefix}codex_observation_lost`
        });
      }
      const recovered = await submitCodexAppServerAssistantResult(sessionId, turn.threadId, turn.turnId, { recoverFromProvider: true });
      if (recovered.reason === "error") throw new Error(recovered.error);
      return { value: codexAppServerMessageRequiresNewTurn({ reason: "observation_lost", threadId: turn.threadId, turnId: turn.turnId }), session: currentSession };
    }
    const threadId = normalizeCodexRunText(turn.threadId) || context.threadId(currentSession);
    if (!threadId) {
      debugLog("appServerMessage.newTurn", {
        messageId,
        reason: "thread_missing",
        sessionId,
        threadId: "",
        turnId: ""
      });
      return { value: codexAppServerMessageRequiresNewTurn({
        reason: "thread_missing"
      }), session: currentSession };
    }
    const acquired = await context.acquireProvider(currentSession);
    const provider = acquired.provider;
    if (acquired.reused) {
      debugLog("appServerMessage.providerReused", {
        messageId,
        sessionId,
        threadId,
        turnId: normalizeCodexRunText(turn.turnId)
      });
    }
    const providerReadyAt = Date.now();
    debugLog("appServerMessage.providerReady", {
      durationMs: providerReadyAt - startedAt,
      messageId,
      sessionId
    });
    try {
      await reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
        source: "message_delivery"
      });
    } catch (error) {
      if (turn.active || !codexAppServerThreadIsMissing(error, threadId)) {
        throw error;
      }
      debugLog("appServerMessage.newTurn", {
        error: debugError(error),
        messageId,
        reason: "provider_thread_missing",
        sessionId,
        threadId,
        turnId: normalizeCodexRunText(turn.turnId)
      });
      return { value: codexAppServerMessageRequiresNewTurn({
        reason: "provider_thread_missing",
        threadId,
        turnId: normalizeCodexRunText(turn.turnId)
      }), session: currentSession };
    }
    debugLog("appServerMessage.reconciled", {
      durationMs: Date.now() - providerReadyAt,
      messageId,
      sessionId
    });
    currentSession = await runtime.getSession(sessionId);
    turn = turnState(currentSession);
    const turnId = normalizeCodexRunText(turn.turnId);
    const goalAwaitingTurn = !turn.active && turn.goalStatus === "active" && turn.goalThreadId === threadId;
    if (!turn.active && !goalAwaitingTurn) {
      debugLog("appServerMessage.newTurn", {
        messageId,
        reason: "provider_idle",
        sessionId,
        threadId,
        turnId
      });
      return { value: codexAppServerMessageRequiresNewTurn({
        reason: "provider_idle",
        threadId,
        turnId
      }), session: currentSession };
    }
    if (goalAwaitingTurn || !turnId || turn.state === "finalizing") {
      return { value: {
        code: steerFailedCode,
        delivered: false,
        error: "The active assistant turn is not ready to accept this message yet.",
        ok: false,
        operationOutcome: "active_turn_not_ready",
        refreshRecommended: true,
        retryable: true,
        threadId,
        turnId
      }, session: currentSession };
    }
    return { session: currentSession, provider, threadId, turnId };
  }

  async function prepareCodexAppServerMessageThread(sessionId, input, prepared, preparation) {
    const facility = preparation.threadPreparation(input, prepared);
    const { messageId, startedAt, workdir } = prepared;
    const operation = async currentSession => {
      const source = await facility.provider(currentSession);
      const connection = source.provider ? null : providerSessions.context(
        normalizeCodexRunText(sessionId), source.providerOptions
      );
      const providerAlreadyAvailable = source.provider
        ? source.providerAlreadyAvailable
        : providerSessions.owner.providers.get(connection.providerKey)?.isAvailable?.() === true;
      if (!providerAlreadyAvailable && facility.running) await facility.running();
      let stageStartedAt = Date.now();
      const provider = source.provider || await providerSessions.owner.ensureSession(connection, source.mainThreadId);
      debugLog("appServerPrompt.stage", {
        durationMs: Date.now() - stageStartedAt, messageId, sessionId, stage: "provider"
      });
      stageStartedAt = Date.now();
      const observerOptions = source.observerOptions || codexAppServerSessionObserverOptions(sessionId, source.providerOptions);
      const thread = await ensureCodexAppServerThread({
        ...(source.preparation || facility.preparation(currentSession)),
        ...(preparation.applicationTools ? { applicationTools: preparation.applicationTools, providerReady: preparation.providerReady } : {}),
        observeThread: threadId => subscribeCodexAppServerEvents(sessionId, provider, threadId, observerOptions),
        provider,
        workdir: source.workdir ?? workdir
      });
      if (source.requirePaginatedHistory && thread.thread.raw?.historyMode !== "paginated") {
        throw new Error("Codex did not create the required paginated history. Update Codex before starting this conversation.");
      }
      debugLog("appServerPrompt.stage", {
        durationMs: Date.now() - stageStartedAt, messageId, sessionId, stage: "thread"
      });
      return { currentSession, provider, providerAlreadyAvailable, providerOptions: source.providerOptions,
        thread, observerOptions, connection, ...(source.settings ? { settings: source.settings } : {}) };
    };
    try {
      // Send's provider acquisition stays inside the application startup gate.
      const threadPreparation = facility.gate
        ? await facility.gate(operation)
        : await operation(prepared.session);
      const { currentSession: preparedSession, provider, providerAlreadyAvailable, providerOptions,
        thread, observerOptions, connection, ...settings } = threadPreparation;
      debugLog("appServerPrompt.stage", {
        durationMs: Date.now() - startedAt, messageId, sessionId, stage: "startup-ready"
      });
      if (!Object.hasOwn(facility, "failureThreadId")) prepared.activeThreadId = thread.threadId;
      subscribeCodexAppServerEvents(sessionId, provider, thread.threadId, observerOptions);
      if (connection) rememberCodexAppServerPreparedThread(sessionId, providerOptions, prepared, thread);
      if (facility.ready) await facility.ready();
      return { preparedSession, provider, providerAlreadyAvailable, providerOptions, thread, ...settings };
    } finally {
      // Standalone preparation historically retained the exact binding on
      // failure as well as success; Main records it after the startup gate.
      if (Object.hasOwn(facility, "failureThreadId")) prepared.activeThreadId = facility.failureThreadId;
    }
  }

  async function startCodexAppServerMessage(sessionId, input = {}, options = {}, prepare) {
    const startedAt = Date.now();
    const agentSettings = isPlainObject(options.agentSettings)
      ? options.agentSettings
      : isPlainObject(input.agentSettings) ? input.agentSettings : {};
    const actorContext = options.actorContext || null;
    const messageId = normalizeCodexRunText(input.messageId) ||
      `${messageIdPrefix}${crypto.randomUUID()}`;
    const userRequest = codexPromptInputFromRequest(input);
    if (!userRequest && options.preparedInput === undefined) {
      return { value: {
        ok: false,
        error: "Codex message is empty."
      } };
    }

    const context = await prepare.readContext(options);
    if (context.ok === false) {
      return { value: context };
    }
    const { runtime } = context;
    const turnMetadata = { ...input.turnMetadata, ...await messageMetadata.actor?.(actorContext) };
    debugLog("appServerPrompt.start", {
      durationMs: Date.now() - startedAt,
      messageId,
      sessionId
    });

    const claim = await claimCodexAppServerMessageStart(runtime, sessionId, messageId);
    if (!claim?.claimed) {
      debugLog("appServerPrompt.claimObserved", {
        code: String(claim?.response?.value?.code || ""),
        messageId,
        operationOutcome: String(claim?.response?.value?.operationOutcome || ""),
        sessionId
      });
      return claim?.response || { value: {
        ok: false,
        error: turnAlreadyRunningError
      } };
    }

    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const promptDeliveryKey = namespace(normalizedSessionId);
    codexAppServerPromptDeliveries.add(promptDeliveryKey);
    const prepared = {
      ...context, agentSettings, actorContext, messageId, userRequest, startedAt,
      activeThreadId: ""
    };
    let providerFailure = "";
    let turnFailureHandled = false;
    try {
      Object.assign(prepared, await prepareCodexAppServerMessageThread(sessionId, input, prepared, prepare));
      const { provider, providerAlreadyAvailable, thread } = prepared;
      await markCodexAppServerTurnActive(sessionId, {
        status: "starting",
        threadId: thread.threadId
      });
      const prompt = await prepare.prepareMessage(input, prepared, { starting: true });
      const started = await startCodexAppServerTurn(sessionId, input, {
        runtime, provider, threadId: thread.threadId, promptDeliveryKey, messageId, renderedPrompt: prompt.renderedPrompt, turnMetadata,
        preparedInput: options.preparedInput,
        get turnSettings() { return prompt.turnSettings; }
      });
      if (started.turnFailureHandled) {
        turnFailureHandled = true;
        throw started.error;
      }
      const { delivery, deliveredTurnId } = started;
      providerFailure = started.providerFailure;
      await prepare.finishMessage(input, prepared, { delivery });
      const currentSession = await runtime.getSession(sessionId);
      debugLog("appServerPrompt.delivered", {
        messageId,
        sessionId,
        threadId: thread.threadId,
        turnId: deliveredTurnId
      });
      return { value: {
        ...(providerFailure ? { error: providerFailure } : {}),
        ok: !providerFailure,
        connectionReused: providerAlreadyAvailable,
        turnMetadata,
        turnId: delivery.turn?.id || ""
      }, session: currentSession, nativeIdentity: { threadId: thread.threadId, turnId: deliveredTurnId } };
    } catch (error) {
      if (!turnFailureHandled) {
        await markCodexAppServerTurnIdle(sessionId, {
          error: codexAppServerErrorMessage(error, "Codex app-server prompt delivery failed."),
          status: "failed",
          threadId: prepared.activeThreadId
        }).catch(() => null);
      }
      return await prepare.finishMessage(input, prepared, { error });
    } finally {
      codexAppServerPromptDeliveries.delete(promptDeliveryKey);
    }
  }

  async function sendCodexAppServerMessage(sessionId, input = {}, options = {}, prepare) {
    const startedAt = Date.now();
    const turnOwnership = options.turnOwnership || null;
    const message = codexAppServerMessageText(input);
    const displayMessage = codexAppServerMessageDisplayText(input, message);
    const messageId = normalizeCodexRunText(input?.messageId);
    if (!message && options.preparedInput === undefined) {
      return { value: {
        code: steerFailedCode,
        error: "Codex message input is empty.",
        ok: false,
        operationOutcome: "message_empty",
        refreshRecommended: false
      } };
    }
    const context = await prepare.readContext(options);
    if (context.ok === false) {
      return { value: context };
    }
    const { runtime, session } = context;
    if (
      messageId &&
      typeof runtime.store.conversationMessageIdExists === "function" &&
      await runtime.store.conversationMessageIdExists(sessionId, messageId)
    ) {
      return { value: {
        delivered: true,
        duplicate: true,
        ok: true,
        operationOutcome: "message_already_delivered"
      }, session };
    }
    const actorContext = options.actorContext || null;
    const turnMetadata = { ...input.turnMetadata, ...await messageMetadata.actor?.(actorContext) };
    debugLog("appServerMessage.contextReady", {
      durationMs: Date.now() - startedAt,
      messageId,
      sessionId
    });
    const selected = await selectCodexAppServerMessageTurn(sessionId, { messageId, startedAt }, context.selection);
    if (Object.hasOwn(selected, "value")) return selected;
    const { provider, threadId, turnId } = selected;
    if (prepare.providerReady) await prepare.providerReady({ provider, threadId });
    const prepared = { ...context, turnOwnership, messageId, actorContext };
    const policy = await prepare.prepareMessage(input, prepared, { starting: false, selected });
    if (policy) return policy;
    const clientUserMessageId = messageId || `${messageIdPrefix}${crypto.randomUUID()}`;
    return steerCodexAppServerTurn(sessionId, input, {
      runtime, provider, threadId, turnId, message, displayMessage, messageId, clientUserMessageId, turnMetadata,
      preparedInput: options.preparedInput
    });
  }

  async function dispatchCodexAppServerMessage(sessionId, input = {}, options = {}, prepare) {
    const result = await sendCodexAppServerMessage(sessionId, input, options, prepare);
    if (result.value?.newTurnRequired !== true) {
      return result;
    }
    const message = codexAppServerMessageText(input);
    const messageId = normalizeCodexRunText(input?.messageId) ||
      `${messageIdPrefix}${crypto.randomUUID()}`;
    const started = await startCodexAppServerMessage(sessionId, isPlainObject(input) ? {
      ...input,
      message,
      messageId
    } : {
      message,
      messageId
    }, {
      agentSettings: input?.agentSettings || {},
      runtime: options.runtime || null,
      session: options.session || null,
      actorContext: options.actorContext || null,
      preparedInput: options.preparedInput
    }, prepare);
    // The original unavailable-worktree return starts its policy operation,
    // releases the prompt marker in finally, then awaits the returned value.
    started.value = await started.value;
    if (started.value?.ok === false || started.value?.delivered === false) {
      return started;
    }
    const runtime = await createRuntime(sessionId);
    const displayMessage = codexAppServerMessageDisplayText(input, message);
    const conversationTurn = await writeCodexAppServerDeliveredUserMessage(
      runtime,
      sessionId,
      displayMessage || message,
      messageId,
      started.value.turnMetadata || null,
      input?.displayAttachments,
      started.nativeIdentity
    );
    return {
      ...started,
      value: {
        ...started.value,
        conversationTurn,
        conversationTurns: [conversationTurn],
        delivered: true,
        deliveryMode: "new_turn",
        newTurnRequired: false
      }
    };
  }

  async function startCodexAppServerTurn(sessionId, input = {}, context = {}) {
    const { runtime, provider, threadId, promptDeliveryKey, messageId, renderedPrompt, turnMetadata } = context;
    let providerFailure = "";
    let delivery = null;
    const clientUserMessageId = messageId;
    await writeCodexAppServerUserMessageOwnership(runtime.store, sessionId, clientUserMessageId, {
      eventKind: "codex-app-server-user-message-owned",
      owned: true
    });
    try {
      await input.onPromptSending?.({ threadId: threadId, displayAttachments: input.displayAttachments, turnMetadata });
      const response = sendCodexAppServerPrompt({
        clientUserMessageId,
        prompt: renderedPrompt,
        attachments: input.attachments,
        provider,
        threadId
      }, context);
      const receipt = codexAppServerPendingUserMessages.get(
        `${promptDeliveryKey}\0${clientUserMessageId}`
      )?.receipt;
      // An exact, persisted user-message receipt confirms delivery too.
      // Finish bookkeeping once; a late RPC reply must not hold admission
      // or change a turn that has already continued or completed.
      delivery = receipt
        ? await Promise.race([response, receipt.promise.then((turn) => ({ turn }))])
        : await response;
    } catch (error) {
      if (Number.isInteger(error?.code) && error.code < 0) await input.onPromptRejected?.();
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
    const deliveredTurnId = normalizeCodexRunText(delivery.turn?.id);
    const deliveredTurnStatus = normalizeCodexRunText(delivery.turn?.status || delivery.turn?.raw?.status);
    if (!deliveredTurnId) {
      throw new Error("Codex app-server accepted the prompt without returning a turn id.");
    }
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
      await input.onPromptSending?.({ threadId, displayAttachments: input.displayAttachments, turnMetadata });
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
      const receipt = codexAppServerPendingUserMessages.get(
        `${namespace(sessionId)}\0${clientUserMessageId}`
      )?.receipt;
      result = receipt ? await Promise.race([response, receipt.promise]) : await response;
    } catch (error) {
      if (Number.isInteger(error?.code) && error.code < 0) await input.onPromptRejected?.();
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
    const conversationTurn = await writeCodexAppServerDeliveredUserMessage(
      runtime,
      sessionId,
      displayMessage || message,
      messageId,
      turnMetadata,
      input?.displayAttachments,
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

  return {
    selectMessageTurn: selectCodexAppServerMessageTurn,
    dispatchMessage: dispatchCodexAppServerMessage,
    startTurn: startCodexAppServerTurn,
    steerTurn: steerCodexAppServerTurn
  };
}
