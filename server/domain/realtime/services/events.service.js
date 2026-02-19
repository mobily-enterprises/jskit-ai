import { randomUUID } from "node:crypto";
import { REALTIME_TOPICS, REALTIME_EVENT_TYPES } from "../../../../shared/realtime/eventTypes.js";

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

function createEventEnvelope({
  eventType,
  topic,
  workspace,
  entityType,
  entityId,
  commandId,
  sourceClientId,
  actorUserId,
  payload
}) {
  return {
    eventId: `evt_${randomUUID()}`,
    occurredAt: new Date().toISOString(),
    eventType: String(eventType || "").trim(),
    topic: String(topic || "").trim(),
    workspaceId: normalizePositiveIntegerOrNull(workspace?.id),
    workspaceSlug: normalizeStringOrNull(workspace?.slug),
    entityType: String(entityType || "").trim(),
    entityId: normalizeEntityId(entityId),
    commandId: normalizeStringOrNull(commandId),
    sourceClientId: normalizeStringOrNull(sourceClientId),
    actorUserId: normalizePositiveIntegerOrNull(actorUserId),
    payload: payload && typeof payload === "object" ? { ...payload } : {}
  };
}

function createService() {
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

  function publishProjectEvent({ operation, workspace, project, commandId, sourceClientId, actorUserId }) {
    const normalizedOperation = String(operation || "").trim().toLowerCase();
    const eventType =
      normalizedOperation === "created"
        ? REALTIME_EVENT_TYPES.WORKSPACE_PROJECT_CREATED
        : REALTIME_EVENT_TYPES.WORKSPACE_PROJECT_UPDATED;

    const envelope = createEventEnvelope({
      eventType,
      topic: REALTIME_TOPICS.PROJECTS,
      workspace,
      entityType: "project",
      entityId: project?.id,
      commandId,
      sourceClientId,
      actorUserId,
      payload: {
        operation: normalizedOperation || "updated",
        projectId: Number(project?.id)
      }
    });

    publish(envelope);
    return envelope;
  }

  function publishWorkspaceEvent({
    eventType,
    topic,
    workspace,
    entityType = "workspace",
    entityId = workspace?.id,
    commandId,
    sourceClientId,
    actorUserId,
    payload
  }) {
    const envelope = createEventEnvelope({
      eventType,
      topic,
      workspace,
      entityType,
      entityId,
      commandId,
      sourceClientId,
      actorUserId,
      payload
    });

    publish(envelope);
    return envelope;
  }

  function resetForTests() {
    listeners.clear();
  }

  return {
    createEventEnvelope,
    publish,
    subscribe,
    unsubscribe,
    publishProjectEvent,
    publishWorkspaceEvent,
    resetForTests
  };
}

const __testables = {
  normalizePositiveIntegerOrNull,
  normalizeStringOrNull,
  normalizeEntityId
};

export { createService, __testables };
