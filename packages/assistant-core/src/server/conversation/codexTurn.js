import { createCodexSessionReconciliation } from "./codexSessionReconciliation.js";
import { createCodexRuntimeLifecycle } from "./codexRuntimeLifecycle.js";
import { createCodexSessionCleanup } from "./codexSessionCleanup.js";
import { createCodexMessageCommands } from "./codexMessageCommands.js";
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
export { codexAppServerThreadIsMissing } from "./codexProvider.js";

export function createCodexAppServerRunOwner({
  namespace = normalizeCodexRunText,
  normalizeRunState = normalizeCodexAppServerRunState,
  debugLog = () => {},
  debugError = error => normalizeCodexRunText(error?.message || error),
  createRuntime,
  createStore,
  publish = async () => null,
  acquireProvider = async () => null,
  providerSessions = null,
  serverClosingError = null,
  helperThreads = null,
  modelCatalogCacheMs = 30_000,
  conversationPreparation = null,
  storeReadError = "The session store does not support agent-run reads.",
  sessionIdRequiredError = "A session ID is required.",
  turnClaimsUnsupportedError = "The session runtime does not support Codex turn claims.",
  turnAlreadyRunningError = "Codex is already working on this session.",
  messageIdPrefix = "codex:",
  idlePublishPayload = null,
  checkpoint = async () => null,
  messageMetadata = {},
  persistCommentary = true,
  deliveryStateMetadataKey = "assistant_delivery",
  hasRuntime = () => true,
  recoverAdmission = null,
  admissionTaskFinished = () => false,
  outcomeNotice = async () => null,
  resultDeliveryFailureMessage = ({ error = "" } = {}) => {
    const detail = normalizeCodexRunText(error);
    if (!detail) return "Codex app-server finished this turn, but the assistant result text was not received.";
    const punctuation = [".", "!", "?"].some(character => detail.endsWith(character)) ? "" : ".";
    return "Codex completed, but its response could not be processed: " + detail + punctuation;
  },
  orphanedPromptMessage = "The application restarted before Codex confirmed the message. Your message is safe; retry it.",
  onNotificationSignal = async () => null,
  captureContext = () => null,
  runInContext = (_context, operation) => operation(),
  notificationQueue = null,
  activeReconcileMs = 2000,
  finalizingGraceMs = 10000,
  finalizingGraceAfterHistoryRead = false,
  failureDetailGraceMs = 0,
  steerFailedCode = "codex_turn_steer_failed",
  interruptFailedCode = "codex_turn_interrupt_failed",
  errorPrefix = ""
} = {}) {
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
  const turnOutcomes = {
    PROVIDER_FAILURE: "provider_failure",
    RESPONSE_DELIVERY_FAILURE: "response_delivery_failure",
    SERVICE_RESTART: "service_restart",
    USER_CANCELLED: "user_cancelled",
    CONTROL_RECONFIGURATION: "control_reconfiguration",
    INTERRUPTED: "interrupted"
  };
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
    messageMetadata,
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
    recoverAdmission,
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
    messageMetadata,
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

  const codexMessageCommands = createCodexMessageCommands({
    output: codexAppServerOutput,
    journal: codexRunJournal,
    recovery: codexTurnRecovery,
    threadStatus: codexThreadStatus,
    selection: codexProviderSelection,
    observer: codexNotificationObserver,
    delivery: codexMessageDelivery,
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
      const providerKey = codexProviderSelection.managedProviderKeyForThread(sessionId, workdir, threadId);
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
    startTurn: codexMessageCommands.startTurn,
    steerTurn: codexMessageCommands.steerTurn,
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
