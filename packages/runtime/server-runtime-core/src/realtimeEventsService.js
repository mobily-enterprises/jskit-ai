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

const DEFAULT_REALTIME_TOPICS = Object.freeze({
  PROJECTS: "projects",
  CHAT: "chat",
  TYPING: "typing"
});

const DEFAULT_REALTIME_EVENT_TYPES = Object.freeze({
  WORKSPACE_PROJECT_CREATED: "workspace.project.created",
  WORKSPACE_PROJECT_UPDATED: "workspace.project.updated"
});

function resolveChatTopic(eventType, topic, realtimeTopics = DEFAULT_REALTIME_TOPICS) {
  const normalizedTopic = String(topic || "").trim();
  if (normalizedTopic) {
    return normalizedTopic;
  }

  const normalizedEventType = String(eventType || "")
    .trim()
    .toLowerCase();
  if (normalizedEventType.startsWith("chat.typing.")) {
    return realtimeTopics.TYPING;
  }

  return realtimeTopics.CHAT;
}

function createService({ realtimeTopics = {}, realtimeEventTypes = {} } = {}) {
  const resolvedRealtimeTopics = {
    ...DEFAULT_REALTIME_TOPICS,
    ...(realtimeTopics || {})
  };
  const resolvedRealtimeEventTypes = {
    ...DEFAULT_REALTIME_EVENT_TYPES,
    ...(realtimeEventTypes || {})
  };
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
        ? resolvedRealtimeEventTypes.WORKSPACE_PROJECT_CREATED
        : resolvedRealtimeEventTypes.WORKSPACE_PROJECT_UPDATED;

    const envelope = createEventEnvelope({
      eventType,
      topic: resolvedRealtimeTopics.PROJECTS,
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
      topic: resolveChatTopic(eventType, topic, resolvedRealtimeTopics),
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
