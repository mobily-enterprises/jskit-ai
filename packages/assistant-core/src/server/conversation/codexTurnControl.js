import {
  codexAppServerTurnStatusIsComplete,
  codexAppServerTurnStatusIsProviderFailure,
  codexAppServerThreadStatus,
  codexAppServerReadThreadStatus,
  normalizeCodexRunText,
  codexAppServerTurnCanAdoptSuccessor,
  codexAppServerInterruptFailure,
  codexAppServerInterruptUnavailableResponse,
  codexAppServerFrozenTurnInterruptResponse
} from "./codexTurnState.js";
import { codexAppServerRequestIsInvalid } from "./codexProvider.js";
import { codexAppServerThreadTurnId } from "./codexEvents.js";

// Original user Stop control, including preflight and bounded successor races.
// Existing journal, recovery and status owners retain their state.
export function createCodexTurnControl({
  journal,
  settlement,
  recovery,
  threadStatus,
  debugError,
  debugLog,
  errorPrefix,
  interruptFailedCode,
  turnOutcomes,
  turnState
}) {
  const { turnResultWasProcessed: codexAppServerTurnResultWasProcessed } = journal;
  const {
    adoptSuccessorTurn: adoptCodexAppServerSuccessorTurn,
    finalizeAssistantResult: finalizeCodexAppServerAssistantResult
  } = settlement;
  const {
    stopTurnWithProviderFailure: stopCodexAppServerTurnWithProviderFailure,
    completeTurn: completeCodexAppServerTurn
  } = recovery;
  const { reconcileThreadStatus: reconcileCodexAppServerThreadStatus } = threadStatus;

  async function interruptCodexAppServerTurn(sessionId, input = {}, context = {}) {
    const { runtime } = context;
    const controlRequestId = normalizeCodexRunText(input?.controlRequestId);
    let currentSession = await runtime.getSession(sessionId);
    let currentTurn = turnState(currentSession);
    let threadId = normalizeCodexRunText(currentTurn.threadId) ||
      context.threadId(currentSession);
    let provider = null;
    let providerPreflight = null;
    if (context.admissionError()) {
      return { value: codexAppServerFrozenTurnInterruptResponse({
        threadId,
        turnId: currentTurn.turnId
      }) };
    }
    if (currentTurn.status === "observation_lost" && currentTurn.active) {
      const owner = context.observationOwner(threadId);
      if (owner) {
        await owner.failObservation(owner.observationFailure);
        return { value: { ok: true, interrupted: true }, session: await runtime.getSession(sessionId) };
      }
      return { value: { ok: false, error: "Codex's stop could not be verified. Its runtime owner is unavailable." }, session: currentSession };
    }
    if (currentTurn.active && threadId) {
      provider = await context.acquireProvider(currentSession);
      try {
        const providerThread = await codexAppServerReadThreadStatus(provider, threadId, {
          observeLatestTurn: true
        });
        const providerStatus = codexAppServerThreadStatus(providerThread);
        const providerTurnId = codexAppServerThreadTurnId(providerThread);
        providerPreflight = {
          status: providerStatus,
          threadId,
          turnId: providerTurnId || normalizeCodexRunText(currentTurn.turnId)
        };
        if (
          providerTurnId &&
          codexAppServerTurnCanAdoptSuccessor(currentTurn, threadId, providerTurnId)
        ) {
          await adoptCodexAppServerSuccessorTurn(sessionId, {
            previousTurnId: currentTurn.turnId,
            source: "interrupt_preflight",
            status: "inProgress",
            threadId,
            turnId: providerTurnId
          });
        }
      } catch (error) {
        debugLog("appServerInterrupt.preflight.error", {
          controlRequestId,
          error: debugError(error),
          sessionId,
          threadId,
          turnId: currentTurn.turnId
        });
      }
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      currentSession = await runtime.getSession(sessionId);
      currentTurn = turnState(currentSession);
      threadId = normalizeCodexRunText(currentTurn.threadId) ||
        context.threadId(currentSession);
      const turnId = normalizeCodexRunText(currentTurn.turnId);
      if (context.admissionError()) {
        return { value: codexAppServerFrozenTurnInterruptResponse({ threadId, turnId }) };
      }
      if (currentTurn.state === "finalizing" && threadId) {
        if (codexAppServerTurnResultWasProcessed(currentSession, threadId, turnId)) {
          await finalizeCodexAppServerAssistantResult(sessionId, threadId, turnId, {
            status: currentTurn.status || "completed"
          });
          currentSession = await runtime.getSession(sessionId);
          currentTurn = turnState(currentSession);
        }
        if (!currentTurn.active) {
          return { value: {
            interrupted: false,
            ok: true,
            operationOutcome: "already_idle",
            threadId,
            turnId
          }, session: currentSession };
        }
        const stoppedThreadId = normalizeCodexRunText(currentTurn.threadId) || threadId;
        const stoppedTurnId = normalizeCodexRunText(currentTurn.turnId) || turnId;
        const stopped = await stopCodexAppServerTurnWithProviderFailure(
          sessionId,
          stoppedThreadId,
          stoppedTurnId,
          {
            error: "Stopped by user.",
            ok: true,
            outcome: turnOutcomes.USER_CANCELLED,
            status: "interrupted",
            verifyInactive: false
          }
        );
        return { value: {
          ...stopped,
          operationOutcome: "interrupted",
          threadId: stoppedThreadId,
          turnId: stoppedTurnId
        } };
      }
      if (!currentTurn.active || !threadId || !turnId) {
        debugLog("appServerInterrupt.unavailable", {
          active: currentTurn.active,
          controlRequestId,
          sessionId,
          threadId,
          turnId
        });
        if (currentTurn.active) {
          return { value: codexAppServerInterruptUnavailableResponse({
            active: true,
            threadId,
            turnId
          }, interruptFailedCode) };
        }
        return { value: {
          interrupted: false,
          ok: true,
          operationOutcome: "already_idle",
          threadId,
          turnId
        }, session: currentSession };
      }
      if (!provider) {
        if (context.admissionError()) {
          return { value: codexAppServerFrozenTurnInterruptResponse({ threadId, turnId }) };
        }
        provider = await context.acquireProvider(currentSession);
      }
      debugLog("appServerInterrupt.start", {
        attempt,
        controlRequestId,
        sessionId,
        threadId,
        turnId
      });
      let result;
      let requestError = null;
      if (context.admissionError()) {
        return { value: codexAppServerFrozenTurnInterruptResponse({ threadId, turnId }) };
      }
      try {
        result = await provider.interruptTurn(threadId, turnId);
      } catch (error) {
        if (error?.code === `${provider?.errorPrefix ?? errorPrefix}codex_command_stop_unconfirmed`) throw error;
        requestError = error;
      }
      const interruptFailure = requestError
        ? null
        : codexAppServerInterruptFailure(result, interruptFailedCode);
      if (requestError || interruptFailure) {
        const preflightMatchesTurn = providerPreflight?.threadId === threadId &&
          providerPreflight?.turnId === turnId;
        if (
          preflightMatchesTurn &&
          codexAppServerTurnStatusIsComplete(providerPreflight.status)
        ) {
          if (codexAppServerTurnStatusIsProviderFailure(providerPreflight.status)) {
            await stopCodexAppServerTurnWithProviderFailure(sessionId, threadId, turnId, {
              status: providerPreflight.status,
              verifyInactive: false
            });
          } else {
            await completeCodexAppServerTurn(sessionId, threadId, turnId, {
              status: providerPreflight.status,
              verifyInactive: false
            });
          }
          const settledSession = await runtime.getSession(sessionId);
          return { value: {
            interrupted: false,
            ok: true,
            operationOutcome: "already_idle",
            threadId,
            turnId
          }, session: settledSession };
        }
        providerPreflight = null;
        await reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
          source: "interrupt_race"
        }).catch(() => null);
        const reconciledSession = await runtime.getSession(sessionId);
        const reconciledTurn = turnState(reconciledSession);
        const successorIsActive = reconciledTurn.active === true &&
          normalizeCodexRunText(reconciledTurn.threadId) === threadId &&
          Boolean(normalizeCodexRunText(reconciledTurn.turnId)) &&
          normalizeCodexRunText(reconciledTurn.turnId) !== turnId;
        if (successorIsActive && attempt < 2) {
          continue;
        }
        const sameTurnIsActive = reconciledTurn.state === "active" &&
          reconciledTurn.active === true &&
          normalizeCodexRunText(reconciledTurn.threadId) === threadId &&
          normalizeCodexRunText(reconciledTurn.turnId) === turnId;
        if (!sameTurnIsActive) {
          debugLog("appServerInterrupt.alreadyIdle", {
            controlRequestId,
            sessionId,
            threadId,
            turnId
          });
          return { value: {
            interrupted: false,
            ok: true,
            operationOutcome: "already_idle",
            threadId,
            turnId
          }, session: reconciledSession };
        }
        if (requestError) {
          if (codexAppServerRequestIsInvalid(requestError, "turn/interrupt")) {
            return { value: codexAppServerInterruptUnavailableResponse({
              active: true,
              threadId,
              turnId
            }, interruptFailedCode) };
          }
          throw requestError;
        }
        debugLog("appServerInterrupt.failed", {
          controlRequestId,
          error: interruptFailure.error,
          operationOutcome: interruptFailure.operationOutcome,
          sessionId,
          threadId,
          turnId
        });
        return { value: {
          ...interruptFailure,
          result,
          threadId,
          turnId
        } };
      }
      const stopped = await stopCodexAppServerTurnWithProviderFailure(sessionId, threadId, turnId, {
        error: "Stopped by user.",
        ok: true,
        outcome: turnOutcomes.USER_CANCELLED,
        status: "interrupted",
        verifyInactive: false
      });
      if (stopped?.reason === "stale_turn_state" && attempt < 2) {
        await reconcileCodexAppServerThreadStatus(sessionId, provider, threadId, {
          source: "interrupt_settlement_race"
        }).catch(() => null);
        continue;
      }
      debugLog("appServerInterrupt.done", {
        controlRequestId,
        sessionId,
        threadId,
        turnId
      });
      return { value: {
        ...stopped,
        operationOutcome: "interrupted",
        result,
        threadId,
        turnId
      } };
    }
    currentSession = await runtime.getSession(sessionId);
    currentTurn = turnState(currentSession);
    return { value: codexAppServerInterruptUnavailableResponse({
      active: currentTurn.active,
      threadId: currentTurn.threadId,
      turnId: currentTurn.turnId
    }, interruptFailedCode) };
  }

  return { interruptTurn: interruptCodexAppServerTurn };
}
