import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText } from "./normalize.js";

const CODEX_TOKEN_USAGE_METHOD = "thread/tokenUsage/updated";

function nonNegativeInteger(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function codexContextUsageFromNotification(notification = {}) {
  if (normalizeNullableText(notification?.method) !== CODEX_TOKEN_USAGE_METHOD) {
    return null;
  }
  const params = notification?.params && typeof notification.params === "object"
    ? notification.params
    : {};
  const tokenUsage = params.tokenUsage && typeof params.tokenUsage === "object"
    ? params.tokenUsage
    : {};
  const last = tokenUsage.last && typeof tokenUsage.last === "object"
    ? tokenUsage.last
    : {};
  const total = tokenUsage.total && typeof tokenUsage.total === "object"
    ? tokenUsage.total
    : {};
  const usedTokens = nonNegativeInteger(last.totalTokens);
  const inputTokens = nonNegativeInteger(last.inputTokens);
  const cumulativeTokens = nonNegativeInteger(total.totalTokens);
  const windowTokens = nonNegativeInteger(tokenUsage.modelContextWindow);
  const threadId = normalizeNullableText(params.threadId);
  const turnId = normalizeNullableText(params.turnId);
  if (
    !threadId ||
    !turnId ||
    usedTokens === null ||
    inputTokens === null ||
    cumulativeTokens === null ||
    !windowTokens ||
    usedTokens > windowTokens ||
    inputTokens > usedTokens ||
    cumulativeTokens < usedTokens
  ) {
    return null;
  }
  return Object.freeze({
    cumulativeTokens,
    inputTokens,
    threadId,
    turnId,
    usedTokens,
    windowTokens
  });
}

const CODEX_APP_SERVER_CONTEXT_COMPACTION_SIGNALS = new Set(
  [
    "contextcompaction",
    ...["context", "thread", "conversation"].flatMap((subject) => (
      ["compact", "compacted", "compaction", "truncate", "truncated", "truncation"]
        .flatMap((state) => [`${subject}_${state}`, `${state}_${subject}`])
    ))
  ]
);
const CODEX_APP_SERVER_CONTEXT_REFRESH_SIGNALS = new Set([
  "context_refresh_required",
  "context_refresh_needed",
  "context_refresh_pending"
]);

function codexAppServerStatusFromValue(status = null) {
  if (typeof status === "string") {
    const normalized = normalizeNullableText(status);
    if (normalized === "active") {
      return "inProgress";
    }
    if (normalized === "idle" || normalized === "notLoaded") {
      return "completed";
    }
    if (normalized === "systemError") {
      return "failed";
    }
    return normalized;
  }
  if (!isRecord(status)) {
    return "";
  }
  const type = normalizeNullableText(status.type);
  if (type === "active") {
    return "inProgress";
  }
  if (type === "idle" || type === "notLoaded" || type === "completed") {
    return "completed";
  }
  if (type === "systemError" || type === "failed") {
    return "failed";
  }
  if (type === "interrupted") {
    return "interrupted";
  }
  return type;
}

function codexAppServerNotificationParams(notification = {}) {
  return isRecord(notification?.params) ? notification.params : {};
}

function codexAppServerNotificationEvent(notification = {}) {
  const method = normalizeNullableText(notification.method);
  const params = codexAppServerNotificationParams(notification);
  const candidates = [
    params.event,
    params.msg,
    params.entry,
    params.record,
    notification.event,
    notification.msg,
    notification.entry,
    notification.record
  ];
  for (const candidate of candidates) {
    if (isRecord(candidate)) {
      return candidate;
    }
  }
  if (isRecord(params.payload) || normalizeNullableText(params.type)) {
    return params;
  }
  if (isRecord(notification.payload) || normalizeNullableText(notification.type)) {
    return notification;
  }
  if (["event_msg", "response_item", "task_complete"].includes(method) && isRecord(params)) {
    return params;
  }
  return null;
}

function codexAppServerNotificationEventType(notification = {}, event = null) {
  const params = codexAppServerNotificationParams(notification);
  return normalizeNullableText(event?.type || params.type || notification.type || notification.method);
}

function codexAppServerNotificationEventPayload(notification = {}, event = null) {
  if (isRecord(event?.payload)) {
    return event.payload;
  }
  const params = codexAppServerNotificationParams(notification);
  if (isRecord(params.payload)) {
    return params.payload;
  }
  if (isRecord(notification.payload)) {
    return notification.payload;
  }
  return isRecord(event) ? event : {};
}

function codexAppServerNotificationItem(notification = {}) {
  const item = codexAppServerNotificationParams(notification).item;
  return isRecord(item) ? item : null;
}

function codexAppServerNotificationThreadId(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const event = codexAppServerNotificationEvent(notification);
  const payload = codexAppServerNotificationEventPayload(notification, event);
  return normalizeNullableText(
    params.threadId ||
    params.thread_id ||
    params.thread?.id ||
    event?.threadId ||
    event?.thread_id ||
    payload.threadId ||
    payload.thread_id
  );
}

function codexAppServerNotificationTurnId(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const event = codexAppServerNotificationEvent(notification);
  const payload = codexAppServerNotificationEventPayload(notification, event);
  const item = codexAppServerNotificationItem(notification);
  return normalizeNullableText(
    params.turnId ||
    params.turn_id ||
    params.turn?.id ||
    event?.turnId ||
    event?.turn_id ||
    payload.turnId ||
    payload.turn_id ||
    item?.turnId ||
    item?.turn_id
  );
}

function codexAppServerNotificationTurnStatus(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const turnStatus = normalizeNullableText(params.turn?.status);
  return turnStatus || codexAppServerStatusFromValue(params.status);
}

function codexAppServerErrorText(value = null, seen = new Set()) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    const text = normalizeNullableText(value);
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        const parsedText = codexAppServerErrorText(parsed, seen);
        if (parsedText) {
          return parsedText;
        }
      } catch {
        // Keep non-JSON provider details as their original user-facing text.
      }
    }
    return text;
  }
  if (!isRecord(value)) {
    return "";
  }
  if (seen.has(value)) {
    return "";
  }
  seen.add(value);
  const messages = [
    codexAppServerErrorText(value.message, seen),
    codexAppServerErrorText(value.error, seen),
    codexAppServerErrorText(value.additionalDetails || value.additional_details, seen),
    codexAppServerErrorText(value.details || value.detail, seen),
    codexAppServerErrorText(value.reason, seen),
    codexAppServerErrorText(value.codexErrorInfo || value.codex_error_info, seen)
  ].filter(Boolean);
  if (!messages.length) {
    return normalizeNullableText(value.code);
  }
  return [...new Set(messages)].join(" ");
}

function codexAppServerNotificationError(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const status = isRecord(params.status) ? params.status : {};
  const turn = isRecord(params.turn) ? params.turn : {};
  return normalizeNullableText(
    codexAppServerErrorText(params.error) ||
    params.message ||
    codexAppServerErrorText(status.error) ||
    status.message ||
    codexAppServerErrorText(turn.error) ||
    turn.message
  );
}

function codexAppServerNotificationUsageLimitExceeded(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const status = isRecord(params.status) ? params.status : {};
  const turn = isRecord(params.turn) ? params.turn : {};
  return [params.error, status.error, turn.error].some((error) => (
    isRecord(error) &&
    normalizeNullableText(error.codexErrorInfo || error.codex_error_info) === "usageLimitExceeded"
  ));
}

function codexAppServerTextInputText(input = {}) {
  if (!isRecord(input) || normalizeNullableText(input.type) !== "text") {
    return "";
  }
  return normalizeNullableText(input.text);
}

function codexAppServerUserMessageText(item = {}) {
  if (!isRecord(item) || normalizeNullableText(item.type) !== "userMessage") {
    return "";
  }
  return (Array.isArray(item.content) ? item.content : [])
    .map((input) => codexAppServerTextInputText(input))
    .filter(Boolean)
    .join("\n\n");
}

function codexAppServerContentText(value = null) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => codexAppServerContentText(entry)).filter(Boolean).join("");
  }
  if (!isRecord(value)) {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.value === "string") {
    return value.value;
  }
  if (typeof value.content === "string" || Array.isArray(value.content)) {
    return codexAppServerContentText(value.content);
  }
  if (typeof value.message === "string" || Array.isArray(value.message)) {
    return codexAppServerContentText(value.message);
  }
  if (isRecord(value.message)) {
    return codexAppServerContentText(value.message.content || value.message.text);
  }
  return "";
}

function codexAppServerAssistantItemText(item = {}) {
  if (!isRecord(item)) {
    return "";
  }
  const type = normalizeNullableText(item.type);
  const role = normalizeNullableText(item.role || item.author?.role);
  const isAssistant = role === "assistant" ||
    type === "agentMessage" ||
    type === "assistantMessage" ||
    type === "assistant_message" ||
    type === "outputMessage" ||
    type === "message" && role === "assistant";
  if (!isAssistant) {
    return "";
  }
  return normalizeNullableText(
    codexAppServerContentText(item.content) ||
    codexAppServerContentText(item.text) ||
    codexAppServerContentText(item.message)
  );
}

function codexAppServerHookPromptText(item = {}) {
  if (!isRecord(item) || normalizeNullableText(item.type) !== "hookPrompt") {
    return "";
  }
  return (Array.isArray(item.fragments) ? item.fragments : [])
    .map((fragment) => normalizeNullableText(fragment?.text))
    .filter(Boolean)
    .join("\n\n");
}

function codexAppServerNotificationItemId(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const item = codexAppServerNotificationItem(notification);
  const event = codexAppServerNotificationEvent(notification);
  const payload = codexAppServerNotificationEventPayload(notification, event);
  return normalizeNullableText(
    item?.id ||
    params.itemId ||
    params.item_id ||
    event?.itemId ||
    event?.item_id ||
    payload.itemId ||
    payload.item_id ||
    payload.id
  );
}

// Text of an event_msg agent_message payload.
function codexAppServerAgentMessageText(payload = {}) {
  return normalizeNullableText(
    codexAppServerContentText(payload.message) ||
    codexAppServerContentText(payload.text) ||
    codexAppServerContentText(payload.content)
  );
}

function codexAppServerFinalEventText(notification = {}, event = null, payload = {}) {
  const eventType = codexAppServerNotificationEventType(notification, event);
  const payloadType = normalizeNullableText(payload.type);
  const phase = normalizeNullableText(payload.phase || event?.phase);
  if (eventType === "task_complete") {
    return normalizeNullableText(
      codexAppServerContentText(payload.last_agent_message) ||
      codexAppServerContentText(payload.lastAgentMessage)
    );
  }
  if (eventType === "event_msg" && payloadType === "agent_message" && phase === "final_answer") {
    return codexAppServerAgentMessageText(payload);
  }
  if (eventType === "response_item" && phase === "final_answer") {
    return codexAppServerAssistantItemText(payload);
  }
  return "";
}

function classifyCodexAppServerEvent(notification = {}) {
  const method = normalizeNullableText(notification.method);
  const event = codexAppServerNotificationEvent(notification);
  const payload = codexAppServerNotificationEventPayload(notification, event);
  const eventType = event ? codexAppServerNotificationEventType(notification, event) : "";
  const payloadType = normalizeNullableText(payload.type);
  const item = codexAppServerNotificationItem(notification);
  const itemType = normalizeNullableText(item?.type);
  const itemText = codexAppServerAssistantItemText(item);
  const phase = normalizeNullableText(payload.phase || event?.phase || item?.phase || item?.purpose || item?.category);
  const base = {
    itemId: codexAppServerNotificationItemId(notification),
    source: method || eventType || "notification",
    text: "",
    threadId: codexAppServerNotificationThreadId(notification),
    turnId: codexAppServerNotificationTurnId(notification)
  };
  if (itemType === "contextCompaction" && (method === "item/started" || method === "item/completed")) {
    base.phase = method === "item/started" ? "compacting" : "working";
  } else if (method === "error" && codexAppServerNotificationParams(notification).willRetry === true) {
    base.phase = "retrying";
  }

  if (method === "item/agentMessage/delta") {
    const { delta } = codexAppServerNotificationParams(notification);
    return {
      ...base,
      kind: "assistant_delta",
      delta: typeof delta === "string" ? delta : ""
    };
  }

  if (method === "item/started" && itemType === "agentMessage") {
    return {
      ...base,
      kind: "assistant_started",
      role: phase === "commentary" ? "commentary" : "assistant"
    };
  }

  if (method === "error") {
    return {
      ...base,
      kind: "provider_error",
      text: codexAppServerNotificationError(notification)
    };
  }

  if (method === "item/reasoning/summaryPartAdded" || method === "item/reasoning/summaryTextDelta") {
    return {
      ...base,
      kind: "reasoning_summary",
      delta: codexAppServerContentText(codexAppServerNotificationParams(notification).delta),
      text: normalizeNullableText(codexAppServerContentText(codexAppServerNotificationParams(notification).delta))
    };
  }

  const finalEventText = event ? codexAppServerFinalEventText(notification, event, payload) : "";
  if (finalEventText) {
    return {
      ...base,
      kind: "final_assistant_result",
      source: eventType,
      text: finalEventText
    };
  }

  if (itemType === "hookPrompt") {
    return {
      ...base,
      kind: "hook_prompt",
      text: codexAppServerHookPromptText(item)
    };
  }

  if (method === "item/completed" && itemType === "userMessage") {
    return {
      ...base,
      kind: "terminal_user_message",
      text: codexAppServerUserMessageText(item)
    };
  }

  if (method === "item/completed" && itemText) {
    return phase === "final_answer"
      ? {
          ...base,
          kind: "final_assistant_result",
          source: "item",
          text: itemText
        }
      : {
          ...base,
          kind: "live_progress",
          source: "item",
          text: itemText
        };
  }

  if (eventType === "event_msg" && payloadType === "agent_message") {
    if (!phase) {
      return {
        ...base,
        kind: "ignored",
        source: eventType
      };
    }
    return {
      ...base,
      kind: "live_progress",
      source: eventType,
      text: codexAppServerAgentMessageText(payload)
    };
  }

  if (eventType === "response_item") {
    if (!phase) {
      return {
        ...base,
        kind: "ignored",
        source: eventType
      };
    }
    return {
      ...base,
      kind: "live_progress",
      source: eventType,
      text: codexAppServerAssistantItemText(payload)
    };
  }

  if (method === "turn/started" || method === "turn/completed" || method === "thread/status/changed") {
    return {
      ...base,
      kind: "status",
      ...(codexAppServerNotificationTurnStatus(notification) === "inProgress" ? { phase: "working" } : {}),
      text: codexAppServerNotificationTurnStatus(notification)
    };
  }

  return {
    ...base,
    kind: "ignored"
  };
}

function codexAppServerSignalName(value = "") {
  return normalizeNullableText(value)
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll("/", "_");
}

function codexAppServerSignalNames(value = null) {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return [codexAppServerSignalName(value)].filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => codexAppServerSignalNames(entry));
  }
  if (!isRecord(value)) {
    return [];
  }
  return [
    value.type,
    value.event,
    value.kind,
    value.reason,
    value.code,
    value.status,
    value.phase,
    value.name
  ].map((signal) => codexAppServerSignalName(signal)).filter(Boolean);
}

function codexAppServerContextRefreshReason(notification = {}) {
  const method = normalizeNullableText(notification.method);
  const item = codexAppServerNotificationItem(notification);
  const event = codexAppServerNotificationEvent(notification);
  const payload = codexAppServerNotificationEventPayload(notification, event);
  const eventType = codexAppServerNotificationEventType(notification, event);
  const payloadType = normalizeNullableText(payload.type);
  const signals = [
    method,
    item?.type,
    eventType,
    payloadType,
    ...codexAppServerSignalNames(item),
    ...codexAppServerSignalNames(payload),
    ...codexAppServerSignalNames(event)
  ].map((signal) => codexAppServerSignalName(signal)).filter(Boolean);

  if (signals.some((signal) => CODEX_APP_SERVER_CONTEXT_COMPACTION_SIGNALS.has(signal))) {
    return "context_compacted";
  }
  if (signals.some((signal) => CODEX_APP_SERVER_CONTEXT_REFRESH_SIGNALS.has(signal))) {
    return "context_refresh_required";
  }
  return "";
}

// Like codexAppServerThreadRawValue, but provider results may also wrap the
// thread once more under `thread`, checked after raw and response.thread.
function codexAppServerProviderThread(value = {}) {
  if (!isRecord(value?.raw) && !isRecord(value?.response?.thread) && isRecord(value?.thread)) {
    return value.thread;
  }
  return codexAppServerThreadRawValue(value || {});
}

function codexAppServerProviderTurnId(turn = {}) {
  return normalizeNullableText(turn.id || turn.turnId || turn.turn_id || turn.turn?.id || "");
}

function codexAppServerProviderTurnItems(turn = {}) {
  return [
    ...(Array.isArray(turn.items) ? turn.items : []),
    ...(Array.isArray(turn.itemsView) ? turn.itemsView : [])
  ].filter(isRecord);
}

function codexAppServerProviderThreadTurn(value = {}, turnId = "") {
  const normalizedTurnId = normalizeNullableText(turnId);
  if (!normalizedTurnId) {
    return null;
  }
  const thread = codexAppServerProviderThread(value);
  return (Array.isArray(thread.turns) ? thread.turns : [])
    .find((turn) => codexAppServerProviderTurnId(turn) === normalizedTurnId) || null;
}

function codexAppServerProviderTurnAssistantSegments(turn = {}) {
  const seenItemIds = new Set();
  const items = codexAppServerProviderTurnItems(turn);
  // Providers without phases emit progress as ordinary assistant messages.
  // Only the trailing response can be a final; reasoning/tools separate it
  // from earlier updates. Explicit finals retain their native attribution.
  let responseStart = items.length;
  while (responseStart > 0 && codexAppServerAssistantItemText(items[responseStart - 1])) responseStart -= 1;
  const active = ["inProgress", "starting"].includes(codexAppServerStatusFromValue(turn.status));
  return items
    .filter((item, index) => {
      const phase = normalizeNullableText(item.phase);
      return phase === "final_answer" || (!phase && !active && index >= responseStart);
    })
    .map((item) => {
      const itemId = normalizeNullableText(item.id);
      const text = codexAppServerAssistantItemText(item);
      if (
        !itemId ||
        !text ||
        seenItemIds.has(itemId)
      ) {
        return null;
      }
      seenItemIds.add(itemId);
      return {
        itemId,
        text
      };
    })
    .filter(Boolean);
}

function codexAppServerProviderThreadAssistantSegments(value = {}, turnId = "") {
  const turn = codexAppServerProviderThreadTurn(value, turnId);
  return turn ? codexAppServerProviderTurnAssistantSegments(turn) : [];
}

function codexAppServerOutputOwnerTurnId({
  notificationThreadId = "",
  notificationTurnId = "",
  trackedActive = false,
  trackedState = "",
  trackedThreadId = "",
  trackedTurnId = ""
} = {}) {
  const normalizedNotificationThreadId = normalizeNullableText(notificationThreadId);
  const normalizedTrackedThreadId = normalizeNullableText(trackedThreadId);
  const normalizedTrackedTurnId = normalizeNullableText(trackedTurnId);
  const trackedTurnOwnsResult = trackedActive === true &&
    ["active", "finalizing"].includes(normalizeNullableText(trackedState)) &&
    Boolean(normalizedTrackedTurnId) &&
    Boolean(normalizedNotificationThreadId) &&
    normalizedNotificationThreadId === normalizedTrackedThreadId;
  return trackedTurnOwnsResult
    ? normalizedTrackedTurnId
    : normalizeNullableText(notificationTurnId);
}

function codexAppServerThreadRawValue(thread = {}) {
  if (isRecord(thread.raw)) {
    return thread.raw;
  }
  if (isRecord(thread.response?.thread)) {
    return thread.response.thread;
  }
  return isRecord(thread) ? thread : {};
}

function codexAppServerThreadTurnId(thread = {}) {
  const observedTurnId = normalizeNullableText(thread.observedTurn?.id || "");
  if (observedTurnId) {
    return observedTurnId;
  }
  const rawThread = codexAppServerThreadRawValue(thread);
  const status = isRecord(rawThread.status) ? rawThread.status : {};
  return normalizeNullableText(
    thread.turnId ||
    thread.turn_id ||
    thread.turn?.id ||
    rawThread.turnId ||
    rawThread.turn_id ||
    rawThread.turn?.id ||
    rawThread.currentTurnId ||
    rawThread.current_turn_id ||
    rawThread.activeTurnId ||
    rawThread.active_turn_id ||
    status.turnId ||
    status.turn_id ||
    status.turn?.id ||
    status.currentTurnId ||
    status.current_turn_id ||
    status.activeTurnId ||
    status.active_turn_id ||
    ""
  );
}

function codexAppServerThreadError(thread = {}) {
  const rawThread = codexAppServerThreadRawValue(thread);
  const status = isRecord(rawThread.status) ? rawThread.status : {};
  return codexAppServerErrorText(rawThread.error || status.error);
}

function codexAppServerProviderThreadTurns(thread = null) {
  const rawThread = codexAppServerThreadRawValue(thread || {});
  return (Array.isArray(rawThread.turns) ? rawThread.turns : [])
    .filter((turn) => isRecord(turn));
}

function codexAppServerProviderTurnStatus(turn = {}) {
  return codexAppServerStatusFromValue(turn.status || turn.state);
}

function codexAppServerProviderTurnClientIds(turn = {}) {
  return codexAppServerProviderTurnItems(turn)
    .map((item) => normalizeNullableText(
      item.clientId ||
      item.client_id ||
      item.clientUserMessageId ||
      item.client_user_message_id ||
      ""
    ))
    .filter(Boolean);
}

function codexAppServerProviderTurnForOperation(thread = null, {
  clientMessageId = "",
  turnId = ""
} = {}) {
  const normalizedTurnId = normalizeNullableText(turnId || "");
  const normalizedClientMessageId = normalizeNullableText(clientMessageId || "");
  const turns = codexAppServerProviderThreadTurns(thread);
  if (normalizedTurnId) {
    return turns.find((turn) => (
      codexAppServerProviderTurnId(turn) === normalizedTurnId
    )) || null;
  }
  if (!normalizedClientMessageId) {
    return null;
  }
  return [...turns].reverse().find((turn) => (
    codexAppServerProviderTurnClientIds(turn).includes(normalizedClientMessageId)
  )) || null;
}

// Native snapshot matching for renewal handover and seeding.
// The application projects these classifications into its approval/error policy.
function inspectCodexAppServerRenewalThread(thread = null, {
  clientMessageId = "",
  turnId: expectedTurnId = "",
  requireFresh = false
} = {}) {
  const snapshotTurns = codexAppServerProviderThreadTurns(thread);
  const targetTurn = codexAppServerProviderTurnForOperation(thread, {
    clientMessageId,
    turnId: expectedTurnId
  });
  if (expectedTurnId && !targetTurn) return { targetTurn, failure: "turn_missing" };
  if (!requireFresh && !targetTurn && snapshotTurns.length === 0) return { targetTurn, failure: "history_missing" };
  if (requireFresh && snapshotTurns.some((turn) => (
    !targetTurn || codexAppServerProviderTurnId(turn) !== codexAppServerProviderTurnId(targetTurn)
  ))) return { targetTurn, failure: "unrelated_history" };
  return { targetTurn, failure: "" };
}

function codexAppServerProviderTurnText(thread = null, turnId = "") {
  return codexAppServerProviderThreadAssistantSegments(thread || {}, turnId)
    .map((segment) => segment.text)
    .join("\n\n")
    .trim();
}

function codexAppServerProviderTurnError(turn = {}) {
  return codexAppServerErrorText(turn.error || turn.status?.error || turn.state?.error);
}

export {
  codexContextUsageFromNotification,
  classifyCodexAppServerEvent,
  codexAppServerThreadRawValue,
  codexAppServerThreadTurnId,
  codexAppServerThreadError,
  codexAppServerProviderThreadTurns,
  codexAppServerProviderTurnId,
  codexAppServerProviderTurnStatus,
  codexAppServerProviderTurnItems,
  codexAppServerProviderTurnClientIds,
  codexAppServerProviderTurnForOperation,
  inspectCodexAppServerRenewalThread,
  codexAppServerProviderTurnText,
  codexAppServerProviderTurnError,
  codexAppServerAgentMessageText,
  codexAppServerAssistantItemText,
  codexAppServerContentText,
  codexAppServerContextRefreshReason,
  codexAppServerErrorText,
  codexAppServerNotificationError,
  codexAppServerNotificationEvent,
  codexAppServerNotificationEventPayload,
  codexAppServerNotificationEventType,
  codexAppServerNotificationItem,
  codexAppServerNotificationItemId,
  codexAppServerNotificationParams,
  codexAppServerNotificationThreadId,
  codexAppServerNotificationTurnId,
  codexAppServerNotificationTurnStatus,
  codexAppServerNotificationUsageLimitExceeded,
  codexAppServerProviderThreadAssistantSegments,
  codexAppServerOutputOwnerTurnId,
  codexAppServerStatusFromValue,
  codexAppServerUserMessageText
};
