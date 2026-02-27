import { randomUUID } from "node:crypto";

function normalizePositiveIntegerOrNull(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    return null;
  }

  return normalized;
}

function normalizeStringOrNull(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeEntityId(value) {
  const normalized = String(value ?? "").trim();
  return normalized || "none";
}

function normalizePositiveIntegerArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const parsed = normalizePositiveIntegerOrNull(item);
    if (!parsed || seen.has(parsed)) {
      continue;
    }

    seen.add(parsed);
    normalized.push(parsed);
  }

  return normalized;
}

function normalizeScopeKind(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "workspace" ? "workspace" : "global";
}

function normalizeStringifiedPositiveIntegerOrNull(value) {
  const normalized = normalizePositiveIntegerOrNull(value);
  return normalized ? String(normalized) : null;
}

function normalizePayload(payload) {
  return payload && typeof payload === "object" ? { ...payload } : {};
}

function createRealtimeEventEnvelope({
  eventType,
  topic,
  workspace,
  workspaceId = workspace?.id,
  workspaceSlug = workspace?.slug,
  entityType,
  entityId,
  commandId,
  sourceClientId,
  actorUserId,
  payload
} = {}) {
  return {
    eventId: `evt_${randomUUID()}`,
    occurredAt: new Date().toISOString(),
    eventType: String(eventType || "").trim(),
    topic: String(topic || "").trim(),
    workspaceId: normalizePositiveIntegerOrNull(workspaceId),
    workspaceSlug: normalizeStringOrNull(workspaceSlug),
    entityType: String(entityType || "").trim(),
    entityId: normalizeEntityId(entityId),
    commandId: normalizeStringOrNull(commandId),
    sourceClientId: normalizeStringOrNull(sourceClientId),
    actorUserId: normalizePositiveIntegerOrNull(actorUserId),
    payload: normalizePayload(payload)
  };
}

function createTargetedChatEventEnvelope({
  eventType,
  topic,
  threadId,
  scopeKind,
  workspaceId,
  workspaceSlug,
  actorUserId,
  targetUserIds,
  commandId,
  sourceClientId,
  payload,
  eventVersion = 1
} = {}) {
  return {
    eventId: `evt_${randomUUID()}`,
    eventType: String(eventType || "").trim(),
    eventVersion: Number.isInteger(Number(eventVersion)) ? Number(eventVersion) : 1,
    occurredAt: new Date().toISOString(),
    topic: String(topic || "").trim(),
    threadId: normalizeStringifiedPositiveIntegerOrNull(threadId),
    scopeKind: normalizeScopeKind(scopeKind),
    workspaceId: normalizeStringifiedPositiveIntegerOrNull(workspaceId),
    workspaceSlug: normalizeStringOrNull(workspaceSlug),
    actorUserId: normalizeStringifiedPositiveIntegerOrNull(actorUserId),
    targetUserIds: normalizePositiveIntegerArray(targetUserIds),
    commandId: normalizeStringOrNull(commandId),
    sourceClientId: normalizeStringOrNull(sourceClientId),
    payload: normalizePayload(payload)
  };
}

function createRealtimeEventsBus() {
  const listeners = new Set();

  function subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function unsubscribe(listener) {
    listeners.delete(listener);
  }

  function publish(eventEnvelope) {
    for (const listener of listeners) {
      try {
        listener(eventEnvelope);
      } catch {
        // A broken listener must not interrupt fanout for others.
      }
    }
  }

  function resetForTests() {
    listeners.clear();
  }

  return {
    subscribe,
    unsubscribe,
    publish,
    resetForTests
  };
}

export {
  createRealtimeEventEnvelope,
  createRealtimeEventsBus,
  createTargetedChatEventEnvelope,
  normalizeEntityId,
  normalizePositiveIntegerArray,
  normalizePositiveIntegerOrNull,
  normalizeScopeKind,
  normalizeStringifiedPositiveIntegerOrNull,
  normalizeStringOrNull
};
