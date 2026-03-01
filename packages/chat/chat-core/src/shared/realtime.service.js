import { normalizePositiveIntegerOrNull, normalizeScopeKind } from "@jskit-ai/server-runtime-core/realtimeNormalization";

const DEFAULT_REALTIME_EVENT_TYPES = Object.freeze({
  CHAT_MESSAGE_CREATED: "chat.message.created",
  CHAT_THREAD_READ_UPDATED: "chat.thread.read.updated",
  CHAT_MESSAGE_REACTION_UPDATED: "chat.message.reaction.updated",
  CHAT_ATTACHMENT_UPDATED: "chat.attachment.updated",
  CHAT_TYPING_STARTED: "chat.typing.started",
  CHAT_TYPING_STOPPED: "chat.typing.stopped"
});

function normalizeTargetUserIds(value, { excludeUserId = null } = {}) {
  if (!Array.isArray(value)) {
    return [];
  }

  const excluded = normalizePositiveIntegerOrNull(excludeUserId);
  const seen = new Set();
  const normalized = [];
  for (const item of value) {
    const userId = normalizePositiveIntegerOrNull(item);
    if (!userId || userId === excluded || seen.has(userId)) {
      continue;
    }

    seen.add(userId);
    normalized.push(userId);
  }

  return normalized;
}

function normalizeThreadRef(thread) {
  if (!thread || typeof thread !== "object") {
    return null;
  }

  const id = normalizePositiveIntegerOrNull(thread.id);
  if (!id) {
    return null;
  }

  return {
    id,
    scopeKind: normalizeScopeKind(thread.scopeKind),
    workspaceId: normalizePositiveIntegerOrNull(thread.workspaceId),
    workspaceSlug: String(thread.workspaceSlug || thread.workspace?.slug || "").trim() || null
  };
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }

  return payload;
}

function normalizeIdempotencyStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "replayed") {
    return "replayed";
  }

  return "created";
}

function createService({ realtimeEventsService = null, realtimeEventTypes = null } = {}) {
  const publishChatEvent =
    realtimeEventsService && typeof realtimeEventsService.publishChatEvent === "function"
      ? realtimeEventsService.publishChatEvent.bind(realtimeEventsService)
      : null;
  const resolvedRealtimeEventTypes =
    realtimeEventTypes && typeof realtimeEventTypes === "object"
      ? {
          ...DEFAULT_REALTIME_EVENT_TYPES,
          ...realtimeEventTypes
        }
      : DEFAULT_REALTIME_EVENT_TYPES;

  function publishThreadEvent({
    thread,
    eventType,
    actorUserId,
    targetUserIds,
    payload,
    commandId,
    sourceClientId,
    workspaceSlug
  } = {}) {
    if (!publishChatEvent) {
      return null;
    }

    const normalizedThread = normalizeThreadRef(thread);
    if (!normalizedThread) {
      return null;
    }

    const normalizedActorUserId = normalizePositiveIntegerOrNull(actorUserId);
    const normalizedTargetUserIds = normalizeTargetUserIds(targetUserIds);
    if (normalizedTargetUserIds.length < 1) {
      return null;
    }

    const normalizedWorkspaceSlug =
      String(workspaceSlug || normalizedThread.workspaceSlug || "")
        .trim()
        .toLowerCase() || null;

    return publishChatEvent({
      eventType,
      threadId: normalizedThread.id,
      scopeKind: normalizedThread.scopeKind,
      workspaceId: normalizedThread.workspaceId,
      workspaceSlug: normalizedWorkspaceSlug,
      actorUserId: normalizedActorUserId,
      targetUserIds: normalizedTargetUserIds,
      payload: normalizePayload(payload),
      commandId,
      sourceClientId
    });
  }

  function publishMessageEvent({
    thread,
    message,
    idempotencyStatus,
    actorUserId,
    targetUserIds,
    commandId,
    sourceClientId,
    workspaceSlug
  } = {}) {
    return publishThreadEvent({
      thread,
      eventType: resolvedRealtimeEventTypes.CHAT_MESSAGE_CREATED,
      actorUserId,
      targetUserIds,
      payload: {
        message,
        idempotencyStatus: normalizeIdempotencyStatus(idempotencyStatus)
      },
      commandId,
      sourceClientId,
      workspaceSlug
    });
  }

  function publishReadCursorUpdated({
    thread,
    userId,
    lastReadSeq,
    lastReadMessageId,
    actorUserId,
    targetUserIds,
    commandId,
    sourceClientId,
    workspaceSlug
  } = {}) {
    const normalizedUserId = normalizePositiveIntegerOrNull(userId);
    const normalizedLastReadSeq = Math.max(0, Number(lastReadSeq || 0));
    const normalizedLastReadMessageId = normalizePositiveIntegerOrNull(lastReadMessageId);

    return publishThreadEvent({
      thread,
      eventType: resolvedRealtimeEventTypes.CHAT_THREAD_READ_UPDATED,
      actorUserId: actorUserId == null ? normalizedUserId : actorUserId,
      targetUserIds,
      payload: {
        threadId: normalizePositiveIntegerOrNull(thread?.id),
        userId: normalizedUserId,
        lastReadSeq: normalizedLastReadSeq,
        lastReadMessageId: normalizedLastReadMessageId
      },
      commandId,
      sourceClientId,
      workspaceSlug
    });
  }

  function publishReactionUpdated({
    thread,
    messageId,
    reactions,
    actorUserId,
    targetUserIds,
    commandId,
    sourceClientId,
    workspaceSlug
  } = {}) {
    return publishThreadEvent({
      thread,
      eventType: resolvedRealtimeEventTypes.CHAT_MESSAGE_REACTION_UPDATED,
      actorUserId,
      targetUserIds,
      payload: {
        threadId: normalizePositiveIntegerOrNull(thread?.id),
        messageId: normalizePositiveIntegerOrNull(messageId),
        reactions: Array.isArray(reactions) ? reactions : []
      },
      commandId,
      sourceClientId,
      workspaceSlug
    });
  }

  function publishAttachmentUpdated({
    thread,
    attachment,
    actorUserId,
    targetUserIds,
    commandId,
    sourceClientId,
    workspaceSlug
  } = {}) {
    return publishThreadEvent({
      thread,
      eventType: resolvedRealtimeEventTypes.CHAT_ATTACHMENT_UPDATED,
      actorUserId,
      targetUserIds,
      payload: {
        threadId: normalizePositiveIntegerOrNull(thread?.id),
        attachment: attachment && typeof attachment === "object" ? { ...attachment } : null
      },
      commandId,
      sourceClientId,
      workspaceSlug
    });
  }

  function emitTyping({
    thread,
    actorUserId,
    targetUserIds,
    state,
    expiresAt,
    commandId,
    sourceClientId,
    workspaceSlug
  } = {}) {
    const normalizedActorUserId = normalizePositiveIntegerOrNull(actorUserId);
    const normalizedState = String(state || "")
      .trim()
      .toLowerCase();
    const eventType =
      normalizedState === "stopped"
        ? resolvedRealtimeEventTypes.CHAT_TYPING_STOPPED
        : resolvedRealtimeEventTypes.CHAT_TYPING_STARTED;

    return publishThreadEvent({
      thread,
      eventType,
      actorUserId: normalizedActorUserId,
      targetUserIds: normalizeTargetUserIds(targetUserIds, {
        excludeUserId: normalizedActorUserId
      }),
      payload: {
        threadId: normalizePositiveIntegerOrNull(thread?.id),
        userId: normalizedActorUserId,
        expiresAt: String(expiresAt || "") || null
      },
      commandId,
      sourceClientId,
      workspaceSlug
    });
  }

  return {
    publishThreadEvent,
    publishMessageEvent,
    publishReadCursorUpdated,
    publishReactionUpdated,
    publishAttachmentUpdated,
    emitTyping
  };
}

const __testables = {
  normalizePositiveIntegerOrNull,
  normalizeScopeKind,
  normalizeTargetUserIds,
  normalizeThreadRef,
  normalizeIdempotencyStatus
};

export { createService, __testables };
