import { codexAppServerRunStateIsActive, codexAppServerAgentRun, codexAppServerPendingUserMessageClientIds, codexAppServerProcessedResultEvent, codexAppServerTurnCanReceiveProviderActivity, codexAppServerTurnKey, codexAppServerAgentRunPatch, codexAppServerRunIdentityForPatch, codexAppServerRunPatchIsStaleAfterTerminalState, codexAppServerRunPatchSettlesOtherActiveTurn, CODEX_APP_SERVER_AGENT_RUN_ID, CODEX_AGENT_PROVIDER, CODEX_APP_SERVER_RUN_STATE, codexAppServerRunInputSource, codexAppServerTurnStateFromAgentRun } from "./codexTurnState.js";
import crypto from "node:crypto";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const CODEX_APP_SERVER_PROMPT_CLAIM_GRACE_MS = 15000;
const CODEX_APP_SERVER_STOPPED_BY_SHUTDOWN_EVENT = "codex-app-server-stopped-by-shutdown";

/**
 * Marks the session's running turn as stopped by the server's shutdown, so the
 * next server records its interruption as a restart. Nothing else of the saved
 * run changes.
 * @param {{ createRuntime: import("./codexTurn.js").CodexCreateRuntime, turnState: import("./codexTurn.js").CodexTurnStateReader }} dependencies
 * @param {string} sessionId
 * @param {string} [threadId] the session's Main thread, when known
 */
export async function markCodexAppServerTurnStoppedByShutdown({ createRuntime, turnState }, sessionId = "", threadId = "") {
  const normalizedSessionId = normalizeText(sessionId);
  if (!normalizedSessionId) return { marked: false };
  const runtime = await createRuntime();
  let marked = false;
  await runtime.store.mutateSession(normalizedSessionId, async () => {
    const turn = turnState(await runtime.getSession(normalizedSessionId).catch(() => null) || {});
    if (!turn.active || !turn.turnId || (normalizeText(threadId) && turn.threadId !== normalizeText(threadId))) return;
    await runtime.store.writeAgentRunEvent(normalizedSessionId, CODEX_APP_SERVER_AGENT_RUN_ID, {
      event: { kind: CODEX_APP_SERVER_STOPPED_BY_SHUTDOWN_EVENT },
      patch: { stoppedByShutdownTurnId: turn.turnId }
    });
    marked = true;
  });
  return { marked };
}

function terminalCodexAppServerAgentRunState(status = "") {
  const normalizedStatus = normalizeText(status);
  if (normalizedStatus === "interrupted") {
    return CODEX_APP_SERVER_RUN_STATE.INTERRUPTED;
  }
  if (normalizedStatus === "failed") {
    return CODEX_APP_SERVER_RUN_STATE.FAILED;
  }
  return CODEX_APP_SERVER_RUN_STATE.COMPLETED;
}

function codexAppServerDateValueMs(value = "") {
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Native run claims, guarded journal writes and status retirement. The containing run owner shares these exact Sets
 * and Maps by reference.
 * @param {object} dependencies
 * @param {import("./codexTurn.js").CodexSessionNamespace} dependencies.namespace
 * @param {(state: unknown) => string} dependencies.normalizeRunState
 * @param {import("./codexTurn.js").CodexTurnStateReader} dependencies.turnState
 * @param {import("./codexTurn.js").CodexCreateRuntime} dependencies.createRuntime
 * @param {import("./codexTurn.js").CodexPublish} dependencies.publish
 * @param {(sessionId: string, input: object) => Promise<unknown>} dependencies.checkpoint
 * @param {import("./codexTurn.js").CodexDebugLog} dependencies.debugLog
 * @param {import("./codexOutput.js").CodexAppServerOutput} dependencies.output
 * @param {string} dependencies.messageIdPrefix
 * @param {string} dependencies.sessionIdRequiredError
 * @param {string} dependencies.turnAlreadyRunningError
 * @param {string} dependencies.errorPrefix
 * @param {object} [dependencies.idlePublishPayload]
 * @param {number} dependencies.finalizingGraceMs
 * @param {(session: object, run: object) => boolean} dependencies.admissionTaskFinished
 * @param {string} dependencies.orphanedPromptMessage
 * @param {() => boolean} dependencies.isClosing Whether the server's shutdown has begun.
 */
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
  turnAlreadyRunningError,
  errorPrefix,
  idlePublishPayload,
  finalizingGraceMs,
  admissionTaskFinished,
  orphanedPromptMessage,
  isClosing
}) {
  const codexAppServerCompletedTurns = new Set();
  const codexAppServerProcessedTurns = new Set();
  const codexAppServerActiveTimers = new Map();
  const codexAppServerFinalizingTimers = new Map();
  const agentRunPatch = input => codexAppServerAgentRunPatch(input, normalizeRunState);
  const runIdentityForPatch = (session, input) => codexAppServerRunIdentityForPatch(session, input, normalizeRunState);
  const runPatchIsStaleAfterTerminalState = (turn, patch) => codexAppServerRunPatchIsStaleAfterTerminalState(turn, patch, normalizeRunState);

  function codexAppServerTurnResultWasProcessed(session = {}, threadId = "", turnId = "") {
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedThreadId || !normalizedTurnId) {
      return false;
    }
    return codexAppServerProcessedTurns.has(output.resultFinalizationKey(
      session.sessionId,
      normalizedThreadId,
      normalizedTurnId
    )) || Boolean(codexAppServerProcessedResultEvent(session, normalizedThreadId, normalizedTurnId));
  }

  async function claimCodexAppServerTurnStart(runtime, sessionId = "", outerTurnId = "", {
    inputSource = "chat"
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedOuterTurnId = normalizeText(outerTurnId);
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
        inputSource: normalizeText(inputSource) || "chat",
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
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedOuterTurnId = normalizeText(outerTurnId) ||
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
    const result = await claimCodexAppServerTurnStart(runtime, normalizedSessionId, normalizedOuterTurnId, { inputSource });
    if (result?.claimed === false && result.session) {
      const turn = turnState(result.session);
      return { ...result, response: { value: {
        ok: false,
        code: `${errorPrefix}agent_turn_already_running`,
        error: turnAlreadyRunningError,
        operationOutcome: "agent_already_running",
        refreshRecommended: true,
        threadId: normalizeText(turn.threadId),
        turnId: normalizeText(turn.turnId)
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
    const normalizedSessionId = normalizeText(sessionId);
    let runPatch = null;
    let conversationStream = null;
    let wrote = false;
    let stale = null;
    const updatedSession = await runtime.store.mutateSession(normalizedSessionId, async () => {
      const currentSession = await runtime.getSession(normalizedSessionId).catch(() => null);
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
        updatedAt: normalizeText(updatedAt) || new Date().toISOString()
      });
      const currentTurn = turnState(currentSession || {});
      if (
        codexAppServerRunStateIsActive(runPatch.state) &&
        currentTurn.threadId === normalizeText(runPatch.providerThreadId) &&
        currentTurn.turnId === normalizeText(runPatch.providerTurnId) &&
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
      const observationLostBlocks = currentTurn.status === "observation_lost" && status !== "observation_lost";
      const phaseTargetsOtherTurn = phase !== undefined && (!normalizeText(turnId) ||
        !codexAppServerTurnCanReceiveProviderActivity(currentTurn, threadId, turnId));
      const observationExpired = Boolean(observedRun) && !canRecoverStoppedTurn;
      const terminalAlreadyRecorded = !canRecoverStoppedTurn && runPatchIsStaleAfterTerminalState(currentTurn, runPatch);
      const settlesOtherActiveTurn = codexAppServerRunPatchSettlesOtherActiveTurn(currentTurn, runPatch);
      if (
        observationLostBlocks ||
        phaseTargetsOtherTurn ||
        observationExpired ||
        terminalAlreadyRecorded ||
        settlesOtherActiveTurn
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
          message: normalizeText(error),
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
    const normalizedSessionId = normalizeText(sessionId);
    const sessionKey = namespace(normalizedSessionId);
    const timer = codexAppServerActiveTimers.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      codexAppServerActiveTimers.delete(sessionKey);
    }
  }

  function clearCodexAppServerFinalizingTimer(sessionId = "", threadId = "", turnId = "") {
    const key = output.resultFinalizationKey(sessionId, threadId, turnId);
    const entry = codexAppServerFinalizingTimers.get(key);
    if (entry) {
      clearTimeout(entry.timer);
      codexAppServerFinalizingTimers.delete(key);
    }
  }

  function clearCodexAppServerSessionRecoveryTimers(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    clearCodexAppServerActiveTimer(normalizedSessionId);
    const finalizingKeyPrefix = `${namespace(normalizedSessionId)}:`;
    for (const [key, entry] of codexAppServerFinalizingTimers.entries()) {
      if (key.startsWith(finalizingKeyPrefix)) {
        clearTimeout(entry.timer);
        codexAppServerFinalizingTimers.delete(key);
      }
    }
  }

  function codexAppServerAgentRunRealtimePayload(runPatch = {}) {
    const turn = codexAppServerTurnStateFromAgentRun({ ...runPatch, id: CODEX_APP_SERVER_AGENT_RUN_ID }, normalizeRunState);
    return {
      agentRun: {
        active: turn.active,
        id: CODEX_APP_SERVER_AGENT_RUN_ID,
        inputSource: turn.inputSource,
        outerTurnId: turn.outerTurnId,
        provider: CODEX_AGENT_PROVIDER,
        providerInterface: "codex_app_server",
        providerStatus: turn.status,
        providerThreadId: turn.threadId,
        providerTurnId: turn.turnId,
        state: turn.runState,
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
    const normalizedSessionId = normalizeText(sessionId);
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
        ...(isRecord(publishPayload) ? publishPayload : {})
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
      error: normalizeText(input.error),
      publishReason: "codex-app-server-turn-finalizing",
      runState: CODEX_APP_SERVER_RUN_STATE.FINALIZING,
      status: normalizeText(input.status) || "completed",
      threadId: normalizeText(input.threadId),
      turnId: normalizeText(input.turnId)
    });
    clearCodexAppServerActiveTimer(sessionId);
    return result;
  }

  async function markCodexAppServerTurnIdle(sessionId = "", input = {}) {
    // Once shutdown has begun the turn's end, and its checkpoint, are left to the next server's recovery, as after a crash.
    if (isClosing()) {
      return { ok: true, processed: false, reason: "left_to_next_server" };
    }
    const status = normalizeText(input.status) || "completed";
    const result = await publishCodexAppServerAgentRun(sessionId, {
      error: normalizeText(input.error),
      publishPayload: idlePublishPayload,
      publishReason: "codex-app-server-turn-idle",
      runState: terminalCodexAppServerAgentRunState(status),
      status,
      threadId: normalizeText(input.threadId),
      turnId: normalizeText(input.turnId)
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
        turnOutcome: normalizeText(input.turnOutcome),
        threadId: normalizeText(input.threadId),
        turnId: normalizeText(input.turnId)
      })
    };
  }

  async function currentCodexAppServerTurnId(sessionId = "", threadId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedThreadId = normalizeText(threadId);
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
    return normalizeText(turnId) || await currentCodexAppServerTurnId(sessionId, threadId);
  }

  function codexAppServerFinalizingExpired(turn = {}, nowMs = Date.now()) {
    if (normalizeText(turn.state) !== "finalizing") {
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
    const normalizedThreadId = normalizeText(threadId);
    const normalizedTurnId = normalizeText(turnId);
    if (!normalizedThreadId || !normalizedTurnId) {
      return false;
    }
    return codexAppServerCompletedTurns.has(codexAppServerTurnKey(
      normalizedThreadId,
      normalizedTurnId
    )) || codexAppServerTurnResultWasProcessed(session, normalizedThreadId, normalizedTurnId);
  }

  async function failOrphanedCodexAppServerPromptDelivery(runtime, session = {}, turn = {}) {
    const sessionId = normalizeText(session.sessionId);
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
    const normalizedSessionId = normalizeText(sessionId);
    const normalizedClientId = normalizeText(clientId);
    if (!normalizedSessionId || !normalizedClientId) {
      return false;
    }
    let wasOwned = false;
    await store.mutateSession(normalizedSessionId, async () => {
      const run = await output.readAgentRunForSession(store, normalizedSessionId);
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
      normalizeText(run.state) === CODEX_APP_SERVER_RUN_STATE.STARTING &&
      !normalizeText(run.providerThreadId) &&
      !normalizeText(run.providerTurnId) &&
      promptDeliveryActive !== true &&
      (admissionTaskFinished(session, run) || claimExpired)
    ) ? run : null;
  }

  async function recoverAbandonedCodexAppServerPromptClaim(runtime, session = {}, options = {}) {
    const run = abandonedCodexAppServerPromptClaim(session, options);
    if (!run || !session.sessionId) {
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
      runUpdatedAt: normalizeText(run.updatedAt),
      sessionId: session.sessionId
    });
    return {
      recovered: true,
      session: await runtime.getSession(session.sessionId)
    };
  }

  return Object.freeze({
    completedTurns: codexAppServerCompletedTurns,
    processedTurns: codexAppServerProcessedTurns,
    activeTimers: codexAppServerActiveTimers,
    finalizingTimers: codexAppServerFinalizingTimers,
    agentRunPatch,
    turnResultWasProcessed: codexAppServerTurnResultWasProcessed,
    claimTurnStart: claimCodexAppServerTurnStart,
    claimCodexAppServerMessageStart,
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
  });
}

/** @typedef {ReturnType<typeof createCodexRunJournal>} CodexRunJournal */
