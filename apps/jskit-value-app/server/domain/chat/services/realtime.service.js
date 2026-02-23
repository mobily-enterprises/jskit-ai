import { REALTIME_EVENT_TYPES } from "../../../../shared/realtime/eventTypes.js";

function normalizePositiveIntegerOrNull(value) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) {
    return null;
  }

  return normalized;
}

function normalizeScopeKind(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized === "workspace" ? "workspace" : "global";
}

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
    workspaceId: normalizePositiveIntegerOrNull(thread.workspaceId)
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

function createService({ realtimeEventsService = null } = {}) {
  const publishChatEvent =
    realtimeEventsService && typeof realtimeEventsService.publishChatEvent === "function"
      ? realtimeEventsService.publishChatEvent.bind(realtimeEventsService)
      : null;

  function publishThreadEvent({
    thread,
    eventType,
    actorUserId,
    targetUserIds,
    payload,
    commandId,
    sourceClientId
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

    return publishChatEvent({
      eventType,
      threadId: normalizedThread.id,
      scopeKind: normalizedThread.scopeKind,
      workspaceId: normalizedThread.workspaceId,
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
    sourceClientId
  } = {}) {
    return publishThreadEvent({
      thread,
      eventType: REALTIME_EVENT_TYPES.CHAT_MESSAGE_CREATED,
      actorUserId,
      targetUserIds,
      payload: {
        message,
        idempotencyStatus: normalizeIdempotencyStatus(idempotencyStatus)
      },
      commandId,
      sourceClientId
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
    sourceClientId
  } = {}) {
    const normalizedUserId = normalizePositiveIntegerOrNull(userId);
    const normalizedLastReadSeq = Math.max(0, Number(lastReadSeq || 0));
    const normalizedLastReadMessageId = normalizePositiveIntegerOrNull(lastReadMessageId);

    return publishThreadEvent({
      thread,
      eventType: REALTIME_EVENT_TYPES.CHAT_THREAD_READ_UPDATED,
      actorUserId: actorUserId == null ? normalizedUserId : actorUserId,
      targetUserIds,
      payload: {
        threadId: normalizePositiveIntegerOrNull(thread?.id),
        userId: normalizedUserId,
        lastReadSeq: normalizedLastReadSeq,
        lastReadMessageId: normalizedLastReadMessageId
      },
      commandId,
      sourceClientId
    });
  }

  function publishReactionUpdated({
    thread,
    messageId,
    reactions,
    actorUserId,
    targetUserIds,
    commandId,
    sourceClientId
  } = {}) {
    return publishThreadEvent({
      thread,
      eventType: REALTIME_EVENT_TYPES.CHAT_MESSAGE_REACTION_UPDATED,
      actorUserId,
      targetUserIds,
      payload: {
        threadId: normalizePositiveIntegerOrNull(thread?.id),
        messageId: normalizePositiveIntegerOrNull(messageId),
        reactions: Array.isArray(reactions) ? reactions : []
      },
      commandId,
      sourceClientId
    });
  }

  function publishAttachmentUpdated({
    thread,
    attachment,
    actorUserId,
    targetUserIds,
    commandId,
    sourceClientId
  } = {}) {
    return publishThreadEvent({
      thread,
      eventType: REALTIME_EVENT_TYPES.CHAT_ATTACHMENT_UPDATED,
      actorUserId,
      targetUserIds,
      payload: {
        threadId: normalizePositiveIntegerOrNull(thread?.id),
        attachment: attachment && typeof attachment === "object" ? { ...attachment } : null
      },
      commandId,
      sourceClientId
    });
  }

  function emitTyping({ thread, actorUserId, targetUserIds, state, expiresAt, commandId, sourceClientId } = {}) {
    const normalizedActorUserId = normalizePositiveIntegerOrNull(actorUserId);
    const normalizedState = String(state || "")
      .trim()
      .toLowerCase();
    const eventType =
      normalizedState === "stopped"
        ? REALTIME_EVENT_TYPES.CHAT_TYPING_STOPPED
        : REALTIME_EVENT_TYPES.CHAT_TYPING_STARTED;

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
      sourceClientId
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
