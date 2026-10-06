import { normalizeText, isPlainObject } from "./normalize.js";
import { codexAppServerStatusFromValue, codexAppServerThreadRawValue } from "./codexEvents.js";

function codexAppServerTurnStatusIsActive(status = "") {
  return normalizeText(status) === "inProgress";
}

function codexAppServerTurnStatusIsComplete(status = "") {
  return ["completed", "interrupted", "failed"].includes(normalizeText(status));
}

function codexAppServerTurnStatusIsSuccessfulComplete(status = "") {
  return normalizeText(status) === "completed";
}

function codexAppServerTurnStatusIsProviderFailure(status = "") {
  return ["failed", "interrupted"].includes(normalizeText(status));
}

function codexAppServerThreadStatus(thread = {}) {
  const liveStatus = codexAppServerStatusFromValue(
    codexAppServerThreadRawValue(thread).status || thread.status
  );
  // A resumed goal can already be running while turn history still reports
  // interruption. Releasing its chat owner would hide progress and steering.
  if (codexAppServerTurnStatusIsActive(liveStatus)) {
    return liveStatus;
  }
  if (isPlainObject(thread.observedTurn)) {
    const observedStatus = codexAppServerStatusFromValue(thread.observedTurn.status);
    if (observedStatus) {
      return observedStatus;
    }
  }
  return liveStatus;
}

async function codexAppServerReadThreadStatus(provider = null, threadId = "", {
  observeLatestTurn = false
} = {}) {
  const normalizedThreadId = normalizeText(threadId || "");
  if (!normalizedThreadId) {
    return null;
  }
  if (typeof provider?.readThreadStatus === "function") {
    const thread = await provider.readThreadStatus(normalizedThreadId);
    if (!observeLatestTurn || typeof provider?.listThreadTurns !== "function") {
      return thread;
    }
    const response = await provider.listThreadTurns(normalizedThreadId, {
      itemsView: "summary",
      limit: 1,
      sortDirection: "desc"
    });
    const observedTurn = Array.isArray(response?.data) ? response.data[0] : null;
    if (provider.isControlProbeTurn?.(normalizedThreadId, observedTurn?.id)) return thread;
    return isPlainObject(observedTurn)
      ? {
          ...thread,
          observedTurn
        }
      : thread;
  }
  return null;
}

// Original native run projection and guarded mutation sequence. The caller's
// existing runtime/store owns persistence and its mutation lock; no second
// request journal or transcript-derived ownership is introduced here.
const CODEX_APP_SERVER_AGENT_RUN_ID = "codex_app_server";
const CODEX_APP_SERVER_RESULT_PROCESSED_EVENT = "codex-app-server-result-processed";
const CODEX_AGENT_PROVIDER = "codex";
export const CODEX_APP_SERVER_RUN_STATE = Object.freeze({
  ACTIVE: "active",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  FAILED: "failed",
  FINALIZING: "finalizing",
  INTERRUPTED: "interrupted",
  STARTING: "starting",
  TIMED_OUT: "timed_out"
});
const CODEX_APP_SERVER_RUN_STATES = new Set(Object.values(CODEX_APP_SERVER_RUN_STATE));
const CODEX_APP_SERVER_TERMINAL_RUN_STATES = new Set([
  CODEX_APP_SERVER_RUN_STATE.CANCELLED,
  CODEX_APP_SERVER_RUN_STATE.COMPLETED,
  CODEX_APP_SERVER_RUN_STATE.FAILED,
  CODEX_APP_SERVER_RUN_STATE.INTERRUPTED,
  CODEX_APP_SERVER_RUN_STATE.TIMED_OUT
]);
const CODEX_APP_SERVER_ACTIVE_RUN_STATES = new Set([
  CODEX_APP_SERVER_RUN_STATE.ACTIVE,
  CODEX_APP_SERVER_RUN_STATE.FINALIZING,
  CODEX_APP_SERVER_RUN_STATE.STARTING
]);

function normalizeCodexRunText(value) {
  return String(value || "").trim();
}

function codexAppServerRunInputSource(run = {}) {
  return normalizeCodexRunText(run?.inputSource);
}

export function normalizeCodexAppServerRunState(state) {
  const normalizedState = normalizeCodexRunText(state) || CODEX_APP_SERVER_RUN_STATE.STARTING;
  if (!CODEX_APP_SERVER_RUN_STATES.has(normalizedState)) {
    throw Object.assign(new Error(`Invalid Codex app-server run state: ${normalizedState}`), {
      code: "codex_app_server_invalid_run_state"
    });
  }
  return normalizedState;
}

export function codexAppServerRunStateIsActive(state) {
  return CODEX_APP_SERVER_ACTIVE_RUN_STATES.has(normalizeCodexAppServerRunState(state));
}

export function codexAppServerRunStateIsTerminal(state) {
  return CODEX_APP_SERVER_TERMINAL_RUN_STATES.has(normalizeCodexAppServerRunState(state));
}

export function codexAppServerAgentRun(session = {}) {
  const runs = Array.isArray(session.agentRuns) ? session.agentRuns : [];
  return runs.find((run) => normalizeCodexRunText(run?.id) === CODEX_APP_SERVER_AGENT_RUN_ID) || null;
}

export function codexAppServerPendingUserMessageClientIds(run = {}) {
  const ids = run?.pendingUserMessageClientIds;
  return (Array.isArray(ids) ? ids : [])
    .map((id) => normalizeCodexRunText(id))
    .filter(Boolean);
}

export function codexAppServerPendingUserMessageOwnership(run = {}, clientId = "") {
  const pendingClientIds = codexAppServerPendingUserMessageClientIds(run);
  const normalizedClientId = normalizeCodexRunText(clientId);
  const ownedClientId = normalizedClientId
    ? pendingClientIds.find((id) => id === normalizedClientId)
    : pendingClientIds[0];
  if (!ownedClientId) {
    return null;
  }
  return {
    clientId: ownedClientId,
    inputSource: normalizeCodexRunText(run?.inputSource)
  };
}

export function codexAppServerProcessedResultEvent(session = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeCodexRunText(threadId);
  const normalizedTurnId = normalizeCodexRunText(turnId);
  const events = codexAppServerAgentRun(session)?.events;
  return (Array.isArray(events) ? events : []).findLast((event) => (
    normalizeCodexRunText(event?.kind) === CODEX_APP_SERVER_RESULT_PROCESSED_EVENT &&
    normalizeCodexRunText(event?.providerThreadId) === normalizedThreadId &&
    normalizeCodexRunText(event?.providerTurnId) === normalizedTurnId
  )) || null;
}

export function codexAppServerTurnStateFromAgentRun(run = {}, normalizeRunState = normalizeCodexAppServerRunState) {
  const runState = normalizeRunState(run.state);
  const active = codexAppServerRunStateIsActive(runState);
  const state = runState === CODEX_APP_SERVER_RUN_STATE.FINALIZING
    ? "finalizing"
    : runState === CODEX_APP_SERVER_RUN_STATE.STARTING
      ? "starting"
      : active
        ? "active"
        : "idle";
  return {
    active,
    completedAt: normalizeCodexRunText(run.finishedAt),
    error: normalizeCodexRunText(run.error),
    goalStatus: normalizeCodexRunText(run.providerGoalStatus),
    goalThreadId: normalizeCodexRunText(run.providerGoalThreadId),
    inputSource: normalizeCodexRunText(run.inputSource),
    outerTurnId: normalizeCodexRunText(run.outerTurnId),
    phase: active && run.providerStatus !== "observation_lost" ? normalizeCodexRunText(run.providerPhase) : "",
    runId: normalizeCodexRunText(run.id),
    runState,
    startedAt: normalizeCodexRunText(run.startedAt),
    state,
    status: normalizeCodexRunText(run.providerStatus || run.status || runState),
    threadId: normalizeCodexRunText(run.providerThreadId),
    turnId: normalizeCodexRunText(run.providerTurnId),
    updatedAt: normalizeCodexRunText(run.updatedAt)
  };
}

export function codexAppServerTurnState(session = {}, normalizeRunState = normalizeCodexAppServerRunState) {
  const run = codexAppServerAgentRun(session);
  if (run) {
    return codexAppServerTurnStateFromAgentRun(run, normalizeRunState);
  }
  return {
    active: false,
    completedAt: "",
    error: "",
    goalStatus: "",
    goalThreadId: "",
    outerTurnId: "",
    runId: "",
    runState: "",
    startedAt: "",
    state: "idle",
    status: "",
    threadId: "",
    turnId: "",
    updatedAt: ""
  };
}

export function codexAppServerTurnOwnsActiveGoal(turn = {}, threadId = "") {
  const normalizedThreadId = normalizeCodexRunText(threadId);
  const goalThreadId = normalizeCodexRunText(turn.goalThreadId);
  const inputSource = normalizeCodexRunText(turn.inputSource);
  return normalizeCodexRunText(turn.goalStatus) === "active" &&
    Boolean(normalizedThreadId) &&
    goalThreadId === normalizedThreadId &&
    Boolean(normalizeCodexRunText(turn.outerTurnId)) &&
    Boolean(inputSource) &&
    inputSource !== "terminal";
}

export function codexAppServerTurnMatches(turn = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeCodexRunText(threadId);
  const normalizedTurnId = normalizeCodexRunText(turnId);
  const currentThreadId = normalizeCodexRunText(turn.threadId);
  const currentTurnId = normalizeCodexRunText(turn.turnId);
  if (normalizedThreadId && normalizeCodexRunText(turn.threadId) !== normalizedThreadId) {
    return false;
  }
  if (normalizedTurnId && currentTurnId && currentTurnId !== normalizedTurnId) {
    return false;
  }
  if (!normalizedTurnId && currentTurnId) {
    return false;
  }
  if (!normalizedThreadId && currentThreadId) {
    return false;
  }
  return true;
}

export function codexAppServerTurnCanReceiveProviderCompletion(turn = {}, threadId = "", turnId = "") {
  return codexAppServerTurnMatches(turn, threadId, turnId) &&
    ["active", "finalizing"].includes(normalizeCodexRunText(turn.state));
}

export function codexAppServerTurnAwaitsProviderIdentity(turn = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeCodexRunText(threadId);
  const normalizedTurnId = normalizeCodexRunText(turnId);
  const currentThreadId = normalizeCodexRunText(turn.threadId);
  return normalizeCodexRunText(turn.state) === "starting" &&
    Boolean(normalizedTurnId) &&
    !normalizeCodexRunText(turn.turnId) &&
    (!normalizedThreadId || !currentThreadId || normalizedThreadId === currentThreadId);
}

export function codexAppServerTurnCanReceiveProviderActivity(turn = {}, threadId = "", turnId = "") {
  if (turn.status === "observation_lost") return false;
  const normalizedThreadId = normalizeCodexRunText(threadId);
  const normalizedTurnId = normalizeCodexRunText(turnId);
  const currentThreadId = normalizeCodexRunText(turn.threadId);
  const currentTurnId = normalizeCodexRunText(turn.turnId);
  if (!["starting", "active"].includes(normalizeCodexRunText(turn.state))) {
    return false;
  }
  if (normalizedThreadId && currentThreadId && currentThreadId !== normalizedThreadId) {
    return false;
  }
  if (normalizedTurnId && currentTurnId && currentTurnId !== normalizedTurnId) {
    return false;
  }
  if (normalizedThreadId && !currentThreadId) {
    return false;
  }
  return true;
}

export function codexAppServerTurnCanAdoptSuccessor(turn = {}, threadId = "", turnId = "") {
  if (turn.status === "observation_lost") return false;
  const normalizedThreadId = normalizeCodexRunText(threadId);
  const normalizedTurnId = normalizeCodexRunText(turnId);
  const currentThreadId = normalizeCodexRunText(turn.threadId);
  const currentTurnId = normalizeCodexRunText(turn.turnId);
  return turn.active === true &&
    ["active", "finalizing"].includes(normalizeCodexRunText(turn.state)) &&
    Boolean(normalizedThreadId) &&
    normalizedThreadId === currentThreadId &&
    Boolean(normalizedTurnId) &&
    Boolean(currentTurnId) &&
    normalizedTurnId !== currentTurnId;
}

export function codexAppServerTurnKey(threadId = "", turnId = "") {
  return `${normalizeCodexRunText(threadId)}:${normalizeCodexRunText(turnId)}`;
}

export function codexAppServerAgentRunPatch({
  error = "",
  inputSource = "",
  outerTurnId = "",
  phase,
  runState = CODEX_APP_SERVER_RUN_STATE.COMPLETED,
  session = {},
  status = "",
  threadId = "",
  turnId = "",
  updatedAt = ""
} = {}, normalizeRunState = normalizeCodexAppServerRunState) {
  const normalizedRunState = normalizeRunState(runState);
  const currentRun = codexAppServerAgentRun(session);
  const sameActiveTurn = normalizedRunState === CODEX_APP_SERVER_RUN_STATE.ACTIVE &&
    currentRun?.providerThreadId === normalizeCodexRunText(threadId) &&
    currentRun?.providerTurnId === normalizeCodexRunText(turnId);
  const patch = {
    error: normalizeCodexRunText(error),
    provider: CODEX_AGENT_PROVIDER,
    providerInterface: "codex_app_server",
    providerPhase: normalizedRunState === CODEX_APP_SERVER_RUN_STATE.ACTIVE && status !== "observation_lost"
      ? normalizeCodexRunText(phase === undefined && sameActiveTurn ? currentRun?.providerPhase : phase)
      : "",
    providerStatus: normalizeCodexRunText(status),
    providerThreadId: normalizeCodexRunText(threadId),
    providerTurnId: normalizeCodexRunText(turnId),
    state: normalizedRunState,
    updatedAt: normalizeCodexRunText(updatedAt)
  };
  const normalizedInputSource = normalizeCodexRunText(inputSource);
  if (normalizedInputSource) {
    patch.inputSource = normalizedInputSource;
  }
  // A native terminal turn starts its own chat owner. Reusing the previous
  // owner's id would checkpoint two different turns with one identity.
  const normalizedOuterTurnId = normalizeCodexRunText(outerTurnId) ||
    (normalizedInputSource === "terminal" && normalizedRunState === CODEX_APP_SERVER_RUN_STATE.ACTIVE && !sameActiveTurn
      ? `codex:${normalizeCodexRunText(threadId)}:${normalizeCodexRunText(turnId)}`
      : normalizeCodexRunText(currentRun?.outerTurnId));
  if (normalizedOuterTurnId) {
    patch.outerTurnId = normalizedOuterTurnId;
  }
  if (
    normalizedRunState === CODEX_APP_SERVER_RUN_STATE.STARTING ||
    codexAppServerRunStateIsTerminal(normalizedRunState) ||
    normalizedInputSource === "terminal"
  ) {
    patch.pendingUserMessageClientIds = [];
  }
  if ([CODEX_APP_SERVER_RUN_STATE.ACTIVE, CODEX_APP_SERVER_RUN_STATE.STARTING].includes(normalizedRunState)) {
    patch.startedAt = normalizeCodexRunText(updatedAt);
  }
  if (!codexAppServerRunStateIsActive(normalizedRunState)) {
    patch.finishedAt = normalizeCodexRunText(updatedAt);
  }
  return patch;
}

export function codexAppServerRunIdentityForPatch(session = {}, {
  threadId = "",
  turnId = ""
} = {}, normalizeRunState = normalizeCodexAppServerRunState) {
  const normalizedThreadId = normalizeCodexRunText(threadId);
  const normalizedTurnId = normalizeCodexRunText(turnId);
  if (normalizedTurnId) {
    return {
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    };
  }
  const currentTurn = codexAppServerTurnState(session, normalizeRunState);
  const currentThreadId = normalizeCodexRunText(currentTurn.threadId);
  if (
    normalizeCodexRunText(currentTurn.turnId) &&
    ["active", "finalizing"].includes(normalizeCodexRunText(currentTurn.state)) &&
    (!normalizedThreadId || !currentThreadId || normalizedThreadId === currentThreadId)
  ) {
    return {
      threadId: normalizedThreadId || currentThreadId,
      turnId: currentTurn.turnId
    };
  }
  return {
    threadId: normalizedThreadId,
    turnId: normalizedTurnId
  };
}

export function codexAppServerRunPatchIsStaleAfterTerminalState(currentTurn = {}, patch = {}, normalizeRunState = normalizeCodexAppServerRunState) {
  const currentRunState = normalizeRunState(currentTurn.runState);
  const patchRunState = normalizeRunState(patch.state);
  if (!codexAppServerRunStateIsTerminal(currentRunState)) {
    return false;
  }
  if (patchRunState === CODEX_APP_SERVER_RUN_STATE.STARTING) {
    return false;
  }
  const currentThreadId = normalizeCodexRunText(currentTurn.threadId);
  const patchThreadId = normalizeCodexRunText(patch.providerThreadId);
  const currentTurnId = normalizeCodexRunText(currentTurn.turnId);
  const patchTurnId = normalizeCodexRunText(patch.providerTurnId);
  const threadMatches = !patchThreadId || !currentThreadId || patchThreadId === currentThreadId;
  const turnMatches = !patchTurnId || (
    Boolean(currentTurnId) &&
    currentTurnId === patchTurnId
  );
  return threadMatches && turnMatches;
}

function codexAppServerErrorMessage(value, fallback = "Codex could not be prepared.") {
  return normalizeCodexRunText(value?.error || value?.message || value) || fallback;
}

export function codexAppServerSteerFailure(result = {}, steerFailedCode = "codex_turn_steer_failed") {
  if (!isPlainObject(result)) {
    return null;
  }
  if (result.ok !== false) {
    return null;
  }
  return {
    code: normalizeCodexRunText(result.code) || steerFailedCode,
    error: codexAppServerErrorMessage(result, "Codex app-server turn could not be steered."),
    ok: false,
    operationOutcome: normalizeCodexRunText(result.operationOutcome) || "steer_failed",
    refreshRecommended: true,
    retryable: result.retryable === true
  };
}

export function codexAppServerMessageRequiresNewTurn({
  reason = "provider_idle",
  threadId = "",
  turnId = ""
} = {}) {
  return {
    delivered: false,
    deliveryMode: "new_turn",
    newTurnRequired: true,
    ok: true,
    operationOutcome: "new_turn_required",
    reason: normalizeCodexRunText(reason),
    threadId: normalizeCodexRunText(threadId),
    turnId: normalizeCodexRunText(turnId)
  };
}

function codexAppServerMessageDeferred({
  threadId = "",
  turnId = ""
} = {}, steerFailedCode = "codex_turn_steer_failed") {
  return {
    code: steerFailedCode,
    delivered: false,
    error: "The active assistant operation cannot accept messages yet.",
    ok: false,
    operationOutcome: "active_turn_not_steerable",
    refreshRecommended: true,
    retryable: true,
    threadId,
    turnId
  };
}

export function codexAppServerInterruptFailure(result = {}, interruptFailedCode = "codex_turn_interrupt_failed") {
  if (!isPlainObject(result)) {
    return null;
  }
  if (result.ok !== false && result.interrupted !== false) {
    return null;
  }
  return {
    code: normalizeCodexRunText(result.code) || interruptFailedCode,
    error: codexAppServerErrorMessage(result, "Codex app-server turn could not be interrupted."),
    ok: false,
    operationOutcome: normalizeCodexRunText(result.operationOutcome) || "interrupt_failed",
    refreshRecommended: true,
    retryable: result.retryable === true
  };
}

export function codexAppServerInterruptUnavailableResponse({
  active = false,
  threadId = "",
  turnId = ""
} = {}, interruptFailedCode = "codex_turn_interrupt_failed") {
  return {
    active: active === true,
    code: interruptFailedCode,
    error: active
      ? "The active Codex app-server turn is not ready to interrupt yet."
      : "No active Codex app-server turn is available to interrupt.",
    ok: false,
    operationOutcome: "interrupt_unavailable",
    refreshRecommended: true,
    retryable: active === true,
    threadId: normalizeCodexRunText(threadId),
    turnId: normalizeCodexRunText(turnId)
  };
}

export function codexAppServerFrozenTurnInterruptResponse({
  threadId = "",
  turnId = ""
} = {}) {
  return {
    interrupted: false,
    ok: true,
    operationOutcome: "already_idle",
    status: "interrupted",
    threadId: normalizeCodexRunText(threadId),
    turnId: normalizeCodexRunText(turnId)
  };
}

export function codexAppServerConversationTurnIsActive(status = "") {
  return ["starting", "inProgress"].includes(normalizeCodexRunText(status));
}

export function codexAppServerMessageText(input = {}) {
  if (typeof input === "string") {
    return normalizeCodexRunText(input);
  }
  if (!isPlainObject(input)) {
    return "";
  }
  return normalizeCodexRunText(input.message);
}

export function codexAppServerMessageDisplayText(input = {}, fallback = "") {
  if (!isPlainObject(input)) {
    return normalizeCodexRunText(fallback || input);
  }
  return normalizeCodexRunText(input.displayMessage || input.message || fallback);
}

function codexPromptInputFromRequest(input = {}) {
  if (typeof input === "string") {
    return normalizeCodexRunText(input);
  }
  const terminalInput = normalizeCodexRunText(input.terminalInput);
  if (terminalInput) {
    return terminalInput;
  }
  return codexAppServerMessageText(input);
}

export { codexAppServerRunInputSource, codexAppServerThreadStatus, codexAppServerReadThreadStatus, codexAppServerTurnStatusIsActive, codexAppServerTurnStatusIsComplete, codexAppServerTurnStatusIsSuccessfulComplete, codexAppServerTurnStatusIsProviderFailure, normalizeCodexRunText, codexAppServerErrorMessage, codexAppServerMessageDeferred, codexPromptInputFromRequest, CODEX_APP_SERVER_AGENT_RUN_ID, CODEX_APP_SERVER_RESULT_PROCESSED_EVENT, CODEX_AGENT_PROVIDER, CODEX_APP_SERVER_ACTIVE_RUN_STATES };
