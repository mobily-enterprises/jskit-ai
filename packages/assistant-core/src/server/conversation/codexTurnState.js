import crypto from "node:crypto";
import { isRecord, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText } from "./normalize.js";
import { codexAppServerStatusFromValue } from "./codexEvents.js";
import { codexAppServerThreadRawValue } from "./codexThreadSnapshot.js";

function codexAppServerTurnStatusIsActive(status = "") {
  return normalizeNullableText(status) === "inProgress";
}

function codexAppServerTurnStatusIsComplete(status = "") {
  return ["completed", "interrupted", "failed"].includes(normalizeNullableText(status));
}

function codexAppServerTurnStatusIsSuccessfulComplete(status = "") {
  return normalizeNullableText(status) === "completed";
}

function codexAppServerTurnStatusIsProviderFailure(status = "") {
  return ["failed", "interrupted"].includes(normalizeNullableText(status));
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
  if (isRecord(thread.observedTurn)) {
    const observedStatus = codexAppServerStatusFromValue(thread.observedTurn.status);
    if (observedStatus) {
      return observedStatus;
    }
  }
  return liveStatus;
}

/**
 * Reads a native thread's status, and with observeLatestTurn its latest turn too.
 * @param {import("./codexProvider.js").CodexAppServerAgentProvider | null} provider
 * @param {string} threadId
 * @param {{ observeLatestTurn?: boolean }} [options]
 */
async function codexAppServerReadThreadStatus(provider = null, threadId = "", {
  observeLatestTurn = false
} = {}) {
  const normalizedThreadId = normalizeNullableText(threadId || "");
  if (!normalizedThreadId) {
    return null;
  }
  if (provider) {
    const thread = await provider.readThreadStatus(normalizedThreadId);
    if (!observeLatestTurn) {
      return thread;
    }
    const response = await provider.listThreadTurns(normalizedThreadId, {
      itemsView: "summary",
      limit: 1,
      sortDirection: "desc"
    });
    const observedTurn = Array.isArray(response?.data) ? response.data[0] : null;
    if (provider.isControlProbeTurn(normalizedThreadId, observedTurn?.id)) return thread;
    return isRecord(observedTurn)
      ? {
          ...thread,
          observedTurn
        }
      : thread;
  }
  return null;
}

// The native run projection and its guarded mutation sequence. The caller's
// runtime store owns persistence and its mutation lock; there is no second
// request journal and no ownership derived from the transcript.
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

function codexAppServerRunInputSource(run) {
  return normalizeText(run?.inputSource);
}

export function normalizeCodexAppServerRunState(state) {
  const normalizedState = normalizeText(state) || CODEX_APP_SERVER_RUN_STATE.STARTING;
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
  return runs.find((run) => normalizeText(run?.id) === CODEX_APP_SERVER_AGENT_RUN_ID) || null;
}

export function codexAppServerPendingUserMessageClientIds(run) {
  const ids = run?.pendingUserMessageClientIds;
  return (Array.isArray(ids) ? ids : [])
    .map((id) => normalizeText(id))
    .filter(Boolean);
}

export function codexAppServerPendingUserMessageOwnership(run, clientId = "") {
  const pendingClientIds = codexAppServerPendingUserMessageClientIds(run);
  const normalizedClientId = normalizeText(clientId);
  const ownedClientId = normalizedClientId
    ? pendingClientIds.find((id) => id === normalizedClientId)
    : pendingClientIds[0];
  if (!ownedClientId) {
    return null;
  }
  return {
    clientId: ownedClientId,
    inputSource: normalizeText(run?.inputSource)
  };
}

export function codexAppServerProcessedResultEvent(session = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const events = codexAppServerAgentRun(session)?.events;
  return (Array.isArray(events) ? events : []).findLast((event) => (
    normalizeText(event?.kind) === CODEX_APP_SERVER_RESULT_PROCESSED_EVENT &&
    normalizeText(event?.providerThreadId) === normalizedThreadId &&
    normalizeText(event?.providerTurnId) === normalizedTurnId
  )) || null;
}

/**
 * The turn a saved Codex run reports. No saved run (null or undefined) is no turn: it is idle. A saved run
 * whose state is not written yet is starting, which counts as active.
 * @param {object | null | undefined} run
 * @param {(state: unknown) => string} [normalizeRunState]
 */
export function codexAppServerTurnStateFromAgentRun(run, normalizeRunState = normalizeCodexAppServerRunState) {
  if (run == null) return codexAppServerIdleTurnState();
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
    completedAt: normalizeText(run.finishedAt),
    error: normalizeText(run.error),
    goalStatus: normalizeText(run.providerGoalStatus),
    goalThreadId: normalizeText(run.providerGoalThreadId),
    inputSource: normalizeText(run.inputSource),
    outerTurnId: normalizeText(run.outerTurnId),
    phase: active && run.providerStatus !== "observation_lost" ? normalizeText(run.providerPhase) : "",
    runId: normalizeText(run.id),
    runState,
    startedAt: normalizeText(run.startedAt),
    state,
    status: normalizeText(run.providerStatus || run.status || runState),
    threadId: normalizeText(run.providerThreadId),
    turnId: normalizeText(run.providerTurnId),
    updatedAt: normalizeText(run.updatedAt)
  };
}

export function codexAppServerTurnState(session = {}, normalizeRunState = normalizeCodexAppServerRunState) {
  return codexAppServerTurnStateFromAgentRun(codexAppServerAgentRun(session), normalizeRunState);
}

/** The turn of a session or binding that has no saved Codex run. */
function codexAppServerIdleTurnState() {
  return {
    active: false,
    completedAt: "",
    error: "",
    goalStatus: "",
    goalThreadId: "",
    inputSource: "",
    outerTurnId: "",
    phase: "",
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
  const normalizedThreadId = normalizeText(threadId);
  const goalThreadId = normalizeText(turn.goalThreadId);
  const inputSource = normalizeText(turn.inputSource);
  return normalizeText(turn.goalStatus) === "active" &&
    Boolean(normalizedThreadId) &&
    goalThreadId === normalizedThreadId &&
    Boolean(normalizeText(turn.outerTurnId)) &&
    Boolean(inputSource) &&
    inputSource !== "terminal";
}

export function codexAppServerTurnMatches(turn = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const currentThreadId = normalizeText(turn.threadId);
  const currentTurnId = normalizeText(turn.turnId);
  if (normalizedThreadId && normalizeText(turn.threadId) !== normalizedThreadId) {
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
    ["active", "finalizing"].includes(normalizeText(turn.state));
}

export function codexAppServerTurnAwaitsProviderIdentity(turn = {}, threadId = "", turnId = "") {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const currentThreadId = normalizeText(turn.threadId);
  return normalizeText(turn.state) === "starting" &&
    Boolean(normalizedTurnId) &&
    !normalizeText(turn.turnId) &&
    (!normalizedThreadId || !currentThreadId || normalizedThreadId === currentThreadId);
}

export function codexAppServerTurnCanReceiveProviderActivity(turn = {}, threadId = "", turnId = "") {
  if (turn.status === "observation_lost") return false;
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const currentThreadId = normalizeText(turn.threadId);
  const currentTurnId = normalizeText(turn.turnId);
  if (!["starting", "active"].includes(normalizeText(turn.state))) {
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
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  const currentThreadId = normalizeText(turn.threadId);
  const currentTurnId = normalizeText(turn.turnId);
  return turn.active === true &&
    ["active", "finalizing"].includes(normalizeText(turn.state)) &&
    Boolean(normalizedThreadId) &&
    normalizedThreadId === currentThreadId &&
    Boolean(normalizedTurnId) &&
    Boolean(currentTurnId) &&
    normalizedTurnId !== currentTurnId;
}

export function codexAppServerTurnKey(threadId = "", turnId = "") {
  return `${normalizeText(threadId)}:${normalizeText(turnId)}`;
}

// Identity of a native conversation message, derived from its thread, turn, role and text.
export function codexAppServerConversationMessageId(
  threadId = "",
  turnId = "",
  role = "",
  text = ""
) {
  const normalizedText = normalizeText(text);
  const normalizedThreadId = normalizeText(threadId);
  if (!normalizedText || !normalizedThreadId) {
    return "";
  }
  const digest = crypto.createHash("sha256")
    .update([
      normalizedThreadId,
      normalizeText(turnId) || "*",
      normalizeText(role),
      normalizedText
    ].join("\u0000"))
    .digest("hex");
  return `codex-${digest}`;
}

// Identity of a native outer turn. Terminal turns and persistent-conversation
// checkpoints must agree on it, so both build it here.
export function codexAppServerNativeOuterTurnId(threadId = "", turnId = "") {
  return `codex:${threadId}:${turnId}`;
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
    currentRun?.providerThreadId === normalizeText(threadId) &&
    currentRun?.providerTurnId === normalizeText(turnId);
  const patch = {
    error: normalizeText(error),
    provider: CODEX_AGENT_PROVIDER,
    providerInterface: "codex_app_server",
    providerPhase: normalizedRunState === CODEX_APP_SERVER_RUN_STATE.ACTIVE && status !== "observation_lost"
      ? normalizeText(phase === undefined && sameActiveTurn ? currentRun?.providerPhase : phase)
      : "",
    providerStatus: normalizeText(status),
    providerThreadId: normalizeText(threadId),
    providerTurnId: normalizeText(turnId),
    state: normalizedRunState,
    updatedAt: normalizeText(updatedAt)
  };
  const normalizedInputSource = normalizeText(inputSource);
  if (normalizedInputSource) {
    patch.inputSource = normalizedInputSource;
  }
  // A native terminal turn starts its own chat owner. Reusing the previous
  // owner's id would checkpoint two different turns with one identity.
  const normalizedOuterTurnId = normalizeText(outerTurnId) ||
    (normalizedInputSource === "terminal" && normalizedRunState === CODEX_APP_SERVER_RUN_STATE.ACTIVE && !sameActiveTurn
      ? codexAppServerNativeOuterTurnId(normalizeText(threadId), normalizeText(turnId))
      : normalizeText(currentRun?.outerTurnId));
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
    patch.startedAt = normalizeText(updatedAt);
  }
  if (!codexAppServerRunStateIsActive(normalizedRunState)) {
    patch.finishedAt = normalizeText(updatedAt);
  }
  return patch;
}

export function codexAppServerRunIdentityForPatch(session = {}, {
  threadId = "",
  turnId = ""
} = {}, normalizeRunState = normalizeCodexAppServerRunState) {
  const normalizedThreadId = normalizeText(threadId);
  const normalizedTurnId = normalizeText(turnId);
  if (normalizedTurnId) {
    return {
      threadId: normalizedThreadId,
      turnId: normalizedTurnId
    };
  }
  const currentTurn = codexAppServerTurnState(session, normalizeRunState);
  const currentThreadId = normalizeText(currentTurn.threadId);
  if (
    normalizeText(currentTurn.turnId) &&
    ["active", "finalizing"].includes(normalizeText(currentTurn.state)) &&
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

// A settling writer names the turn it settles. While another turn owns the
// active run, that write belongs to a predecessor and must not end the run.
export function codexAppServerRunPatchSettlesOtherActiveTurn(currentTurn = {}, patch = {}) {
  const currentTurnId = normalizeText(currentTurn.turnId);
  const patchTurnId = normalizeText(patch.providerTurnId);
  return currentTurn.active === true &&
    !codexAppServerRunStateIsActive(patch.state) &&
    Boolean(currentTurnId) &&
    Boolean(patchTurnId) &&
    currentTurnId !== patchTurnId;
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
  const currentThreadId = normalizeText(currentTurn.threadId);
  const patchThreadId = normalizeText(patch.providerThreadId);
  const currentTurnId = normalizeText(currentTurn.turnId);
  const patchTurnId = normalizeText(patch.providerTurnId);
  const threadMatches = !patchThreadId || !currentThreadId || patchThreadId === currentThreadId;
  const turnMatches = !patchTurnId || (
    Boolean(currentTurnId) &&
    currentTurnId === patchTurnId
  );
  return threadMatches && turnMatches;
}

function codexAppServerErrorMessage(value, fallback = "Codex could not be prepared.") {
  return normalizeText(value?.error || value?.message || value) || fallback;
}

export function codexAppServerSteerFailure(result = {}, steerFailedCode = "codex_turn_steer_failed") {
  if (!isRecord(result)) {
    return null;
  }
  if (result.ok !== false) {
    return null;
  }
  return {
    code: normalizeText(result.code) || steerFailedCode,
    error: codexAppServerErrorMessage(result, "Codex app-server turn could not be steered."),
    ok: false,
    operationOutcome: normalizeText(result.operationOutcome) || "steer_failed",
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
    reason: normalizeText(reason),
    threadId: normalizeText(threadId),
    turnId: normalizeText(turnId)
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
    messageCode: "assistant.codex.operationNotSteerable",
    messageParams: {},
    ok: false,
    operationOutcome: "active_turn_not_steerable",
    refreshRecommended: true,
    retryable: true,
    threadId,
    turnId
  };
}

export function codexAppServerInterruptFailure(result = {}, interruptFailedCode = "codex_turn_interrupt_failed") {
  if (!isRecord(result)) {
    return null;
  }
  if (result.ok !== false && result.interrupted !== false) {
    return null;
  }
  return {
    code: normalizeText(result.code) || interruptFailedCode,
    error: codexAppServerErrorMessage(result, "Codex app-server turn could not be interrupted."),
    ok: false,
    operationOutcome: normalizeText(result.operationOutcome) || "interrupt_failed",
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
    threadId: normalizeText(threadId),
    turnId: normalizeText(turnId)
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
    threadId: normalizeText(threadId),
    turnId: normalizeText(turnId)
  };
}

export function codexAppServerConversationTurnIsActive(status = "") {
  return ["starting", "inProgress"].includes(normalizeText(status));
}

export function codexAppServerMessageText(input = {}) {
  if (typeof input === "string") {
    return normalizeText(input);
  }
  if (!isRecord(input)) {
    return "";
  }
  return normalizeText(input.message);
}

export function codexAppServerMessageDisplayText(input = {}, fallback = "") {
  if (!isRecord(input)) {
    return normalizeText(fallback || input);
  }
  return normalizeText(input.displayMessage || input.message || fallback);
}

function codexPromptInputFromRequest(input = {}) {
  if (typeof input === "string") {
    return normalizeText(input);
  }
  const terminalInput = normalizeText(input.terminalInput);
  if (terminalInput) {
    return terminalInput;
  }
  return codexAppServerMessageText(input);
}

export { codexAppServerRunInputSource, codexAppServerThreadStatus, codexAppServerReadThreadStatus, codexAppServerTurnStatusIsActive, codexAppServerTurnStatusIsComplete, codexAppServerTurnStatusIsSuccessfulComplete, codexAppServerTurnStatusIsProviderFailure, codexAppServerErrorMessage, codexAppServerMessageDeferred, codexPromptInputFromRequest, CODEX_APP_SERVER_AGENT_RUN_ID, CODEX_APP_SERVER_RESULT_PROCESSED_EVENT, CODEX_AGENT_PROVIDER, CODEX_APP_SERVER_ACTIVE_RUN_STATES };
