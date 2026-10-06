import {
  codexAppServerTurnStatusIsActive,
  codexAppServerTurnStatusIsComplete,
  codexAppServerTurnStatusIsSuccessfulComplete,
  codexAppServerTurnStatusIsProviderFailure,
  codexAppServerThreadStatus,
  codexAppServerReadThreadStatus,
  normalizeCodexRunText,
  codexAppServerAgentRun,
  codexAppServerTurnCanReceiveProviderCompletion,
  codexAppServerTurnCanAdoptSuccessor,
  codexAppServerErrorMessage
} from "./codexTurnState.js";
import { isPlainObject } from "./normalize.js";
import {
  codexAppServerStatusFromValue,
  codexAppServerThreadRawValue,
  codexAppServerThreadTurnId,
  codexAppServerThreadError
} from "./codexEvents.js";

// Original native snapshot reconciliation; existing owners retain all state.
export function createCodexThreadStatus({ journal, settlement, recovery, output, createRuntime, turnState, turnOutcomes, debugLog, debugError }) {
  const { turnResultWasProcessed: codexAppServerTurnResultWasProcessed } = journal;
  const {
    finalizeAssistantResult: finalizeCodexAppServerAssistantResult,
    adoptSuccessorTurn: adoptCodexAppServerSuccessorTurn
  } = settlement;
  const {
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure,
    markProviderTurnActive: markCodexAppServerProviderTurnActive,
    completeTurn: completeCodexAppServerTurn
  } = recovery;
  const { reconcileObservedTurnItems: reconcileCodexAppServerObservedTurnItems } = output;

  function codexAppServerReadyTurnFailureMessage(reason = "", error = "") {
    const detail = normalizeCodexRunText(error);
    if (detail) {
      return detail;
    }
    switch (normalizeCodexRunText(reason)) {
      case "thread_replaced":
        return "Codex app-server resumed a different thread before this turn completed.";
      case "provider_unreadable":
        return "Codex app-server could not confirm the active turn after restart.";
      case "missing_status":
        return "Codex app-server did not report the active turn status after restart.";
      case "missing_turn":
        return "Codex app-server did not report the active turn after restart.";
      case "turn_mismatch":
        return "Codex app-server reported a different active turn after restart.";
      default:
        return "Codex app-server could not recover the active turn after restart.";
    }
  }

  async function failCodexAppServerTrackedReadyTurn(sessionId = "", turn = {}, {
    error = "",
    reason = "",
    status = "failed",
    threadId = "",
    turnId = ""
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId) || normalizeCodexRunText(turn.threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId) || normalizeCodexRunText(turn.turnId);
    if (!normalizedSessionId || !normalizedThreadId) {
      return {
        ok: false,
        processed: false,
        reason: "missing_tracked_turn"
      };
    }
    return stopCodexAppServerTurnWithProviderFailure(
      normalizedSessionId,
      normalizedThreadId,
      normalizedTurnId,
      {
        error: codexAppServerReadyTurnFailureMessage(reason, error),
        outcome: turnOutcomes.SERVICE_RESTART,
        status
      }
    );
  }

  async function reconcileCodexAppServerThreadStatus(sessionId = "", provider = null, threadId = "", {
    failUnconfirmedTrackedTurn = false,
    observeLatestTurn = false,
    requireTrackedTurn = false,
    source = ""
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const runtime = normalizedSessionId
      ? await createRuntime()
      : null;
    const session = runtime
      ? await runtime.getSession(normalizedSessionId)
      : {};
    const trackedTurn = turnState(session);
    if (trackedTurn.status === "observation_lost") return { ok: true, status: "observation_lost" };
    const trackedStartingTurn = trackedTurn.active && trackedTurn.state === "starting"
      ? trackedTurn
      : null;
    const trackedProviderTurn = ["active", "finalizing"].includes(trackedTurn.state) &&
      trackedTurn.active &&
      trackedTurn.threadId
      ? trackedTurn
      : null;
    const statusThreadId = normalizeCodexRunText(trackedProviderTurn?.threadId) || normalizedThreadId;
    const shouldFailUnconfirmed = failUnconfirmedTrackedTurn && trackedProviderTurn;
    if (!normalizedSessionId || !normalizedThreadId) {
      return {
        ok: true,
        status: "notRead"
      };
    }
    if (requireTrackedTurn && !trackedProviderTurn) {
      return {
        ok: true,
        status: "notTracked"
      };
    }
    if (
      trackedProviderTurn?.state === "finalizing" &&
      codexAppServerTurnResultWasProcessed(
        session,
        trackedProviderTurn.threadId,
        trackedProviderTurn.turnId
      )
    ) {
      await finalizeCodexAppServerAssistantResult(
        normalizedSessionId,
        trackedProviderTurn.threadId,
        trackedProviderTurn.turnId,
        {
          status: trackedProviderTurn.status || "completed"
        }
      );
      return {
        ok: true,
        status: trackedProviderTurn.status || "completed",
        turnId: trackedProviderTurn.turnId
      };
    }

    if (shouldFailUnconfirmed && statusThreadId !== normalizedThreadId) {
      debugLog("appServerThread.reconcile.trackedThreadReplaced", {
        currentThreadId: normalizedThreadId,
        sessionId: normalizedSessionId,
        source: normalizeCodexRunText(source),
        trackedThreadId: statusThreadId,
        trackedTurnId: trackedProviderTurn.turnId
      });
      return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedProviderTurn, {
        reason: "thread_replaced"
      });
    }

    if (typeof provider?.readThreadStatus !== "function") {
      if (shouldFailUnconfirmed) {
        return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedProviderTurn, {
          reason: "provider_unreadable"
        });
      }
      return {
        ok: true,
        status: "notRead"
      };
    }

    let thread = null;
    try {
      thread = await codexAppServerReadThreadStatus(provider, statusThreadId, {
        observeLatestTurn
      });
    } catch (error) {
      if (shouldFailUnconfirmed) {
        debugLog("appServerThread.reconcile.readFailed", {
          error: debugError(error),
          sessionId: normalizedSessionId,
          source: normalizeCodexRunText(source),
          threadId: statusThreadId,
          turnId: trackedProviderTurn.turnId
        });
        return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedProviderTurn, {
          error: codexAppServerErrorMessage(error, "Codex app-server could not confirm the active turn after restart."),
          reason: "provider_unreadable"
        });
      }
      throw error;
    }

    const status = codexAppServerThreadStatus(thread);
    const turnId = codexAppServerThreadTurnId(thread);
    if (!status) {
      if (shouldFailUnconfirmed) {
        return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedProviderTurn, {
          reason: "missing_status"
        });
      }
      return {
        ok: true,
        status: "unknown"
      };
    }
    // A STARTING run has durable application ownership but no provider identity yet.
    // A thread snapshot may describe the predecessor (or an unrelated terminal
    // turn), so only the active-turn recovery path may bind it after matching
    // the provider's client message id.
    if (trackedStartingTurn) {
      return {
        ok: true,
        status,
        turnId
      };
    }
    if (
      trackedProviderTurn &&
      turnId &&
      codexAppServerTurnCanAdoptSuccessor(trackedProviderTurn, statusThreadId, turnId)
    ) {
      const adoption = await adoptCodexAppServerSuccessorTurn(normalizedSessionId, {
        previousTurnId: trackedProviderTurn.turnId,
        source: normalizeCodexRunText(source) || "thread_status",
        status: "inProgress",
        threadId: statusThreadId,
        turnId
      });
      if (!adoption.processed && adoption.reason !== "already_current") {
        if (shouldFailUnconfirmed) {
          return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedProviderTurn, {
            reason: "turn_mismatch"
          });
        }
        return {
          ok: true,
          reason: adoption.reason,
          status,
          turnId
        };
      }
    }
    if (codexAppServerTurnStatusIsActive(status)) {
      if (!turnId) {
        debugLog("appServerThread.reconcile.activeWithoutTurn", {
          sessionId: normalizedSessionId,
          status,
          source: normalizeCodexRunText(source),
          threadId: statusThreadId,
          trackedTurnId: trackedProviderTurn?.turnId || ""
        });
        return {
          ok: true,
          status
        };
      }
      await markCodexAppServerProviderTurnActive(normalizedSessionId, {
        observedRun: codexAppServerTurnStatusIsActive(codexAppServerStatusFromValue(
          codexAppServerThreadRawValue(thread).status || thread.status
        )) ? codexAppServerAgentRun(session) : null,
        source: normalizeCodexRunText(source) || "thread_status",
        status,
        threadId: statusThreadId,
        turnId
      });
      await reconcileCodexAppServerObservedTurnItems(
        normalizedSessionId,
        statusThreadId,
        thread?.observedTurn,
        provider
      );
      return {
        ok: true,
        status,
        turnId
      };
    }
    if (
      codexAppServerTurnStatusIsComplete(status) &&
      isPlainObject(thread?.observedTurn) &&
      turnId
    ) {
      const currentSession = await runtime.getSession(normalizedSessionId);
      const currentTurn = turnState(currentSession);
      if (!currentTurn.active && normalizeCodexRunText(currentTurn.turnId) !== turnId) {
        await markCodexAppServerProviderTurnActive(normalizedSessionId, {
          inputSource: "terminal",
          source: normalizeCodexRunText(source) || "thread_snapshot",
          status: "inProgress",
          threadId: statusThreadId,
          turnId
        });
      }
      const recoverableSession = await runtime.getSession(normalizedSessionId);
      if (codexAppServerTurnCanReceiveProviderCompletion(
        turnState(recoverableSession),
        statusThreadId,
        turnId
      )) {
        await reconcileCodexAppServerObservedTurnItems(
          normalizedSessionId,
          statusThreadId,
          thread.observedTurn,
          provider
        );
      }
    }
    const completedTurnId = turnId || normalizeCodexRunText(trackedProviderTurn?.turnId);
    if (!completedTurnId) {
      return {
        ok: true,
        status
      };
    }
    if (codexAppServerTurnStatusIsProviderFailure(status)) {
      await stopCodexAppServerTurnWithProviderFailure(normalizedSessionId, statusThreadId, completedTurnId, {
        error: codexAppServerThreadError(thread),
        provider,
        status
      });
    } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
      await completeCodexAppServerTurn(normalizedSessionId, statusThreadId, completedTurnId, {
        status,
        verifyInactive: false
      });
    }
    return {
      ok: true,
      status,
      turnId: completedTurnId
    };
  }

  async function reconcileCodexAppServerLoadedThreadStatus(
    sessionId = "",
    provider = null,
    threadId = "",
    {
      observeLatestTurn = false
    } = {}
  ) {
    return reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
      observeLatestTurn,
      source: "loaded_thread"
    });
  }


  return {
    reconcileThreadStatus: reconcileCodexAppServerThreadStatus,
    reconcileLoadedThreadStatus: reconcileCodexAppServerLoadedThreadStatus
  };
}
