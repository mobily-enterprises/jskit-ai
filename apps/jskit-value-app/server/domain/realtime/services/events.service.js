import {
  createRealtimeEventEnvelope,
  createRealtimeEventsBus,
  createTargetedChatEventEnvelope,
  normalizeEntityId,
  normalizePositiveIntegerArray,
  normalizePositiveIntegerOrNull,
  normalizeScopeKind,
  normalizeStringifiedPositiveIntegerOrNull,
  normalizeStringOrNull
} from "@jskit-ai/server-runtime-core/realtimeEvents";
import { REALTIME_TOPICS, REALTIME_EVENT_TYPES } from "../../../../shared/realtime/eventTypes.js";

function resolveChatTopic(eventType, topic) {
  const normalizedTopic = String(topic || "").trim();
  if (normalizedTopic) {
    return normalizedTopic;
  }

  const normalizedEventType = String(eventType || "")
    .trim()
    .toLowerCase();
  if (normalizedEventType.startsWith("chat.typing.")) {
    return REALTIME_TOPICS.TYPING;
  }

  return REALTIME_TOPICS.CHAT;
}

function createService() {
  const realtimeEventsBus = createRealtimeEventsBus();

  function createEventEnvelope(payload) {
    return createRealtimeEventEnvelope(payload);
  }

  function publishProjectEvent({ operation, workspace, project, commandId, sourceClientId, actorUserId }) {
    const normalizedOperation = String(operation || "")
      .trim()
      .toLowerCase();
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

    realtimeEventsBus.publish(envelope);
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

    realtimeEventsBus.publish(envelope);
    return envelope;
  }

  function publishChatEvent({
    eventType,
    thread,
    threadId = thread?.id,
    scopeKind = thread?.scopeKind,
    workspaceId = thread?.workspaceId,
    actorUserId,
    targetUserIds,
    commandId,
    sourceClientId,
    payload,
    topic
  }) {
    const envelope = createTargetedChatEventEnvelope({
      eventType,
      topic: resolveChatTopic(eventType, topic),
      threadId,
      scopeKind,
      workspaceId,
      actorUserId,
      targetUserIds,
      commandId,
      sourceClientId,
      payload,
      eventVersion: 1
    });

    realtimeEventsBus.publish(envelope);
    return envelope;
  }

  return {
    createEventEnvelope,
    publish: realtimeEventsBus.publish,
    subscribe: realtimeEventsBus.subscribe,
    unsubscribe: realtimeEventsBus.unsubscribe,
    publishProjectEvent,
    publishWorkspaceEvent,
    publishChatEvent,
    resetForTests: realtimeEventsBus.resetForTests
  };
}

const __testables = {
  normalizePositiveIntegerOrNull,
  normalizePositiveIntegerArray,
  normalizeStringOrNull,
  normalizeEntityId,
  normalizeScopeKind,
  normalizeStringifiedPositiveIntegerOrNull,
  resolveChatTopic
};

export { createService, __testables };
