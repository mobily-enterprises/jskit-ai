import { isPlainObject, normalizeText } from "./normalize.js";
import { normalizeCodexAppServerRunState, codexAppServerRunStateIsActive,
  codexAppServerRunStateIsTerminal } from "./codexTurn.js";

const normalizeRunState = state => normalizeCodexAppServerRunState(normalizeText(state));
const runStateIsActive = state => codexAppServerRunStateIsActive(normalizeText(state));
const runStateIsTerminal = state => codexAppServerRunStateIsTerminal(normalizeText(state));

export function conversationAgentRunRecord(record, normalizedRunId, {
  normalizeState = normalizeRunState,
  isActive = runStateIsActive
} = {}) {
  return isPlainObject(record)
    ? {
        ...record,
        active: isActive(record.state),
        events: Array.isArray(record.events) ? record.events.filter(isPlainObject) : [],
        id: normalizedRunId,
        state: normalizeState(record.state)
      }
    : null;
}

export function conversationAgentRunEvent(previous, normalizedRunId, {
  event = {},
  patch = {}
} = {}, {
  now = () => new Date(),
  normalizeState = normalizeRunState,
  isTerminal = runStateIsTerminal
} = {}) {
  const eventAt = normalizeText(event.at || patch.updatedAt) || now().toISOString();
  const state = normalizeState(patch.state || event.state || previous.state);
  const terminalState = isTerminal(state);
  const eventRecord = {
    ...event,
    at: eventAt,
    kind: normalizeText(event.kind || state || "updated"),
    message: normalizeText(event.message || patch.message),
    state
  };
  const record = {
    ...previous,
    ...patch,
    active: !terminalState,
    events: [
      ...(Array.isArray(previous.events) ? previous.events : []),
      eventRecord
    ],
    finishedAt: terminalState
      ? normalizeText(patch.finishedAt || previous.finishedAt) || eventAt
      : "",
    id: normalizedRunId,
    startedAt: normalizeText(previous.startedAt || patch.startedAt) || eventAt,
    state,
    updatedAt: eventAt
  };
  if (!terminalState && !Object.hasOwn(patch, "error")) {
    record.error = "";
  }
  return record;
}

/** Explicit offline copy only: the destination has no inherited execution. */
export function prepareCopiedConversationAgentRun(run, { at }) {
  const active = runStateIsActive(run.state);
  if (!active && run.providerGoalStatus !== "active") return structuredClone(run);
  return conversationAgentRunEvent(run, run.id, {
    event: { at, kind: "development-copy", message: "Copied into a stopped development environment." },
    patch: { state: active ? "interrupted" : run.state, providerPhase: "",
      ...(active ? { providerStatus: "interrupted", pendingUserMessageClientIds: [], finishedAt: at } : {}),
      ...(run.providerGoalStatus === "active" ? { providerGoalStatus: "paused" } : {}) }
  });
}
