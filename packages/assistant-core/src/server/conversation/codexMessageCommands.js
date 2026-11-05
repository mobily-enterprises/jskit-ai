import { codexAppServerErrorMessage, codexAppServerMessageRequiresNewTurn, codexAppServerMessageText, codexAppServerMessageDisplayText, codexPromptInputFromRequest } from "./codexTurnState.js";
import {
  codexAppServerThreadIsMissing,
  ensureCodexAppServerThread
} from "./codexProviderThreads.js";
import crypto from "node:crypto";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * Main message admission, preparation and dispatch. Prompt delivery and receipt state remain the same run-owner
 * references.
 * @param {object} dependencies
 * @param {import("./codexOutput.js").CodexAppServerOutput} dependencies.output
 * @param {import("./codexRunJournal.js").CodexRunJournal} dependencies.journal
 * @param {import("./codexTurnRecovery.js").CodexTurnRecovery} dependencies.recovery
 * @param {import("./codexThreadStatus.js").CodexThreadStatus} dependencies.threadStatus
 * @param {import("./codexProviderSelection.js").CodexProviderSelection} dependencies.selection
 * @param {import("./codexNotificationObserver.js").CodexNotificationObserver} dependencies.observer
 * @param {import("./codexMessageDelivery.js").CodexAppServerMessageDelivery} dependencies.delivery
 * @param {import("./codexPromptDispatch.js").CodexPromptDispatch} dependencies.promptDispatch
 * @param {Set<string>} dependencies.promptDeliveries
 * @param {import("./codexTurn.js").CodexCreateRuntime} dependencies.createRuntime
 * @param {import("./codexTurn.js").CodexDebugError} dependencies.debugError
 * @param {import("./codexTurn.js").CodexDebugLog} dependencies.debugLog
 * @param {string} dependencies.errorPrefix
 * @param {string} dependencies.messageIdPrefix
 * @param {import("./codexTurn.js").CodexMessageMetadataHooks} dependencies.messageMetadata
 * @param {import("./codexTurn.js").CodexSessionNamespace} dependencies.namespace
 * @param {import("./codexTurn.js").CodexProviderSessions} [dependencies.providerSessions]
 * @param {import("./codexTurn.js").CodexAdmissionRecovery} dependencies.recoverAdmission
 * @param {string} dependencies.steerFailedCode
 * @param {string} dependencies.turnAlreadyRunningError
 * @param {import("./codexTurn.js").CodexTurnStateReader} dependencies.turnState
 */
export function createCodexMessageCommands({
  output,
  journal,
  recovery,
  threadStatus,
  selection,
  observer,
  delivery,
  promptDispatch,
  promptDeliveries,
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
    codexAppServerMessageContext,
    codexAppServerSessionObserverOptions,
    sessionConnection,
    rememberManagedSession
  } = selection;

  async function selectCodexAppServerMessageTurn(sessionId, { messageId = "", startedAt = Date.now() } = {}, context = {}) {
    if (providerSessions) context = codexAppServerMessageContext(sessionId, context);
    const { runtime, session } = context;
    let currentSession = session;
    let turn = turnState(currentSession);
    if (
      turn.state === "starting" &&
      !turn.turnId &&
      !promptDeliveries.has(namespace(sessionId))
    ) {
      const abandonedClaim = await recoverAdmission(
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
          code: `${errorPrefix}codex_observation_lost`, messageCode: "assistant.codex.observationLostStopUnverified", messageParams: {}
        });
      }
      const recovered = await output.submitAssistantResult(sessionId, turn.threadId, turn.turnId, { recoverFromProvider: true });
      if (recovered.reason === "error") throw new Error(recovered.error);
      return { value: codexAppServerMessageRequiresNewTurn({ reason: "observation_lost", threadId: turn.threadId, turnId: turn.turnId }), session: currentSession };
    }
    const threadId = normalizeText(turn.threadId) || context.threadId(currentSession);
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
        turnId: normalizeText(turn.turnId)
      });
    }
    const providerReadyAt = Date.now();
    debugLog("appServerMessage.providerReady", {
      durationMs: providerReadyAt - startedAt,
      messageId,
      sessionId
    });
    try {
      await threadStatus.reconcileThreadStatus(sessionId, provider, threadId, {
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
        turnId: normalizeText(turn.turnId)
      });
      return { value: codexAppServerMessageRequiresNewTurn({
        reason: "provider_thread_missing",
        threadId,
        turnId: normalizeText(turn.turnId)
      }), session: currentSession };
    }
    debugLog("appServerMessage.reconciled", {
      durationMs: Date.now() - providerReadyAt,
      messageId,
      sessionId
    });
    currentSession = await runtime.getSession(sessionId);
    turn = turnState(currentSession);
    const turnId = normalizeText(turn.turnId);
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
        messageCode: "assistant.codex.turnNotReady",
        messageParams: {},
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
      const connection = source.provider ? null : sessionConnection(sessionId, source.providerOptions);
      const providerAlreadyAvailable = source.provider
        ? source.providerAlreadyAvailable
        : providerSessions.owner.providers.get(connection.providerKey)?.isAvailable() === true;
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
        observeThread: threadId => observer.subscribeEvents(sessionId, provider, threadId, observerOptions),
        provider,
        workdir: source.workdir ?? workdir
      });
      if (source.requirePaginatedHistory && thread.thread.raw?.historyMode !== "paginated") {
        throw Object.assign(new Error("Codex did not create the required paginated history. Update Codex before starting this conversation."), {
          messageCode: "assistant.codex.paginatedHistoryMissing", messageParams: {}
        });
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
      observer.subscribeEvents(sessionId, provider, thread.threadId, observerOptions);
      if (connection) {
        rememberManagedSession(sessionId, providerOptions, {
          executionRoot: prepared.executionRoot, workdir: prepared.workdir, threadId: thread.threadId
        });
      }
      if (facility.ready) await facility.ready();
      return { preparedSession, provider, providerAlreadyAvailable, providerOptions, thread, ...settings };
    } finally {
      // Standalone preparation keeps the exact binding on failure as well as
      // success; Main records it after the startup gate.
      if (Object.hasOwn(facility, "failureThreadId")) prepared.activeThreadId = facility.failureThreadId;
    }
  }

  async function startCodexAppServerMessage(sessionId, input = {}, options = {}, prepare) {
    const startedAt = Date.now();
    const agentSettings = isRecord(options.agentSettings)
      ? options.agentSettings
      : isRecord(input.agentSettings) ? input.agentSettings : {};
    const actorContext = options.actorContext || null;
    const messageId = normalizeText(input.messageId) ||
      `${messageIdPrefix}${crypto.randomUUID()}`;
    const userRequest = codexPromptInputFromRequest(input);
    if (!userRequest && options.preparedInput === undefined) {
      return { value: {
        ok: false,
        error: "Codex message is empty.",
        messageCode: "assistant.codex.messageEmpty",
        messageParams: {}
      } };
    }

    const context = await prepare.readContext(options);
    if (context.ok === false) {
      return { value: context };
    }
    const { runtime } = context;
    const turnMetadata = { ...input.turnMetadata, ...await messageMetadata.actor(actorContext) };
    debugLog("appServerPrompt.start", {
      durationMs: Date.now() - startedAt,
      messageId,
      sessionId
    });

    const claim = await journal.claimCodexAppServerMessageStart(runtime, sessionId, messageId);
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

    const normalizedSessionId = normalizeText(sessionId);
    const promptDeliveryKey = namespace(normalizedSessionId);
    promptDeliveries.add(promptDeliveryKey);
    const prepared = {
      ...context, agentSettings, actorContext, messageId, userRequest, startedAt,
      activeThreadId: ""
    };
    let providerFailure = "";
    let turnFailureHandled = false;
    try {
      Object.assign(prepared, await prepareCodexAppServerMessageThread(sessionId, input, prepared, prepare));
      const { provider, providerAlreadyAvailable, thread } = prepared;
      await recovery.markTurnActive(sessionId, {
        status: "starting",
        threadId: thread.threadId
      });
      const prompt = await prepare.prepareMessage(input, prepared, { starting: true });
      const started = await promptDispatch.startTurn(sessionId, input, {
        runtime, provider, threadId: thread.threadId, messageId, renderedPrompt: prompt.renderedPrompt, turnMetadata,
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
        await journal.markTurnIdle(sessionId, {
          error: codexAppServerErrorMessage(error, "Codex app-server prompt delivery failed."),
          status: "failed",
          threadId: prepared.activeThreadId
        }).catch(() => null);
      }
      return await prepare.finishMessage(input, prepared, { error });
    } finally {
      promptDeliveries.delete(promptDeliveryKey);
    }
  }

  async function sendCodexAppServerMessage(sessionId, input, options = {}, prepare) {
    const startedAt = Date.now();
    const turnOwnership = options.turnOwnership || null;
    const message = codexAppServerMessageText(input);
    const displayMessage = codexAppServerMessageDisplayText(input, message);
    const messageId = normalizeText(input?.messageId);
    if (!message && options.preparedInput === undefined) {
      return { value: {
        code: steerFailedCode,
        error: "Codex message input is empty.",
        messageCode: "assistant.codex.messageInputEmpty",
        messageParams: {},
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
    const turnMetadata = { ...input.turnMetadata, ...await messageMetadata.actor(actorContext) };
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
    return promptDispatch.steerTurn(sessionId, input, {
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
    const messageId = normalizeText(input.messageId) ||
      `${messageIdPrefix}${crypto.randomUUID()}`;
    const started = await startCodexAppServerMessage(sessionId, isRecord(input) ? {
      ...input,
      message,
      messageId
    } : {
      message,
      messageId
    }, {
      agentSettings: input.agentSettings || {},
      runtime: options.runtime || null,
      session: options.session || null,
      actorContext: options.actorContext || null,
      preparedInput: options.preparedInput
    }, prepare);
    // An unavailable-worktree result starts its policy operation, releases
    // the prompt marker in finally, and then this awaits the returned value.
    started.value = await started.value;
    if (started.value?.ok === false || started.value?.delivered === false) {
      return started;
    }
    const runtime = await createRuntime(sessionId);
    const displayMessage = codexAppServerMessageDisplayText(input, message);
    const conversationTurn = await delivery.writeDeliveredUserMessage(
      runtime,
      sessionId,
      displayMessage || message,
      messageId,
      started.value.turnMetadata || null,
      input.displayAttachments,
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

  return Object.freeze({
    selectMessageTurn: selectCodexAppServerMessageTurn,
    dispatchMessage: dispatchCodexAppServerMessage
  });
}
