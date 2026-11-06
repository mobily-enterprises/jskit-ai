import { codexAppServerTurnStatusIsActive, codexAppServerThreadStatus, codexAppServerReadThreadStatus, codexAppServerAgentRun, codexAppServerTurnOwnsActiveGoal, codexAppServerTurnCanReceiveProviderCompletion, codexAppServerTurnAwaitsProviderIdentity, codexAppServerTurnCanReceiveProviderActivity } from "./codexTurnState.js";
import { codexAppServerThreadTurnId } from "./codexThreadSnapshot.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

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
 * @param {import("./codexTurn.js").CodexCaptureContext} dependencies.captureContext
 * @param {import("./codexTurn.js").CodexRunInContext} dependencies.runInContext
 * @param {import("./codexNotificationQueue.js").CodexAppServerNotificationQueue} dependencies.notificationQueue
 * @param {boolean} dependencies.finalizingGraceAfterHistoryRead
 * @param {(sessionId: string, delayMs?: number) => void} dependencies.scheduleActiveRecovery
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
  captureContext,
  runInContext,
  notificationQueue,
  finalizingGraceAfterHistoryRead,
  scheduleActiveRecovery
}) {
  const retainFinalizingTimer = finalizingGraceAfterHistoryRead || failureDetailGraceMs > 0;

  async function codexAppServerProviderBlocksTurnRelease(sessionId = "", provider = null, threadId = "", turnId = "", {
    source = ""
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
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
        providerTurnId !== normalizeText(turn.turnId)
      ) {
        debugLog("appServerTurn.releaseAllowedSuccessor", {
          providerTurnId,
          sessionId: normalizedSessionId,
          source: normalizeText(source),
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
        source: normalizeText(source),
        status,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId || turn.turnId
      });
      scheduleActiveRecovery(normalizedSessionId);
      return true;
    } catch (error) {
      debugLog("appServerTurn.releaseCheck.error", {
        error: debugError(error),
        sessionId: normalizedSessionId,
        source: normalizeText(source),
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
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const normalizedStatus = normalizeText(status) || "completed";
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
        output.cleanupUntrackedTurn(normalizedThreadId, normalizedTurnId);
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
      await journal.markTurnIdle(normalizedSessionId, {
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
      output.finalizedTurns.add(output.resultFinalizationKey(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      ));
      output.cleanupUntrackedTurn(normalizedThreadId, normalizedTurnId);
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
    if (journal.runInputSource(codexAppServerAgentRun(session)) === "terminal") {
      journal.markTurnCompleted(normalizedThreadId, normalizedTurnId);
      output.cleanupUntrackedTurn(normalizedThreadId, normalizedTurnId);
      await journal.markTurnIdle(normalizedSessionId, {
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
    journal.markTurnCompleted(normalizedThreadId, normalizedTurnId);
    if (!alreadyFinalizing) {
      await journal.markTurnFinalizing(normalizedSessionId, {
        status: normalizedStatus,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
    }
    if (continuesOwnedGoal) {
      // Keep the outer chat turn active so the next provider turn can adopt
      // its chat ownership without exposing this internal final as an answer.
      journal.clearFinalizingTimer(
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
    const normalizedStatus = normalizeText(status);
    let base = "Codex app-server failed before completing this turn.";
    if (normalizedStatus === "interrupted") {
      if (outcome === turnOutcomes.CONTROL_RECONFIGURATION) base = "Codex app-server was interrupted while its controls were restored.";
      else if (outcome === turnOutcomes.SERVICE_RESTART) base = "Codex app-server was interrupted by a restart before completing this turn.";
      else base = "Codex app-server was interrupted before completing this turn.";
    }
    const normalizedError = normalizeText(error);
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
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const normalizedStatus = normalizeText(status) || "failed";
    const runtime = await createRuntime();
    let resolvedOutcome = normalizeText(outcome);
    if (!resolvedOutcome) {
      if (normalizedStatus === "interrupted") {
        const recorded = provider ? provider.interruptionOutcome(normalizedThreadId, normalizedTurnId) : "";
        if ([turnOutcomes.USER_CANCELLED, turnOutcomes.CONTROL_RECONFIGURATION].includes(recorded)) resolvedOutcome = recorded;
        // The previous server's shutdown stopped this turn: a restart, not a failure.
        else if (codexAppServerAgentRun(await runtime.getSession(normalizedSessionId))?.stoppedByShutdownTurnId === normalizedTurnId) {
          resolvedOutcome = turnOutcomes.SERVICE_RESTART;
        } else resolvedOutcome = turnOutcomes.INTERRUPTED;
      } else {
        resolvedOutcome = turnOutcomes.PROVIDER_FAILURE;
      }
    }
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
    const key = output.resultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const pendingTimer = journal.finalizingTimers.get(key);
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
      await output.submitAssistantResult(normalizedSessionId, normalizedThreadId, normalizedTurnId, {
        recoverFromProvider: true
      });
    } else {
      const recovered = await settlement.recoverFinalResponseBeforeOutcome(
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
    await journal.markTurnIdle(normalizedSessionId, {
      error: message,
      status: normalizedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
      turnOutcome: resolvedOutcome
    });
    output.cleanupUntrackedTurn(normalizedThreadId, normalizedTurnId);
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
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedStatus = normalizeText(status) || "completed";
    const normalizedTurnId = await journal.resolveTurnId(normalizedSessionId, normalizedThreadId, turnId);
    const recovered = await settlement.recoverFinalResponseBeforeOutcome(
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
      output.finalizedTurns.add(output.resultFinalizationKey(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId
      ));
      output.cleanupUntrackedTurn(normalizedThreadId, normalizedTurnId);
      debugLog("appServerAgentResult.missing.stale", {
        currentState: currentTurn.state,
        currentStatus: currentTurn.status,
        currentThreadId: currentTurn.threadId,
        currentTurnId: currentTurn.turnId,
        reason: normalizeText(reason),
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
    await journal.markTurnIdle(normalizedSessionId, {
      error: message,
      status: normalizedStatus,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId,
      turnOutcome: turnOutcomes.RESPONSE_DELIVERY_FAILURE
    });
    output.cleanupUntrackedTurn(normalizedThreadId, normalizedTurnId);
    debugLog("appServerAgentResult.missing", {
      error: normalizeText(error),
      reason: normalizeText(reason),
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
    journal.clearFinalizingTimer(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const key = output.resultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const projectContext = captureContext();
    const delayMs = failureDetail
      ? Math.max(0, failureDetail.expiresAt - Date.now())
      : journal.finalizingRemainingMs({ completedAt, state: "finalizing", updatedAt });
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
          if (journal.finalizingTimers.get(key) !== entry) return;
          try {
            return await stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, normalizedThreadId, normalizedTurnId,
              { ...failureDetail, failureDetailReady: true });
          } finally {
            if (journal.finalizingTimers.get(key) === entry) {
              journal.clearFinalizingTimer(normalizedSessionId, normalizedThreadId, normalizedTurnId);
            }
          }
        });
        return;
      }
      // The post-read policy keeps its first clock while expiry rereads history.
      if (!retainFinalizingTimer) journal.finalizingTimers.delete(key);
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
    journal.finalizingTimers.set(key, entry);
  }

  async function recoverCodexAppServerFinalizingTurn(sessionId = "", threadId = "", turnId = "", {
    status = "completed", timerRecovery = false
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const key = output.resultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const priorTimer = retainFinalizingTimer ? journal.finalizingTimers.get(key) : null;
    if (!timerRecovery && priorTimer?.recovery) return priorTimer.recovery;
    const runtime = await createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = turnState(session);
    if (codexAppServerTurnOwnsActiveGoal(turn, normalizedThreadId)) {
      journal.clearFinalizingTimer(normalizedSessionId, normalizedThreadId, normalizedTurnId);
      return { ok: true, processed: false, reason: "goal_continuation_pending" };
    }
    const result = await settlement.finalizeAssistantResult(normalizedSessionId, normalizedThreadId, normalizedTurnId,
      { recoverFromProvider: true, status });
    if (result?.processed) {
      return result;
    }
    // A later failure owns the same first deadline, even when this successful
    // history read was already in flight under the completion-based clock.
    const currentTimer = journal.finalizingTimers.get(key);
    if (currentTimer?.failureDetail) return result;
    if (retainFinalizingTimer && priorTimer && !currentTimer) return result;
    let graceTurn = turn;
    if (finalizingGraceAfterHistoryRead) {
      const readReturnedAt = new Date().toISOString();
      const currentTurn = turnState(await runtime.getSession(normalizedSessionId));
      const timer = journal.finalizingTimers.get(key);
      if (timer?.failureDetail || (priorTimer && !timer)) return result;
      if (currentTurn.state !== "finalizing" || currentTurn.threadId !== normalizedThreadId ||
          currentTurn.turnId !== normalizedTurnId) {
        journal.clearFinalizingTimer(normalizedSessionId, normalizedThreadId, normalizedTurnId);
        return { ...result, reason: "stale_turn_state" };
      }
      if (codexAppServerTurnOwnsActiveGoal(currentTurn, normalizedThreadId)) {
        journal.clearFinalizingTimer(normalizedSessionId, normalizedThreadId, normalizedTurnId);
        return { ok: true, processed: false, reason: "goal_continuation_pending" };
      }
      if (!timerRecovery && timer?.recovery) return timer.recovery;
      // This local clock never changes the native completion timestamp.
      graceTurn = { ...currentTurn, completedAt: timer?.startedAt || readReturnedAt };
    }
    if (!journal.finalizingExpired(graceTurn)) {
      scheduleCodexAppServerFinalizingRecovery(normalizedSessionId, normalizedThreadId, normalizedTurnId, {
        completedAt: graceTurn.completedAt,
        status,
        updatedAt: graceTurn.updatedAt
      });
      return result;
    }
    return stopCodexAppServerTurnWithResultDeliveryFailure(normalizedSessionId, normalizedThreadId, normalizedTurnId,
      { error: result?.error, reason: result?.reason || "missing_assistant_text", status });
  }

  return Object.freeze({
    completeTurn: completeCodexAppServerTurn,
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure,
    stopTurnWithResultDeliveryFailure: stopCodexAppServerTurnWithResultDeliveryFailure,
    recoverFinalizingTurn: recoverCodexAppServerFinalizingTurn
  });
}

/** @typedef {ReturnType<typeof createCodexTurnEndings>} CodexTurnEndings */
