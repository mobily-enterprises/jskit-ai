import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText } from "./normalize.js";
import { normalizeCodexAppServerRunState, codexAppServerRunStateIsActive,
  codexAppServerRunStateIsTerminal } from "./codexTurn.js";

const normalizeRunState = state => normalizeCodexAppServerRunState(normalizeNullableText(state));
const runStateIsActive = state => codexAppServerRunStateIsActive(normalizeNullableText(state));
const runStateIsTerminal = state => codexAppServerRunStateIsTerminal(normalizeNullableText(state));

export function conversationAgentRunRecord(record, normalizedRunId, {
  normalizeState = normalizeRunState,
  isActive = runStateIsActive
} = {}) {
  return isRecord(record)
    ? {
        ...record,
        active: isActive(record.state),
        events: Array.isArray(record.events) ? record.events.filter(isRecord) : [],
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
  const eventAt = normalizeNullableText(event.at || patch.updatedAt) || now().toISOString();
  const state = normalizeState(patch.state || event.state || previous.state);
  const terminalState = isTerminal(state);
  const eventRecord = {
    ...event,
    at: eventAt,
    kind: normalizeNullableText(event.kind || state || "updated"),
    message: normalizeNullableText(event.message || patch.message),
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
      ? normalizeNullableText(patch.finishedAt || previous.finishedAt) || eventAt
      : "",
    id: normalizedRunId,
    startedAt: normalizeNullableText(previous.startedAt || patch.startedAt) || eventAt,
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
