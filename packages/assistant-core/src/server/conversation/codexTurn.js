import { createCodexSessionReconciliation } from "./codexSessionReconciliation.js";
import { createCodexRuntimeLifecycle } from "./codexRuntimeLifecycle.js";
import { createCodexSessionCleanup } from "./codexSessionCleanup.js";
import { createCodexMessageCommands } from "./codexMessageCommands.js";
import { createCodexPromptDispatch } from "./codexPromptDispatch.js";
import { createCodexTurnControl } from "./codexTurnControl.js";
import { createCodexObservationControl } from "./codexObservationControl.js";
import { createCodexThreadReadiness } from "./codexThreadReadiness.js";
import { createCodexNotificationObserver } from "./codexNotificationObserver.js";
import { createCodexThreadStatus } from "./codexThreadStatus.js";
import { createCodexTurnRecovery } from "./codexTurnRecovery.js";
import { createCodexResultSettlement } from "./codexResultSettlement.js";
import { createCodexRunJournal } from "./codexRunJournal.js";
import { createCodexRenewalCommands } from "./codexRenewalCommands.js";
import { createCodexGoalCommands } from "./codexGoalCommands.js";
import { createCodexProviderSelection } from "./codexProviderSelection.js";
import { createCodexAppServerMessageDelivery } from "./codexMessageDelivery.js";
import { createCodexConversationCommands } from "./codexConversations.js";
import { createCodexAppServerOutput } from "./codexOutput.js";
import {
  normalizeCodexRunText,
  normalizeCodexAppServerRunState,
  codexAppServerTurnStateFromAgentRun,
  codexAppServerTurnState
} from "./codexTurnState.js";

import { createCodexAppServerNotificationQueue } from "./codexNotificationQueue.js";
export {
  CODEX_APP_SERVER_RUN_STATE,
  normalizeCodexAppServerRunState,
  codexAppServerRunStateIsActive,
  codexAppServerRunStateIsTerminal,
  codexAppServerAgentRun,
  codexAppServerPendingUserMessageClientIds,
  codexAppServerPendingUserMessageOwnership,
  codexAppServerProcessedResultEvent,
  codexAppServerTurnStateFromAgentRun,
  codexAppServerTurnState,
  codexAppServerTurnOwnsActiveGoal,
  codexAppServerTurnMatches,
  codexAppServerTurnCanReceiveProviderCompletion,
  codexAppServerTurnAwaitsProviderIdentity,
  codexAppServerTurnCanReceiveProviderActivity,
  codexAppServerTurnCanAdoptSuccessor,
  codexAppServerTurnKey,
  codexAppServerAgentRunPatch,
  codexAppServerRunIdentityForPatch,
  codexAppServerRunPatchIsStaleAfterTerminalState,
  codexAppServerSteerFailure,
  codexAppServerMessageRequiresNewTurn,
  codexAppServerInterruptFailure,
  codexAppServerInterruptUnavailableResponse,
  codexAppServerFrozenTurnInterruptResponse,
  codexAppServerConversationTurnIsActive,
  codexAppServerMessageText,
  codexAppServerMessageDisplayText,
  codexAppServerThreadStatus,
  codexAppServerReadThreadStatus,
  codexAppServerTurnStatusIsActive,
  codexAppServerTurnStatusIsComplete,
  codexAppServerTurnStatusIsSuccessfulComplete,
  codexAppServerTurnStatusIsProviderFailure
} from "./codexTurnState.js";
export { createCodexAppServerDetachedTurnWatcher, waitForCodexAppServerTurn } from "./codexDetachedTurn.js";
export { createCodexAppServerNotificationQueue } from "./codexNotificationQueue.js";
import {
  assertCodexAppServerHelperAccountIdentity,
  createCodexHelperOwnershipError
} from "./codexHelperExecution.js";
export { sendPreparedCodexAppServerHelperTurn } from "./codexHelperExecution.js";
import { createCodexHelperThreadLifecycle } from "./codexHelperThreads.js";
export { codexAppServerThreadIsMissing } from "./codexProviderThreads.js";

/** @typedef {(sessionId: string) => string} CodexSessionNamespace */
/** @typedef {(event: string, details?: object) => void} CodexDebugLog */
/** @typedef {(error: unknown) => string} CodexDebugError */
/** @typedef {() => Promise<any>} CodexCreateRuntime */
/** @typedef {() => Promise<any>} CodexCreateStore */
/** @typedef {(sessionId: string, event: object) => Promise<unknown>} CodexPublish */
/** @typedef {(session: object) => ReturnType<typeof codexAppServerTurnState>} CodexTurnStateReader */
/** @typedef {(run: object) => ReturnType<typeof codexAppServerTurnStateFromAgentRun>} CodexAgentRunTurnStateReader */
/** @typedef {() => unknown} CodexCaptureContext */
/** @typedef {(context: unknown, operation: () => any) => any} CodexRunInContext */
/** @typedef {typeof CODEX_TURN_OUTCOMES} CodexTurnOutcomes */
/** @typedef {ReturnType<typeof createCodexProviderSelection>} CodexProviderSelection */
/** @typedef {ReturnType<typeof import("./codexProviderOwner.js").createCodexAppServerProviderOwner>} CodexProviderOwner */
/** @typedef {(runtime: any, session: object, options: object) => Promise<any>} CodexAdmissionRecovery */
/** @typedef {(sessionId: string, input: object) => Promise<unknown>} CodexCheckpoint */

/**
 * The application hooks that add metadata to the turns a run writes.
 * @typedef {object} CodexMessageMetadataHooks
 * @property {(actorContext: unknown) => unknown} actor Metadata for the person who sent a message.
 * @property {(store: any, sessionId: string, metadata: object) => unknown} delivered Metadata of a delivered message.
 * @property {(store: any, sessionId: string) => unknown} terminal Metadata of a turn written after the run stopped.
 */

/**
 * The managed provider sessions of an application that owns its provider processes.
 * @typedef {object} CodexProviderSessions
 * @property {CodexProviderOwner} owner
 * @property {Map<string, any>} [managed]
 * @property {Function} [context]
 * @property {Function} [keyFields]
 * @property {Function} [connectionPolicy]
 * @property {Function} [outputContext]
 * @property {Function} [assertOpen]
 */

const CODEX_TURN_OUTCOMES = Object.freeze({
  PROVIDER_FAILURE: "provider_failure",
  RESPONSE_DELIVERY_FAILURE: "response_delivery_failure",
  SERVICE_RESTART: "service_restart",
  USER_CANCELLED: "user_cancelled",
  CONTROL_RECONFIGURATION: "control_reconfiguration",
  INTERRUPTED: "interrupted"
});

function ignoreDebugLog() {}

async function answerNothing() {
  return null;
}

function captureNoContext() {
  return null;
}

function addNoMessageMetadata() {
  return null;
}

function keepDeliveredMessageMetadata(_store, _sessionId, metadata) {
  return metadata;
}

function codexResultDeliveryFailureMessage({ error = "" } = {}) {
  const detail = normalizeCodexRunText(error);
  if (!detail) return "Codex app-server finished this turn, but the assistant result text was not received.";
  const punctuation = [".", "!", "?"].some(character => detail.endsWith(character)) ? "" : ".";
  return "Codex completed, but its response could not be processed: " + detail + punctuation;
}

function runInNoContext(_context, operation) {
  return operation();
}

/**
 * Builds the run owner of one application's Codex turns: messages, turns, recovery, output, conversations and
 * goals over one session store. Every hook without a value does nothing.
 * @param {object} options
 * @param {CodexSessionNamespace} [options.namespace]
 * @param {(state: unknown) => string} [options.normalizeRunState]
 * @param {CodexDebugLog} [options.debugLog]
 * @param {CodexDebugError} [options.debugError]
 * @param {CodexCreateRuntime} options.createRuntime
 * @param {CodexCreateStore} options.createStore
 * @param {CodexPublish} [options.publish]
 * @param {(input: { sessionId: string, runtime: any, session: object }) => Promise<any>} [options.acquireProvider]
 * @param {CodexProviderSessions} [options.providerSessions] Absent when the provider is acquired per call.
 * @param {{ message: string, code?: string, retryable?: boolean }} [options.serverClosingError]
 * @param {object} [options.helperThreads] The helper thread ledger options, when the application runs helpers.
 * @param {number} [options.modelCatalogCacheMs]
 * @param {object} [options.conversationPreparation] Absent when the application starts no scoped conversations.
 * @param {string} [options.storeReadError]
 * @param {string} [options.sessionIdRequiredError]
 * @param {string} [options.turnClaimsUnsupportedError]
 * @param {string} [options.turnAlreadyRunningError]
 * @param {string} [options.messageIdPrefix]
 * @param {object} [options.idlePublishPayload]
 * @param {CodexCheckpoint} [options.checkpoint]
 * @param {Partial<CodexMessageMetadataHooks>} [options.messageMetadata]
 * @param {boolean} [options.persistCommentary]
 * @param {string} [options.deliveryStateMetadataKey]
 * @param {(session: object) => boolean} [options.hasRuntime]
 * @param {CodexAdmissionRecovery} [options.recoverAdmission]
 * @param {(session: object, run: object) => boolean} [options.admissionTaskFinished]
 * @param {(...details: any[]) => Promise<unknown>} [options.outcomeNotice]
 * @param {(details: { error?: string }) => string} [options.resultDeliveryFailureMessage]
 * @param {string} [options.orphanedPromptMessage]
 * @param {(kind: string, details: object) => Promise<unknown>} [options.onNotificationSignal]
 * @param {CodexCaptureContext} [options.captureContext]
 * @param {CodexRunInContext} [options.runInContext]
 * @param {(sessionId: string, input: { threadId: string }) => Promise<unknown>} [options.continueGoalAfterAccountChange]
 *   Resumes a goal an account change paused, once the previous account's runtime has stopped. Without it the goal
 *   stays paused for the person to resume.
 * @param {import("./codexNotificationQueue.js").CodexAppServerNotificationQueue} [options.notificationQueue]
 * @param {number} [options.activeReconcileMs]
 * @param {number} [options.finalizingGraceMs]
 * @param {boolean} [options.finalizingGraceAfterHistoryRead]
 * @param {number} [options.failureDetailGraceMs]
 * @param {string} [options.steerFailedCode]
 * @param {string} [options.interruptFailedCode]
 * @param {string} [options.errorPrefix]
 */
export function createCodexAppServerRunOwner({
  namespace = normalizeCodexRunText,
  normalizeRunState = normalizeCodexAppServerRunState,
  debugLog = ignoreDebugLog,
  debugError = error => normalizeCodexRunText(error?.message || error),
  createRuntime,
  createStore,
  publish = answerNothing,
  acquireProvider = answerNothing,
  providerSessions,
  serverClosingError,
  helperThreads = null,
  modelCatalogCacheMs = 30_000,
  conversationPreparation,
  storeReadError = "The session store does not support agent-run reads.",
  sessionIdRequiredError = "A session ID is required.",
  turnClaimsUnsupportedError = "The session runtime does not support Codex turn claims.",
  turnAlreadyRunningError = "Codex is already working on this session.",
  messageIdPrefix = "codex:",
  idlePublishPayload,
  checkpoint = answerNothing,
  messageMetadata = {},
  persistCommentary = true,
  deliveryStateMetadataKey = "assistant_delivery",
  hasRuntime = () => true,
  recoverAdmission,
  admissionTaskFinished = () => false,
  outcomeNotice = answerNothing,
  resultDeliveryFailureMessage = codexResultDeliveryFailureMessage,
  orphanedPromptMessage = "The application restarted before Codex confirmed the message. Your message is safe; retry it.",
  onNotificationSignal = answerNothing,
  captureContext = captureNoContext,
  runInContext = runInNoContext,
  continueGoalAfterAccountChange,
  notificationQueue = null,
  activeReconcileMs = 2000,
  finalizingGraceMs = 10000,
  finalizingGraceAfterHistoryRead = false,
  failureDetailGraceMs = 0,
  steerFailedCode = "codex_turn_steer_failed",
  interruptFailedCode = "codex_turn_interrupt_failed",
  errorPrefix = ""
}) {
  if (typeof persistCommentary !== "boolean") throw new TypeError("Invalid Codex commentary persistence policy.");
  if (!Number.isSafeInteger(finalizingGraceMs) || finalizingGraceMs < 1) {
    throw new TypeError("Invalid Codex finalizing grace.");
  }
  if (typeof finalizingGraceAfterHistoryRead !== "boolean") {
    throw new TypeError("Invalid Codex finalizing grace clock.");
  }
  if (!Number.isSafeInteger(failureDetailGraceMs) || failureDetailGraceMs < 0) {
    throw new TypeError("Invalid Codex failure detail grace.");
  }
  if (providerSessions && (serverClosingError || !providerSessions.managed)) {
    providerSessions = { ...providerSessions, managed: providerSessions.managed || new Map() };
  }
  const liveProgressMaxLength = 320;
  const turnOutcomes = CODEX_TURN_OUTCOMES;
  /** @type {CodexMessageMetadataHooks} */
  const messageMetadataHooks = Object.freeze({
    actor: messageMetadata.actor || addNoMessageMetadata,
    delivered: messageMetadata.delivered || keepDeliveredMessageMetadata,
    terminal: messageMetadata.terminal || addNoMessageMetadata
  });
  const snapshotRecoveryItemLimit = 25;
  const helperOwnershipError = createCodexHelperOwnershipError({ errorPrefix });
  const helperLifecycle = helperThreads ? createCodexHelperThreadLifecycle({
    providerOwner: providerSessions.owner,
    ...helperThreads,
    errorPrefix
  }) : null;
  const codexAppServerNotificationQueue = notificationQueue || createCodexAppServerNotificationQueue({
    namespace, runInContext,
    isClosing: () => runOwner.runtimeLifecycle?.closing === true,
    reportError: (error, context) => debugLog("appServerNotification.error", {
      error: debugError(error), method: normalizeCodexRunText(context.method),
      sessionId: normalizeCodexRunText(context.sessionId),
      threadId: normalizeCodexRunText(context.threadId), turnId: normalizeCodexRunText(context.turnId)
    })
  });
  const codexAppServerPromptDeliveries = new Set();
  const turnState = session => codexAppServerTurnState(session, normalizeRunState);
  const turnStateFromAgentRun = run => codexAppServerTurnStateFromAgentRun(run, normalizeRunState);

  const codexProviderSelection = createCodexProviderSelection({
    providerSessions,
    turnState,
    helperLifecycle,
    helperOwnershipError,
    modelCatalogCacheMs,
    errorPrefix
  });
  const acquireOutputProvider = providerSessions?.outputContext
    ? async ({ sessionId, runtime, session }) => {
      const prepared = await providerSessions.outputContext({ sessionId, runtime, session });
      if (!prepared) return null;
      return codexProviderSelection.acquireCodexAppServerOutputProvider(
        sessionId, session, prepared.managedIdentity, prepared.providerOptions
      );
    }
    : acquireProvider;

  const codexAppServerOutput = createCodexAppServerOutput({
    namespace,
    createRuntime,
    createStore,
    publish,
    acquireProvider: acquireOutputProvider,
    turnState,
    turnStateFromAgentRun,
    debugLog,
    debugError,
    liveProgressMaxLength,
    persistCommentary,
    storeReadError,
    messageMetadata: messageMetadataHooks,
    snapshotRecoveryItemLimit
  });

  const codexRunJournal = createCodexRunJournal({
    namespace,
    normalizeRunState,
    turnState,
    createRuntime,
    publish,
    checkpoint,
    debugLog,
    output: codexAppServerOutput,
    messageIdPrefix,
    sessionIdRequiredError,
    turnClaimsUnsupportedError,
    turnAlreadyRunningError,
    errorPrefix,
    idlePublishPayload,
    finalizingGraceMs,
    admissionTaskFinished,
    orphanedPromptMessage
  });
  const admissionRecovery = recoverAdmission || codexRunJournal.recoverAbandonedPromptClaim;

  const codexResultSettlement = createCodexResultSettlement({
    journal: codexRunJournal,
    output: codexAppServerOutput,
    createRuntime,
    publish,
    debugLog,
    debugError,
    turnState
  });

  const codexTurnRecovery = createCodexTurnRecovery({
    journal: codexRunJournal,
    output: codexAppServerOutput,
    settlement: codexResultSettlement,
    promptDeliveries: codexAppServerPromptDeliveries,
    namespace,
    createRuntime,
    createStore,
    acquireProvider: acquireOutputProvider,
    turnState,
    turnStateFromAgentRun,
    debugLog,
    debugError,
    captureContext,
    runInContext,
    activeReconcileMs,
    finalizingGraceAfterHistoryRead,
    failureDetailGraceMs,
    notificationQueue: codexAppServerNotificationQueue,
    hasRuntime,
    recoverAdmission: admissionRecovery,
    turnOutcomes,
    outcomeNotice,
    resultDeliveryFailureMessage
  });

  const codexThreadStatus = createCodexThreadStatus({
    journal: codexRunJournal,
    settlement: codexResultSettlement,
    recovery: codexTurnRecovery,
    output: codexAppServerOutput,
    createRuntime,
    turnState,
    turnOutcomes,
    debugLog,
    debugError
  });

  const codexMessageDelivery = createCodexAppServerMessageDelivery({
    namespace,
    publish,
    messageMetadata: messageMetadataHooks,
    createStore,
    turnStateFromAgentRun,
    deliveryStateMetadataKey,
    output: codexAppServerOutput,
    journal: codexRunJournal,
    recovery: codexTurnRecovery
  });

  const codexNotificationObserver = createCodexNotificationObserver({
    journal: codexRunJournal,
    recovery: codexTurnRecovery,
    threadStatus: codexThreadStatus,
    output: codexAppServerOutput,
    delivery: codexMessageDelivery,
    notificationQueue: codexAppServerNotificationQueue,
    namespace,
    createRuntime,
    createStore,
    publish,
    captureContext,
    debugLog,
    onNotificationSignal,
    turnStateFromAgentRun
  });

  const codexThreadReadiness = createCodexThreadReadiness({
    providerSessions,
    selection: codexProviderSelection,
    observer: codexNotificationObserver,
    threadStatus: codexThreadStatus,
    recovery: codexTurnRecovery,
    turnState,
    debugLog,
    debugError
  });

  const codexConversations = createCodexConversationCommands({
    checkpoint,
    codexAppServerConversationMessageId: codexAppServerOutput.conversationMessageId,
    codexAppServerStreamMessage: codexAppServerOutput.streamMessage,
    conversationPreparation,
    ensureCodexAppServerProviderForActiveTurn: codexProviderSelection.ensureCodexAppServerProviderForActiveTurn,
    errorPrefix,
    helperLifecycle,
    helperOwnershipError,
    interruptFailedCode,
    namespace,
    providerSessions,
    ensureSessionProvider: codexProviderSelection.ensureSessionProvider,
    borrowSessionProvider: codexProviderSelection.borrowSessionProvider,
    steerFailedCode,
    turnOutcomes
  });

  const codexObservationControl = createCodexObservationControl({
    conversations: codexConversations,
    output: codexAppServerOutput,
    journal: codexRunJournal,
    namespace,
    createRuntime,
    publish,
    runInContext,
    turnState,
    errorPrefix
  });

  const codexTurnControl = createCodexTurnControl({
    journal: codexRunJournal,
    settlement: codexResultSettlement,
    recovery: codexTurnRecovery,
    threadStatus: codexThreadStatus,
    debugError,
    debugLog,
    errorPrefix,
    interruptFailedCode,
    turnOutcomes,
    turnState
  });

  const codexPromptDispatch = createCodexPromptDispatch({
    output: codexAppServerOutput,
    journal: codexRunJournal,
    recovery: codexTurnRecovery,
    threadStatus: codexThreadStatus,
    delivery: codexMessageDelivery,
    debugError,
    debugLog,
    steerFailedCode,
    turnState
  });

  const codexMessageCommands = createCodexMessageCommands({
    output: codexAppServerOutput,
    journal: codexRunJournal,
    recovery: codexTurnRecovery,
    threadStatus: codexThreadStatus,
    selection: codexProviderSelection,
    observer: codexNotificationObserver,
    delivery: codexMessageDelivery,
    promptDispatch: codexPromptDispatch,
    promptDeliveries: codexAppServerPromptDeliveries,
    createRuntime,
    debugError,
    debugLog,
    errorPrefix,
    messageIdPrefix,
    messageMetadata: messageMetadataHooks,
    namespace,
    providerSessions,
    recoverAdmission: admissionRecovery,
    steerFailedCode,
    turnAlreadyRunningError,
    turnState
  });

  const codexRenewalCommands = createCodexRenewalCommands({
    claimCodexAppServerTurnStart: codexRunJournal.claimTurnStart,
    codexAppServerNotificationQueue,
    completeCodexAppServerTurn: codexTurnRecovery.completeTurn,
    errorPrefix,
    markCodexAppServerTurnActive: codexTurnRecovery.markTurnActive,
    markCodexAppServerTurnIdle: codexRunJournal.markTurnIdle,
    observer: codexNotificationObserver,
    selection: codexProviderSelection,
    turnAlreadyRunningError,
    writeCodexAppServerUserMessageOwnership: codexRunJournal.writeUserMessageOwnership
  });

  const codexGoalCommands = createCodexGoalCommands({
    conversationContext: codexConversations.codexAppServerConversationContext,
    ensureThreadReady: codexThreadReadiness.ensureThreadReady,
    publish,
    readCodexAppServerAgentRunForSession: codexAppServerOutput.readAgentRunForSession,
    reconcileCodexAppServerGoalUpdated: codexNotificationObserver.reconcileGoalUpdated,
    submitCodexAppServerAssistantResult: codexAppServerOutput.submitAssistantResult,
    subscribeCodexAppServerEvents: codexNotificationObserver.subscribeEvents,
    turnState
  });

  function recoverSessionObservationLoss(sessionId, runtime, session, preparation) {
    return codexObservationControl.recoverObservationLoss(runtime, session,
      codexProviderSelection.codexAppServerObservationRecoveryContext(sessionId, preparation));
  }

  async function ensureSessionReadiness(sessionId, prepared) {
    if (Object.hasOwn(prepared, "value")) return prepared.value;
    let session = prepared.session;
    let turn = turnState(session);
    if (turn.status === "observation_lost") {
      if (turn.active) {
        session = await prepared.recovery(recoverSessionObservationLoss);
        turn = turnState(session);
      }
      if (!turn.active) {
        const recovered = await codexAppServerOutput.submitAssistantResult(sessionId, turn.threadId, turn.turnId, { recoverFromProvider: true });
        if (recovered.reason === "error") throw new Error(recovered.error);
      }
      // A verified stop is a usable composer state, not a reconnect loop.
      return prepared.stopped(session, turn);
    }
    const connection = prepared.connection;
    const { workdir, threadId } = connection;
    if (threadId && connection.available && turnState(session).state !== "starting") {
      const providerKey = codexProviderSelection.managedProviderKeyForThread(sessionId, workdir, threadId, {
        turnActive: turnState(session).active
      });
      if (providerKey !== null) {
        const observed = await codexThreadReadiness.checkManagedConnection(providerKey, { reconnect: false });
        if (!observed.requiresPreparation) {
          return prepared.ready(threadId);
        }
      }
    }
    return prepared.prepare(codexThreadReadiness.ensureThreadReady);
  }

  async function readExecutionProfileModelCatalog(sessionId, preparation) {
    if (preparation.assistantScope) {
      const context = await codexConversations.codexAppServerEphemeralScopeContext(
        sessionId, { agentSettings: preparation.agentSettings }, preparation.assistantScope
      );
      if (context.ok === false) return context;
      return codexProviderSelection.readExecutionProfileModelCatalog(sessionId, {
        assistantScope: preparation.assistantScope,
        get provider() { return context.provider; },
        signal: preparation.signal
      });
    }
    return codexProviderSelection.readExecutionProfileModelCatalog(sessionId, preparation);
  }

  const runOwner = {
    helperThreads: helperLifecycle,
    assertAccountIdentity: (provider, expectedSignature) => assertCodexAppServerHelperAccountIdentity(
      provider, expectedSignature, helperOwnershipError
    ),
    ensureSessionReadiness,
    conversations: codexConversations.codexAppServerConversations,
    hasActiveTemporaryConversation: codexConversations.hasActiveConversation,
    readExecutionProfileModelCatalog,
    readProviderAccountIdentity: codexProviderSelection.readProviderAccountIdentity,
    conversation: codexConversations.codexAppServerConversation,
    readPersistentConversation: codexConversations.readPersistentCodexConversation,
    createConversation: codexConversations.createCodexAppServerConversation,
    runDetachedConversation: codexConversations.runDetachedCodexAppServerConversation,
    startConversationTurn: codexConversations.startCodexAppServerConversationTurn,
    acquireDetachedThread: codexConversations.acquireCodexAppServerDetachedThread,
    detachedThreadId: codexConversations.codexAppServerDetachedThreadId,
    dispatchDetachedTurn: codexConversations.dispatchCodexAppServerDetachedTurn,
    runDetachedTurn: codexConversations.runDetachedCodexAppServerTurn,
    deleteConversation: codexConversations.deleteScopedCodexAppServerConversation,
    readConversation: codexConversations.readCodexAppServerConversation,
    stopConversation: codexConversations.stopCodexAppServerConversation,
    conversationContext: codexConversations.codexAppServerConversationContext,
    prepareConversationThread: codexConversations.prepareCodexAppServerConversationThread,
    interruptDetachedTurn: codexConversations.interruptDetachedCodexAppServerConversationTurn,
    deleteDetachedThread: codexConversations.deleteDetachedCodexAppServerConversationThread,
    stopPersistentConversation: codexConversations.stopPersistentCodexConversation,
    waitForConversationTurn: codexConversations.waitForCodexAppServerConversationTurn,
    withMessageDelivery: codexMessageDelivery.withMessageDelivery,
    dispatchMessage: codexMessageCommands.dispatchMessage,
    ensureThreadReady: codexThreadReadiness.ensureThreadReady,
    runtimeForVisibleTerminal: codexProviderSelection.codexAppServerRuntimeForVisibleTerminal,
    controlContext: codexProviderSelection.codexAppServerControlContext,
    assertThreadCanResume: codexObservationControl.assertThreadCanResume,
    createObservation(sessionId, context = {}) {
      if (!providerSessions) return codexObservationControl.createObservation(sessionId, context);
      const { providerKey } = context;
      return codexObservationControl.createObservation(sessionId, {
        ...context,
        retireProvider: () => runOwner.runtimeLifecycle.retireProvider(providerKey)
      });
    },
    selectMessageTurn: codexMessageCommands.selectMessageTurn,
    interruptTurn: codexTurnControl.interruptTurn,
    recoverObservationLoss: codexObservationControl.recoverObservationLoss,
    runRenewalHandover: codexRenewalCommands.runCodexAppServerRenewalHandover,
    runRenewalSeed: codexRenewalCommands.runCodexAppServerRenewalSeed,
    startTurn: codexPromptDispatch.startTurn,
    steerTurn: codexPromptDispatch.steerTurn,
    prepareGoalContext: codexGoalCommands.prepareCodexAppServerGoalContext,
    validateGoalInput: codexGoalCommands.validateCodexAppServerGoalInput,
    updateGoal: codexGoalCommands.updateCodexAppServerGoal,
    notificationQueue: codexAppServerNotificationQueue,
    messageDeliveries: codexMessageDelivery.messageDeliveries,
    pendingUserMessages: codexMessageDelivery.pendingUserMessages,
    eventSubscriptions: codexNotificationObserver.eventSubscriptions,
    promptDeliveries: codexAppServerPromptDeliveries,
    unsubscribeEventSubscription: codexNotificationObserver.unsubscribeEventSubscription,
    scheduleActiveRecovery: codexTurnRecovery.scheduleActiveRecovery,
    reconcileThreadStatus: codexThreadStatus.reconcileThreadStatus,
    mirrorTerminalUserMessage: codexMessageDelivery.mirrorTerminalUserMessage,
    recoverActiveTurn: codexTurnRecovery.recoverActiveTurn,
    completeTurn: codexTurnRecovery.completeTurn,
    stopTurnWithProviderFailure: codexTurnRecovery.stopTurnWithProviderFailure,
    writeDeliveredUserMessage: codexMessageDelivery.writeDeliveredUserMessage,
    subscribeEvents: codexNotificationObserver.subscribeEvents,
    activeTimers: codexRunJournal.activeTimers,
    finalizingTimers: codexRunJournal.finalizingTimers,
    resultFinalizations: codexResultSettlement.resultFinalizations,
    clearSessionRecoveryTimers: codexRunJournal.clearSessionRecoveryTimers,
    publishAgentRun: codexRunJournal.publishAgentRun,
    markTurnIdle: codexRunJournal.markTurnIdle,
    finalizeAssistantResult: codexResultSettlement.finalizeAssistantResult,
    finalizedTurns: codexAppServerOutput.finalizedTurns,
    liveProgressItems: codexAppServerOutput.liveProgressItems,
    liveProgressFingerprints: codexAppServerOutput.liveProgressFingerprints,
    readAgentRunForSession: codexAppServerOutput.readAgentRunForSession,
    readFinalAssistantResult: codexAppServerOutput.readFinalAssistantResult,
    persistAssistantReply: codexAppServerOutput.persistAssistantReply,
    recordFinalAssistantResult: codexAppServerOutput.recordFinalAssistantResult,
    recordReasoningForSession: codexAppServerOutput.recordReasoningForSession,
    writeStream: codexAppServerOutput.writeStream,
    writeLiveProgress: codexAppServerOutput.writeLiveProgress,
    submitAssistantResult: codexAppServerOutput.submitAssistantResult,
    processedTurns: codexRunJournal.processedTurns,
    resultFinalizationKey: codexAppServerOutput.resultFinalizationKey,
    claimTurnStart: codexRunJournal.claimTurnStart,
    writeAgentRun: codexRunJournal.writeAgentRun
  };
  if (providerSessions) {
    runOwner.runtimeLifecycle = createCodexRuntimeLifecycle({
      pendingWork: {
        conversationTurnStarts: codexConversations.codexAppServerConversationTurnStarts,
        messageDeliveries: codexMessageDelivery.messageDeliveries,
        reasoningPersistQueues: codexAppServerOutput.reasoningPersistQueues,
        resultFinalizations: codexResultSettlement.resultFinalizations,
        threadReconciliations: codexThreadReadiness.threadReconciliations,
        notificationTasks: codexAppServerNotificationQueue.tasks
      },
      observer: codexNotificationObserver,
      checkManagedConnection: codexThreadReadiness.checkManagedConnection,
      providerSessions,
      helperLifecycle,
      captureContext,
      runInContext,
      continueGoalAfterAccountChange,
      debugLog,
      debugError,
      closingError: serverClosingError
    });
    if (serverClosingError) {
      providerSessions.owner.attachRuntimeLifecycle(runOwner.runtimeLifecycle);
      providerSessions.assertOpen = runOwner.runtimeLifecycle.assertOpen;
    }
    runOwner.invalidateRuntimes = runOwner.runtimeLifecycle.invalidateRuntimes;
    Object.assign(runOwner, createCodexSessionReconciliation({
      readiness: codexThreadReadiness, recoverSessionObservationLoss,
      providerSessions, helperLifecycle, lifecycle: runOwner.runtimeLifecycle,
      createRuntime, namespace, turnState, sessionIdRequiredError, debugLog, debugError
    }));
  }
  const cleanup = createCodexSessionCleanup({
    namespace,
    runOwner,
    providerSessions,
    sessionClosures: runOwner.runtimeLifecycle?.sessionClosures,
    helperLifecycle,
    journal: codexRunJournal,
    conversations: codexConversations,
    debugLog,
    debugError
  });
  runOwner.closeSession = cleanup.closeSession;
  runOwner.closeProject = cleanup.closeProject;
  return runOwner;
}
