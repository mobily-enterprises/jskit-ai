import { codexAppServerTurnStatusIsActive, codexAppServerTurnStatusIsComplete, codexAppServerTurnStatusIsSuccessfulComplete, codexAppServerTurnStatusIsProviderFailure, codexAppServerThreadStatus, codexAppServerObservedTurnFinished, codexAppServerReadThreadStatus, codexAppServerAgentRun, codexAppServerPendingUserMessageOwnership, codexAppServerTurnCanAdoptSuccessor } from "./codexTurnState.js";
import { codexAppServerProviderTurnForOperation, codexAppServerThreadTurnId, codexAppServerThreadError } from "./codexThreadSnapshot.js";
import { createCodexTurnActivity } from "./codexTurnActivity.js";
import { createCodexTurnEndings } from "./codexTurnEndings.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * Active and finalizing turn recovery: the timers that reread the provider, and the reconciliation of the tracked
 * turn with what the provider reports. Timers and receipts remain owned by the shared journal, output and settlement.
 * @param {object} dependencies
 * @param {import("./codexRunJournal.js").CodexRunJournal} dependencies.journal
 * @param {import("./codexOutput.js").CodexAppServerOutput} dependencies.output
 * @param {import("./codexResultSettlement.js").CodexResultSettlement} dependencies.settlement
 * @param {Set<string>} dependencies.promptDeliveries
 * @param {import("./codexTurn.js").CodexSessionNamespace} dependencies.namespace
 * @param {import("./codexTurn.js").CodexCreateRuntime} dependencies.createRuntime
 * @param {import("./codexTurn.js").CodexCreateStore} dependencies.createStore
 * @param {(input: { sessionId: string, runtime: any, session: object }) => Promise<any>} dependencies.acquireProvider
 * @param {import("./codexTurn.js").CodexTurnStateReader} dependencies.turnState
 * @param {import("./codexTurn.js").CodexAgentRunTurnStateReader} dependencies.turnStateFromAgentRun
 * @param {import("./codexTurn.js").CodexDebugLog} dependencies.debugLog
 * @param {import("./codexTurn.js").CodexDebugError} dependencies.debugError
 * @param {import("./codexTurn.js").CodexCaptureContext} dependencies.captureContext
 * @param {import("./codexTurn.js").CodexRunInContext} dependencies.runInContext
 * @param {number} dependencies.activeReconcileMs
 * @param {boolean} dependencies.finalizingGraceAfterHistoryRead
 * @param {number} dependencies.failureDetailGraceMs
 * @param {import("./codexNotificationQueue.js").CodexAppServerNotificationQueue} dependencies.notificationQueue
 * @param {(session: object) => boolean} dependencies.hasRuntime
 * @param {import("./codexTurn.js").CodexAdmissionRecovery} dependencies.recoverAdmission
 * @param {import("./codexTurn.js").CodexTurnOutcomes} dependencies.turnOutcomes
 * @param {(...details: any[]) => Promise<unknown>} dependencies.outcomeNotice
 * @param {(details: { error?: string }) => string} dependencies.resultDeliveryFailureMessage
 */
export function createCodexTurnRecovery({
  journal,
  output,
  settlement,
  promptDeliveries,
  namespace,
  createRuntime,
  createStore,
  acquireProvider,
  turnState,
  turnStateFromAgentRun,
  debugLog,
  debugError,
  captureContext,
  runInContext,
  activeReconcileMs,
  finalizingGraceAfterHistoryRead,
  failureDetailGraceMs,
  notificationQueue,
  hasRuntime,
  recoverAdmission,
  turnOutcomes,
  outcomeNotice,
  resultDeliveryFailureMessage
}) {
  const activity = createCodexTurnActivity({
    journal,
    output,
    settlement,
    createRuntime,
    createStore,
    debugLog,
    turnState,
    turnStateFromAgentRun,
    scheduleActiveRecovery: scheduleCodexAppServerActiveRecovery
  });
  const endings = createCodexTurnEndings({
    journal,
    output,
    settlement,
    createRuntime,
    debugLog,
    debugError,
    turnState,
    failureDetailGraceMs,
    turnOutcomes,
    outcomeNotice,
    resultDeliveryFailureMessage,
    captureContext,
    runInContext,
    notificationQueue,
    finalizingGraceAfterHistoryRead,
    scheduleActiveRecovery: scheduleCodexAppServerActiveRecovery
  });

  function scheduleCodexAppServerActiveRecovery(sessionId = "", delayMs = activeReconcileMs) {
    const normalizedSessionId = normalizeText(sessionId);
    const sessionKey = namespace(normalizedSessionId);
    const projectContext = captureContext();
    if (!normalizedSessionId || journal.activeTimers.has(sessionKey)) {
      return;
    }
    const timer = setTimeout(() => {
      journal.activeTimers.delete(sessionKey);
      void runInContext(
        projectContext,
        () => recoverCodexAppServerActiveTurn(normalizedSessionId)
      );
    }, delayMs);
    timer.unref();
    journal.activeTimers.set(sessionKey, timer);
  }

  async function reconcileCodexAppServerActiveTurn(session = {}, {
    provider: suppliedProvider = null,
    runtime = null,
    providerError = null
  } = {}) {
    const sessionId = normalizeText(session.sessionId);
    const trackedTurn = turnState(session);
    if (!sessionId || !trackedTurn.active || !trackedTurn.threadId || !hasRuntime(session)) {
      return session;
    }
    const provider = suppliedProvider || await acquireProvider({ sessionId, runtime, session });
    if (!provider) {
      if (trackedTurn.state === "finalizing") {
        await endings.recoverFinalizingTurn(
          sessionId,
          trackedTurn.threadId,
          trackedTurn.turnId,
          {
            status: trackedTurn.status || "completed"
          }
        );
        const activeRuntime = runtime || await createRuntime();
        return activeRuntime.getSession(sessionId);
      }
      return session;
    }
    const activeRuntime = runtime || await createRuntime();
    let currentSession = session;
    let currentTurn = trackedTurn;
    let thread = await codexAppServerReadThreadStatus(provider, trackedTurn.threadId);
    let status = codexAppServerThreadStatus(thread);
    let providerTurnId = codexAppServerThreadTurnId(thread);
    const promptDeliveryIsLocal = promptDeliveries.has(
      namespace(sessionId)
    );
    if (
      currentTurn.state === "starting" &&
      !currentTurn.turnId &&
      !promptDeliveryIsLocal
    ) {
      const ownership = codexAppServerPendingUserMessageOwnership(
        codexAppServerAgentRun(currentSession)
      );
      if (!ownership) {
        return journal.failOrphanedPromptDelivery(
          activeRuntime,
          currentSession,
          currentTurn
        );
      }
      const providerThread = await provider.readThread(currentTurn.threadId);
      const ownedProviderTurn = codexAppServerProviderTurnForOperation(providerThread, {
        clientMessageId: ownership.clientId
      });
      if (!ownedProviderTurn) {
        return journal.failOrphanedPromptDelivery(
          activeRuntime,
          currentSession,
          currentTurn
        );
      }
      thread = {
        ...providerThread,
        observedTurn: ownedProviderTurn
      };
      status = codexAppServerThreadStatus(thread);
      providerTurnId = codexAppServerThreadTurnId(thread);
      if (!providerTurnId) {
        return journal.failOrphanedPromptDelivery(
          activeRuntime,
          currentSession,
          currentTurn
        );
      }
      await activity.markProviderTurnActive(sessionId, {
        inputSource: ownership.inputSource,
        source: "owned_prompt_recovery",
        status: codexAppServerTurnStatusIsActive(status) ? status : "inProgress",
        threadId: currentTurn.threadId,
        turnId: providerTurnId
      });
      await journal.writeUserMessageOwnership(
        activeRuntime.store,
        sessionId,
        ownership.clientId,
        {
          eventKind: "codex-app-server-user-message-consumed",
          owned: false
        }
      );
      currentSession = await activeRuntime.getSession(sessionId);
      currentTurn = turnState(currentSession);
      debugLog("appServerPrompt.recovered", {
        clientMessageId: ownership.clientId,
        sessionId,
        status,
        threadId: currentTurn.threadId,
        turnId: currentTurn.turnId
      });
    }
    if (
      providerTurnId &&
      codexAppServerTurnCanAdoptSuccessor(currentTurn, currentTurn.threadId, providerTurnId)
    ) {
      const adoption = await settlement.adoptSuccessorTurn(sessionId, {
        previousTurnId: currentTurn.turnId,
        source: "active_reconciliation",
        status: "inProgress",
        threadId: currentTurn.threadId,
        turnId: providerTurnId
      });
      currentSession = await activeRuntime.getSession(sessionId);
      currentTurn = turnState(currentSession);
      if (!adoption.processed && adoption.reason !== "already_current") {
        if (currentTurn.state === "starting") {
          scheduleCodexAppServerActiveRecovery(sessionId);
        }
        return currentSession;
      }
    }
    if (currentTurn.state === "finalizing") {
      await endings.recoverFinalizingTurn(sessionId, currentTurn.threadId, currentTurn.turnId, {
        status: currentTurn.status || "completed"
      });
      return activeRuntime.getSession(sessionId);
    }
    if (currentTurn.state === "starting") {
      if (codexAppServerTurnStatusIsActive(status) && providerTurnId) {
        await activity.markProviderTurnActive(sessionId, {
          source: "active_reconciliation",
          status,
          threadId: currentTurn.threadId,
          turnId: providerTurnId
        });
        return activeRuntime.getSession(sessionId);
      }
      if (codexAppServerTurnStatusIsActive(status) || !status) {
        scheduleCodexAppServerActiveRecovery(sessionId);
        return currentSession;
      }
      // A local prompt delivery owns the outcome of its own starting turn.
      if (promptDeliveryIsLocal) {
        return currentSession;
      }
      if (!providerTurnId || !codexAppServerTurnStatusIsComplete(status)) {
        return journal.failOrphanedPromptDelivery(activeRuntime, currentSession, currentTurn);
      }
      await activity.markProviderTurnActive(sessionId, {
        source: "active_reconciliation",
        status: "inProgress",
        threadId: currentTurn.threadId,
        turnId: providerTurnId
      });
      currentSession = await activeRuntime.getSession(sessionId);
      currentTurn = turnState(currentSession);
    }
    if (!status || codexAppServerTurnStatusIsActive(status)) {
      if (currentTurn.state === "starting") {
        scheduleCodexAppServerActiveRecovery(sessionId);
      }
      return currentSession;
    }
    if (!codexAppServerTurnStatusIsComplete(status)) {
      return currentSession;
    }
    if (journal.turnIsUnstarted(currentTurn.threadId, currentTurn.turnId)) {
      // Codex may have accepted this turn without starting it: its thread reads idle until it does. Only Codex's own
      // listing of the turn as finished settles it before a notification about the turn arrives.
      const observed = await codexAppServerReadThreadStatus(provider, currentTurn.threadId, { observeLatestTurn: true });
      if (!codexAppServerObservedTurnFinished(observed, currentTurn.turnId)) {
        debugLog("appServerTurn.reconcile.awaitingProviderStart", {
          sessionId,
          status,
          threadId: currentTurn.threadId,
          turnId: currentTurn.turnId
        });
        scheduleCodexAppServerActiveRecovery(sessionId);
        return currentSession;
      }
      journal.noteTurnReported(currentTurn.threadId, currentTurn.turnId);
    }
    const completedTurnId = providerTurnId || currentTurn.turnId;
    debugLog("appServerTurn.reconcile.complete", {
      sessionId,
      status,
      threadId: currentTurn.threadId,
      turnId: completedTurnId
    });
    if (codexAppServerTurnStatusIsProviderFailure(status)) {
      const exactError = providerError?.threadId === currentTurn.threadId && providerError?.turnId === completedTurnId;
      await endings.stopTurnWithProviderFailure(sessionId, currentTurn.threadId, completedTurnId, {
        error: exactError ? providerError.error : codexAppServerThreadError(thread),
        failureDetailReady: exactError,
        provider,
        status
      });
    } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
      await endings.completeTurn(sessionId, currentTurn.threadId, completedTurnId, {
        status,
        verifyInactive: false
      });
    }
    return activeRuntime.getSession(sessionId);
  }

  async function recoverCodexAppServerActiveTurn(sessionId = "", {
    provider = null,
    retryOnError = true,
    runtime: suppliedRuntime = null,
    providerError = null
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    try {
      const runtime = suppliedRuntime || await createRuntime();
      const storedSession = await runtime.getSession(normalizedSessionId);
      const abandonedClaim = await recoverAdmission(
        runtime,
        storedSession,
        {
          promptDeliveryActive: promptDeliveries.has(
            namespace(normalizedSessionId)
          )
        }
      );
      const session = abandonedClaim.session;
      if (abandonedClaim.recovered) {
        return session;
      }
      const turn = turnState(session);
      if (!["active", "starting"].includes(turn.state) || !turn.threadId) {
        return session;
      }
      const reconciledSession = await reconcileCodexAppServerActiveTurn(session, {
        provider,
        runtime,
        providerError
      });
      const currentTurn = turnState(reconciledSession);
      if (currentTurn.state === "starting" && currentTurn.threadId) {
        scheduleCodexAppServerActiveRecovery(normalizedSessionId);
      }
      return reconciledSession;
    } catch (error) {
      debugLog("appServerTurn.reconcile.error", {
        error: debugError(error),
        sessionId: normalizedSessionId
      });
      if (!retryOnError) {
        throw error;
      }
      const store = await Promise.resolve()
        .then(() => createStore(normalizedSessionId))
        .catch(() => null);
      const run = store
        ? await output.readAgentRunForSession(store, normalizedSessionId).catch(() => null)
        : null;
      if (turnStateFromAgentRun(run || {}).state === "starting") {
        scheduleCodexAppServerActiveRecovery(normalizedSessionId);
      }
      return null;
    }
  }

  return Object.freeze({
    scheduleActiveRecovery: scheduleCodexAppServerActiveRecovery,
    markTurnActive: activity.markTurnActive,
    markProviderTurnActive: activity.markProviderTurnActive,
    recoverFinalizingTurn: endings.recoverFinalizingTurn,
    recoverActiveTurn: recoverCodexAppServerActiveTurn,
    completeTurn: endings.completeTurn,
    stopTurnWithProviderFailure: endings.stopTurnWithProviderFailure
  });
}

/** @typedef {ReturnType<typeof createCodexTurnRecovery>} CodexTurnRecovery */
