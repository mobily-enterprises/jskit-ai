import { CODEX_APP_SERVER_AGENT_RUN_ID, CODEX_APP_SERVER_RESULT_PROCESSED_EVENT, codexAppServerTurnCanReceiveProviderCompletion, codexAppServerProcessedResultEvent, codexAppServerTurnAwaitsProviderIdentity, codexAppServerTurnCanAdoptSuccessor, codexAppServerAgentRun, CODEX_APP_SERVER_RUN_STATE } from "./codexTurnState.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * Result settlement and successor adoption for one retained run owner. Journal and output collections remain with
 * their owners and are shared by reference.
 * @param {object} dependencies
 * @param {import("./codexRunJournal.js").CodexRunJournal} dependencies.journal
 * @param {import("./codexOutput.js").CodexAppServerOutput} dependencies.output
 * @param {import("./codexTurn.js").CodexCreateRuntime} dependencies.createRuntime
 * @param {import("./codexTurn.js").CodexPublish} dependencies.publish
 * @param {import("./codexTurn.js").CodexDebugLog} dependencies.debugLog
 * @param {import("./codexTurn.js").CodexDebugError} dependencies.debugError
 * @param {import("./codexTurn.js").CodexTurnStateReader} dependencies.turnState
 */
export function createCodexResultSettlement({ journal, output, createRuntime, publish, debugLog, debugError, turnState }) {
  const { agentRunPatch } = journal;
  const codexAppServerResultFinalizations = new Map();

  async function recordCodexAppServerProcessedResult(runtime, sessionId = "", threadId = "", turnId = "", result = {}) {
    await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: CODEX_APP_SERVER_RESULT_PROCESSED_EVENT,
        providerThreadId: normalizeText(threadId),
        providerTurnId: normalizeText(turnId),
        resultReason: normalizeText(result.reason)
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
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const key = output.resultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    const runtime = await createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = turnState(session);
    if (!codexAppServerTurnCanReceiveProviderCompletion(turn, normalizedThreadId, normalizedTurnId)) {
      journal.processedTurns.delete(key);
      output.finalizedTurns.add(key);
      output.cleanupUntrackedTurn(normalizedThreadId, normalizedTurnId);
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
    await journal.markTurnIdle(normalizedSessionId, {
      status,
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
    journal.processedTurns.delete(key);
    output.finalizedTurns.add(key);
    output.cleanupUntrackedTurn(normalizedThreadId, normalizedTurnId);
    return result;
  }

  async function finalizeCodexAppServerAssistantResult(sessionId = "", threadId = "", turnId = "", {
    recoverFromProvider = false,
    status = "completed"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    const key = output.resultFinalizationKey(normalizedSessionId, normalizedThreadId, normalizedTurnId);
    if (!normalizedSessionId || !normalizedThreadId || !normalizedTurnId) {
      return {
        ok: false,
        processed: false,
        reason: "missing_turn"
      };
    }
    if (journal.processedTurns.has(key)) {
      return settleCodexAppServerProcessedTurn(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId,
        {
          status
        }
      );
    }
    if (output.finalizedTurns.has(key)) {
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
        journal.processedTurns.add(key);
        return settleCodexAppServerProcessedTurn(
          normalizedSessionId,
          normalizedThreadId,
          normalizedTurnId,
          {
            result: {
              ok: true,
              processed: true,
              reason: normalizeText(processedEvent.resultReason) || "already_processed"
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
        output.finalizedTurns.add(key);
        output.cleanupUntrackedTurn(normalizedThreadId, normalizedTurnId);
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
      const result = await output.submitAssistantResult(
        normalizedSessionId,
        normalizedThreadId,
        normalizedTurnId,
        {
          recoverFromProvider
        }
      );
      if (result?.processed) {
        journal.processedTurns.add(key);
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
    return journal.turnResultWasProcessed(session, threadId, turnId)
      ? result
      : {
          ...result,
          processed: false,
          reason: "already_finalized_without_response"
        };
  }

  async function adoptCodexAppServerSuccessorTurn(sessionId = "", input = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(input.threadId);
    const normalizedTurnId = normalizeText(input.turnId);
    const expectedPreviousTurnId = normalizeText(input.previousTurnId);
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
        normalizeText(currentTurn.threadId) === normalizedThreadId &&
        normalizeText(currentTurn.turnId) === normalizedTurnId
      ) {
        outcome = {
          ok: true,
          processed: false,
          reason: "already_current"
        };
        return currentSession;
      }
      if (journal.turnWasCompleted(currentSession, normalizedThreadId, normalizedTurnId)) {
        outcome = {
          ok: true,
          processed: false,
          reason: "completed_turn"
        };
        return currentSession;
      }
      if (
        normalizeText(currentTurn.turnId) !== expectedPreviousTurnId ||
        !codexAppServerTurnCanAdoptSuccessor(currentTurn, normalizedThreadId, normalizedTurnId)
      ) {
        outcome = {
          ok: true,
          processed: false,
          reason: "turn_changed"
        };
        return currentSession;
      }
      previousTurnId = normalizeText(currentTurn.turnId);
      const updatedAt = new Date().toISOString();
      runPatch = agentRunPatch({
        runState: CODEX_APP_SERVER_RUN_STATE.ACTIVE,
        session: currentSession,
        status: normalizeText(input.status) || "inProgress",
        threadId: normalizedThreadId,
        turnId: normalizedTurnId,
        updatedAt
      });
      const currentInputSource = journal.runInputSource(codexAppServerAgentRun(currentSession));
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
          source: normalizeText(input.source),
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

    journal.clearFinalizingTimer(
      normalizedSessionId,
      normalizedThreadId,
      previousTurnId
    );
    journal.markTurnCompleted(normalizedThreadId, previousTurnId);
    const previousResultKey = output.resultFinalizationKey(
      normalizedSessionId,
      normalizedThreadId,
      previousTurnId
    );
    journal.processedTurns.delete(previousResultKey);
    output.finalizedTurns.add(previousResultKey);
    try {
      await output.flushReasoningPersist(
        normalizedSessionId,
        normalizedThreadId,
        previousTurnId
      );
      const previousAssistantResult = output.readFinalAssistantResult(
        normalizedSessionId,
        normalizedThreadId,
        previousTurnId
      );
      if (previousAssistantResult?.text) {
        await output.persistAssistantReply(
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
    output.cleanupUntrackedTurn(normalizedThreadId, previousTurnId);
    await publish(normalizedSessionId, {
      payload: journal.agentRunRealtimePayload(runPatch),
      reason: "codex-app-server-turn-active",
      session: updatedSession
    });
    debugLog("appServerTurn.continued", {
      previousTurnId,
      sessionId: normalizedSessionId,
      source: normalizeText(input.source),
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    });
    journal.clearActiveTimer(normalizedSessionId);
    return outcome;
  }

  return Object.freeze({
    resultFinalizations: codexAppServerResultFinalizations,
    finalizeAssistantResult: finalizeCodexAppServerAssistantResult,
    recoverFinalResponseBeforeOutcome: recoverCodexAppServerFinalResponseBeforeOutcome,
    adoptSuccessorTurn: adoptCodexAppServerSuccessorTurn
  });
}

/** @typedef {ReturnType<typeof createCodexResultSettlement>} CodexResultSettlement */
