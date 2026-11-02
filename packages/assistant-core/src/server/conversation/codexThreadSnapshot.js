import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeNullableText } from "./normalize.js";
import {
  codexAppServerAssistantItemText,
  codexAppServerErrorText,
  codexAppServerSignedOutText,
  codexAppServerStatusFromValue
} from "./codexEvents.js";

// Like codexAppServerThreadRawValue, but provider results may also wrap the
// thread once more under `thread`, checked after raw and response.thread.
function codexAppServerProviderThread(value) {
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
  return codexAppServerSignedOutText(codexAppServerErrorText(turn.error || turn.status?.error || turn.state?.error));
}

export {
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
  codexAppServerProviderThreadAssistantSegments
};
