import { codexAppServerTurnStatusIsActive, codexAppServerTurnStatusIsComplete, codexAppServerTurnStatusIsSuccessfulComplete, codexAppServerTurnStatusIsProviderFailure, codexAppServerThreadStatus, codexAppServerReadThreadStatus, codexAppServerAgentRun, codexAppServerPendingUserMessageOwnership, codexAppServerTurnOwnsActiveGoal, codexAppServerTurnCanAdoptSuccessor } from "./codexTurnState.js";
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
  const {
    resultFinalizationKey: codexAppServerResultFinalizationKey,
    readAgentRunForSession: readCodexAppServerAgentRunForSession
  } = output;
  const {
    activeTimers: codexAppServerActiveTimers,
    finalizingTimers: codexAppServerFinalizingTimers,
    clearFinalizingTimer: clearCodexAppServerFinalizingTimer,
    finalizingExpired: codexAppServerFinalizingExpired,
    finalizingRemainingMs: codexAppServerFinalizingRemainingMs,
    writeUserMessageOwnership: writeCodexAppServerUserMessageOwnership,
    failOrphanedPromptDelivery: failOrphanedCodexAppServerPromptDelivery
  } = journal;
  const {
    finalizeAssistantResult: finalizeCodexAppServerAssistantResult,
    adoptSuccessorTurn: adoptCodexAppServerSuccessorTurn
  } = settlement;
  const codexAppServerPromptDeliveries = promptDeliveries;
  const retainFinalizingTimer = finalizingGraceAfterHistoryRead || failureDetailGraceMs > 0;
  const {
    markTurnActive: markCodexAppServerTurnActive,
    markProviderTurnActive: markCodexAppServerProviderTurnActive
  } = createCodexTurnActivity({
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
  const {
    completeTurn: completeCodexAppServerTurn,
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure,
    stopTurnWithResultDeliveryFailure: stopCodexAppServerTurnWithResultDeliveryFailure
  } = createCodexTurnEndings({
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
    scheduleActiveRecovery: scheduleCodexAppServerActiveRecovery,
    scheduleFinalizingRecovery: scheduleCodexAppServerFinalizingRecovery,
    recoverFinalizingTurn: recoverCodexAppServerFinalizingTurn
  });

  function scheduleCodexAppServerActiveRecovery(sessionId = "", delayMs = activeReconcileMs) {
    const normalizedSessionId = normalizeText(sessionId);
    const sessionKey = namespace(normalizedSessionId);
    const projectContext = captureContext();
    if (!normalizedSessionId || codexAppServerActiveTimers.has(sessionKey)) {
      return;
    }
    const timer = setTimeout(() => {
      codexAppServerActiveTimers.delete(sessionKey);
      void runInContext(
        projectContext,
        () => recoverCodexAppServerActiveTurn(normalizedSessionId)
      );
    }, delayMs);
    timer.unref();
    codexAppServerActiveTimers.set(sessionKey, timer);
  }

  function scheduleCodexAppServerFinalizingRecovery(sessionId = "", threadId = "", turnId = "", {
    completedAt = "",
    status = "completed",
    updatedAt = "",
    failureDetail = null
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId) {
      return;
    }
    clearCodexAppServerFinalizingTimer(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const key = codexAppServerResultFinalizationKey(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId
    );
    const projectContext = captureContext();
    const delayMs = failureDetail
      ? Math.max(0, failureDetail.expiresAt - Date.now())
      : codexAppServerFinalizingRemainingMs({ completedAt, state: "finalizing", updatedAt });
    // One record per pending deadline: `recovery` is the in-flight expiry
    // (retained-timer policy only), `expiresAt` the first deadline that a later
    // failure-detail grace may not exceed, `failureDetail` a deferred provider
    // failure, and `startedAt` the post-read clock that rereads must keep.
    const entry = {
      timer: null,
      recovery: null,
      expiresAt: failureDetailGraceMs > 0 ? Date.now() + delayMs : null,
      failureDetail,
      startedAt: !failureDetail && finalizingGraceAfterHistoryRead ? completedAt : ""
    };
    entry.timer = setTimeout(() => {
      if (failureDetail) {
        notificationQueue.run({ projectContext, provider: failureDetail.provider, sessionId: normalizedSessionId }, async () => {
          if (codexAppServerFinalizingTimers.get(key) !== entry) return;
          try {
            return await stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, normalizedThreadId, normalizedTurnId,
              { ...failureDetail, failureDetailReady: true });
          } finally {
            if (codexAppServerFinalizingTimers.get(key) === entry) {
              clearCodexAppServerFinalizingTimer(normalizedSessionId, normalizedThreadId, normalizedTurnId);
            }
          }
        });
        return;
      }
      // The post-read policy keeps its first clock while expiry rereads history.
      if (!retainFinalizingTimer) codexAppServerFinalizingTimers.delete(key);
      const recovery = runInContext(
        projectContext,
        () => recoverCodexAppServerFinalizingTurn(
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          { status, timerRecovery: finalizingGraceAfterHistoryRead }
        )
      );
      if (retainFinalizingTimer) {
        entry.recovery = recovery;
        void recovery.then(
          () => { if (entry.recovery === recovery) entry.recovery = null; },
          error => {
            if (entry.recovery === recovery) entry.recovery = null;
            debugLog("appServerFinalizingRecovery.error", {
              error: debugError(error), sessionId: normalizedSessionId,
              threadId: normalizedThreadId, turnId: normalizedTurnId
            });
          }
        );
      } else {
        void recovery;
      }
    }, delayMs);
    entry.timer.unref();
    codexAppServerFinalizingTimers.set(key, entry);
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
        await recoverCodexAppServerFinalizingTurn(
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
    const promptDeliveryIsLocal = codexAppServerPromptDeliveries.has(
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
        return failOrphanedCodexAppServerPromptDelivery(
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
        return failOrphanedCodexAppServerPromptDelivery(
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
        return failOrphanedCodexAppServerPromptDelivery(
          activeRuntime,
          currentSession,
          currentTurn
        );
      }
      await markCodexAppServerProviderTurnActive(sessionId, {
        inputSource: ownership.inputSource,
        source: "owned_prompt_recovery",
        status: codexAppServerTurnStatusIsActive(status) ? status : "inProgress",
        threadId: currentTurn.threadId,
        turnId: providerTurnId
      });
      await writeCodexAppServerUserMessageOwnership(
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
      const adoption = await adoptCodexAppServerSuccessorTurn(sessionId, {
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
      await recoverCodexAppServerFinalizingTurn(sessionId, currentTurn.threadId, currentTurn.turnId, {
        status: currentTurn.status || "completed"
      });
      return activeRuntime.getSession(sessionId);
    }
    if (currentTurn.state === "starting") {
      if (codexAppServerTurnStatusIsActive(status) && providerTurnId) {
        await markCodexAppServerProviderTurnActive(sessionId, {
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
        return failOrphanedCodexAppServerPromptDelivery(activeRuntime, currentSession, currentTurn);
      }
      await markCodexAppServerProviderTurnActive(sessionId, {
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
    const completedTurnId = providerTurnId || currentTurn.turnId;
    debugLog("appServerTurn.reconcile.complete", {
      sessionId,
      status,
      threadId: currentTurn.threadId,
      turnId: completedTurnId
    });
    if (codexAppServerTurnStatusIsProviderFailure(status)) {
      const exactError = providerError?.threadId === currentTurn.threadId && providerError?.turnId === completedTurnId;
      await stopCodexAppServerTurnWithProviderFailure(sessionId, currentTurn.threadId, completedTurnId, {
        error: exactError ? providerError.error : codexAppServerThreadError(thread),
        failureDetailReady: exactError,
        provider,
        status
      });
    } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
      await completeCodexAppServerTurn(sessionId, currentTurn.threadId, completedTurnId, {
        status,
        verifyInactive: false
      });
    }
    return activeRuntime.getSession(sessionId);
  }

  async function recoverCodexAppServerFinalizingTurn(sessionId = "", threadId = "", turnId = "", {
    status = "completed", timerRecovery = false
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const key = codexAppServerResultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const priorTimer = retainFinalizingTimer ? codexAppServerFinalizingTimers.get(key) : null;
    if (!timerRecovery && priorTimer?.recovery) return priorTimer.recovery;
    const runtime = await createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = turnState(session);
    if (codexAppServerTurnOwnsActiveGoal(turn, normalizedThreadId)) {
      clearCodexAppServerFinalizingTimer(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      );
      return {
        ok: true,
        processed: false,
        reason: "goal_continuation_pending"
      };
    }
    const result = await finalizeCodexAppServerAssistantResult(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      {
        recoverFromProvider: true,
        status
      }
    );
    if (result?.processed) {
      return result;
    }
    // A later failure owns the same first deadline, even when this successful
    // history read was already in flight under the completion-based clock.
    const currentTimer = codexAppServerFinalizingTimers.get(key);
    if (currentTimer?.failureDetail) return result;
    if (retainFinalizingTimer && priorTimer && !currentTimer) return result;
    let graceTurn = turn;
    if (finalizingGraceAfterHistoryRead) {
      const readReturnedAt = new Date().toISOString();
      const currentTurn = turnState(await runtime.getSession(normalizedSessionId));
      const timer = codexAppServerFinalizingTimers.get(key);
      if (timer?.failureDetail || (priorTimer && !timer)) return result;
      if (currentTurn.state !== "finalizing" || currentTurn.threadId !== normalizedThreadId ||
          currentTurn.turnId !== normalizedTurnId) {
        clearCodexAppServerFinalizingTimer(normalizedSessionId, normalizedThreadId, normalizedTurnId);
        return { ...result, reason: "stale_turn_state" };
      }
      if (codexAppServerTurnOwnsActiveGoal(currentTurn, normalizedThreadId)) {
        clearCodexAppServerFinalizingTimer(normalizedSessionId, normalizedThreadId, normalizedTurnId);
        return { ok: true, processed: false, reason: "goal_continuation_pending" };
      }
      if (!timerRecovery && timer?.recovery) return timer.recovery;
      // This local clock never changes the native completion timestamp.
      graceTurn = { ...currentTurn, completedAt: timer?.startedAt || readReturnedAt };
    }
    if (!codexAppServerFinalizingExpired(graceTurn)) {
      scheduleCodexAppServerFinalizingRecovery(normalizedSessionId, normalizedThreadId, normalizedTurnId, {
        completedAt: graceTurn.completedAt,
        status,
        updatedAt: graceTurn.updatedAt
      });
      return result;
    }
    return stopCodexAppServerTurnWithResultDeliveryFailure(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      {
        error: result?.error,
        reason: result?.reason || "missing_assistant_text",
        status
      }
    );
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
          promptDeliveryActive: codexAppServerPromptDeliveries.has(
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
        ? await readCodexAppServerAgentRunForSession(store, normalizedSessionId).catch(() => null)
        : null;
      if (turnStateFromAgentRun(run || {}).state === "starting") {
        scheduleCodexAppServerActiveRecovery(normalizedSessionId);
      }
      return null;
    }
  }

  return Object.freeze({
    scheduleActiveRecovery: scheduleCodexAppServerActiveRecovery,
    markTurnActive: markCodexAppServerTurnActive,
    markProviderTurnActive: markCodexAppServerProviderTurnActive,
    recoverFinalizingTurn: recoverCodexAppServerFinalizingTurn,
    recoverActiveTurn: recoverCodexAppServerActiveTurn,
    completeTurn: completeCodexAppServerTurn,
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure
  });
}

/** @typedef {ReturnType<typeof createCodexTurnRecovery>} CodexTurnRecovery */
