import { codexAppServerTurnStatusIsActive, codexAppServerTurnStatusIsComplete, codexAppServerTurnStatusIsSuccessfulComplete, codexAppServerTurnStatusIsProviderFailure, codexAppServerThreadStatus, codexAppServerReadThreadStatus, codexAppServerAgentRun, codexAppServerTurnCanReceiveProviderCompletion, codexAppServerTurnCanAdoptSuccessor, codexAppServerErrorMessage, codexAppServerTurnKey } from "./codexTurnState.js";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { codexAppServerStatusFromValue } from "./codexEvents.js";
import { codexAppServerThreadRawValue, codexAppServerThreadTurnId, codexAppServerThreadError } from "./codexThreadSnapshot.js";

/**
 * Native thread snapshot reconciliation; it holds no state of its own.
 * @param {object} dependencies
 * @param {import("./codexRunJournal.js").CodexRunJournal} dependencies.journal
 * @param {import("./codexResultSettlement.js").CodexResultSettlement} dependencies.settlement
 * @param {import("./codexTurnRecovery.js").CodexTurnRecovery} dependencies.recovery
 * @param {import("./codexOutput.js").CodexAppServerOutput} dependencies.output
 * @param {import("./codexTurn.js").CodexCreateRuntime} dependencies.createRuntime
 * @param {import("./codexTurn.js").CodexTurnStateReader} dependencies.turnState
 * @param {import("./codexTurn.js").CodexTurnOutcomes} dependencies.turnOutcomes
 * @param {import("./codexTurn.js").CodexDebugLog} dependencies.debugLog
 * @param {import("./codexTurn.js").CodexDebugError} dependencies.debugError
 */
export function createCodexThreadStatus({ journal, settlement, recovery, output, createRuntime, turnState, turnOutcomes, debugLog, debugError }) {

  function codexAppServerReadyTurnFailureMessage(reason = "", error = "") {
    const detail = normalizeText(error);
    if (detail) {
      return detail;
    }
    switch (normalizeText(reason)) {
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
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId) || normalizeText(turn.threadId);
    const normalizedTurnId = normalizeText(turnId) || normalizeText(turn.turnId);
    if (!normalizedSessionId || !normalizedThreadId) {
      return {
        ok: false,
        processed: false,
        reason: "missing_tracked_turn"
      };
    }
    return recovery.stopTurnWithProviderFailure(
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
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
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
    const statusThreadId = normalizeText(trackedProviderTurn?.threadId) || normalizedThreadId;
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
      journal.turnResultWasProcessed(
        session,
        trackedProviderTurn.threadId,
        trackedProviderTurn.turnId
      )
    ) {
      await settlement.finalizeAssistantResult(
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
        source: normalizeText(source),
        trackedThreadId: statusThreadId,
        trackedTurnId: trackedProviderTurn.turnId
      });
      return failCodexAppServerTrackedReadyTurn(normalizedSessionId, trackedProviderTurn, {
        reason: "thread_replaced"
      });
    }

    if (!provider) {
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
          source: normalizeText(source),
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
    // Codex has accepted the tracked turn but not started it. Until it does, its thread reads idle and lists the
    // turn as interrupted, so only Codex's own report about the turn settles it.
    if (
      trackedProviderTurn?.state === "active" &&
      !codexAppServerTurnStatusIsActive(status) &&
      journal.unstartedTurns.has(codexAppServerTurnKey(trackedProviderTurn.threadId, trackedProviderTurn.turnId))
    ) {
      debugLog("appServerThread.reconcile.awaitingProviderStart", {
        sessionId: normalizedSessionId,
        source: normalizeText(source),
        status,
        threadId: trackedProviderTurn.threadId,
        turnId: trackedProviderTurn.turnId
      });
      return {
        ok: true,
        reason: "provider_turn_not_started",
        status: trackedProviderTurn.status || "inProgress",
        turnId: trackedProviderTurn.turnId
      };
    }
    if (
      trackedProviderTurn &&
      turnId &&
      codexAppServerTurnCanAdoptSuccessor(trackedProviderTurn, statusThreadId, turnId)
    ) {
      const adoption = await settlement.adoptSuccessorTurn(normalizedSessionId, {
        previousTurnId: trackedProviderTurn.turnId,
        source: normalizeText(source) || "thread_status",
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
          source: normalizeText(source),
          threadId: statusThreadId,
          trackedTurnId: trackedProviderTurn?.turnId || ""
        });
        return {
          ok: true,
          status
        };
      }
      await recovery.markProviderTurnActive(normalizedSessionId, {
        observedRun: codexAppServerTurnStatusIsActive(codexAppServerStatusFromValue(
          codexAppServerThreadRawValue(thread).status || thread.status
        )) ? codexAppServerAgentRun(session) : null,
        source: normalizeText(source) || "thread_status",
        status,
        threadId: statusThreadId,
        turnId
      });
      await output.reconcileObservedTurnItems(
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
      isRecord(thread?.observedTurn) &&
      turnId
    ) {
      const currentSession = await runtime.getSession(normalizedSessionId);
      const currentTurn = turnState(currentSession);
      if (!currentTurn.active && normalizeText(currentTurn.turnId) !== turnId) {
        await recovery.markProviderTurnActive(normalizedSessionId, {
          inputSource: "terminal",
          source: normalizeText(source) || "thread_snapshot",
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
        await output.reconcileObservedTurnItems(
          normalizedSessionId,
          statusThreadId,
          thread.observedTurn,
          provider
        );
      }
    }
    const completedTurnId = turnId || normalizeText(trackedProviderTurn?.turnId);
    if (!completedTurnId) {
      return {
        ok: true,
        status
      };
    }
    if (codexAppServerTurnStatusIsProviderFailure(status)) {
      await recovery.stopTurnWithProviderFailure(normalizedSessionId, statusThreadId, completedTurnId, {
        error: codexAppServerThreadError(thread),
        provider,
        status
      });
    } else if (codexAppServerTurnStatusIsSuccessfulComplete(status)) {
      await recovery.completeTurn(normalizedSessionId, statusThreadId, completedTurnId, {
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

  return Object.freeze({
    reconcileThreadStatus: reconcileCodexAppServerThreadStatus,
    reconcileLoadedThreadStatus: reconcileCodexAppServerLoadedThreadStatus
  });
}

/** @typedef {ReturnType<typeof createCodexThreadStatus>} CodexThreadStatus */
