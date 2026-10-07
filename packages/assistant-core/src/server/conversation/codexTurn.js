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
  createCodexHelperOwnershipError,
  readCodexAppServerAccountIdentity
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
  steerFailedCode = "codex_turn_steer_failed",
  interruptFailedCode = "codex_turn_interrupt_failed",
  errorPrefix = ""
} = {}) {
  if (!Number.isSafeInteger(finalizingGraceMs) || finalizingGraceMs < 1) {
    throw new TypeError("Invalid Codex finalizing grace.");
  }
  if (typeof finalizingGraceAfterHistoryRead !== "boolean") {
    throw new TypeError("Invalid Codex finalizing grace clock.");
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
  const {
    ensureCodexAppServerProviderForActiveTurn,
    acquireCodexAppServerOutputProvider,
    codexAppServerRuntimeForVisibleTerminal,
    codexAppServerMessageContext,
    codexAppServerControlContext,
    codexAppServerObservationRecoveryContext
  } = codexProviderSelection;
  const acquireOutputProvider = providerSessions?.outputContext
    ? async ({ sessionId, runtime, session }) => {
      const prepared = providerSessions.outputContext({ sessionId, runtime, session });
      if (!prepared) return null;
      return acquireCodexAppServerOutputProvider(
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
    storeReadError,
    messageMetadata,
    snapshotRecoveryItemLimit
  });
  const {
    finalizedTurns: codexAppServerFinalizedTurns,
    finalAssistantResults: codexAppServerFinalAssistantResults,
    reasoningTurns: codexAppServerReasoningTurns,
    reasoningPersistQueues: codexAppServerReasoningPersistQueues,
    liveProgressItems: codexAppServerLiveProgressItems,
    liveProgressFingerprints: codexAppServerLiveProgressFingerprints,
    mirroredTerminalItems: codexAppServerMirroredTerminalItems,
    resultFinalizationKey: codexAppServerResultFinalizationKey,
    liveProgressCandidate: codexAppServerLiveProgressCandidate,
    conversationMessageId: codexAppServerConversationMessageId,
    readAgentRunForSession: readCodexAppServerAgentRunForSession,
    readFinalAssistantResult: readCodexAppServerFinalAssistantResult,
    persistAssistantReply: persistCodexAppServerAssistantReply,
    recordFinalAssistantResult: recordCodexAppServerFinalAssistantResult,
    recordReasoningForSession: recordCodexAppServerReasoningForSession,
    flushReasoningPersist: flushCodexAppServerReasoningPersist,
    splitReasoningTurn: splitCodexAppServerReasoningTurn,
    cleanupUntrackedTurn: cleanupCodexAppServerUntrackedTurn,
    streamMessage: codexAppServerStreamMessage,
    writeStream: writeCodexAppServerStream,
    writeLiveProgress: writeCodexAppServerLiveProgress,
    submitAssistantResult: submitCodexAppServerAssistantResult,
    reconcileObservedTurnItems: reconcileCodexAppServerObservedTurnItems
  } = codexAppServerOutput;

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
  const {
    completedTurns: codexAppServerCompletedTurns,
    processedTurns: codexAppServerProcessedTurns,
    activeTimers: codexAppServerActiveTimers,
    finalizingTimers: codexAppServerFinalizingTimers,
    turnResultWasProcessed: codexAppServerTurnResultWasProcessed,
    claimTurnStart: claimCodexAppServerTurnStart,
    claimMessageStart: claimCodexAppServerMessageStart,
    writeAgentRun: writeCodexAppServerAgentRun,
    clearActiveTimer: clearCodexAppServerActiveTimer,
    clearFinalizingTimer: clearCodexAppServerFinalizingTimer,
    clearSessionRecoveryTimers: clearCodexAppServerSessionRecoveryTimers,
    agentRunRealtimePayload: codexAppServerAgentRunRealtimePayload,
    publishAgentRun: publishCodexAppServerAgentRun,
    markTurnFinalizing: markCodexAppServerTurnFinalizing,
    markTurnIdle: markCodexAppServerTurnIdle,
    resolveTurnId: resolveCodexAppServerTurnId,
    writeUserMessageOwnership: writeCodexAppServerUserMessageOwnership
  } = codexRunJournal;

  const codexResultSettlement = createCodexResultSettlement({
    journal: codexRunJournal,
    output: codexAppServerOutput,
    createRuntime,
    publish,
    debugLog,
    debugError,
    turnState
  });
  const {
    resultFinalizations: codexAppServerResultFinalizations,
    finalizeAssistantResult: finalizeCodexAppServerAssistantResult,
    recoverFinalResponseBeforeOutcome: recoverCodexAppServerFinalResponseBeforeOutcome,
    adoptSuccessorTurn: adoptCodexAppServerSuccessorTurn
  } = codexResultSettlement;

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
    hasRuntime,
    recoverAdmission,
    turnOutcomes,
    outcomeNotice,
    resultDeliveryFailureMessage
  });
  const {
    scheduleActiveRecovery: scheduleCodexAppServerActiveRecovery,
    markTurnActive: markCodexAppServerTurnActive,
    recoverActiveTurn: recoverCodexAppServerActiveTurn,
    completeTurn: completeCodexAppServerTurn,
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure
  } = codexTurnRecovery;

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
  const {
    reconcileThreadStatus: reconcileCodexAppServerThreadStatus,
    reconcileLoadedThreadStatus: reconcileCodexAppServerLoadedThreadStatus
  } = codexThreadStatus;

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
  const {
    messageDeliveries: codexAppServerMessageDeliveries,
    pendingUserMessages: codexAppServerPendingUserMessages,
    withMessageDelivery: withCodexAppServerMessageDelivery,
    writeDeliveredUserMessage: writeCodexAppServerDeliveredUserMessage,
    mirrorTerminalUserMessage: mirrorCodexAppServerTerminalUserMessage
  } = codexMessageDelivery;

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
  const {
    eventSubscriptions: codexAppServerEventSubscriptions,
    automaticHookThreads: codexAppServerAutomaticHookThreads,
    eventSubscriptionKey: codexAppServerEventSubscriptionKey,
    eventSubscriptionIsCurrent: codexAppServerEventSubscriptionIsCurrent,
    unsubscribeEventSubscription: unsubscribeCodexAppServerEventSubscription,
    reconcileGoalUpdated: reconcileCodexAppServerGoalUpdated,
    subscribeEvents: subscribeCodexAppServerEvents
  } = codexNotificationObserver;

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
  const {
    threadReconciliations: codexAppServerThreadReconciliations,
    ensureThreadReady: ensureCodexAppServerThreadReady,
    reconcileThread: reconcileCodexAppServerThreadForSession,
    waitForThreadReconciliations: waitForOtherCodexAppServerThreadReconciliations,
    checkManagedConnection: checkCodexAppServerManagedConnection,
    restoreLoadedThread: restoreCodexAppServerLoadedThread
  } = codexThreadReadiness;

  const codexConversations = createCodexConversationCommands({
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
    steerFailedCode
  });
  const {
    codexAppServerConversations,
    codexAppServerConversationTurnStarts,
    codexAppServerConversation,
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
  } = codexConversations;

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
  const {
    assertThreadCanResume: assertCodexAppServerThreadCanResume,
    createObservation: createCodexAppServerObservation,
    recoverObservationLoss: recoverCodexAppServerObservationLoss
  } = codexObservationControl;

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
  const { interruptTurn: interruptCodexAppServerTurn } = codexTurnControl;

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
  const {
    selectMessageTurn: selectCodexAppServerMessageTurn,
    dispatchMessage: dispatchCodexAppServerMessage,
    startTurn: startCodexAppServerTurn,
    steerTurn: steerCodexAppServerTurn
  } = codexMessageCommands;

  const {
    runCodexAppServerRenewalHandover,
    runCodexAppServerRenewalSeed
  } = createCodexRenewalCommands({
    claimCodexAppServerTurnStart,
    codexAppServerNotificationQueue,
    completeCodexAppServerTurn,
    errorPrefix,
    markCodexAppServerTurnActive,
    markCodexAppServerTurnIdle,
    observer: codexNotificationObserver,
    selection: codexProviderSelection,
    turnAlreadyRunningError,
    writeCodexAppServerUserMessageOwnership
  });

  const {
    prepareCodexAppServerGoalContext,
    validateCodexAppServerGoalInput,
    updateCodexAppServerGoal
  } = createCodexGoalCommands({
    conversationContext: codexAppServerConversationContext,
    ensureThreadReady: ensureCodexAppServerThreadReady,
    publish,
    readCodexAppServerAgentRunForSession,
    reconcileCodexAppServerGoalUpdated,
    submitCodexAppServerAssistantResult,
    subscribeCodexAppServerEvents,
    turnState
  });

  function recoverSessionObservationLoss(sessionId, runtime, session, preparation) {
    return recoverCodexAppServerObservationLoss(runtime, session,
      codexAppServerObservationRecoveryContext(sessionId, preparation));
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
        const recovered = await submitCodexAppServerAssistantResult(sessionId, turn.threadId, turn.turnId, { recoverFromProvider: true });
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
        const observed = await checkCodexAppServerManagedConnection(providerKey, { reconnect: false });
        if (!observed.requiresPreparation) {
          return prepared.ready(threadId);
        }
      }
    }
    return prepared.prepare(ensureCodexAppServerThreadReady);
  }

  async function readExecutionProfileModelCatalog(sessionId, preparation) {
    if (preparation.assistantScope) {
      const context = await codexAppServerEphemeralScopeContext(
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
    readAccountIdentity: provider => readCodexAppServerAccountIdentity(provider, helperOwnershipError),
    assertAccountIdentity: (provider, expectedSignature) => assertCodexAppServerHelperAccountIdentity(
      provider, expectedSignature, helperOwnershipError
    ),
    checkManagedConnection: checkCodexAppServerManagedConnection,
    ensureSessionReadiness,
    recoverSessionObservationLoss,
    restoreLoadedThread: restoreCodexAppServerLoadedThread,
    reconcileThread: reconcileCodexAppServerThreadForSession,
    threadReconciliations: codexAppServerThreadReconciliations,
    waitForThreadReconciliations: waitForOtherCodexAppServerThreadReconciliations,
    conversations: codexAppServerConversations,
    hasActiveTemporaryConversation: codexConversations.hasActiveConversation,
    readExecutionProfileModelCatalog,
    readProviderAccountIdentity: codexProviderSelection.readProviderAccountIdentity,
    conversationTurnStarts: codexAppServerConversationTurnStarts,
    conversation: codexAppServerConversation,
    conversationSnapshot: codexAppServerEphemeralConversationSnapshot,
    withConversationTurnStart: withCodexAppServerConversationTurnStart,
    observeConversation: observeCodexConversation,
    readPersistentConversation: readPersistentCodexConversation,
    createConversation: createCodexAppServerConversation,
    runDetachedConversation: runDetachedCodexAppServerConversation,
    steerConversationTurn: steerCodexAppServerConversationTurn,
    startConversationTurn: startCodexAppServerConversationTurn,
    acquireDetachedThread: acquireCodexAppServerDetachedThread,
    detachedThreadId: codexAppServerDetachedThreadId,
    dispatchDetachedTurn: dispatchCodexAppServerDetachedTurn,
    runDetachedTurn: runDetachedCodexAppServerTurn,
    interruptConversation: interruptCodexAppServerConversation,
    deleteConversation: deleteScopedCodexAppServerConversation,
    readConversation: readCodexAppServerConversation,
    stopConversation: stopCodexAppServerConversation,
    closeConversations: closeCodexAppServerConversations,
    conversationContext: codexAppServerConversationContext,
    ephemeralScopeContext: codexAppServerEphemeralScopeContext,
    prepareConversationThread: prepareCodexAppServerConversationThread,
    interruptDetachedTurn: interruptDetachedCodexAppServerConversationTurn,
    deleteDetachedThread: deleteDetachedCodexAppServerConversationThread,
    stopPersistentConversation: stopPersistentCodexConversation,
    waitForConversationTurn: waitForCodexAppServerConversationTurn,
    withMessageDelivery: withCodexAppServerMessageDelivery,
    dispatchMessage: dispatchCodexAppServerMessage,
    ensureThreadReady: ensureCodexAppServerThreadReady,
    messageContext: codexAppServerMessageContext,
    outputProvider: acquireCodexAppServerOutputProvider,
    runtimeForVisibleTerminal: codexAppServerRuntimeForVisibleTerminal,
    controlContext: codexAppServerControlContext,
    observationRecoveryContext: codexAppServerObservationRecoveryContext,
    claimMessageStart: claimCodexAppServerMessageStart,
    assertThreadCanResume: assertCodexAppServerThreadCanResume,
    createObservation(sessionId, context = {}) {
      if (!providerSessions) return createCodexAppServerObservation(sessionId, context);
      const { providerKey } = context;
      return createCodexAppServerObservation(sessionId, {
        ...context,
        retireProvider: () => runOwner.runtimeLifecycle.retireProvider(providerKey)
      });
    },
    selectMessageTurn: selectCodexAppServerMessageTurn,
    interruptTurn: interruptCodexAppServerTurn,
    recoverObservationLoss: recoverCodexAppServerObservationLoss,
    runRenewalHandover: runCodexAppServerRenewalHandover,
    runRenewalSeed: runCodexAppServerRenewalSeed,
    startTurn: startCodexAppServerTurn,
    steerTurn: steerCodexAppServerTurn,
    prepareGoalContext: prepareCodexAppServerGoalContext,
    validateGoalInput: validateCodexAppServerGoalInput,
    updateGoal: updateCodexAppServerGoal,
    notificationQueue: codexAppServerNotificationQueue,
    messageDeliveries: codexAppServerMessageDeliveries,
    pendingUserMessages: codexAppServerPendingUserMessages,
    eventSubscriptions: codexAppServerEventSubscriptions,
    completedTurns: codexAppServerCompletedTurns,
    promptDeliveries: codexAppServerPromptDeliveries,
    automaticHookThreads: codexAppServerAutomaticHookThreads,
    eventSubscriptionKey: codexAppServerEventSubscriptionKey,
    eventSubscriptionIsCurrent: codexAppServerEventSubscriptionIsCurrent,
    unsubscribeEventSubscription: unsubscribeCodexAppServerEventSubscription,
    scheduleActiveRecovery: scheduleCodexAppServerActiveRecovery,
    reconcileThreadStatus: reconcileCodexAppServerThreadStatus,
    reconcileLoadedThreadStatus: reconcileCodexAppServerLoadedThreadStatus,
    writeUserMessageOwnership: writeCodexAppServerUserMessageOwnership,
    mirrorTerminalUserMessage: mirrorCodexAppServerTerminalUserMessage,
    reconcileObservedTurnItems: reconcileCodexAppServerObservedTurnItems,
    markTurnActive: markCodexAppServerTurnActive,
    adoptSuccessorTurn: adoptCodexAppServerSuccessorTurn,
    recoverActiveTurn: recoverCodexAppServerActiveTurn,
    completeTurn: completeCodexAppServerTurn,
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure,
    reconcileGoalUpdated: reconcileCodexAppServerGoalUpdated,
    writeDeliveredUserMessage: writeCodexAppServerDeliveredUserMessage,
    subscribeEvents: subscribeCodexAppServerEvents,
    activeTimers: codexAppServerActiveTimers,
    finalizingTimers: codexAppServerFinalizingTimers,
    resultFinalizations: codexAppServerResultFinalizations,
    clearActiveTimer: clearCodexAppServerActiveTimer,
    clearFinalizingTimer: clearCodexAppServerFinalizingTimer,
    clearSessionRecoveryTimers: clearCodexAppServerSessionRecoveryTimers,
    agentRunRealtimePayload: codexAppServerAgentRunRealtimePayload,
    publishAgentRun: publishCodexAppServerAgentRun,
    markTurnFinalizing: markCodexAppServerTurnFinalizing,
    markTurnIdle: markCodexAppServerTurnIdle,
    resolveTurnId: resolveCodexAppServerTurnId,
    finalizeAssistantResult: finalizeCodexAppServerAssistantResult,
    recoverFinalResponseBeforeOutcome: recoverCodexAppServerFinalResponseBeforeOutcome,
    finalizedTurns: codexAppServerFinalizedTurns,
    finalAssistantResults: codexAppServerFinalAssistantResults,
    reasoningTurns: codexAppServerReasoningTurns,
    reasoningPersistQueues: codexAppServerReasoningPersistQueues,
    liveProgressItems: codexAppServerLiveProgressItems,
    liveProgressFingerprints: codexAppServerLiveProgressFingerprints,
    mirroredTerminalItems: codexAppServerMirroredTerminalItems,
    liveProgressCandidate: codexAppServerLiveProgressCandidate,
    conversationMessageId: codexAppServerConversationMessageId,
    readAgentRunForSession: readCodexAppServerAgentRunForSession,
    readFinalAssistantResult: readCodexAppServerFinalAssistantResult,
    persistAssistantReply: persistCodexAppServerAssistantReply,
    recordFinalAssistantResult: recordCodexAppServerFinalAssistantResult,
    recordReasoningForSession: recordCodexAppServerReasoningForSession,
    flushReasoningPersist: flushCodexAppServerReasoningPersist,
    splitReasoningTurn: splitCodexAppServerReasoningTurn,
    cleanupUntrackedTurn: cleanupCodexAppServerUntrackedTurn,
    writeStream: writeCodexAppServerStream,
    writeLiveProgress: writeCodexAppServerLiveProgress,
    submitAssistantResult: submitCodexAppServerAssistantResult,
    processedTurns: codexAppServerProcessedTurns,
    resultFinalizationKey: codexAppServerResultFinalizationKey,
    turnResultWasProcessed: codexAppServerTurnResultWasProcessed,
    claimTurnStart: claimCodexAppServerTurnStart,
    writeAgentRun: writeCodexAppServerAgentRun
  };
  const cleanup = createCodexSessionCleanup({
    namespace,
    runOwner,
    providerSessions,
    helperLifecycle,
    journal: codexRunJournal,
    conversations: codexConversations,
    debugLog,
    debugError
  });
  runOwner.closeSession = cleanup.closeSession;
  runOwner.closeProject = cleanup.closeProject;
  if (providerSessions) {
    runOwner.runtimeLifecycle = createCodexRuntimeLifecycle({
      runOwner,
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
      runOwner, providerSessions, helperLifecycle, lifecycle: runOwner.runtimeLifecycle,
      createRuntime, namespace, turnState, sessionIdRequiredError, debugLog, debugError
    }));
  }
  return runOwner;
}
