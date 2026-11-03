import {
  codexAppServerTurnStatusIsActive,
  codexAppServerThreadStatus,
  codexAppServerReadThreadStatus,
  normalizeCodexRunText,
  codexAppServerAgentRun,
  codexAppServerTurnOwnsActiveGoal,
  codexAppServerTurnCanReceiveProviderCompletion,
  codexAppServerTurnAwaitsProviderIdentity,
  codexAppServerTurnCanReceiveProviderActivity,
  codexAppServerTurnKey
} from "./codexTurnState.js";
import { codexAppServerThreadTurnId } from "./codexThreadSnapshot.js";

/**
 * How a tracked turn ends: it completes, or it stops after a provider failure or a reply that could not be
 * delivered. Each ending checks that the provider has released the turn first.
 * @param {object} dependencies
 * @param {import("./codexRunJournal.js").CodexRunJournal} dependencies.journal
 * @param {import("./codexOutput.js").CodexAppServerOutput} dependencies.output
 * @param {import("./codexResultSettlement.js").CodexResultSettlement} dependencies.settlement
 * @param {import("./codexTurn.js").CodexCreateRuntime} dependencies.createRuntime
 * @param {import("./codexTurn.js").CodexDebugLog} dependencies.debugLog
 * @param {import("./codexTurn.js").CodexDebugError} dependencies.debugError
 * @param {import("./codexTurn.js").CodexTurnStateReader} dependencies.turnState
 * @param {number} dependencies.failureDetailGraceMs
 * @param {import("./codexTurn.js").CodexTurnOutcomes} dependencies.turnOutcomes
 * @param {(...details: any[]) => Promise<unknown>} dependencies.outcomeNotice
 * @param {(details: { error?: string }) => string} dependencies.resultDeliveryFailureMessage
 * @param {(sessionId: string, delayMs?: number) => void} dependencies.scheduleActiveRecovery
 * @param {(sessionId: string, threadId: string, turnId: string, options?: object) => void} dependencies.scheduleFinalizingRecovery
 * @param {(sessionId: string, threadId: string, turnId: string, options?: object) => Promise<any>} dependencies.recoverFinalizingTurn
 */
export function createCodexTurnEndings({
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
}) {
  const {
    finalizedTurns: codexAppServerFinalizedTurns,
    resultFinalizationKey: codexAppServerResultFinalizationKey,
    submitAssistantResult: submitCodexAppServerAssistantResult,
    cleanupUntrackedTurn: cleanupCodexAppServerUntrackedTurn
  } = output;
  const {
    completedTurns: codexAppServerCompletedTurns,
    finalizingTimers: codexAppServerFinalizingTimers,
    clearFinalizingTimer: clearCodexAppServerFinalizingTimer,
    markTurnFinalizing: markCodexAppServerTurnFinalizing,
    markTurnIdle: markCodexAppServerTurnIdle,
    resolveTurnId: resolveCodexAppServerTurnId,
    runInputSource: codexAppServerRunInputSource
  } = journal;
  const {
    recoverFinalResponseBeforeOutcome: recoverCodexAppServerFinalResponseBeforeOutcome
  } = settlement;

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

  function codexAppServerStoppedTurnMessage(status = "", error = "", outcome = "") {
    const normalizedStatus = normalizeCodexRunText(status);
    let base = "Codex app-server failed before completing this turn.";
    if (normalizedStatus === "interrupted") {
      base = outcome === turnOutcomes.CONTROL_RECONFIGURATION
        ? "Codex app-server was interrupted while its controls were restored."
        : "Codex app-server was interrupted before completing this turn.";
    }
    const normalizedError = normalizeCodexRunText(error);
    return normalizedError ? `${base} ${normalizedError}` : base;
  }

  async function stopCodexAppServerTurnWithProviderFailure(sessionId = "", threadId = "", turnId = "", {
    error = "",
    ok = false,
    outcome = "",
    provider = null,
    status = "failed",
    usageLimitExceeded = false,
    verifyInactive = true,
    deferFailureDetails = false,
    failureDetailReady = false
  } = {}) {
    const observedAt = Date.now();
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    const normalizedStatus = normalizeCodexRunText(status) || "failed";
    let resolvedOutcome = normalizeCodexRunText(outcome);
    if (!resolvedOutcome) {
      if (normalizedStatus === "interrupted") {
        const recorded = provider ? provider.interruptionOutcome(normalizedThreadId, normalizedTurnId) : "";
        resolvedOutcome = [turnOutcomes.USER_CANCELLED, turnOutcomes.CONTROL_RECONFIGURATION].includes(recorded)
          ? recorded : turnOutcomes.INTERRUPTED;
      } else {
        resolvedOutcome = turnOutcomes.PROVIDER_FAILURE;
      }
    }
    const runtime = await createRuntime();
    const staleFailure = async () => {
      const turn = turnState(await runtime.getSession(normalizedSessionId));
      if (codexAppServerTurnCanReceiveProviderCompletion(turn, normalizedThreadId, normalizedTurnId)) {
        return null;
      }
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
    };
    const staleBeforeRecovery = await staleFailure();
    if (staleBeforeRecovery) {
      return staleBeforeRecovery;
    }
    const key = codexAppServerResultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const pendingTimer = codexAppServerFinalizingTimers.get(key);
    const pendingDetail = pendingTimer?.failureDetail;
    if (failureDetailGraceMs > 0 && !failureDetailReady && (deferFailureDetails || pendingDetail) &&
        ![turnOutcomes.USER_CANCELLED, turnOutcomes.CONTROL_RECONFIGURATION].includes(resolvedOutcome)) {
      if (!pendingDetail) {
        scheduleCodexAppServerFinalizingRecovery(normalizedSessionId, normalizedThreadId, normalizedTurnId, {
          failureDetail: { error, ok, outcome: resolvedOutcome, provider, status: normalizedStatus,
            usageLimitExceeded, verifyInactive,
            expiresAt: Math.min(observedAt + failureDetailGraceMs,
              pendingTimer?.expiresAt ?? Infinity) }
        });
      }
      return { ok: true, processed: false, reason: "failure_detail_pending", status: normalizedStatus };
    }
    if (resolvedOutcome === turnOutcomes.PROVIDER_FAILURE) {
      // Saved output is still useful, but cannot turn a known provider failure
      // into successful completion. Persist it without settling the turn;
      // the failure notice and checkpoint below own the terminal outcome.
      await submitCodexAppServerAssistantResult(normalizedSessionId, normalizedThreadId, normalizedTurnId, {
        recoverFromProvider: true
      });
    } else {
      const recovered = await recoverCodexAppServerFinalResponseBeforeOutcome(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId,
        normalizedStatus
      );
      if (recovered?.processed) {
        return recovered;
      }
    }
    // History recovery awaited the provider. Confirm ownership and activity
    // again before publishing a failure: a successor, Stop or goal
    // continuation may own the run after that gap.
    const staleAfterRecovery = await staleFailure();
    if (staleAfterRecovery) {
      return staleAfterRecovery;
    }
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
    const message = codexAppServerStoppedTurnMessage(normalizedStatus, error, resolvedOutcome);
    await outcomeNotice(
      runtime,
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      resolvedOutcome,
      error,
      { usageLimitExceeded }
    );
    await markCodexAppServerTurnIdle(normalizedSessionId, {
      error: message,
      status: normalizedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
      turnOutcome: resolvedOutcome
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
    const recovered = await recoverCodexAppServerFinalResponseBeforeOutcome(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      normalizedStatus
    );
    if (recovered?.processed) {
      return recovered;
    }
    // The history read can outlive this turn: a successor or Stop may own the
    // run by now, so the outcome is decided against the run read after it.
    const runtime = await createRuntime();
    const currentTurn = turnState(await runtime.getSession(normalizedSessionId));
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

  return Object.freeze({
    completeTurn: completeCodexAppServerTurn,
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure,
    stopTurnWithResultDeliveryFailure: stopCodexAppServerTurnWithResultDeliveryFailure
  });
}

/** @typedef {ReturnType<typeof createCodexTurnEndings>} CodexTurnEndings */
