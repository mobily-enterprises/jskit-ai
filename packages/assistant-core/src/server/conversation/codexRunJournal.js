import {
  normalizeCodexRunText,
  codexAppServerRunStateIsActive,
  codexAppServerAgentRun,
  codexAppServerPendingUserMessageClientIds,
  codexAppServerProcessedResultEvent,
  codexAppServerTurnCanReceiveProviderActivity,
  codexAppServerTurnKey,
  codexAppServerAgentRunPatch,
  codexAppServerRunIdentityForPatch,
  codexAppServerRunPatchIsStaleAfterTerminalState,
  CODEX_APP_SERVER_AGENT_RUN_ID,
  CODEX_AGENT_PROVIDER,
  CODEX_APP_SERVER_RUN_STATE,
  CODEX_APP_SERVER_ACTIVE_RUN_STATES,
  codexAppServerRunInputSource
} from "./codexTurnState.js";
import crypto from "node:crypto";
import { isPlainObject } from "./normalize.js";

const CODEX_APP_SERVER_PROMPT_CLAIM_GRACE_MS = 15000;

// Original native run claims, guarded journal writes and status retirement.
// The containing run owner shares these exact Sets and Maps by reference.
export function createCodexRunJournal({
  namespace,
  normalizeRunState,
  turnState,
  createRuntime,
  publish,
  checkpoint,
  debugLog,
  output,
  messageIdPrefix,
  sessionIdRequiredError,
  turnClaimsUnsupportedError,
  turnAlreadyRunningError,
  errorPrefix,
  idlePublishPayload,
  finalizingGraceMs,
  admissionTaskFinished,
  orphanedPromptMessage
}) {
  const codexAppServerCompletedTurns = new Set();
  const codexAppServerProcessedTurns = new Set();
  const codexAppServerActiveTimers = new Map();
  const codexAppServerFinalizingTimers = new Map();
  const agentRunPatch = input => codexAppServerAgentRunPatch(input, normalizeRunState);
  const runIdentityForPatch = (session, input) => codexAppServerRunIdentityForPatch(session, input, normalizeRunState);
  const runPatchIsStaleAfterTerminalState = (turn, patch) => codexAppServerRunPatchIsStaleAfterTerminalState(turn, patch, normalizeRunState);
  const {
    resultFinalizationKey: codexAppServerResultFinalizationKey,
    readAgentRunForSession: readCodexAppServerAgentRunForSession
  } = output;

  function codexAppServerTurnResultWasProcessed(session = {}, threadId = "", turnId = "") {
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    if (!normalizedThreadId || !normalizedTurnId) {
      return false;
    }
    return codexAppServerProcessedTurns.has(codexAppServerResultFinalizationKey(
      session.sessionId,
      normalizedThreadId,
      normalizedTurnId
    )) || Boolean(codexAppServerProcessedResultEvent(session, normalizedThreadId, normalizedTurnId));
  }

  async function claimCodexAppServerTurnStart(runtime, sessionId = "", outerTurnId = "", {
    inputSource = "chat"
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedOuterTurnId = normalizeCodexRunText(outerTurnId);
    let claimResult = null;
    const mutationResult = await runtime.store.mutateSession(normalizedSessionId, async () => {
      const currentSession = await runtime.getSession(normalizedSessionId);
      const currentTurn = turnState(currentSession);
      if (currentTurn.active) {
        claimResult = {
          claimed: false,
          session: currentSession
        };
        return claimResult;
      }
      const updatedAt = new Date().toISOString();
      const runPatch = agentRunPatch({
        inputSource: normalizeCodexRunText(inputSource) || "chat",
        outerTurnId: normalizedOuterTurnId,
        runState: CODEX_APP_SERVER_RUN_STATE.STARTING,
        session: currentSession,
        status: "starting",
        updatedAt
      });
      runPatch.providerGoalStatus = "";
      runPatch.providerGoalThreadId = "";
      runPatch.providerGoalUpdatedAt = "";
      await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          kind: "codex-app-server-turn-claimed",
          message: "",
          state: runPatch.state
        },
        patch: runPatch
      });
      claimResult = {
        claimed: true,
        session: await runtime.getSession(normalizedSessionId)
      };
      return claimResult;
    });
    return claimResult || mutationResult;
  }

  async function claimCodexAppServerMessageStart(runtime, sessionId = "", outerTurnId = "", {
    inputSource = "chat"
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedOuterTurnId = normalizeCodexRunText(outerTurnId) ||
      `${messageIdPrefix}${crypto.randomUUID()}`;
    if (!normalizedSessionId) {
      return {
        claimed: false,
        response: { value: {
          ok: false,
          error: sessionIdRequiredError
        } }
      };
    }
    if (typeof runtime?.store?.mutateSession !== "function" || typeof runtime?.getSession !== "function") {
      throw new Error(turnClaimsUnsupportedError);
    }
    const result = await claimCodexAppServerTurnStart(runtime, normalizedSessionId, normalizedOuterTurnId, { inputSource });
    if (result?.claimed === false && result.session) {
      const turn = turnState(result.session);
      return { ...result, response: { value: {
        ok: false,
        code: `${errorPrefix}agent_turn_already_running`,
        error: turnAlreadyRunningError,
        operationOutcome: "agent_already_running",
        refreshRecommended: true,
        threadId: normalizeCodexRunText(turn.threadId),
        turnId: normalizeCodexRunText(turn.turnId)
      }, session: result.session } };
    }
    if (result?.claimed) {
      await publish(normalizedSessionId, {
        reason: "codex-app-server-turn-claimed",
        session: result.session,
        payload: codexAppServerAgentRunRealtimePayload(codexAppServerAgentRun(result.session))
      });
    }
    return result;
  }

  async function writeCodexAppServerAgentRun(runtime, sessionId = "", {
    error = "",
    inputSource = "",
    phase,
    publishReason = "",
    observedRun = null,
    runState = CODEX_APP_SERVER_RUN_STATE.COMPLETED,
    status = "",
    threadId = "",
    turnId = "",
    updatedAt = ""
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    let runPatch = null;
    let conversationStream = null;
    let wrote = false;
    let stale = null;
    const updatedSession = await runtime.store.mutateSession(normalizedSessionId, async () => {
      const currentSession = typeof runtime?.getSession === "function"
        ? await runtime.getSession(normalizedSessionId).catch(() => null)
        : null;
      const identity = runIdentityForPatch(currentSession || {}, {
        threadId,
        turnId
      });
      runPatch = agentRunPatch({
        error,
        inputSource,
        phase,
        runState,
        session: currentSession || {},
        status,
        threadId: identity.threadId,
        turnId: identity.turnId,
        updatedAt: normalizeCodexRunText(updatedAt) || new Date().toISOString()
      });
      const currentTurn = turnState(currentSession || {});
      if (
        codexAppServerRunStateIsActive(runPatch.state) &&
        currentTurn.threadId === normalizeCodexRunText(runPatch.providerThreadId) &&
        currentTurn.turnId === normalizeCodexRunText(runPatch.providerTurnId) &&
        currentTurn.startedAt
      ) {
        runPatch.startedAt = currentTurn.startedAt;
      }
      // The observation is valid only for the durable run read before the RPC.
      // A later Stop, Pause, completion or successor wins under this same lock.
      const canRecoverStoppedTurn = observedRun &&
        currentTurn.status !== "observation_lost" &&
        (codexAppServerAgentRun(currentSession)?.events?.length || 0) === (observedRun.events?.length || 0) &&
        !codexAppServerTurnResultWasProcessed(currentSession, runPatch.providerThreadId, runPatch.providerTurnId) &&
        [CODEX_APP_SERVER_RUN_STATE.FAILED, CODEX_APP_SERVER_RUN_STATE.INTERRUPTED].includes(currentTurn.runState) &&
        currentTurn.threadId === runPatch.providerThreadId &&
        currentTurn.turnId === runPatch.providerTurnId &&
        runPatch.state === CODEX_APP_SERVER_RUN_STATE.ACTIVE;
      if (
        (currentTurn.status === "observation_lost" && status !== "observation_lost") ||
        (phase !== undefined && (!normalizeCodexRunText(turnId) ||
          !codexAppServerTurnCanReceiveProviderActivity(currentTurn, threadId, turnId))) ||
        (observedRun && !canRecoverStoppedTurn) ||
        (!canRecoverStoppedTurn && runPatchIsStaleAfterTerminalState(currentTurn, runPatch))
      ) {
        stale = {
          currentState: currentTurn.state,
          currentStatus: currentTurn.status,
          currentThreadId: currentTurn.threadId,
          currentTurnId: currentTurn.turnId,
          patchState: runPatch.state,
          patchStatus: runPatch.providerStatus,
          patchThreadId: runPatch.providerThreadId,
          patchTurnId: runPatch.providerTurnId
        };
        debugLog("appServerAgentRun.staleTerminalPatch", {
          ...stale,
          publishReason,
          sessionId: normalizedSessionId
        });
        return currentSession;
      }
      await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          kind: publishReason || "codex-app-server-turn-state",
          message: normalizeCodexRunText(error),
          state: runPatch.state
        },
        patch: runPatch
      });
      if (!codexAppServerRunStateIsActive(runPatch.state)) {
        conversationStream = runtime.store.clearConversationStream(normalizedSessionId);
      }
      wrote = true;
      return runtime.getSession(normalizedSessionId);
    });
    return { wrote, stale, runPatch, conversationStream, updatedSession };
  }

  function clearCodexAppServerActiveTimer(sessionId = "") {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const sessionKey = namespace(normalizedSessionId);
    const timer = codexAppServerActiveTimers.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      codexAppServerActiveTimers.delete(sessionKey);
    }
  }

  function clearCodexAppServerFinalizingTimer(sessionId = "", threadId = "", turnId = "") {
    const key = codexAppServerResultFinalizationKey(sessionId, threadId, turnId);
    const timer = codexAppServerFinalizingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      codexAppServerFinalizingTimers.delete(key);
    }
  }

  function clearCodexAppServerSessionRecoveryTimers(sessionId = "") {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    clearCodexAppServerActiveTimer(normalizedSessionId);
    const finalizingKeyPrefix = `${namespace(normalizedSessionId)}:`;
    for (const [key, timer] of codexAppServerFinalizingTimers.entries()) {
      if (key.startsWith(finalizingKeyPrefix)) {
        clearTimeout(timer);
        codexAppServerFinalizingTimers.delete(key);
      }
    }
  }

  function terminalCodexAppServerAgentRunState(status = "") {
    const normalizedStatus = normalizeCodexRunText(status);
    if (normalizedStatus === "interrupted") {
      return CODEX_APP_SERVER_RUN_STATE.INTERRUPTED;
    }
    if (normalizedStatus === "failed") {
      return CODEX_APP_SERVER_RUN_STATE.FAILED;
    }
    return CODEX_APP_SERVER_RUN_STATE.COMPLETED;
  }

  function codexAppServerAgentRunRealtimePayload(runPatch = {}) {
    const runState = normalizeRunState(runPatch.state);
    const active = codexAppServerRunStateIsActive(runState);
    const state = runState === CODEX_APP_SERVER_RUN_STATE.FINALIZING
      ? "finalizing"
      : runState === CODEX_APP_SERVER_RUN_STATE.STARTING
        ? "starting"
        : active
          ? "active"
          : "idle";
    const turn = {
      active,
      completedAt: normalizeCodexRunText(runPatch.finishedAt),
      error: normalizeCodexRunText(runPatch.error),
      inputSource: normalizeCodexRunText(runPatch.inputSource),
      outerTurnId: normalizeCodexRunText(runPatch.outerTurnId),
      phase: active && runPatch.providerStatus !== "observation_lost" ? normalizeCodexRunText(runPatch.providerPhase) : "",
      runId: CODEX_APP_SERVER_AGENT_RUN_ID,
      runState,
      startedAt: normalizeCodexRunText(runPatch.startedAt),
      state,
      status: normalizeCodexRunText(runPatch.providerStatus || runState),
      threadId: normalizeCodexRunText(runPatch.providerThreadId),
      turnId: normalizeCodexRunText(runPatch.providerTurnId),
      updatedAt: normalizeCodexRunText(runPatch.updatedAt)
    };
    return {
      agentRun: {
        active,
        id: CODEX_APP_SERVER_AGENT_RUN_ID,
        inputSource: turn.inputSource,
        outerTurnId: turn.outerTurnId,
        provider: CODEX_AGENT_PROVIDER,
        providerInterface: "codex_app_server",
        providerStatus: turn.status,
        providerThreadId: turn.threadId,
        providerTurnId: turn.turnId,
        state: runState,
        updatedAt: turn.updatedAt
      },
      agentSession: {
        providerId: CODEX_AGENT_PROVIDER,
        thread: {
          id: turn.threadId
        },
        transportId: "codex_app_server",
        turn: {
          active: turn.active,
          completedAt: turn.completedAt,
          error: turn.error,
          id: turn.turnId,
          inputSource: turn.inputSource,
          outerTurnId: turn.outerTurnId,
          phase: turn.phase,
          runState: turn.runState,
          startedAt: turn.startedAt,
          state: turn.state,
          status: turn.status,
          updatedAt: turn.updatedAt
        }
      }
    };
  }

  async function publishCodexAppServerAgentRun(sessionId = "", {
    error = "",
    inputSource = "",
    phase,
    publishPayload = null,
    publishReason = "",
    observedRun = null,
    runState = CODEX_APP_SERVER_RUN_STATE.COMPLETED,
    status = "",
    threadId = "",
    turnId = "",
    updatedAt = ""
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    if (!normalizedSessionId) {
      return {
        ok: false,
        error: sessionIdRequiredError
      };
    }
    const runtime = await createRuntime();
    const { wrote, stale, runPatch, conversationStream, updatedSession } = await writeCodexAppServerAgentRun(runtime, normalizedSessionId, {
      error, inputSource, phase, publishReason, observedRun, runState, status, threadId, turnId, updatedAt
    });
    if (!wrote) {
      return {
        ok: true,
        processed: false,
        reason: "stale_terminal_turn_state",
        stale
      };
    }
    await publish(normalizedSessionId, {
      payload: {
        ...codexAppServerAgentRunRealtimePayload(runPatch),
        ...(conversationStream ? { conversationStream } : {}),
        ...(isPlainObject(publishPayload) ? publishPayload : {})
      },
      reason: publishReason || "codex-app-server-turn-state",
      session: updatedSession
    });
    return {
      ok: true
    };
  }

  async function markCodexAppServerTurnFinalizing(sessionId = "", input = {}) {
    const result = await publishCodexAppServerAgentRun(sessionId, {
      error: normalizeCodexRunText(input.error),
      publishReason: "codex-app-server-turn-finalizing",
      runState: CODEX_APP_SERVER_RUN_STATE.FINALIZING,
      status: normalizeCodexRunText(input.status) || "completed",
      threadId: normalizeCodexRunText(input.threadId),
      turnId: normalizeCodexRunText(input.turnId)
    });
    clearCodexAppServerActiveTimer(sessionId);
    return result;
  }

  async function markCodexAppServerTurnIdle(sessionId = "", input = {}) {
    const status = normalizeCodexRunText(input.status) || "completed";
    const result = await publishCodexAppServerAgentRun(sessionId, {
      error: normalizeCodexRunText(input.error),
      publishPayload: idlePublishPayload,
      publishReason: "codex-app-server-turn-idle",
      runState: terminalCodexAppServerAgentRunState(status),
      status,
      threadId: normalizeCodexRunText(input.threadId),
      turnId: normalizeCodexRunText(input.turnId)
    });
    clearCodexAppServerActiveTimer(sessionId);
    clearCodexAppServerFinalizingTimer(sessionId, input.threadId, input.turnId);
    if (result?.processed === false) {
      return result;
    }
    return {
      ...result,
      checkpoint: await checkpoint(sessionId, {
        status,
        turnOutcome: normalizeCodexRunText(input.turnOutcome),
        threadId: normalizeCodexRunText(input.threadId),
        turnId: normalizeCodexRunText(input.turnId)
      })
    };
  }

  async function currentCodexAppServerTurnId(sessionId = "", threadId = "") {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedThreadId = normalizeCodexRunText(threadId);
    if (!normalizedSessionId) {
      return "";
    }
    const runtime = await createRuntime();
    const session = await runtime.getSession(normalizedSessionId);
    const turn = turnState(session);
    if (!turn.active) {
      return "";
    }
    if (normalizedThreadId && turn.threadId && turn.threadId !== normalizedThreadId) {
      return "";
    }
    return turn.turnId;
  }

  async function resolveCodexAppServerTurnId(sessionId = "", threadId = "", turnId = "") {
    return normalizeCodexRunText(turnId) || await currentCodexAppServerTurnId(sessionId, threadId);
  }

  function codexAppServerDateValueMs(value = "") {
    const parsed = Date.parse(normalizeCodexRunText(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function codexAppServerFinalizingExpired(turn = {}, nowMs = Date.now()) {
    if (normalizeCodexRunText(turn.state) !== "finalizing") {
      return false;
    }
    const referenceMs = codexAppServerDateValueMs(turn.completedAt) || codexAppServerDateValueMs(turn.updatedAt);
    return Boolean(referenceMs && nowMs - referenceMs >= finalizingGraceMs);
  }

  function codexAppServerFinalizingRemainingMs(turn = {}, nowMs = Date.now()) {
    const referenceMs = codexAppServerDateValueMs(turn.completedAt) || codexAppServerDateValueMs(turn.updatedAt);
    if (!referenceMs) {
      return finalizingGraceMs;
    }
    return Math.max(0, finalizingGraceMs - (nowMs - referenceMs));
  }

  function codexAppServerTurnWasCompleted(session = {}, threadId = "", turnId = "") {
    const normalizedThreadId = normalizeCodexRunText(threadId);
    const normalizedTurnId = normalizeCodexRunText(turnId);
    if (!normalizedThreadId || !normalizedTurnId) {
      return false;
    }
    return codexAppServerCompletedTurns.has(codexAppServerTurnKey(
      normalizedThreadId,
      normalizedTurnId
    )) || codexAppServerTurnResultWasProcessed(session, normalizedThreadId, normalizedTurnId);
  }

  async function failOrphanedCodexAppServerPromptDelivery(runtime, session = {}, turn = {}) {
    const sessionId = normalizeCodexRunText(session.sessionId);
    if (!sessionId) {
      return session;
    }
    const error = orphanedPromptMessage;
    const updatedAt = new Date().toISOString();
    const runPatch = agentRunPatch({
      error,
      inputSource: turn.inputSource,
      runState: CODEX_APP_SERVER_RUN_STATE.FAILED,
      session,
      status: "delivery_failed",
      threadId: turn.threadId,
      turnId: turn.turnId,
      updatedAt
    });
    delete runPatch.pendingUserMessageClientIds;
    const updatedSession = await runtime.store.mutateSession(sessionId, async () => {
      await runtime.store.writeAgentRunEvent(sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          kind: "codex-prompt-delivery-abandoned",
          message: error,
          state: CODEX_APP_SERVER_RUN_STATE.FAILED
        },
        patch: runPatch
      });
      return runtime.getSession(sessionId);
    });
    await publish(sessionId, {
      payload: codexAppServerAgentRunRealtimePayload(runPatch),
      reason: "codex-prompt-delivery-abandoned",
      session: updatedSession
    });
    debugLog("appServerPrompt.orphaned", {
      sessionId,
      threadId: turn.threadId
    });
    return runtime.getSession(sessionId);
  }

  async function writeCodexAppServerUserMessageOwnership(store, sessionId = "", clientId = "", {
    eventKind = "codex-app-server-user-message-ownership-updated",
    owned = false
  } = {}) {
    const normalizedSessionId = normalizeCodexRunText(sessionId);
    const normalizedClientId = normalizeCodexRunText(clientId);
    if (!normalizedSessionId || !normalizedClientId) {
      return false;
    }
    let wasOwned = false;
    await store.mutateSession(normalizedSessionId, async () => {
      const run = await readCodexAppServerAgentRunForSession(store, normalizedSessionId);
      const currentIds = codexAppServerPendingUserMessageClientIds(run);
      wasOwned = currentIds.indexOf(normalizedClientId) >= 0;
      if (wasOwned === owned) {
        return;
      }
      const pendingUserMessageClientIds = owned
        ? [...currentIds, normalizedClientId]
        : currentIds.filter((id) => id !== normalizedClientId);
      await store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
        event: {
          clientId: normalizedClientId,
          kind: eventKind,
          message: ""
        },
        patch: {
          pendingUserMessageClientIds
        }
      });
    });
    return wasOwned;
  }

  function abandonedCodexAppServerPromptClaim(session = {}, {
    nowMs = Date.now(),
    promptDeliveryActive = false
  } = {}) {
    const run = codexAppServerAgentRun(session);
    if (!run) {
      return null;
    }
    const runUpdatedMs = codexAppServerDateValueMs(run.updatedAt || run.startedAt || run.at);
    const claimExpired = Boolean(
      runUpdatedMs &&
      nowMs - runUpdatedMs >= CODEX_APP_SERVER_PROMPT_CLAIM_GRACE_MS
    );
    return (
      (run.active === true || CODEX_APP_SERVER_ACTIVE_RUN_STATES.has(normalizeRunState(run.state))) &&
      normalizeCodexRunText(run.state) === CODEX_APP_SERVER_RUN_STATE.STARTING &&
      !normalizeCodexRunText(run.providerThreadId) &&
      !normalizeCodexRunText(run.providerTurnId) &&
      promptDeliveryActive !== true &&
      (admissionTaskFinished(session, run) || claimExpired)
    ) ? run : null;
  }

  async function recoverAbandonedCodexAppServerPromptClaim(runtime, session = {}, options = {}) {
    const run = abandonedCodexAppServerPromptClaim(session, options);
    if (!run || !session?.sessionId || typeof runtime?.store?.writeAgentRunEvent !== "function") {
      return {
        recovered: false,
        session
      };
    }
    const error = "Codex app-server prompt delivery ended before a provider turn was created.";
    await runtime.store.writeAgentRunEvent(session.sessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: {
        kind: "codex-prompt-delivery-abandoned",
        message: error,
        state: CODEX_APP_SERVER_RUN_STATE.FAILED
      },
      patch: {
        error,
        provider: CODEX_AGENT_PROVIDER,
        providerInterface: "codex_app_server",
        providerStatus: "delivery_failed",
        providerThreadId: "",
        providerTurnId: "",
        state: CODEX_APP_SERVER_RUN_STATE.FAILED,
        updatedAt: new Date().toISOString()
      }
    });
    debugLog("appServerPrompt.abandoned", {
      runUpdatedAt: normalizeCodexRunText(run.updatedAt),
      sessionId: session.sessionId
    });
    return {
      recovered: true,
      session: await runtime.getSession(session.sessionId)
    };
  }

  return {
    completedTurns: codexAppServerCompletedTurns,
    processedTurns: codexAppServerProcessedTurns,
    activeTimers: codexAppServerActiveTimers,
    finalizingTimers: codexAppServerFinalizingTimers,
    agentRunPatch,
    turnResultWasProcessed: codexAppServerTurnResultWasProcessed,
    claimTurnStart: claimCodexAppServerTurnStart,
    claimMessageStart: claimCodexAppServerMessageStart,
    writeAgentRun: writeCodexAppServerAgentRun,
    clearActiveTimer: clearCodexAppServerActiveTimer,
    clearFinalizingTimer: clearCodexAppServerFinalizingTimer,
    clearSessionRecoveryTimers: clearCodexAppServerSessionRecoveryTimers,
    agentRunRealtimePayload: codexAppServerAgentRunRealtimePayload,
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
  };
}
