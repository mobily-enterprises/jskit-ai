import {
  normalizeCodexRunText,
  CODEX_APP_SERVER_AGENT_RUN_ID,
  CODEX_APP_SERVER_RESULT_PROCESSED_EVENT,
  codexAppServerTurnCanReceiveProviderCompletion,
  codexAppServerProcessedResultEvent,
  codexAppServerTurnAwaitsProviderIdentity,
  codexAppServerTurnCanAdoptSuccessor,
  codexAppServerAgentRun,
  CODEX_APP_SERVER_RUN_STATE,
  codexAppServerTurnKey
} from "./codexTurnState.js";

// Original result settlement and successor adoption for one retained run owner.
// Journal/output collections remain with their owners and are shared by reference.
export function createCodexResultSettlement({ journal, output, createRuntime, publish, debugLog, debugError, turnState }) {
  const {
    processedTurns: codexAppServerProcessedTurns,
    completedTurns: codexAppServerCompletedTurns,
    agentRunPatch,
    markTurnIdle: markCodexAppServerTurnIdle,
    turnResultWasProcessed: codexAppServerTurnResultWasProcessed,
    turnWasCompleted: codexAppServerTurnWasCompleted,
    runInputSource: codexAppServerRunInputSource,
    clearFinalizingTimer: clearCodexAppServerFinalizingTimer,
    agentRunRealtimePayload: codexAppServerAgentRunRealtimePayload,
    clearActiveTimer: clearCodexAppServerActiveTimer
  } = journal;
  const {
    finalizedTurns: codexAppServerFinalizedTurns,
    resultFinalizationKey: codexAppServerResultFinalizationKey,
    cleanupUntrackedTurn: cleanupCodexAppServerUntrackedTurn,
    submitAssistantResult: submitCodexAppServerAssistantResult,
    flushReasoningPersist: flushCodexAppServerReasoningPersist,
    readFinalAssistantResult: readCodexAppServerFinalAssistantResult,
    persistAssistantReply: persistCodexAppServerAssistantReply
  } = output;
  const codexAppServerResultFinalizations = new Map();

  async function recordCodexAppServerProcessedResult(runtime, sessionId = "", threadId = "", turnId = "", result = {}) {
    await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: CODEX_APP_SERVER_RESULT_PROCESSED_EVENT,
        providerThreadId: normalizeCodexRunText(threadId),
        providerTurnId: normalizeCodexRunText(turnId),
        resultReason: normalizeCodexRunText(result.reason)
      },
      patch: {}
    });
  }

  async function settleCodexAppServerProcessedTurn(sessionId = "", threadId = "", turnId = "", {
    result = {
      ok: true,
      processed: true,
      reason: "already_processed"
    },
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    const key = codexAppServerResultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const runtime = await createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = turnState(session);
    if (!codexAppServerTurnCanReceiveProviderCompletion(turn, normalizedThreadId, normalizedTurnId)) {
      codexAppServerProcessedTurns.delete(key);
      codexAppServerFinalizedTurns.add(key);
      cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
      debugLog("appServerAgentResult.processedSettlementStale", {
        currentState: turn.state,
        currentStatus: turn.status,
        currentThreadId: turn.threadId,
        currentTurnId: turn.turnId,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
      return {
        ...result,
        reason: "stale_turn_state"
      };
    }
    await markCodexAppServerTurnIdle(normalizedSessionId, {
      status,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
    codexAppServerProcessedTurns.delete(key);
    codexAppServerFinalizedTurns.add(key);
    cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
    return result;
  }

  async function finalizeCodexAppServerAssistantResult(sessionId = "", threadId = "", turnId = "", {
    recoverFromProvider = false,
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    const key = codexAppServerResultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId) {
      return {
        ok: false,
        processed: false,
        reason: "missing_turn"
      };
    }
    if (codexAppServerProcessedTurns.has(key)) {
      return settleCodexAppServerProcessedTurn(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId,
        {
          status
        }
      );
    }
    if (codexAppServerFinalizedTurns.has(key)) {
      return {
        ok: true,
        processed: true,
        reason: "already_finalized"
      };
    }
    const existing = codexAppServerResultFinalizations.get(key);
    if (existing) {
      return existing;
    }
    const operation = (async () => {
      const runtime = await createRuntime();
      const session = await runtime.getSession(normalizedSessionId);
      const turn = turnState(session);
      const processedEvent = codexAppServerProcessedResultEvent(
        session,
        normalizedThreadId,
        normalizedTurnId
      );
      if (processedEvent) {
        codexAppServerProcessedTurns.add(key);
        return settleCodexAppServerProcessedTurn(
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          {
            result: {
              ok: true,
              processed: true,
              reason: normalizeCodexRunText(processedEvent.resultReason) || "already_processed"
            },
            status
          }
        );
      }
      if (codexAppServerTurnAwaitsProviderIdentity(turn, normalizedThreadId, normalizedTurnId)) {
        return {
          ok: true,
          processed: false,
          reason: "turn_identity_pending"
        };
      }
      if (!codexAppServerTurnCanReceiveProviderCompletion(turn, normalizedThreadId, normalizedTurnId)) {
        codexAppServerFinalizedTurns.add(key);
        cleanupCodexAppServerUntrackedTurn(normalizedThreadId, normalizedTurnId);
        debugLog("appServerAgentResult.stale", {
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
          reason: "stale_turn_state"
        };
      }
      const result = await submitCodexAppServerAssistantResult(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId,
        {
          recoverFromProvider
        }
      );
      if (result?.processed) {
        codexAppServerProcessedTurns.add(key);
        await recordCodexAppServerProcessedResult(
          runtime,
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          result
        );
        return settleCodexAppServerProcessedTurn(
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          {
            result,
            status
          }
        );
      }
      return result;
    })().finally(() => {
      codexAppServerResultFinalizations.delete(key);
    });
    codexAppServerResultFinalizations.set(key, operation);
    return operation;
  }

  async function recoverCodexAppServerFinalResponseBeforeOutcome(
    sessionId = "",
    threadId = "",
    turnId = "",
    status = ""
  ) {
    const result = await finalizeCodexAppServerAssistantResult(
      sessionId,
      threadId,
      turnId,
      {
        recoverFromProvider: true,
        status
      }
    );
    if (result?.processed !== true) {
      return result;
    }
    if (result.reason !== "already_finalized") {
      return result;
    }
    const runtime = await createRuntime();
    const session = await runtime.getSession(sessionId);
    return codexAppServerTurnResultWasProcessed(session, threadId, turnId)
      ? result
      : {
          ...result,
          processed: false,
          reason: "already_finalized_without_response"
        };
  }

  async function adoptCodexAppServerSuccessorTurn(sessionId = "", input = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(input.threadId);
    const normalizedTurnId = normalizeCodexRunText(input.turnId);
    const expectedPreviousTurnId = normalizeCodexRunText(input.previousTurnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId || !expectedPreviousTurnId) {
      return {
        ok: true,
        processed: false,
        reason: "missing_successor_identity"
      };
    }
    const runtime = await createRuntime();
    let previousTurnId = "";
    let runPatch = null;
    let outcome = {
      ok: true,
      processed: false,
      reason: "turn_changed"
    };
    const updatedSession = await runtime.store.mutateSession(normalizedSessionId, async () => {
      const currentSession = await runtime.getSession(normalizedSessionId);
      const currentTurn = turnState(currentSession);
      if (
        normalizeCodexRunText(currentTurn.threadId) === normalizedThreadId &&
        normalizeCodexRunText(currentTurn.turnId) === normalizedTurnId
      ) {
        outcome = {
          ok: true,
          processed: false,
          reason: "already_current"
        };
        return currentSession;
      }
      if (codexAppServerTurnWasCompleted(currentSession, normalizedThreadId, normalizedTurnId)) {
        outcome = {
          ok: true,
          processed: false,
          reason: "completed_turn"
        };
        return currentSession;
      }
      if (
        normalizeCodexRunText(currentTurn.turnId) !== expectedPreviousTurnId ||
        !codexAppServerTurnCanAdoptSuccessor(currentTurn, normalizedThreadId, normalizedTurnId)
      ) {
        outcome = {
          ok: true,
          processed: false,
          reason: "turn_changed"
        };
        return currentSession;
      }
      previousTurnId = normalizeCodexRunText(currentTurn.turnId);
      const updatedAt = new Date().toISOString();
      runPatch = agentRunPatch({
        runState: CODEX_APP_SERVER_RUN_STATE.ACTIVE,
        session: currentSession,
        status: normalizeCodexRunText(input.status) || "inProgress",
        threadId: normalizedThreadId,
        turnId: normalizedTurnId,
        updatedAt
      });
      const currentInputSource = codexAppServerRunInputSource(codexAppServerAgentRun(currentSession));
      if (currentInputSource) {
        runPatch.inputSource = currentInputSource;
      }
      runPatch.finishedAt = "";
      await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          kind: "codex-app-server-turn-continued",
          message: "",
          previousProviderTurnId: previousTurnId,
          providerThreadId: normalizedThreadId,
          providerTurnId: normalizedTurnId,
          source: normalizeCodexRunText(input.source),
          state: runPatch.state
        },
        patch: runPatch
      });
      outcome = {
        ok: true,
        previousTurnId,
        processed: true,
        reason: "successor_turn_adopted",
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      };
      return runtime.getSession(normalizedSessionId);
    });
    if (!outcome.processed) {
      return outcome;
    }

    clearCodexAppServerFinalizingTimer(
      normalizedSessionId,
      normalizedThreadId,
      previousTurnId
    );
    codexAppServerCompletedTurns.add(codexAppServerTurnKey(
      normalizedThreadId,
      previousTurnId
    ));
    const previousResultKey = codexAppServerResultFinalizationKey(
      normalizedSessionId,
      normalizedThreadId,
      previousTurnId
    );
    codexAppServerProcessedTurns.delete(previousResultKey);
    codexAppServerFinalizedTurns.add(previousResultKey);
    try {
      await flushCodexAppServerReasoningPersist(
        normalizedSessionId,
        normalizedThreadId,
        previousTurnId
      );
      const previousAssistantResult = readCodexAppServerFinalAssistantResult(
        normalizedSessionId,
        normalizedThreadId,
        previousTurnId
      );
      if (previousAssistantResult?.text) {
        await persistCodexAppServerAssistantReply(
          runtime,
          normalizedSessionId,
          previousAssistantResult
        );
      }
    } catch (error) {
      debugLog("appServerTurn.continuedOutput.error", {
        error: debugError(error),
        previousTurnId,
        sessionId: normalizedSessionId,
        threadId: normalizedThreadId,
        turnId: normalizedTurnId
      });
    }
    cleanupCodexAppServerUntrackedTurn(normalizedThreadId, previousTurnId);
    await publish(normalizedSessionId, {
      payload: codexAppServerAgentRunRealtimePayload(runPatch),
      reason: "codex-app-server-turn-active",
      session: updatedSession
    });
    debugLog("appServerTurn.continued", {
      previousTurnId,
      sessionId: normalizedSessionId,
      source: normalizeCodexRunText(input.source),
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
    clearCodexAppServerActiveTimer(normalizedSessionId);
    return outcome;
  }

  return {
    resultFinalizations: codexAppServerResultFinalizations,
    finalizeAssistantResult: finalizeCodexAppServerAssistantResult,
    recoverFinalResponseBeforeOutcome: recoverCodexAppServerFinalResponseBeforeOutcome,
    adoptSuccessorTurn: adoptCodexAppServerSuccessorTurn
  };
}
