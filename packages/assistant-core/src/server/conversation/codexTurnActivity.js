import { codexAppServerTurnStatusIsActive, codexAppServerAgentRun, codexAppServerPendingUserMessageClientIds, codexAppServerTurnOwnsActiveGoal, codexAppServerTurnCanReceiveProviderActivity, codexAppServerTurnCanAdoptSuccessor, codexAppServerTurnKey, CODEX_APP_SERVER_RUN_STATE } from "./codexTurnState.js";
import { } from "./codexThreadSnapshot.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * Records the native activity the provider reports for the tracked turn: a turn that is starting or working, and
 * the provider's own identity for it.
 * @param {object} dependencies
 * @param {import("./codexRunJournal.js").CodexRunJournal} dependencies.journal
 * @param {import("./codexOutput.js").CodexAppServerOutput} dependencies.output
 * @param {import("./codexResultSettlement.js").CodexResultSettlement} dependencies.settlement
 * @param {import("./codexTurn.js").CodexCreateRuntime} dependencies.createRuntime
 * @param {import("./codexTurn.js").CodexCreateStore} dependencies.createStore
 * @param {import("./codexTurn.js").CodexDebugLog} dependencies.debugLog
 * @param {import("./codexTurn.js").CodexTurnStateReader} dependencies.turnState
 * @param {import("./codexTurn.js").CodexAgentRunTurnStateReader} dependencies.turnStateFromAgentRun
 * @param {(sessionId: string, delayMs?: number) => void} dependencies.scheduleActiveRecovery
 */
export function createCodexTurnActivity({
  journal,
  output,
  settlement,
  createRuntime,
  createStore,
  debugLog,
  turnState,
  turnStateFromAgentRun,
  scheduleActiveRecovery: scheduleCodexAppServerActiveRecovery
}) {
  const {
    finalizedTurns: codexAppServerFinalizedTurns,
    resultFinalizationKey: codexAppServerResultFinalizationKey,
    readAgentRunForSession: readCodexAppServerAgentRunForSession
  } = output;
  const {
    completedTurns: codexAppServerCompletedTurns,
    turnResultWasProcessed: codexAppServerTurnResultWasProcessed,
    clearActiveTimer: clearCodexAppServerActiveTimer,
    publishAgentRun: publishCodexAppServerAgentRun,
    turnWasCompleted: codexAppServerTurnWasCompleted,
    runInputSource: codexAppServerRunInputSource
  } = journal;
  const {
    finalizeAssistantResult: finalizeCodexAppServerAssistantResult,
    adoptSuccessorTurn: adoptCodexAppServerSuccessorTurn
  } = settlement;

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
          sessionId: normalizeText(sessionId),
          threadId: normalizeText(input.threadId),
          turnId: normalizeText(input.turnId)
        });
        return {
          ok: true,
          processed: false,
          reason: "untracked_terminal_turn"
        };
      }
    }
    const status = normalizeText(input.status) || "inProgress";
    const result = await publishCodexAppServerAgentRun(sessionId, {
      inputSource: normalizeText(input.inputSource),
      phase: input.phase,
      publishReason: "codex-app-server-turn-active",
      observedRun: input.observedRun,
      runState: status === "starting" ? CODEX_APP_SERVER_RUN_STATE.STARTING : CODEX_APP_SERVER_RUN_STATE.ACTIVE,
      status,
      threadId: normalizeText(input.threadId),
      turnId: normalizeText(input.turnId)
    });
    if (status === "starting") {
      scheduleCodexAppServerActiveRecovery(sessionId);
    } else {
      clearCodexAppServerActiveTimer(sessionId);
    }
    return result;
  }

  async function markCodexAppServerProviderTurnActive(sessionId = "", input = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(input.threadId);
    const normalizedTurnId = normalizeText(input.turnId);
    const requestedStatus = normalizeText(input.status) || "inProgress";
    const store = await createStore(normalizedSessionId);
    const persistedRun = await readCodexAppServerAgentRunForSession(
      store,
      normalizedSessionId
    );
    const persistedTurn = turnStateFromAgentRun(persistedRun || {});
    const requestedInputSource = normalizeText(input.inputSource);
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
    const inputSource = normalizeText(input.inputSource) || pendingInputSource || goalInputSource;
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
        source: normalizeText(input.source) || "provider_activity",
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

  return Object.freeze({
    markTurnActive: markCodexAppServerTurnActive,
    markProviderTurnActive: markCodexAppServerProviderTurnActive
  });
}

/** @typedef {ReturnType<typeof createCodexTurnActivity>} CodexTurnActivity */
