import {
  codexAppServerTurnStatusIsActive,
  codexAppServerTurnStatusIsComplete,
  codexAppServerTurnStatusIsSuccessfulComplete,
  codexAppServerTurnStatusIsProviderFailure,
  codexAppServerThreadStatus,
  codexAppServerReadThreadStatus,
  normalizeCodexRunText,
  codexAppServerAgentRun,
  codexAppServerPendingUserMessageClientIds,
  codexAppServerPendingUserMessageOwnership,
  codexAppServerTurnOwnsActiveGoal,
  codexAppServerTurnCanReceiveProviderCompletion,
  codexAppServerTurnAwaitsProviderIdentity,
  codexAppServerTurnCanReceiveProviderActivity,
  codexAppServerTurnCanAdoptSuccessor,
  codexAppServerTurnKey,
  CODEX_APP_SERVER_RUN_STATE
} from "./codexTurnState.js";
import {
  codexAppServerProviderTurnForOperation,
  codexAppServerThreadTurnId,
  codexAppServerThreadError
} from "./codexEvents.js";

// Original active/finalizing recovery, provider activity and completion decisions.
// Timers and receipts remain owned by the shared journal/output/settlement instances.
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
  hasRuntime,
  recoverAdmission,
  turnOutcomes,
  outcomeNotice,
  resultDeliveryFailureMessage
}) {
  const {
    finalizedTurns: codexAppServerFinalizedTurns,
    resultFinalizationKey: codexAppServerResultFinalizationKey,
    readAgentRunForSession: readCodexAppServerAgentRunForSession,
    cleanupUntrackedTurn: cleanupCodexAppServerUntrackedTurn
  } = output;
  const {
    completedTurns: codexAppServerCompletedTurns,
    activeTimers: codexAppServerActiveTimers,
    finalizingTimers: codexAppServerFinalizingTimers,
    turnResultWasProcessed: codexAppServerTurnResultWasProcessed,
    clearActiveTimer: clearCodexAppServerActiveTimer,
    clearFinalizingTimer: clearCodexAppServerFinalizingTimer,
    publishAgentRun: publishCodexAppServerAgentRun,
    markTurnFinalizing: markCodexAppServerTurnFinalizing,
    markTurnIdle: markCodexAppServerTurnIdle,
    resolveTurnId: resolveCodexAppServerTurnId,
    finalizingExpired: codexAppServerFinalizingExpired,
    finalizingRemainingMs: codexAppServerFinalizingRemainingMs,
    turnWasCompleted: codexAppServerTurnWasCompleted,
    runInputSource: codexAppServerRunInputSource,
    writeUserMessageOwnership: writeCodexAppServerUserMessageOwnership,
    recoverAbandonedPromptClaim: recoverAbandonedCodexAppServerPromptClaim,
    failOrphanedPromptDelivery: failOrphanedCodexAppServerPromptDelivery
  } = journal;
  const {
    finalizeAssistantResult: finalizeCodexAppServerAssistantResult,
    recoverFinalResponseBeforeOutcome: recoverCodexAppServerFinalResponseBeforeOutcome,
    adoptSuccessorTurn: adoptCodexAppServerSuccessorTurn
  } = settlement;
  const codexAppServerPromptDeliveries = promptDeliveries;

  function scheduleCodexAppServerActiveRecovery(sessionId = "", delayMs = activeReconcileMs) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
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
    timer.unref?.();
    codexAppServerActiveTimers.set(sessionKey, timer);
  }

  function scheduleCodexAppServerFinalizingRecovery(sessionId = "", threadId = "", turnId = "", {
    completedAt = "",
    status = "completed",
    updatedAt = ""
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
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
    const delayMs = codexAppServerFinalizingRemainingMs({
      completedAt,
      state: "finalizing",
      updatedAt
    });
    const timer = setTimeout(() => {
      codexAppServerFinalizingTimers.delete(key);
      void runInContext(
        projectContext,
        () => recoverCodexAppServerFinalizingTurn(
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          { status }
        )
      );
    }, delayMs);
    timer.unref?.();
    codexAppServerFinalizingTimers.set(key, timer);
  }

  async function reconcileCodexAppServerActiveTurn(session = {}, {
    provider: suppliedProvider = null,
    runtime = null
  } = {}) {
    const sessionId = normalizeCodexRunText(session.sessionId);
    const trackedTurn = turnState(session);
    if (!sessionId || !trackedTurn.active || !trackedTurn.threadId || !hasRuntime(session)) {
      return session;
    }
    const provider = suppliedProvider || await acquireProvider({ sessionId, runtime, session });
    if (typeof provider?.readThreadStatus !== "function") {
      if (trackedTurn.state === "finalizing") {
        await recoverCodexAppServerFinalizingTurn(
          sessionId,
          trackedTurn.threadId,
          trackedTurn.turnId,
          {
            status: trackedTurn.status || "completed"
          }
        );
        const runtime = await createRuntime();
        return runtime.getSession(sessionId);
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
      if (!ownership || typeof provider?.readThread !== "function") {
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
      if (!promptDeliveryIsLocal && (!providerTurnId || !codexAppServerTurnStatusIsComplete(status))) {
        return failOrphanedCodexAppServerPromptDelivery(activeRuntime, currentSession, currentTurn);
      }
      if (promptDeliveryIsLocal) {
        return currentSession;
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
      await stopCodexAppServerTurnWithProviderFailure(sessionId, currentTurn.threadId, completedTurnId, {
        error: codexAppServerThreadError(thread),
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

  async function codexAppServerProviderBlocksTurnRelease(sessionId = "", provider = null, threadId = "", turnId = "", {
    source = ""
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    if (!normalizedSessionId || !normalizedThreadId) {
      return false;
    }
    const runtime = await createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = turnState(session);
    if (!turn.active || !codexAppServerTurnCanReceiveProviderActivity(turn, normalizedThreadId, normalizedTurnId)) {
      return false;
    }
    try {
      const providerThread = await codexAppServerReadThreadStatus(provider, normalizedThreadId, {
        observeLatestTurn: true
      });
      if (!providerThread) {
        return false;
      }
      const status = codexAppServerThreadStatus(providerThread);
      const providerTurnId = codexAppServerThreadTurnId(providerThread);
      if (
        providerTurnId &&
        providerTurnId !== normalizeCodexRunText(turn.turnId)
      ) {
        debugLog("appServerTurn.releaseAllowedSuccessor", {
          providerTurnId,
          sessionId: normalizedSessionId,
          source: normalizeCodexRunText(source),
          threadId: normalizedThreadId,
          turnId: turn.turnId
        });
        return false;
      }
      if (!codexAppServerTurnStatusIsActive(status)) {
        return false;
      }
      debugLog("appServerTurn.releaseBlockedActive", {
        sessionId: normalizedSessionId,
        source: normalizeCodexRunText(source),
        status,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId || turn.turnId
      });
      scheduleCodexAppServerActiveRecovery(normalizedSessionId);
      return true;
    } catch (error) {
      debugLog("appServerTurn.releaseCheck.error", {
        error: debugError(error),
        sessionId: normalizedSessionId,
        source: normalizeCodexRunText(source),
        threadId: normalizedThreadId,
        turnId: normalizedTurnId || turn.turnId
      });
      return false;
    }
  }

  async function markCodexAppServerTurnActive(sessionId = "", input = {}) {
    if (input.requireTrackedTurn === true) {
      const runtime = await createRuntime();
      const session = await runtime.getSession(sessionId);
      const turn = turnState(session);
      if (!codexAppServerTurnCanReceiveProviderActivity(turn, input.threadId, input.turnId)) {
        debugLog("appServerTurn.active.ignored", {
          currentState: turn.state,
          currentStatus: turn.status,
          currentThreadId: turn.threadId,
          currentTurnId: turn.turnId,
          sessionId: normalizeCodexRunText(sessionId),
          threadId: normalizeCodexRunText(input.threadId),
          turnId: normalizeCodexRunText(input.turnId)
        });
        return {
          ok: true,
          processed: false,
          reason: "untracked_terminal_turn"
        };
      }
    }
    const status = normalizeCodexRunText(input.status) || "inProgress";
    const result = await publishCodexAppServerAgentRun(sessionId, {
      inputSource: normalizeCodexRunText(input.inputSource),
      phase: input.phase,
      publishReason: "codex-app-server-turn-active",
      observedRun: input.observedRun,
      runState: status === "starting" ? CODEX_APP_SERVER_RUN_STATE.STARTING : CODEX_APP_SERVER_RUN_STATE.ACTIVE,
      status,
      threadId: normalizeCodexRunText(input.threadId),
      turnId: normalizeCodexRunText(input.turnId)
    });
    if (status === "starting") {
      scheduleCodexAppServerActiveRecovery(sessionId);
    } else {
      clearCodexAppServerActiveTimer(sessionId);
    }
    return result;
  }

  async function markCodexAppServerProviderTurnActive(sessionId = "", input = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(input.threadId);
    const normalizedTurnId = normalizeCodexRunText(input.turnId);
    const requestedStatus = normalizeCodexRunText(input.status) || "inProgress";
    const store = await createStore(normalizedSessionId);
    const persistedRun = await readCodexAppServerAgentRunForSession(
      store,
      normalizedSessionId
    );
    const persistedTurn = turnStateFromAgentRun(persistedRun || {});
    const requestedInputSource = normalizeCodexRunText(input.inputSource);
    if (
      persistedTurn.active &&
      persistedTurn.state === "active" &&
      persistedTurn.threadId === normalizedThreadId &&
      persistedTurn.turnId === normalizedTurnId &&
      codexAppServerTurnStatusIsActive(requestedStatus) &&
      (!requestedInputSource || requestedInputSource === persistedTurn.inputSource)
    ) {
      clearCodexAppServerActiveTimer(normalizedSessionId);
      return {
        ok: true,
        processed: false,
        reason: "already_active"
      };
    }
    const runtime = await createRuntime();
    let session = await runtime.getSession(normalizedSessionId);
    let turn = turnState(session);
    if (
      input.observedRun &&
      [CODEX_APP_SERVER_RUN_STATE.FAILED, CODEX_APP_SERVER_RUN_STATE.INTERRUPTED].includes(turn.runState) &&
      turn.threadId === normalizedThreadId &&
      turn.turnId === normalizedTurnId &&
      !codexAppServerTurnResultWasProcessed(session, normalizedThreadId, normalizedTurnId)
    ) {
      const recovered = await markCodexAppServerTurnActive(normalizedSessionId, {
        inputSource: turn.inputSource,
        observedRun: input.observedRun,
        status: requestedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      if (recovered.processed !== false) {
        codexAppServerCompletedTurns.delete(codexAppServerTurnKey(normalizedThreadId, normalizedTurnId));
        codexAppServerFinalizedTurns.delete(codexAppServerResultFinalizationKey(
          normalizedSessionId, normalizedThreadId, normalizedTurnId
        ));
      }
      return recovered;
    }
    if (codexAppServerTurnWasCompleted(session, normalizedThreadId, normalizedTurnId)) {
      debugLog("appServerProviderTurn.completed.ignored", {
        currentState: turn.state,
        currentThreadId: turn.threadId,
        currentTurnId: turn.turnId,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: "completed_turn"
      };
    }
    if (
      turn.state === "finalizing" &&
      codexAppServerTurnCanAdoptSuccessor(turn, normalizedThreadId, normalizedTurnId) &&
      codexAppServerTurnResultWasProcessed(session, normalizedThreadId, turn.turnId)
    ) {
      await finalizeCodexAppServerAssistantResult(
        normalizedSessionId,
        normalizedThreadId,
        turn.turnId,
        {
          status: turn.status || "completed"
        }
      );
      session = await runtime.getSession(normalizedSessionId);
      turn = turnState(session);
    }
    const currentRun = codexAppServerAgentRun(session);
    const pendingInputSource = codexAppServerPendingUserMessageClientIds(currentRun).length > 0
      ? codexAppServerRunInputSource(currentRun)
      : "";
    const goalInputSource = codexAppServerTurnOwnsActiveGoal(turn, normalizedThreadId)
      ? codexAppServerRunInputSource(currentRun)
      : "";
    const inputSource = normalizeCodexRunText(input.inputSource) || pendingInputSource || goalInputSource;
    if (codexAppServerTurnCanReceiveProviderActivity(turn, normalizedThreadId, normalizedTurnId)) {
      return markCodexAppServerTurnActive(normalizedSessionId, {
        inputSource,
        status: requestedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
    }
    if (codexAppServerTurnCanAdoptSuccessor(turn, normalizedThreadId, normalizedTurnId)) {
      return adoptCodexAppServerSuccessorTurn(normalizedSessionId, {
        previousTurnId: turn.turnId,
        source: normalizeCodexRunText(input.source) || "provider_activity",
        status: requestedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
    }
    if (turn.active || !normalizedTurnId) {
      debugLog("appServerProviderTurn.active.ignored", {
        currentState: turn.state,
        currentStatus: turn.status,
        currentThreadId: turn.threadId,
        currentTurnId: turn.turnId,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: turn.active ? "active_turn_mismatch" : "missing_turn"
      };
    }
    return markCodexAppServerTurnActive(normalizedSessionId, {
      inputSource: inputSource || "terminal",
      status: requestedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
  }

  async function recoverCodexAppServerFinalizingTurn(sessionId = "", threadId = "", turnId = "", {
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
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
    if (!codexAppServerFinalizingExpired(turn)) {
      scheduleCodexAppServerFinalizingRecovery(normalizedSessionId, normalizedThreadId, normalizedTurnId, {
        completedAt: turn.completedAt,
        status,
        updatedAt: turn.updatedAt
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
    runtime: suppliedRuntime = null
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    if (!normalizedSessionId) {
      return null;
    }
    try {
      const runtime = suppliedRuntime || await createRuntime();
      const storedSession = await runtime.getSession(normalizedSessionId);
      const abandonedClaim = await (recoverAdmission || recoverAbandonedCodexAppServerPromptClaim)(
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
        runtime
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

  async function completeCodexAppServerTurn(sessionId = "", threadId = "", turnId = "", {
    provider = null,
    status = "completed",
    verifyInactive = true
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    const normalizedStatus = normalizeCodexRunText(status) || "completed";
    const runtime = await createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const existingTurn = turnState(session);
    const continuesOwnedGoal = codexAppServerTurnOwnsActiveGoal(
      existingTurn,
      normalizedThreadId
    );
    if (codexAppServerTurnAwaitsProviderIdentity(existingTurn, normalizedThreadId, normalizedTurnId)) {
      return {
        ok: true,
        processed: false,
        reason: "turn_identity_pending"
      };
    }
    if (!normalizedTurnId) {
      if (!codexAppServerTurnCanReceiveProviderCompletion(existingTurn, normalizedThreadId, "")) {
        cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
        debugLog("appServerTurn.complete.stale", {
          currentState: existingTurn.state,
          currentStatus: existingTurn.status,
          currentThreadId: existingTurn.threadId,
          currentTurnId: existingTurn.turnId,
          sessionId: normalizedSessionId,
          status: normalizedStatus,
          threadId: normalizedThreadId,
          turnId: normalizedTurnId
        });
        return {
          ok: true,
          processed: false,
          reason: "stale_turn_state"
        };
      }
      if (verifyInactive && await codexAppServerProviderBlocksTurnRelease(normalizedSessionId, provider, normalizedThreadId, normalizedTurnId, {
        source: "complete_missing_turn"
      })) {
        return {
          ok: true,
          processed: false,
          reason: "provider_still_active",
          status: "inProgress"
        };
      }
      await markCodexAppServerTurnIdle(normalizedSessionId, {
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: "missing_turn"
      };
    }
    if (!codexAppServerTurnCanReceiveProviderCompletion(existingTurn, normalizedThreadId, normalizedTurnId)) {
      codexAppServerFinalizedTurns.add(codexAppServerResultFinalizationKey(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      ));
      cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
      debugLog("appServerTurn.complete.stale", {
        currentState: existingTurn.state,
        currentStatus: existingTurn.status,
        currentThreadId: existingTurn.threadId,
        currentTurnId: existingTurn.turnId,
        sessionId: normalizedSessionId,
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: "stale_turn_state"
      };
    }
    if (verifyInactive && await codexAppServerProviderBlocksTurnRelease(normalizedSessionId, provider, normalizedThreadId, normalizedTurnId, {
      source: "complete"
    })) {
      return {
        ok: true,
        processed: false,
        reason: "provider_still_active",
        status: "inProgress"
      };
    }
    if (codexAppServerRunInputSource(codexAppServerAgentRun(session)) === "terminal") {
      codexAppServerCompletedTurns.add(codexAppServerTurnKey(normalizedThreadId, normalizedTurnId));
      cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
      await markCodexAppServerTurnIdle(normalizedSessionId, {
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: true,
        reason: "terminal_turn_completed"
      };
    }
    const alreadyFinalizing = existingTurn.state === "finalizing" &&
      existingTurn.threadId === normalizedThreadId &&
      existingTurn.turnId === normalizedTurnId;
    codexAppServerCompletedTurns.add(codexAppServerTurnKey(normalizedThreadId, normalizedTurnId));
    if (!alreadyFinalizing) {
      await markCodexAppServerTurnFinalizing(normalizedSessionId, {
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
    }
    if (continuesOwnedGoal) {
      // Keep the outer chat turn active so the next provider turn can adopt
      // its chat ownership without exposing this internal final as an answer.
      clearCodexAppServerFinalizingTimer(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      );
      return {
        ok: true,
        processed: true,
        reason: "goal_continuation_pending"
      };
    }
    return recoverCodexAppServerFinalizingTurn(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      {
        status: normalizedStatus
      }
    );
  }

  function codexAppServerStoppedTurnMessage(status = "", error = "") {
    const normalizedStatus = normalizeCodexRunText(status);
    const base = normalizedStatus === "interrupted"
      ? "Codex app-server was interrupted before completing this turn."
      : "Codex app-server failed before completing this turn.";
    const normalizedError = normalizeCodexRunText(error);
    return normalizedError ? `${base} ${normalizedError}` : base;
  }

  async function stopCodexAppServerTurnWithProviderFailure(sessionId = "", threadId = "", turnId = "", {
    error = "",
    ok = false,
    outcome = turnOutcomes.PROVIDER_FAILURE,
    provider = null,
    status = "failed",
    usageLimitExceeded = false,
    verifyInactive = true
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    const normalizedStatus = normalizeCodexRunText(status) || "failed";
    const runtime = await createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = turnState(session);
    if (!codexAppServerTurnCanReceiveProviderCompletion(turn, normalizedThreadId, normalizedTurnId)) {
      debugLog("appServerTurn.failure.stale", {
        currentState: turn.state,
        currentStatus: turn.status,
        currentThreadId: turn.threadId,
        currentTurnId: turn.turnId,
        sessionId: normalizedSessionId,
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: "stale_turn_state"
      };
    }
    const recovered = await recoverCodexAppServerFinalResponseBeforeOutcome(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      normalizedStatus
    );
    if (recovered?.processed) {
      return recovered;
    }
    // History recovery awaited the provider. Confirm activity again before
    // publishing a failure, because the goal may have continued in that gap.
    if (verifyInactive && await codexAppServerProviderBlocksTurnRelease(normalizedSessionId, provider, normalizedThreadId, normalizedTurnId, {
      source: "provider_failure"
    })) {
      return {
        ok: true,
        processed: false,
        reason: "provider_still_active",
        status: "inProgress"
      };
    }
    const message = codexAppServerStoppedTurnMessage(normalizedStatus, error);
    await outcomeNotice(
      runtime,
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      outcome,
      error,
      { usageLimitExceeded }
    );
    await markCodexAppServerTurnIdle(normalizedSessionId, {
      error: message,
      status: normalizedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
      turnOutcome: outcome
    });
    cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
    return {
      ok,
      error: message,
      status: normalizedStatus
    };
  }

  async function stopCodexAppServerTurnWithResultDeliveryFailure(sessionId = "", threadId = "", turnId = "", {
    error = "",
    reason = "",
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedStatus = normalizeCodexRunText(status) || "completed";
    const normalizedTurnId = await resolveCodexAppServerTurnId(normalizedSessionId, normalizedThreadId, turnId);
    const runtime = await createRuntime();
    const currentSession = await runtime.getSession(normalizedSessionId);
    const currentTurn = turnState(currentSession);
    const recovered = await recoverCodexAppServerFinalResponseBeforeOutcome(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      normalizedStatus
    );
    if (recovered?.processed) {
      return recovered;
    }
    if (!codexAppServerTurnCanReceiveProviderCompletion(currentTurn, normalizedThreadId, normalizedTurnId)) {
      codexAppServerFinalizedTurns.add(codexAppServerResultFinalizationKey(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      ));
      cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
      debugLog("appServerAgentResult.missing.stale", {
        currentState: currentTurn.state,
        currentStatus: currentTurn.status,
        currentThreadId: currentTurn.threadId,
        currentTurnId: currentTurn.turnId,
        reason: normalizeCodexRunText(reason),
        sessionId: normalizedSessionId,
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ok: true,
        processed: false,
        reason: "stale_turn_state",
        status: currentTurn.status
      };
    }
    const message = resultDeliveryFailureMessage({
      error
    });
    await outcomeNotice(
      runtime,
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      turnOutcomes.RESPONSE_DELIVERY_FAILURE
    );
    await markCodexAppServerTurnIdle(normalizedSessionId, {
      error: message,
      status: normalizedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
      turnOutcome: turnOutcomes.RESPONSE_DELIVERY_FAILURE
    });
    cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
    debugLog("appServerAgentResult.missing", {
      error: normalizeCodexRunText(error),
      reason: normalizeCodexRunText(reason),
      sessionId: normalizedSessionId,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
    return {
      ok: false,
      error: message,
      status: normalizedStatus
    };
  }

  return {
    scheduleActiveRecovery: scheduleCodexAppServerActiveRecovery,
    markTurnActive: markCodexAppServerTurnActive,
    markProviderTurnActive: markCodexAppServerProviderTurnActive,
    recoverFinalizingTurn: recoverCodexAppServerFinalizingTurn,
    recoverActiveTurn: recoverCodexAppServerActiveTurn,
    completeTurn: completeCodexAppServerTurn,
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure
  };
}
