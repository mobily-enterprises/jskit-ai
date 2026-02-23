import { createHash } from "node:crypto";
import { hasPermission, manifestIncludesPermission, resolveRolePermissions } from "@jskit-ai/rbac-core";
import { toCanonicalJson, toSha256Hex } from "./canonicalJson.js";

const IDEMPOTENCY_VERSION = 1;
const CHAT_MESSAGE_CLIENT_KEY_UNIQUE_INDEX = "uq_chat_messages_thread_sender_client_id";
const WORKSPACE_SURFACE_IDS = new Set(["app", "admin"]);
const INBOX_SURFACE_IDS = new Set(["app", "admin", "console"]);
const WORKSPACE_ROOM_THREAD_KIND = "workspace_room";
const CHAT_TYPING_RATE_WINDOW_MS = 60_000;
const CHAT_TYPING_RATE_LIMIT = 30;
const CHAT_TYPING_THROTTLE_MS = 1_000;
const CHAT_TYPING_TTL_MS = 2_000;
const CHAT_ATTACHMENT_MAX_UPLOAD_BYTES = 20_000_000;
const CHAT_UNATTACHED_UPLOAD_RETENTION_HOURS = 24;
const DEFAULT_REALTIME_EVENT_TYPES = Object.freeze({
  CHAT_ATTACHMENT_UPDATED: "chat.attachment.updated"
});

class DefaultAppError extends Error {
  constructor(status, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.status = Number(status) || 500;
    this.statusCode = this.status;
    this.code = options.code || "APP_ERROR";
    this.details = options.details;
    this.headers = options.headers || {};
  }
}

let AppError = DefaultAppError;

function parsePositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return null;
  }

  return numeric;
}

function isMysqlDuplicateEntryError(error) {
  if (!error) {
    return false;
  }

  return String(error.code || "") === "ER_DUP_ENTRY";
}

function createChatError(status, message, code, { fieldErrors = null, details = {} } = {}) {
  const payloadDetails = {
    code,
    ...(details && typeof details === "object" ? details : {})
  };

  if (fieldErrors && typeof fieldErrors === "object") {
    payloadDetails.fieldErrors = fieldErrors;
  }

  return new AppError(status, message, {
    code,
    details: payloadDetails
  });
}

function createChatValidationError(fieldErrors = {}) {
  return createChatError(400, "Validation failed.", "CHAT_VALIDATION_FAILED", {
    fieldErrors
  });
}

function createFeatureDisabledError() {
  return createChatError(403, "Chat feature is disabled.", "CHAT_FEATURE_DISABLED");
}

function createWorkspaceThreadsDisabledError() {
  return createChatError(403, "Workspace chat is disabled.", "CHAT_WORKSPACE_THREADS_DISABLED");
}

function createWorkspaceContextUnavailableError() {
  return createChatError(404, "Workspace context unavailable.", "CHAT_WORKSPACE_CONTEXT_UNAVAILABLE");
}

function createDmSelfNotAllowedError() {
  return createChatError(400, "Cannot create direct message with yourself.", "CHAT_DM_SELF_NOT_ALLOWED");
}

function createDmTargetUnavailableError() {
  return createChatError(404, "DM target unavailable.", "CHAT_DM_TARGET_UNAVAILABLE");
}

function createSurfaceInvalidError() {
  return createChatError(400, "Surface selection is invalid.", "CHAT_SURFACE_INVALID");
}

function createThreadNotFoundError() {
  return createChatError(404, "Thread not found.", "CHAT_THREAD_NOT_FOUND");
}

function createMessageNotFoundError() {
  return createChatError(404, "Message not found.", "CHAT_MESSAGE_NOT_FOUND");
}

function createReadCursorRequiredError() {
  return createChatError(400, "Read cursor is required.", "CHAT_READ_CURSOR_REQUIRED");
}

function createReadCursorInvalidError(fieldErrors = null) {
  return createChatError(400, "Read cursor is invalid.", "CHAT_READ_CURSOR_INVALID", {
    fieldErrors
  });
}

function createIdempotencyConflictError() {
  return createChatError(409, "Idempotency key conflicts with existing message payload.", "CHAT_IDEMPOTENCY_CONFLICT");
}

function createMessageRetryBlockedError() {
  return createChatError(
    409,
    "Message retry blocked because original message was deleted.",
    "CHAT_MESSAGE_RETRY_BLOCKED"
  );
}

function createRateLimitedError({ retryAfterMs = 1000 } = {}) {
  const normalizedRetryAfterMs = Math.max(1000, Number(retryAfterMs) || 1000);

  return createChatError(429, "Chat rate limit exceeded.", "CHAT_RATE_LIMITED", {
    details: {
      retryAfterMs: normalizedRetryAfterMs
    }
  });
}

function createAttachmentNotFoundError() {
  return createChatError(404, "Attachment not found.", "CHAT_ATTACHMENT_NOT_FOUND");
}

function createAttachmentConflictError(message = "Attachment operation conflicts with existing state.") {
  return createChatError(409, message, "CHAT_ATTACHMENT_CONFLICT");
}

function createAttachmentUploadInProgressError() {
  return createChatError(409, "Attachment upload is already in progress.", "CHAT_ATTACHMENT_UPLOAD_IN_PROGRESS");
}

function normalizeSurfaceIdForInbox(surfaceIdLike) {
  const normalized = String(surfaceIdLike || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "app";
  }
  if (!INBOX_SURFACE_IDS.has(normalized)) {
    throw createSurfaceInvalidError();
  }
  return normalized;
}

function normalizeSurfaceIdForThreadAccess(surfaceIdLike) {
  const normalized = String(surfaceIdLike || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return "app";
  }
  if (!INBOX_SURFACE_IDS.has(normalized)) {
    return "invalid";
  }
  return normalized;
}

function parseCursorPage(cursor) {
  const page = parsePositiveInteger(cursor);
  if (!page) {
    return 1;
  }

  return page;
}

function toBoundedLimit(value, { fallback = 20, max = 50 } = {}) {
  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    return fallback;
  }

  return Math.max(1, Math.min(max, parsed));
}

function toBoundedMilliseconds(value, { fallback = 1000, min = 1, max = 60_000 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function normalizeRequestMeta(metaValue) {
  const source = metaValue && typeof metaValue === "object" ? metaValue : {};
  const commandId = String(source.commandId || "").trim();
  const sourceClientId = String(source.sourceClientId || "").trim();
  const logger = source.logger && typeof source.logger.warn === "function" ? source.logger : null;

  return {
    commandId: commandId || null,
    sourceClientId: sourceClientId || null,
    logger
  };
}

function normalizeUserIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];
  for (const entry of value) {
    const userId = parsePositiveInteger(entry);
    if (!userId || seen.has(userId)) {
      continue;
    }
    seen.add(userId);
    normalized.push(userId);
  }

  return normalized;
}

function normalizeThreadId(threadIdLike) {
  const threadId = parsePositiveInteger(threadIdLike);
  if (!threadId) {
    throw createThreadNotFoundError();
  }

  return threadId;
}

function normalizeUserId(userLike) {
  const userId = parsePositiveInteger(userLike?.id);
  if (!userId) {
    throw new AppError(401, "Authentication required.");
  }

  return userId;
}

function normalizeDmTargetPublicChatId(value) {
  const targetPublicChatId = String(value || "").trim();
  if (!targetPublicChatId) {
    throw createChatValidationError({
      targetPublicChatId: "targetPublicChatId is required."
    });
  }

  if (targetPublicChatId.length > 64) {
    throw createChatValidationError({
      targetPublicChatId: "targetPublicChatId must be at most 64 characters."
    });
  }

  return targetPublicChatId.toLowerCase();
}

function normalizeDmCandidatesSearch(value) {
  const search = String(value || "").trim();
  if (!search) {
    return "";
  }

  if (search.length > 120) {
    throw createChatValidationError({
      q: "q must be at most 120 characters."
    });
  }

  return search.toLowerCase();
}

function normalizeDmCandidatesLimit(value) {
  return toBoundedLimit(value, {
    fallback: 50,
    max: 100
  });
}

function normalizeClientMessageId(value) {
  const clientMessageId = String(value || "").trim();
  if (!clientMessageId) {
    throw createChatValidationError({
      clientMessageId: "clientMessageId is required."
    });
  }

  if (clientMessageId.length > 128) {
    throw createChatValidationError({
      clientMessageId: "clientMessageId must be at most 128 characters."
    });
  }

  return clientMessageId;
}

function normalizeOptionalMessageText(value, maxTextChars) {
  if (value == null) {
    return null;
  }

  const text = String(value);
  if (text.length > maxTextChars) {
    throw createChatValidationError({
      text: `text must be at most ${maxTextChars} characters.`
    });
  }

  return text;
}

function normalizeAttachmentIds(value, maxCount) {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw createChatValidationError({
      attachmentIds: "attachmentIds must be an array."
    });
  }

  if (value.length > maxCount) {
    throw createChatValidationError({
      attachmentIds: `attachmentIds must have at most ${maxCount} entries.`
    });
  }

  const unique = [];
  const seen = new Set();

  for (const item of value) {
    const attachmentId = parsePositiveInteger(item);
    if (!attachmentId) {
      throw createChatValidationError({
        attachmentIds: "attachmentIds must contain positive integers."
      });
    }

    if (seen.has(attachmentId)) {
      continue;
    }

    seen.add(attachmentId);
    unique.push(attachmentId);
  }

  return unique;
}

function normalizeOptionalReplyToMessageId(value) {
  if (value == null) {
    return null;
  }

  const replyToMessageId = parsePositiveInteger(value);
  if (!replyToMessageId) {
    throw createChatValidationError({
      replyToMessageId: "replyToMessageId must be a positive integer."
    });
  }

  return replyToMessageId;
}

function normalizeOptionalMetadata(value) {
  if (value == null) {
    return {};
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw createChatValidationError({
      metadata: "metadata must be an object."
    });
  }

  return value;
}

function normalizeClientAttachmentId(value) {
  const clientAttachmentId = String(value || "").trim();
  if (!clientAttachmentId) {
    throw createChatValidationError({
      clientAttachmentId: "clientAttachmentId is required."
    });
  }

  if (clientAttachmentId.length > 128) {
    throw createChatValidationError({
      clientAttachmentId: "clientAttachmentId must be at most 128 characters."
    });
  }

  return clientAttachmentId;
}

function normalizeAttachmentKind(value) {
  const attachmentKind = String(value || "")
    .trim()
    .toLowerCase();
  if (!attachmentKind) {
    return "file";
  }

  if (attachmentKind.length > 32) {
    throw createChatValidationError({
      kind: "kind must be at most 32 characters."
    });
  }

  return attachmentKind;
}

function normalizeAttachmentMimeType(value) {
  const mimeType = String(value || "").trim();
  if (!mimeType) {
    throw createChatValidationError({
      mimeType: "mimeType is required."
    });
  }

  if (mimeType.length > 160) {
    throw createChatValidationError({
      mimeType: "mimeType must be at most 160 characters."
    });
  }

  return mimeType;
}

function normalizeAttachmentFileName(value) {
  const fileName = String(value || "").trim();
  if (!fileName) {
    throw createChatValidationError({
      fileName: "fileName is required."
    });
  }

  if (fileName.length > 255) {
    throw createChatValidationError({
      fileName: "fileName must be at most 255 characters."
    });
  }

  return fileName;
}

function normalizeAttachmentSizeBytes(value, maxUploadBytes) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
    throw createChatValidationError({
      sizeBytes: "sizeBytes must be a positive integer."
    });
  }

  if (parsed > maxUploadBytes) {
    throw createChatValidationError({
      sizeBytes: `sizeBytes must be at most ${maxUploadBytes}.`
    });
  }

  return parsed;
}

function normalizeReserveAttachmentPayload(body, options) {
  const source = body && typeof body === "object" ? body : {};
  return {
    clientAttachmentId: normalizeClientAttachmentId(source.clientAttachmentId),
    fileName: normalizeAttachmentFileName(source.fileName),
    mimeType: normalizeAttachmentMimeType(source.mimeType),
    sizeBytes: normalizeAttachmentSizeBytes(source.sizeBytes, options.chatAttachmentMaxUploadBytes),
    kind: normalizeAttachmentKind(source.kind),
    metadata: normalizeOptionalMetadata(source.metadata)
  };
}

function normalizeUploadAttachmentId(value) {
  const attachmentId = parsePositiveInteger(value);
  if (!attachmentId) {
    throw createChatValidationError({
      attachmentId: "attachmentId must be a positive integer."
    });
  }

  return attachmentId;
}

function normalizeUploadBuffer(value, maxUploadBytes) {
  if (!Buffer.isBuffer(value)) {
    throw createChatValidationError({
      file: "Uploaded file is required."
    });
  }

  const sizeBytes = Number(value.length || 0);
  if (sizeBytes < 1) {
    throw createChatValidationError({
      file: "Uploaded file must not be empty."
    });
  }

  if (sizeBytes > maxUploadBytes) {
    throw createChatValidationError({
      file: `Uploaded file exceeds maximum size ${maxUploadBytes}.`
    });
  }

  return {
    buffer: value,
    sizeBytes
  };
}

function normalizeSendPayload(body, options) {
  const source = body && typeof body === "object" ? body : {};
  const clientMessageId = normalizeClientMessageId(source.clientMessageId);
  const text = normalizeOptionalMessageText(source.text, options.chatMessageMaxTextChars);
  const attachmentIds = normalizeAttachmentIds(source.attachmentIds, options.chatAttachmentsMaxFilesPerMessage);
  const replyToMessageId = normalizeOptionalReplyToMessageId(source.replyToMessageId);
  const metadata = normalizeOptionalMetadata(source.metadata);

  const hasText = String(text || "").trim().length > 0;
  const hasAttachments = attachmentIds.length > 0;
  if (!hasText && !hasAttachments) {
    throw createChatValidationError({
      text: "Provide text or attachmentIds."
    });
  }

  return {
    clientMessageId,
    text,
    attachmentIds,
    replyToMessageId,
    metadata
  };
}

function normalizeReadPayload(body) {
  const source = body && typeof body === "object" ? body : {};
  const messageId = source.messageId == null ? null : parsePositiveInteger(source.messageId);
  const threadSeq = source.threadSeq == null ? null : parsePositiveInteger(source.threadSeq);

  if (!messageId && !threadSeq) {
    throw createReadCursorRequiredError();
  }

  if (source.messageId != null && !messageId) {
    throw createReadCursorInvalidError({
      messageId: "messageId must be a positive integer."
    });
  }

  if (source.threadSeq != null && !threadSeq) {
    throw createReadCursorInvalidError({
      threadSeq: "threadSeq must be a positive integer."
    });
  }

  return {
    messageId,
    threadSeq
  };
}

function normalizeReactionPayload(body) {
  const source = body && typeof body === "object" ? body : {};
  const messageId = parsePositiveInteger(source.messageId);
  if (!messageId) {
    throw createChatValidationError({
      messageId: "messageId must be a positive integer."
    });
  }

  const reaction = String(source.reaction || "").trim();
  if (!reaction) {
    throw createChatValidationError({
      reaction: "reaction is required."
    });
  }

  if (reaction.length > 32) {
    throw createChatValidationError({
      reaction: "reaction must be at most 32 characters."
    });
  }

  return {
    messageId,
    reaction
  };
}

function buildPreviewText(text) {
  const source = String(text || "").trim();
  if (!source) {
    return null;
  }

  if (source.length <= 280) {
    return source;
  }

  return source.slice(0, 277).trimEnd() + "...";
}

function buildMessageIdempotencyFingerprint({ text, attachmentIds, replyToMessageId, metadata }) {
  const canonicalPayload = {
    version: IDEMPOTENCY_VERSION,
    text: text == null ? null : String(text),
    replyToMessageId: replyToMessageId == null ? null : Number(replyToMessageId),
    attachmentIds: Array.isArray(attachmentIds) ? attachmentIds.map((id) => Number(id)) : [],
    metadata: metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}
  };

  const canonicalJson = toCanonicalJson(canonicalPayload);

  return {
    canonicalJson,
    version: IDEMPOTENCY_VERSION,
    sha256: toSha256Hex(canonicalJson)
  };
}

function computeBufferSha256Hex(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function buildAttachmentDeliveryPath(attachmentId) {
  return `/api/chat/attachments/${Number(attachmentId)}/content`;
}

function isAttachmentReserveReplayCompatible(existingAttachment, reservePayload) {
  const existingMetadata =
    existingAttachment?.metadata &&
    typeof existingAttachment.metadata === "object" &&
    !Array.isArray(existingAttachment.metadata)
      ? existingAttachment.metadata
      : {};
  const incomingMetadata =
    reservePayload?.metadata && typeof reservePayload.metadata === "object" && !Array.isArray(reservePayload.metadata)
      ? reservePayload.metadata
      : {};

  return (
    String(existingAttachment?.clientAttachmentId || "") === String(reservePayload.clientAttachmentId || "") &&
    String(existingAttachment?.fileName || "") === String(reservePayload.fileName || "") &&
    String(existingAttachment?.mimeType || "") === String(reservePayload.mimeType || "") &&
    Number(existingAttachment?.sizeBytes || 0) === Number(reservePayload.sizeBytes || 0) &&
    String(existingAttachment?.attachmentKind || "file") === String(reservePayload.kind || "file") &&
    toCanonicalJson(existingMetadata) === toCanonicalJson(incomingMetadata)
  );
}

function isAttachmentUploadReplayCompatible(existingAttachment, { sizeBytes, sha256Hex }) {
  const existingSha = String(existingAttachment?.sha256Hex || "")
    .trim()
    .toLowerCase();
  const expectedSha = String(sha256Hex || "")
    .trim()
    .toLowerCase();
  if (existingSha && expectedSha) {
    return existingSha === expectedSha;
  }

  return Number(existingAttachment?.sizeBytes || 0) === Number(sizeBytes || 0);
}

function isAttachmentStatusInSet(attachment, allowedStatuses) {
  const status = String(attachment?.status || "")
    .trim()
    .toLowerCase();
  return allowedStatuses.has(status);
}

function buildUploadExpiresAtIso(unattachedUploadRetentionHours) {
  const retentionHours = Math.max(
    1,
    Number.isFinite(Number(unattachedUploadRetentionHours))
      ? Math.floor(Number(unattachedUploadRetentionHours))
      : CHAT_UNATTACHED_UPLOAD_RETENTION_HOURS
  );
  return new Date(Date.now() + retentionHours * 60 * 60 * 1000).toISOString();
}

function normalizeAttachmentReadableStatus(statusLike) {
  return String(statusLike || "")
    .trim()
    .toLowerCase();
}

function isInlineAttachmentMimeType(mimeType) {
  const normalizedMimeType = String(mimeType || "")
    .trim()
    .toLowerCase();
  if (!normalizedMimeType) {
    return false;
  }

  return new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif", "image/bmp"]).has(
    normalizedMimeType
  );
}

function shouldForceAttachmentDownload(mimeType) {
  const normalizedMimeType = String(mimeType || "")
    .trim()
    .toLowerCase();
  if (!normalizedMimeType) {
    return true;
  }

  if (
    normalizedMimeType.includes("html") ||
    normalizedMimeType.includes("svg") ||
    normalizedMimeType.includes("xml") ||
    normalizedMimeType.includes("javascript")
  ) {
    return true;
  }

  return !isInlineAttachmentMimeType(normalizedMimeType);
}

function sanitizeFileNameForContentDisposition(fileName) {
  const normalized = String(fileName || "").trim();
  if (!normalized) {
    return "attachment";
  }

  return normalized
    .replace(/[\\"]/g, "_")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 255);
}

function buildAttachmentContentDisposition(fileName, mimeType) {
  const safeFileName = sanitizeFileNameForContentDisposition(fileName);
  const dispositionType = shouldForceAttachmentDownload(mimeType) ? "attachment" : "inline";
  return `${dispositionType}; filename="${safeFileName}"`;
}

function isClientMessageDuplicateConflict(error) {
  if (!isMysqlDuplicateEntryError(error)) {
    return false;
  }

  const message = String(error?.sqlMessage || error?.message || "").toLowerCase();
  return message.includes(CHAT_MESSAGE_CLIENT_KEY_UNIQUE_INDEX);
}

function shouldEnforceWorkspacePermission(rbacManifest, permission) {
  return manifestIncludesPermission(rbacManifest, permission, { includeOwner: true });
}

function resolveRolePermissionSet(rbacManifest, roleId) {
  return resolveRolePermissions(rbacManifest, roleId);
}

function mapReactionSummary(reactionRows, currentUserId) {
  const byReaction = new Map();

  for (const row of Array.isArray(reactionRows) ? reactionRows : []) {
    const key = String(row?.reaction || "");
    if (!key) {
      continue;
    }

    if (!byReaction.has(key)) {
      byReaction.set(key, {
        reaction: key,
        count: 0,
        reactedByMe: false
      });
    }

    const entry = byReaction.get(key);
    entry.count += 1;
    if (Number(row?.userId) === Number(currentUserId)) {
      entry.reactedByMe = true;
    }
  }

  return Array.from(byReaction.values()).sort((left, right) => left.reaction.localeCompare(right.reaction));
}

function mapAttachmentForResponse(attachment) {
  return {
    id: Number(attachment.id),
    threadId: Number(attachment.threadId),
    messageId: attachment.messageId == null ? null : Number(attachment.messageId),
    uploadedByUserId: Number(attachment.uploadedByUserId),
    clientAttachmentId: attachment.clientAttachmentId,
    position: attachment.position == null ? null : Number(attachment.position),
    kind: String(attachment.attachmentKind || "file"),
    status: String(attachment.status || ""),
    mimeType: attachment.mimeType,
    fileName: attachment.fileName,
    sizeBytes: attachment.sizeBytes == null ? null : Number(attachment.sizeBytes),
    width: attachment.width == null ? null : Number(attachment.width),
    height: attachment.height == null ? null : Number(attachment.height),
    durationMs: attachment.durationMs == null ? null : Number(attachment.durationMs),
    deliveryPath: attachment.deliveryPath,
    previewDeliveryPath: attachment.previewDeliveryPath,
    createdAt: attachment.createdAt,
    updatedAt: attachment.updatedAt
  };
}

function mapMessageForResponse(message, { attachments = [], reactions = [] } = {}) {
  return {
    id: Number(message.id),
    threadId: Number(message.threadId),
    threadSeq: Number(message.threadSeq),
    senderUserId: Number(message.senderUserId),
    clientMessageId: message.clientMessageId,
    kind: String(message.messageKind || "text"),
    text: message.textContent,
    replyToMessageId: message.replyToMessageId == null ? null : Number(message.replyToMessageId),
    attachments: attachments.map(mapAttachmentForResponse),
    reactions,
    sentAt: message.sentAt,
    editedAt: message.editedAt,
    deletedAt: message.deletedAt,
    metadata: message.metadata && typeof message.metadata === "object" ? message.metadata : {}
  };
}

function mapThreadPeerUserForResponse(peerUser) {
  const userId = parsePositiveInteger(peerUser?.id);
  if (!userId) {
    return null;
  }

  const displayName = String(peerUser?.displayName || "").trim() || `User #${userId}`;
  const avatarUrl = String(peerUser?.avatarUrl || "").trim();

  return {
    id: userId,
    displayName,
    avatarUrl: avatarUrl || null
  };
}

function mapThreadForResponse(thread, participant = null, context = {}) {
  const lastMessageSeq = thread.lastMessageSeq == null ? null : Number(thread.lastMessageSeq);
  const participantLastReadSeq = participant ? Number(participant.lastReadSeq || 0) : 0;
  const participantLastReadAt = participant?.lastReadAt == null ? null : String(participant.lastReadAt);
  const participantMutedUntil = participant?.muteUntil == null ? null : String(participant.muteUntil);
  const participantArchivedAt = participant?.archivedAt == null ? null : String(participant.archivedAt);
  const participantPinnedAt = participant?.pinnedAt == null ? null : String(participant.pinnedAt);
  const peerUser = mapThreadPeerUserForResponse(context?.peerUser);

  return {
    id: Number(thread.id),
    scopeKind: String(thread.scopeKind || ""),
    workspaceId: thread.workspaceId == null ? null : Number(thread.workspaceId),
    threadKind: String(thread.threadKind || ""),
    title: thread.title,
    participantCount: Number(thread.participantCount || 0),
    lastMessageId: thread.lastMessageId == null ? null : Number(thread.lastMessageId),
    lastMessageSeq,
    lastMessageAt: thread.lastMessageAt,
    lastMessagePreview: thread.lastMessagePreview,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    unreadCount: Math.max(0, Number(lastMessageSeq || 0) - participantLastReadSeq),
    participant: participant
      ? {
          status: String(participant.status || ""),
          lastReadSeq: Number(participant.lastReadSeq || 0),
          lastReadMessageId: participant.lastReadMessageId == null ? null : Number(participant.lastReadMessageId),
          lastReadAt: participantLastReadAt,
          mutedUntil: participantMutedUntil,
          archivedAt: participantArchivedAt,
          pinnedAt: participantPinnedAt
        }
      : null,
    peerUser
  };
}

function createService({
  chatThreadsRepository,
  chatParticipantsRepository,
  chatMessagesRepository,
  chatAttachmentsRepository,
  chatReactionsRepository,
  chatIdempotencyTombstonesRepository,
  chatUserSettingsRepository,
  chatBlocksRepository,
  chatRealtimeService,
  chatAttachmentStorageService,
  workspaceMembershipsRepository,
  userSettingsRepository,
  userProfilesRepository,
  userAvatarService,
  rbacManifest,
  appErrorClass = null,
  realtimeEventTypes = null,
  config = {}
}) {
  if (typeof appErrorClass === "function") {
    AppError = appErrorClass;
  } else {
    AppError = DefaultAppError;
  }
  const resolvedRealtimeEventTypes =
    realtimeEventTypes && typeof realtimeEventTypes === "object"
      ? {
          ...DEFAULT_REALTIME_EVENT_TYPES,
          ...realtimeEventTypes
        }
      : DEFAULT_REALTIME_EVENT_TYPES;

  if (
    !chatThreadsRepository ||
    !chatParticipantsRepository ||
    !chatMessagesRepository ||
    !chatAttachmentsRepository ||
    !chatReactionsRepository ||
    !chatIdempotencyTombstonesRepository ||
    !chatUserSettingsRepository ||
    !chatBlocksRepository ||
    !chatAttachmentStorageService ||
    !workspaceMembershipsRepository ||
    !userSettingsRepository
  ) {
    throw new Error("chat service dependencies are required.");
  }

  const options = {
    chatEnabled: config.chatEnabled === true,
    chatWorkspaceThreadsEnabled: config.chatWorkspaceThreadsEnabled === true,
    chatGlobalDmsEnabled: config.chatGlobalDmsEnabled === true,
    chatGlobalDmsRequireSharedWorkspace: config.chatGlobalDmsRequireSharedWorkspace !== false,
    chatMessageMaxTextChars: Math.max(1, Number(config.chatMessageMaxTextChars) || 4000),
    chatMessagesPageSizeMax: Math.max(1, Number(config.chatMessagesPageSizeMax) || 100),
    chatThreadsPageSizeMax: Math.max(1, Number(config.chatThreadsPageSizeMax) || 50),
    chatAttachmentsEnabled: config.chatAttachmentsEnabled !== false,
    chatAttachmentsMaxFilesPerMessage: Math.max(1, Number(config.chatAttachmentsMaxFilesPerMessage) || 5),
    chatAttachmentMaxUploadBytes: Math.max(
      1,
      Number(config.chatAttachmentMaxUploadBytes) || CHAT_ATTACHMENT_MAX_UPLOAD_BYTES
    ),
    chatUnattachedUploadRetentionHours: Math.max(
      1,
      Number(config.chatUnattachedUploadRetentionHours) || CHAT_UNATTACHED_UPLOAD_RETENTION_HOURS
    ),
    chatTypingRateLimit: Math.max(1, Number(config.chatTypingRateLimit) || CHAT_TYPING_RATE_LIMIT),
    chatTypingRateWindowMs: toBoundedMilliseconds(config.chatTypingRateWindowMs, {
      fallback: CHAT_TYPING_RATE_WINDOW_MS,
      min: 5_000,
      max: 5 * 60_000
    }),
    chatTypingThrottleMs: toBoundedMilliseconds(config.chatTypingThrottleMs, {
      fallback: CHAT_TYPING_THROTTLE_MS,
      min: 100,
      max: 30_000
    }),
    chatTypingTtlMs: toBoundedMilliseconds(config.chatTypingTtlMs, {
      fallback: CHAT_TYPING_TTL_MS,
      min: 100,
      max: 30_000
    })
  };

  const typingStateByThreadUser = new Map();
  const typingRateStateByThreadUser = new Map();
  const realtimePublisher =
    chatRealtimeService && typeof chatRealtimeService.publishThreadEvent === "function" ? chatRealtimeService : null;
  const canLookupUserProfile = Boolean(userProfilesRepository && typeof userProfilesRepository.findById === "function");
  const canBuildUserAvatar = Boolean(userAvatarService && typeof userAvatarService.buildAvatarResponse === "function");

  async function listActiveParticipantUserIds(threadId) {
    if (typeof chatParticipantsRepository.listActiveUserIdsByThreadId !== "function") {
      return [];
    }

    const userIds = await chatParticipantsRepository.listActiveUserIdsByThreadId(threadId);
    return normalizeUserIds(userIds);
  }

  function buildThreadUserKey(threadId, userId) {
    return `${Number(threadId)}:${Number(userId)}`;
  }

  function logRealtimePublishFailure(logger, error, logContext = {}) {
    if (!logger || typeof logger.warn !== "function") {
      return;
    }

    logger.warn(
      {
        err: error,
        ...(logContext && typeof logContext === "object" ? logContext : {})
      },
      "chat.realtime.publish_failed"
    );
  }

  function publishRealtimeSafely(fn, { requestMeta = {}, logContext = {} } = {}) {
    if (!realtimePublisher || typeof fn !== "function") {
      return;
    }

    try {
      fn();
    } catch (error) {
      logRealtimePublishFailure(requestMeta.logger, error, logContext);
    }
  }

  function clearTypingTimer(state) {
    if (!state || !state.stopTimer) {
      return;
    }

    clearTimeout(state.stopTimer);
    state.stopTimer = null;
  }

  function cleanupTypingRateState(nowMs) {
    for (const [key, state] of typingRateStateByThreadUser.entries()) {
      if (!state || nowMs - Number(state.windowStartedAtMs || 0) > options.chatTypingRateWindowMs * 2) {
        typingRateStateByThreadUser.delete(key);
      }
    }
  }

  async function resolveWorkspaceMembershipAccess({ workspaceId, userId, requiredPermission }) {
    const membership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspaceId, userId);
    if (!membership || String(membership.status || "") !== "active") {
      return {
        allowed: false,
        membership: null
      };
    }

    if (!requiredPermission || !rbacManifest || !shouldEnforceWorkspacePermission(rbacManifest, requiredPermission)) {
      return {
        allowed: true,
        membership
      };
    }

    const permissionSet = resolveRolePermissionSet(rbacManifest, membership.roleId);
    return {
      allowed: hasPermission(permissionSet, requiredPermission),
      membership
    };
  }

  async function resolveThreadAccess({ threadId, userId, surfaceId, requireWrite = false }) {
    const numericThreadId = normalizeThreadId(threadId);

    const thread = await chatThreadsRepository.findById(numericThreadId);
    if (!thread) {
      throw createThreadNotFoundError();
    }

    const participant = await chatParticipantsRepository.findByThreadIdAndUserId(numericThreadId, userId);
    if (!participant || String(participant.status || "") !== "active") {
      throw createThreadNotFoundError();
    }

    if (String(thread.scopeKind || "") === "workspace") {
      if (!options.chatWorkspaceThreadsEnabled) {
        throw createThreadNotFoundError();
      }

      const normalizedSurfaceId = normalizeSurfaceIdForThreadAccess(surfaceId);
      if (!WORKSPACE_SURFACE_IDS.has(normalizedSurfaceId)) {
        throw createThreadNotFoundError();
      }

      const access = await resolveWorkspaceMembershipAccess({
        workspaceId: thread.workspaceId,
        userId,
        requiredPermission: requireWrite ? "chat.write" : "chat.read"
      });
      if (!access.allowed) {
        throw createThreadNotFoundError();
      }

      return {
        thread,
        participant,
        membership: access.membership,
        surfaceId: normalizedSurfaceId
      };
    }

    if (String(thread.scopeKind || "") === "global" && !options.chatGlobalDmsEnabled) {
      throw createThreadNotFoundError();
    }

    return {
      thread,
      participant,
      membership: null,
      surfaceId: normalizeSurfaceIdForThreadAccess(surfaceId)
    };
  }

  async function ensureGlobalDmAvailableForUsers({ actorSettings, targetSettings, actorUserId, targetUserId }) {
    if (!options.chatGlobalDmsEnabled) {
      throw createFeatureDisabledError();
    }

    if (!actorSettings || !targetSettings) {
      throw createDmTargetUnavailableError();
    }

    if (!targetSettings.allowGlobalDms) {
      throw createDmTargetUnavailableError();
    }

    const requiresSharedWorkspace =
      options.chatGlobalDmsRequireSharedWorkspace ||
      Boolean(actorSettings.requireSharedWorkspaceForGlobalDm) ||
      Boolean(targetSettings.requireSharedWorkspaceForGlobalDm);

    if (!requiresSharedWorkspace) {
      return;
    }

    const actorMemberships = await workspaceMembershipsRepository.listByUserId(actorUserId);
    const targetMemberships = await workspaceMembershipsRepository.listByUserId(targetUserId);

    const actorWorkspaceIds = new Set(
      (Array.isArray(actorMemberships) ? actorMemberships : [])
        .filter((membership) => String(membership?.status || "") === "active")
        .map((membership) => Number(membership.workspaceId))
        .filter((workspaceId) => Number.isInteger(workspaceId) && workspaceId > 0)
    );

    const hasSharedWorkspace = (Array.isArray(targetMemberships) ? targetMemberships : []).some(
      (membership) =>
        String(membership?.status || "") === "active" && actorWorkspaceIds.has(Number(membership.workspaceId))
    );

    if (!hasSharedWorkspace) {
      throw createDmTargetUnavailableError();
    }
  }

  function buildGlobalDmScopeKey() {
    return "global";
  }

  function buildWorkspaceRoomScopeKey(workspaceId) {
    return `workspace:${Number(workspaceId)}:room`;
  }

  function normalizeDmPair(userAId, userBId) {
    const left = Number(userAId);
    const right = Number(userBId);
    return left < right ? [left, right] : [right, left];
  }

  function resolveDmPeerUserId(thread, actorUserId) {
    if (String(thread?.threadKind || "").toLowerCase() !== "dm") {
      return 0;
    }

    const normalizedActorUserId = parsePositiveInteger(actorUserId);
    if (!normalizedActorUserId) {
      return 0;
    }

    const lowUserId = parsePositiveInteger(thread?.dmUserLowId);
    const highUserId = parsePositiveInteger(thread?.dmUserHighId);
    if (!lowUserId || !highUserId) {
      return 0;
    }

    if (lowUserId === normalizedActorUserId) {
      return highUserId;
    }
    if (highUserId === normalizedActorUserId) {
      return lowUserId;
    }

    return 0;
  }

  function buildFallbackUserSummary(userId) {
    const normalizedUserId = parsePositiveInteger(userId);
    if (!normalizedUserId) {
      return null;
    }

    return {
      id: normalizedUserId,
      displayName: `User #${normalizedUserId}`,
      avatarUrl: null
    };
  }

  function resolveAvatarUrlFromProfile(profile) {
    if (!profile || !canBuildUserAvatar) {
      return null;
    }

    try {
      const avatar = userAvatarService.buildAvatarResponse(profile, {
        avatarSize: 64
      });
      const effectiveUrl = String(avatar?.effectiveUrl || "").trim();
      return effectiveUrl || null;
    } catch {
      return null;
    }
  }

  async function resolveUserSummary(userId) {
    const fallback = buildFallbackUserSummary(userId);
    if (!fallback || !canLookupUserProfile) {
      return fallback;
    }

    const profile = await userProfilesRepository.findById(fallback.id);
    if (!profile) {
      return fallback;
    }

    const displayName = String(profile.displayName || "").trim() || fallback.displayName;

    return {
      id: fallback.id,
      displayName,
      avatarUrl: resolveAvatarUrlFromProfile(profile)
    };
  }

  async function resolveUserSummariesById(userIds) {
    const normalizedUserIds = normalizeUserIds(userIds);
    if (normalizedUserIds.length < 1) {
      return new Map();
    }

    const summaries = await Promise.all(normalizedUserIds.map((userId) => resolveUserSummary(userId)));
    const byUserId = new Map();
    for (const summary of summaries) {
      const normalizedUserId = parsePositiveInteger(summary?.id);
      if (!normalizedUserId) {
        continue;
      }
      byUserId.set(normalizedUserId, summary);
    }

    return byUserId;
  }

  function resolveDmPeerSummaryFromMap(thread, actorUserId, peerSummariesByUserId = null) {
    const peerUserId = resolveDmPeerUserId(thread, actorUserId);
    if (!peerUserId) {
      return null;
    }

    if (peerSummariesByUserId && typeof peerSummariesByUserId.get === "function") {
      const summary = peerSummariesByUserId.get(peerUserId);
      if (summary) {
        return summary;
      }
    }

    return buildFallbackUserSummary(peerUserId);
  }

  async function resolveDmPeerSummaryForThread(thread, actorUserId, peerSummariesByUserId = null) {
    const fromMap = resolveDmPeerSummaryFromMap(thread, actorUserId, peerSummariesByUserId);
    if (!fromMap) {
      return null;
    }

    const peerUserId = parsePositiveInteger(fromMap.id);
    if (!peerUserId) {
      return null;
    }

    if (
      peerSummariesByUserId &&
      typeof peerSummariesByUserId.has === "function" &&
      peerSummariesByUserId.has(peerUserId)
    ) {
      return fromMap;
    }

    return resolveUserSummary(peerUserId);
  }

  function matchesDmCandidateSearch(candidate, normalizedSearch) {
    const search = String(normalizedSearch || "")
      .trim()
      .toLowerCase();
    if (!search) {
      return true;
    }

    const displayName = String(candidate?.displayName || "").toLowerCase();
    const publicChatId = String(candidate?.publicChatId || "").toLowerCase();
    return displayName.includes(search) || publicChatId.includes(search);
  }

  async function listDmCandidates({ user, query = {} } = {}) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    const actorUserId = normalizeUserId(user);
    const normalizedSearch = normalizeDmCandidatesSearch(query?.q);
    const limit = normalizeDmCandidatesLimit(query?.limit);

    if (!options.chatGlobalDmsEnabled) {
      return {
        items: []
      };
    }

    if (typeof workspaceMembershipsRepository.listByUserId !== "function") {
      return {
        items: []
      };
    }

    const actorMemberships = await workspaceMembershipsRepository.listByUserId(actorUserId);
    const workspaceIds = Array.from(
      new Set(
        (Array.isArray(actorMemberships) ? actorMemberships : [])
          .filter((membership) => String(membership?.status || "") === "active")
          .map((membership) => parsePositiveInteger(membership?.workspaceId))
          .filter(Boolean)
      )
    );

    if (workspaceIds.length < 1 || typeof workspaceMembershipsRepository.listActiveByWorkspaceId !== "function") {
      return {
        items: []
      };
    }

    const candidateByUserId = new Map();
    for (const workspaceId of workspaceIds) {
      const members = await workspaceMembershipsRepository.listActiveByWorkspaceId(workspaceId);
      for (const member of Array.isArray(members) ? members : []) {
        const candidateUserId = parsePositiveInteger(member?.userId);
        if (!candidateUserId || candidateUserId === actorUserId) {
          continue;
        }

        const existing = candidateByUserId.get(candidateUserId) || {
          userId: candidateUserId,
          sharedWorkspaceCount: 0
        };
        existing.sharedWorkspaceCount += 1;
        candidateByUserId.set(candidateUserId, existing);
      }
    }

    if (candidateByUserId.size < 1) {
      return {
        items: []
      };
    }

    const candidates = [];
    for (const [candidateUserId, candidateMeta] of candidateByUserId.entries()) {
      const blockedEitherDirection = await chatBlocksRepository.isBlockedEitherDirection(actorUserId, candidateUserId);
      if (blockedEitherDirection) {
        continue;
      }

      const settings = await chatUserSettingsRepository.findByUserId(candidateUserId);
      if (!settings || !settings.publicChatId || !settings.discoverableByPublicChatId || !settings.allowGlobalDms) {
        continue;
      }

      const userSummary = await resolveUserSummary(candidateUserId);
      const candidate = {
        userId: candidateUserId,
        displayName: String(userSummary?.displayName || `User #${candidateUserId}`),
        avatarUrl: userSummary?.avatarUrl ? String(userSummary.avatarUrl) : null,
        publicChatId: String(settings.publicChatId || "").trim(),
        sharedWorkspaceCount: Math.max(1, Number(candidateMeta?.sharedWorkspaceCount || 1))
      };

      if (!candidate.publicChatId || !matchesDmCandidateSearch(candidate, normalizedSearch)) {
        continue;
      }

      candidates.push(candidate);
    }

    candidates.sort((left, right) => {
      const byDisplayName = String(left.displayName || "").localeCompare(String(right.displayName || ""), undefined, {
        sensitivity: "base"
      });
      if (byDisplayName !== 0) {
        return byDisplayName;
      }
      return Number(left.userId) - Number(right.userId);
    });

    return {
      items: candidates.slice(0, limit)
    };
  }

  async function ensureWorkspaceRoom({ user } = {}) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    if (!options.chatWorkspaceThreadsEnabled) {
      throw createWorkspaceThreadsDisabledError();
    }

    const userId = normalizeUserId(user);
    const userSettings = await userSettingsRepository.findByUserId(userId);
    const activeWorkspaceId = parsePositiveInteger(userSettings?.lastActiveWorkspaceId);
    if (!activeWorkspaceId) {
      throw createWorkspaceContextUnavailableError();
    }

    const workspaceAccess = await resolveWorkspaceMembershipAccess({
      workspaceId: activeWorkspaceId,
      userId,
      requiredPermission: "chat.read"
    });
    if (!workspaceAccess.allowed) {
      throw createWorkspaceContextUnavailableError();
    }

    const scopeKey = buildWorkspaceRoomScopeKey(activeWorkspaceId);
    let created = false;

    const thread = await chatThreadsRepository.transaction(async (trx) => {
      const scopedOptions = {
        trx
      };

      let roomThread =
        typeof chatThreadsRepository.findWorkspaceRoomByWorkspaceId === "function"
          ? await chatThreadsRepository.findWorkspaceRoomByWorkspaceId(
              activeWorkspaceId,
              {
                threadKind: WORKSPACE_ROOM_THREAD_KIND,
                scopeKey
              },
              scopedOptions
            )
          : null;

      if (!roomThread) {
        try {
          roomThread = await chatThreadsRepository.insert(
            {
              scopeKind: "workspace",
              workspaceId: activeWorkspaceId,
              threadKind: WORKSPACE_ROOM_THREAD_KIND,
              scopeKey,
              createdByUserId: userId,
              title: "Workspace chat",
              participantCount: 0,
              nextMessageSeq: 1,
              encryptionMode: "none",
              metadata: {}
            },
            scopedOptions
          );
          created = true;
        } catch (error) {
          if (!isMysqlDuplicateEntryError(error)) {
            throw error;
          }

          roomThread =
            typeof chatThreadsRepository.findWorkspaceRoomByWorkspaceId === "function"
              ? await chatThreadsRepository.findWorkspaceRoomByWorkspaceId(
                  activeWorkspaceId,
                  {
                    threadKind: WORKSPACE_ROOM_THREAD_KIND,
                    scopeKey
                  },
                  scopedOptions
                )
              : null;

          if (!roomThread) {
            throw error;
          }
        }
      }

      const workspaceMembers =
        typeof workspaceMembershipsRepository.listActiveByWorkspaceId === "function"
          ? await workspaceMembershipsRepository.listActiveByWorkspaceId(activeWorkspaceId, scopedOptions)
          : [];

      const participantUserIds = normalizeUserIds([
        userId,
        ...(Array.isArray(workspaceMembers) ? workspaceMembers.map((member) => member?.userId) : [])
      ]);
      const normalizedParticipantUserIds = participantUserIds.length > 0 ? participantUserIds : [userId];

      let participants = [];
      if (typeof chatParticipantsRepository.upsertWorkspaceRoomParticipants === "function") {
        participants = await chatParticipantsRepository.upsertWorkspaceRoomParticipants(
          roomThread.id,
          normalizedParticipantUserIds,
          scopedOptions
        );
      } else if (typeof chatParticipantsRepository.insert === "function") {
        for (const participantUserId of normalizedParticipantUserIds) {
          try {
            await chatParticipantsRepository.insert(
              {
                threadId: roomThread.id,
                userId: participantUserId,
                participantRole: "member",
                status: "active"
              },
              scopedOptions
            );
          } catch (error) {
            if (!isMysqlDuplicateEntryError(error)) {
              throw error;
            }
          }
        }

        if (typeof chatParticipantsRepository.listByThreadId === "function") {
          participants = await chatParticipantsRepository.listByThreadId(roomThread.id, scopedOptions);
        }
      }

      const participantCount =
        Array.isArray(participants) && participants.length > 0
          ? participants.length
          : normalizedParticipantUserIds.length;
      const updatedThread =
        typeof chatThreadsRepository.updateById === "function"
          ? await chatThreadsRepository.updateById(
              roomThread.id,
              {
                participantCount: Math.max(1, participantCount)
              },
              scopedOptions
            )
          : null;

      return updatedThread || roomThread;
    });

    const participant = await chatParticipantsRepository.findByThreadIdAndUserId(thread.id, userId);

    return {
      thread: mapThreadForResponse(thread, participant),
      created
    };
  }

  async function ensureDm({ user, targetPublicChatId }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    const actorUserId = normalizeUserId(user);
    const normalizedTargetPublicChatId = normalizeDmTargetPublicChatId(targetPublicChatId);

    const actorSettings = await chatUserSettingsRepository.ensureForUserId(actorUserId);
    const targetSettings = await chatUserSettingsRepository.findByPublicChatId(normalizedTargetPublicChatId);

    if (!targetSettings || !targetSettings.discoverableByPublicChatId) {
      throw createDmTargetUnavailableError();
    }

    const targetUserId = Number(targetSettings.userId);
    if (targetUserId === actorUserId) {
      throw createDmSelfNotAllowedError();
    }

    const blockedEitherDirection = await chatBlocksRepository.isBlockedEitherDirection(actorUserId, targetUserId);
    if (blockedEitherDirection) {
      throw createDmTargetUnavailableError();
    }

    await ensureGlobalDmAvailableForUsers({
      actorSettings,
      targetSettings,
      actorUserId,
      targetUserId
    });

    const targetUserSummary = await resolveUserSummary(targetUserId);

    const existing = await chatThreadsRepository.findDmByCanonicalPair({
      scopeKey: buildGlobalDmScopeKey(),
      userAId: actorUserId,
      userBId: targetUserId
    });

    if (existing) {
      await chatParticipantsRepository.upsertDmParticipants(existing.id, [actorUserId, targetUserId]);
      const participant = await chatParticipantsRepository.findByThreadIdAndUserId(existing.id, actorUserId);

      return {
        thread: mapThreadForResponse(existing, participant, {
          peerUser: targetUserSummary
        }),
        created: false
      };
    }

    const [dmUserLowId, dmUserHighId] = normalizeDmPair(actorUserId, targetUserId);

    const thread = await chatThreadsRepository.transaction(async (trx) => {
      const scopedOptions = { trx };

      const found = await chatThreadsRepository.findDmByCanonicalPair(
        {
          scopeKey: buildGlobalDmScopeKey(),
          userAId: actorUserId,
          userBId: targetUserId
        },
        scopedOptions
      );

      if (found) {
        await chatParticipantsRepository.upsertDmParticipants(found.id, [actorUserId, targetUserId], scopedOptions);
        return found;
      }

      try {
        const inserted = await chatThreadsRepository.insert(
          {
            scopeKind: "global",
            scopeKey: buildGlobalDmScopeKey(),
            threadKind: "dm",
            createdByUserId: actorUserId,
            dmUserLowId,
            dmUserHighId,
            participantCount: 2,
            nextMessageSeq: 1,
            encryptionMode: "none",
            metadata: {}
          },
          scopedOptions
        );

        await chatParticipantsRepository.upsertDmParticipants(inserted.id, [actorUserId, targetUserId], scopedOptions);
        return inserted;
      } catch (error) {
        if (!isMysqlDuplicateEntryError(error)) {
          throw error;
        }

        const raced = await chatThreadsRepository.findDmByCanonicalPair(
          {
            scopeKey: buildGlobalDmScopeKey(),
            userAId: actorUserId,
            userBId: targetUserId
          },
          scopedOptions
        );

        if (!raced) {
          throw error;
        }

        await chatParticipantsRepository.upsertDmParticipants(raced.id, [actorUserId, targetUserId], scopedOptions);
        return raced;
      }
    });

    const participant = await chatParticipantsRepository.findByThreadIdAndUserId(thread.id, actorUserId);

    return {
      thread: mapThreadForResponse(thread, participant, {
        peerUser: targetUserSummary
      }),
      created: true
    };
  }

  async function listInbox({ user, surfaceId, cursor, limit }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    const userId = normalizeUserId(user);
    const normalizedSurfaceId = normalizeSurfaceIdForInbox(surfaceId);
    const page = parseCursorPage(cursor);
    const pageSize = toBoundedLimit(limit, {
      fallback: 20,
      max: options.chatThreadsPageSizeMax
    });

    const rawThreads = await chatThreadsRepository.listForUser(
      userId,
      {
        includeInactiveParticipants: false
      },
      {
        page,
        pageSize: Math.max(pageSize, pageSize * 3)
      }
    );

    const userSettings = await userSettingsRepository.findByUserId(userId);
    const activeWorkspaceId = parsePositiveInteger(userSettings?.lastActiveWorkspaceId);

    const filteredThreads = (Array.isArray(rawThreads) ? rawThreads : []).filter((thread) => {
      const scopeKind = String(thread.scopeKind || "");
      if (scopeKind === "global") {
        return true;
      }

      if (scopeKind !== "workspace") {
        return false;
      }

      if (normalizedSurfaceId === "console") {
        return false;
      }

      if (!activeWorkspaceId) {
        return false;
      }

      return Number(thread.workspaceId) === Number(activeWorkspaceId);
    });

    const selectedThreads = filteredThreads.slice(0, pageSize);
    const dmPeerSummariesByUserId = await resolveUserSummariesById(
      selectedThreads.map((thread) => resolveDmPeerUserId(thread, userId)).filter(Boolean)
    );

    const items = selectedThreads.map((thread) =>
      mapThreadForResponse(thread, thread.participant, {
        peerUser: resolveDmPeerSummaryFromMap(thread, userId, dmPeerSummariesByUserId)
      })
    );
    const hasMore = filteredThreads.length > pageSize;

    return {
      items,
      nextCursor: hasMore ? String(page + 1) : null
    };
  }

  async function getThread({ user, threadId, surfaceId }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    const userId = normalizeUserId(user);
    const access = await resolveThreadAccess({
      threadId,
      userId,
      surfaceId,
      requireWrite: false
    });

    const peerUser = await resolveDmPeerSummaryForThread(access.thread, userId);

    return {
      thread: mapThreadForResponse(access.thread, access.participant, {
        peerUser
      })
    };
  }

  async function hydrateMessages(messageRows, currentUserId, optionsArg = {}) {
    if (!Array.isArray(messageRows) || messageRows.length < 1) {
      return [];
    }

    const messageIds = messageRows.map((message) => Number(message.id)).filter((id) => Number.isInteger(id) && id > 0);
    const [attachmentRows, reactionRows] = await Promise.all([
      chatAttachmentsRepository.listByMessageIds(messageIds, optionsArg),
      chatReactionsRepository.listByMessageIds(messageIds, optionsArg)
    ]);

    const attachmentsByMessageId = new Map();
    for (const attachment of attachmentRows) {
      const messageId = Number(attachment.messageId);
      if (!attachmentsByMessageId.has(messageId)) {
        attachmentsByMessageId.set(messageId, []);
      }
      attachmentsByMessageId.get(messageId).push(attachment);
    }

    const reactionsByMessageId = new Map();
    for (const reaction of reactionRows) {
      const messageId = Number(reaction.messageId);
      if (!reactionsByMessageId.has(messageId)) {
        reactionsByMessageId.set(messageId, []);
      }
      reactionsByMessageId.get(messageId).push(reaction);
    }

    return messageRows.map((message) =>
      mapMessageForResponse(message, {
        attachments: attachmentsByMessageId.get(Number(message.id)) || [],
        reactions: mapReactionSummary(reactionsByMessageId.get(Number(message.id)) || [], currentUserId)
      })
    );
  }

  async function listThreadMessages({ user, threadId, surfaceId, cursor, limit }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    const userId = normalizeUserId(user);
    const access = await resolveThreadAccess({
      threadId,
      userId,
      surfaceId,
      requireWrite: false
    });

    const pageSize = toBoundedLimit(limit, {
      fallback: 50,
      max: options.chatMessagesPageSizeMax
    });

    const beforeSeq = parsePositiveInteger(cursor) || Number(access.thread.lastMessageSeq || 0) + 1;
    if (beforeSeq < 1) {
      return {
        items: [],
        nextCursor: null
      };
    }

    const descendingRows = await chatMessagesRepository.listByThreadIdBeforeSeq(access.thread.id, beforeSeq, pageSize);
    const orderedRows = [...descendingRows].reverse();

    if (orderedRows.length < 1) {
      return {
        items: [],
        nextCursor: null
      };
    }

    const items = await hydrateMessages(orderedRows, userId);
    const oldestSeq = Number(orderedRows[0].threadSeq || 0);
    const hasMoreRows =
      oldestSeq > 1 &&
      (await chatMessagesRepository.listByThreadIdBeforeSeq(access.thread.id, oldestSeq, 1)).length > 0;

    return {
      items,
      nextCursor: hasMoreRows ? String(oldestSeq) : null
    };
  }

  function ensureAttachmentsEnabled() {
    if (!options.chatAttachmentsEnabled) {
      throw createFeatureDisabledError();
    }
  }

  async function publishAttachmentUpdated({ thread, attachment, actorUserId, requestMeta, logContext = {} } = {}) {
    if (!thread || !attachment || !Number.isInteger(Number(actorUserId))) {
      return;
    }

    const normalizedStatus = normalizeAttachmentReadableStatus(attachment.status);
    const targetUserIds =
      normalizedStatus === "attached" ? await listActiveParticipantUserIds(thread.id) : [Number(actorUserId)];

    if (targetUserIds.length < 1) {
      return;
    }

    publishRealtimeSafely(
      () => {
        if (typeof realtimePublisher?.publishAttachmentUpdated === "function") {
          return realtimePublisher.publishAttachmentUpdated({
            thread,
            attachment,
            actorUserId,
            targetUserIds,
            commandId: requestMeta.commandId,
            sourceClientId: requestMeta.sourceClientId
          });
        }

        return realtimePublisher.publishThreadEvent({
          thread,
          eventType: resolvedRealtimeEventTypes.CHAT_ATTACHMENT_UPDATED,
          actorUserId,
          targetUserIds,
          payload: {
            threadId: Number(thread.id),
            attachment
          },
          commandId: requestMeta.commandId,
          sourceClientId: requestMeta.sourceClientId
        });
      },
      {
        requestMeta,
        logContext: {
          eventType: "chat.attachment.updated",
          threadId: Number(thread.id),
          attachmentId: Number(attachment.id),
          ...(logContext && typeof logContext === "object" ? logContext : {})
        }
      }
    );
  }

  async function reserveThreadAttachment({ user, threadId, surfaceId, payload, requestMeta }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    ensureAttachmentsEnabled();

    const userId = normalizeUserId(user);
    const normalizedRequestMeta = normalizeRequestMeta(requestMeta);
    const normalizedPayload = normalizeReserveAttachmentPayload(payload, options);
    const access = await resolveThreadAccess({
      threadId,
      userId,
      surfaceId,
      requireWrite: true
    });

    const existing = await chatAttachmentsRepository.findByClientAttachmentId(
      access.thread.id,
      userId,
      normalizedPayload.clientAttachmentId
    );
    if (existing) {
      if (!isAttachmentReserveReplayCompatible(existing, normalizedPayload)) {
        throw createAttachmentConflictError("clientAttachmentId conflicts with existing attachment metadata.");
      }

      return {
        attachment: mapAttachmentForResponse(existing)
      };
    }

    let createdAttachment;
    const uploadExpiresAt = buildUploadExpiresAtIso(options.chatUnattachedUploadRetentionHours);
    try {
      createdAttachment = await chatAttachmentsRepository.insertReserved({
        threadId: access.thread.id,
        uploadedByUserId: userId,
        clientAttachmentId: normalizedPayload.clientAttachmentId,
        attachmentKind: normalizedPayload.kind,
        mimeType: normalizedPayload.mimeType,
        fileName: normalizedPayload.fileName,
        sizeBytes: normalizedPayload.sizeBytes,
        metadata: normalizedPayload.metadata,
        uploadExpiresAt,
        storageDriver: chatAttachmentStorageService.driver
      });
    } catch (error) {
      if (!isMysqlDuplicateEntryError(error)) {
        throw error;
      }

      const raced = await chatAttachmentsRepository.findByClientAttachmentId(
        access.thread.id,
        userId,
        normalizedPayload.clientAttachmentId
      );
      if (!raced) {
        throw error;
      }

      if (!isAttachmentReserveReplayCompatible(raced, normalizedPayload)) {
        throw createAttachmentConflictError("clientAttachmentId conflicts with existing attachment metadata.");
      }

      createdAttachment = raced;
    }

    if (!createdAttachment) {
      throw createAttachmentConflictError();
    }

    const mappedAttachment = mapAttachmentForResponse(createdAttachment);
    await publishAttachmentUpdated({
      thread: access.thread,
      attachment: mappedAttachment,
      actorUserId: userId,
      requestMeta: normalizedRequestMeta
    });

    return {
      attachment: mappedAttachment
    };
  }

  async function uploadThreadAttachment({ user, threadId, surfaceId, attachmentId, payload, requestMeta }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    ensureAttachmentsEnabled();

    const userId = normalizeUserId(user);
    const normalizedRequestMeta = normalizeRequestMeta(requestMeta);
    const normalizedAttachmentId = normalizeUploadAttachmentId(attachmentId);
    const normalizedUpload = normalizeUploadBuffer(payload?.fileBuffer, options.chatAttachmentMaxUploadBytes);
    const access = await resolveThreadAccess({
      threadId,
      userId,
      surfaceId,
      requireWrite: true
    });

    const claimedAttachment = await chatAttachmentsRepository.findById(normalizedAttachmentId);
    const ownedAttachment =
      claimedAttachment &&
      Number(claimedAttachment.threadId) === Number(access.thread.id) &&
      Number(claimedAttachment.uploadedByUserId) === Number(userId);
    if (!ownedAttachment) {
      throw createAttachmentNotFoundError();
    }

    const sha256Hex = computeBufferSha256Hex(normalizedUpload.buffer);
    const status = normalizeAttachmentReadableStatus(claimedAttachment.status);
    if (status === "uploading") {
      throw createAttachmentUploadInProgressError();
    }

    if (status === "uploaded" || status === "attached") {
      if (isAttachmentUploadReplayCompatible(claimedAttachment, { sizeBytes: normalizedUpload.sizeBytes, sha256Hex })) {
        return {
          attachment: mapAttachmentForResponse(claimedAttachment)
        };
      }

      throw createAttachmentConflictError("Attachment content conflicts with existing upload.");
    }

    if (!isAttachmentStatusInSet(claimedAttachment, new Set(["reserved", "failed"]))) {
      throw createAttachmentConflictError();
    }

    let uploadingAttachment;
    try {
      uploadingAttachment = await chatAttachmentsRepository.markUploading(normalizedAttachmentId);
    } catch (error) {
      if (String(error?.code || "") !== "CHAT_ATTACHMENT_INVALID_STATUS_TRANSITION") {
        throw error;
      }

      const latestAttachment = await chatAttachmentsRepository.findById(normalizedAttachmentId);
      if (!latestAttachment) {
        throw createAttachmentNotFoundError();
      }

      const latestStatus = normalizeAttachmentReadableStatus(error.currentStatus || latestAttachment.status);
      if (latestStatus === "uploading") {
        throw createAttachmentUploadInProgressError();
      }

      if (
        (latestStatus === "uploaded" || latestStatus === "attached") &&
        isAttachmentUploadReplayCompatible(latestAttachment, {
          sizeBytes: normalizedUpload.sizeBytes,
          sha256Hex
        })
      ) {
        return {
          attachment: mapAttachmentForResponse(latestAttachment)
        };
      }

      throw createAttachmentConflictError();
    }

    if (!uploadingAttachment) {
      throw createAttachmentNotFoundError();
    }

    const expectedSizeBytes = Number(uploadingAttachment.sizeBytes || 0);
    if (expectedSizeBytes > 0 && expectedSizeBytes !== normalizedUpload.sizeBytes) {
      await chatAttachmentsRepository.markFailed(normalizedAttachmentId, "size_mismatch").catch(() => {});
      throw createAttachmentConflictError("Uploaded file size does not match reserved attachment metadata.");
    }

    const uploadFileName = String(uploadingAttachment.fileName || payload?.uploadFileName || "").trim() || "file";
    const uploadMimeType =
      String(uploadingAttachment.mimeType || payload?.uploadMimeType || "").trim() || "application/octet-stream";

    let storageKey = null;
    try {
      const saved = await chatAttachmentStorageService.saveAttachment({
        threadId: access.thread.id,
        attachmentId: normalizedAttachmentId,
        fileName: uploadFileName,
        buffer: normalizedUpload.buffer
      });
      storageKey = String(saved?.storageKey || "").trim() || null;
    } catch (error) {
      await chatAttachmentsRepository.markFailed(normalizedAttachmentId, "storage_write_failed").catch(() => {});
      throw error;
    }

    if (!storageKey) {
      await chatAttachmentsRepository.markFailed(normalizedAttachmentId, "storage_key_missing").catch(() => {});
      throw createAttachmentConflictError();
    }

    let uploadedAttachment;
    try {
      uploadedAttachment = await chatAttachmentsRepository.markUploaded(normalizedAttachmentId, {
        storageDriver: chatAttachmentStorageService.driver,
        storageKey,
        deliveryPath: buildAttachmentDeliveryPath(normalizedAttachmentId),
        mimeType: uploadMimeType,
        fileName: uploadFileName,
        sizeBytes: normalizedUpload.sizeBytes,
        sha256Hex
      });
    } catch (error) {
      await chatAttachmentStorageService.deleteAttachment(storageKey).catch(() => {});
      await chatAttachmentsRepository.markFailed(normalizedAttachmentId, "upload_finalize_failed").catch(() => {});

      if (String(error?.code || "") !== "CHAT_ATTACHMENT_INVALID_STATUS_TRANSITION") {
        throw error;
      }

      const latestAttachment = await chatAttachmentsRepository.findById(normalizedAttachmentId);
      if (!latestAttachment) {
        throw createAttachmentNotFoundError();
      }

      const latestStatus = normalizeAttachmentReadableStatus(error.currentStatus || latestAttachment.status);
      if (latestStatus === "uploading") {
        throw createAttachmentUploadInProgressError();
      }

      if (
        (latestStatus === "uploaded" || latestStatus === "attached") &&
        isAttachmentUploadReplayCompatible(latestAttachment, {
          sizeBytes: normalizedUpload.sizeBytes,
          sha256Hex
        })
      ) {
        return {
          attachment: mapAttachmentForResponse(latestAttachment)
        };
      }

      throw createAttachmentConflictError();
    }

    if (!uploadedAttachment) {
      throw createAttachmentNotFoundError();
    }

    const mappedAttachment = mapAttachmentForResponse(uploadedAttachment);
    await publishAttachmentUpdated({
      thread: access.thread,
      attachment: mappedAttachment,
      actorUserId: userId,
      requestMeta: normalizedRequestMeta
    });

    return {
      attachment: mappedAttachment
    };
  }

  async function deleteThreadAttachment({ user, threadId, surfaceId, attachmentId, requestMeta }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    ensureAttachmentsEnabled();

    const userId = normalizeUserId(user);
    const normalizedRequestMeta = normalizeRequestMeta(requestMeta);
    const normalizedAttachmentId = normalizeUploadAttachmentId(attachmentId);
    const access = await resolveThreadAccess({
      threadId,
      userId,
      surfaceId,
      requireWrite: true
    });

    const attachment = await chatAttachmentsRepository.findById(normalizedAttachmentId);
    const ownedAttachment =
      attachment &&
      Number(attachment.threadId) === Number(access.thread.id) &&
      Number(attachment.uploadedByUserId) === Number(userId);
    if (!ownedAttachment) {
      throw createAttachmentNotFoundError();
    }

    const status = normalizeAttachmentReadableStatus(attachment.status);
    if (attachment.messageId != null || status === "attached") {
      throw createAttachmentConflictError("Attached attachments cannot be deleted.");
    }

    if (status === "deleted") {
      return {
        deleted: true
      };
    }

    const storageKeys = [attachment.storageKey, attachment.previewStorageKey]
      .map((value) => String(value || "").trim())
      .filter((value) => value.length > 0);

    let deletedAttachment;
    try {
      deletedAttachment = await chatAttachmentsRepository.markDeleted(normalizedAttachmentId, {
        deletedAt: new Date().toISOString(),
        failedReason: null
      });
    } catch (error) {
      if (String(error?.code || "") !== "CHAT_ATTACHMENT_INVALID_STATUS_TRANSITION") {
        throw error;
      }
      throw createAttachmentConflictError();
    }

    if (!deletedAttachment) {
      throw createAttachmentNotFoundError();
    }

    for (const storageKey of storageKeys) {
      await chatAttachmentStorageService.deleteAttachment(storageKey).catch(() => {});
    }

    await publishAttachmentUpdated({
      thread: access.thread,
      attachment: mapAttachmentForResponse(deletedAttachment),
      actorUserId: userId,
      requestMeta: normalizedRequestMeta
    });

    return {
      deleted: true
    };
  }

  async function getAttachmentContent({ user, attachmentId, surfaceId }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    ensureAttachmentsEnabled();

    const userId = normalizeUserId(user);
    const normalizedAttachmentId = normalizeUploadAttachmentId(attachmentId);
    const attachment = await chatAttachmentsRepository.findById(normalizedAttachmentId);
    if (!attachment) {
      throw createAttachmentNotFoundError();
    }

    const status = normalizeAttachmentReadableStatus(attachment.status);
    const isAttached = status === "attached" && attachment.messageId != null;
    const isUploaderPreview =
      attachment.messageId == null && status === "uploaded" && Number(attachment.uploadedByUserId) === Number(userId);
    if (!isAttached && !isUploaderPreview) {
      throw createAttachmentNotFoundError();
    }

    await resolveThreadAccess({
      threadId: attachment.threadId,
      userId,
      surfaceId,
      requireWrite: false
    });

    if (!isAttached && Number(attachment.uploadedByUserId) !== Number(userId)) {
      throw createAttachmentNotFoundError();
    }

    const storageKey = String(attachment.storageKey || "").trim();
    if (!storageKey) {
      throw createAttachmentNotFoundError();
    }

    const contentBuffer = await chatAttachmentStorageService.readAttachment(storageKey);
    if (!Buffer.isBuffer(contentBuffer) || contentBuffer.length < 1) {
      throw createAttachmentNotFoundError();
    }

    const contentType = String(attachment.mimeType || "").trim() || "application/octet-stream";
    const contentDisposition = buildAttachmentContentDisposition(attachment.fileName, contentType);
    return {
      attachment: mapAttachmentForResponse(attachment),
      contentBuffer,
      contentType,
      contentDisposition
    };
  }

  async function buildLegacyFingerprintFromStoredMessage(message, optionsArg = {}) {
    const attachments = await chatAttachmentsRepository.listByMessageId(message.id, optionsArg);
    return buildMessageIdempotencyFingerprint({
      text: message.textContent,
      replyToMessageId: message.replyToMessageId,
      attachmentIds: attachments.map((attachment) => Number(attachment.id)),
      metadata: message.metadata
    });
  }

  async function doesMessageMatchIdempotencyFingerprint(message, incomingFingerprint, optionsArg = {}) {
    if (message.idempotencyPayloadVersion && message.idempotencyPayloadSha256) {
      return (
        Number(message.idempotencyPayloadVersion) === Number(incomingFingerprint.version) &&
        String(message.idempotencyPayloadSha256 || "").toLowerCase() ===
          String(incomingFingerprint.sha256 || "").toLowerCase()
      );
    }

    const fallbackFingerprint = await buildLegacyFingerprintFromStoredMessage(message, optionsArg);
    return (
      Number(fallbackFingerprint.version) === Number(incomingFingerprint.version) &&
      String(fallbackFingerprint.sha256 || "").toLowerCase() === String(incomingFingerprint.sha256 || "").toLowerCase()
    );
  }

  async function sendThreadMessage({ user, threadId, surfaceId, payload, requestMeta }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    const userId = normalizeUserId(user);
    const normalizedRequestMeta = normalizeRequestMeta(requestMeta);
    const normalizedPayload = normalizeSendPayload(payload, options);
    const incomingFingerprint = buildMessageIdempotencyFingerprint(normalizedPayload);

    const access = await resolveThreadAccess({
      threadId,
      userId,
      surfaceId,
      requireWrite: true
    });

    const transactionResult = await chatThreadsRepository.transaction(async (trx) => {
      const scopedOptions = { trx };

      const existing = await chatMessagesRepository.findByClientMessageId(
        access.thread.id,
        userId,
        normalizedPayload.clientMessageId,
        scopedOptions
      );

      if (existing) {
        const matches = await doesMessageMatchIdempotencyFingerprint(existing, incomingFingerprint, scopedOptions);
        if (!matches) {
          throw createIdempotencyConflictError();
        }

        const replayThread = await chatThreadsRepository.findById(access.thread.id, scopedOptions);
        return {
          idempotencyStatus: "replayed",
          messageId: existing.id,
          thread: replayThread
        };
      }

      const tombstone = await chatIdempotencyTombstonesRepository.findByClientMessageId(
        access.thread.id,
        userId,
        normalizedPayload.clientMessageId,
        scopedOptions
      );

      if (tombstone) {
        const sameFingerprint =
          Number(tombstone.idempotencyPayloadVersion) === Number(incomingFingerprint.version) &&
          String(tombstone.idempotencyPayloadSha256 || "").toLowerCase() ===
            String(incomingFingerprint.sha256 || "").toLowerCase();

        if (sameFingerprint) {
          throw createMessageRetryBlockedError();
        }

        throw createIdempotencyConflictError();
      }

      const allocatedThreadSeq = await chatThreadsRepository.allocateNextMessageSequence(
        access.thread.id,
        scopedOptions
      );
      if (!allocatedThreadSeq) {
        throw createThreadNotFoundError();
      }

      if (normalizedPayload.replyToMessageId) {
        const replyToMessage = await chatMessagesRepository.findById(normalizedPayload.replyToMessageId, scopedOptions);
        if (!replyToMessage || Number(replyToMessage.threadId) !== Number(access.thread.id)) {
          throw createChatValidationError({
            replyToMessageId: "replyToMessageId must reference a message in this thread."
          });
        }
      }

      let createdMessage;

      try {
        createdMessage = await chatMessagesRepository.insert(
          {
            threadId: access.thread.id,
            threadSeq: allocatedThreadSeq,
            senderUserId: userId,
            clientMessageId: normalizedPayload.clientMessageId,
            idempotencyPayloadVersion: incomingFingerprint.version,
            idempotencyPayloadSha256: incomingFingerprint.sha256,
            messageKind: "text",
            replyToMessageId: normalizedPayload.replyToMessageId,
            textContent: normalizedPayload.text,
            metadata: normalizedPayload.metadata
          },
          scopedOptions
        );
      } catch (error) {
        if (!isClientMessageDuplicateConflict(error)) {
          throw error;
        }

        const racedMessage = await chatMessagesRepository.findByClientMessageId(
          access.thread.id,
          userId,
          normalizedPayload.clientMessageId,
          scopedOptions
        );

        if (!racedMessage) {
          throw error;
        }

        const matches = await doesMessageMatchIdempotencyFingerprint(racedMessage, incomingFingerprint, scopedOptions);
        if (!matches) {
          throw createIdempotencyConflictError();
        }

        const replayThread = await chatThreadsRepository.findById(access.thread.id, scopedOptions);
        return {
          idempotencyStatus: "replayed",
          messageId: racedMessage.id,
          thread: replayThread
        };
      }

      for (let index = 0; index < normalizedPayload.attachmentIds.length; index += 1) {
        const attachmentId = normalizedPayload.attachmentIds[index];
        const attachment = await chatAttachmentsRepository.findById(attachmentId, scopedOptions);

        const isAttachable =
          attachment &&
          Number(attachment.threadId) === Number(access.thread.id) &&
          Number(attachment.uploadedByUserId) === Number(userId) &&
          attachment.messageId == null &&
          String(attachment.status || "") === "uploaded";

        if (!isAttachable) {
          throw createChatValidationError({
            attachmentIds: "All attachmentIds must reference uploaded staged attachments in this thread."
          });
        }

        await chatAttachmentsRepository.attachToMessage(
          attachmentId,
          {
            messageId: createdMessage.id,
            position: index + 1
          },
          scopedOptions
        );
      }

      const updatedThread = await chatThreadsRepository.updateLastMessageCache(
        access.thread.id,
        {
          lastMessageId: createdMessage.id,
          lastMessageSeq: createdMessage.threadSeq,
          lastMessageAt: createdMessage.sentAt,
          lastMessagePreview: buildPreviewText(createdMessage.textContent)
        },
        scopedOptions
      );

      await chatParticipantsRepository.updateReadCursorMonotonic(
        access.thread.id,
        userId,
        {
          lastReadSeq: createdMessage.threadSeq,
          lastReadMessageId: createdMessage.id,
          lastReadAt: createdMessage.sentAt
        },
        scopedOptions
      );

      return {
        idempotencyStatus: "created",
        messageId: createdMessage.id,
        thread: updatedThread
      };
    });

    const [storedMessage] = await Promise.all([
      chatMessagesRepository.findById(transactionResult.messageId),
      Promise.resolve()
    ]);

    if (!storedMessage || Number(storedMessage.threadId) !== Number(access.thread.id)) {
      throw createThreadNotFoundError();
    }

    const [message] = await hydrateMessages([storedMessage], userId);
    const participant = await chatParticipantsRepository.findByThreadIdAndUserId(access.thread.id, userId);
    const latestThread = transactionResult.thread || (await chatThreadsRepository.findById(access.thread.id));
    const responseThread = latestThread || access.thread;
    const peerUser = await resolveDmPeerSummaryForThread(responseThread, userId);
    const responsePayload = {
      message,
      thread: mapThreadForResponse(responseThread, participant || access.participant, {
        peerUser
      }),
      idempotencyStatus: transactionResult.idempotencyStatus
    };

    const participantUserIds = await listActiveParticipantUserIds(access.thread.id);
    publishRealtimeSafely(
      () =>
        realtimePublisher.publishMessageEvent({
          thread: responseThread,
          message: responsePayload.message,
          idempotencyStatus: responsePayload.idempotencyStatus,
          actorUserId: userId,
          targetUserIds: participantUserIds,
          commandId: normalizedRequestMeta.commandId,
          sourceClientId: normalizedRequestMeta.sourceClientId
        }),
      {
        requestMeta: normalizedRequestMeta,
        logContext: {
          eventType: "chat.message.created",
          threadId: Number(access.thread.id)
        }
      }
    );

    return responsePayload;
  }

  async function markThreadRead({ user, threadId, surfaceId, payload, requestMeta }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    const userId = normalizeUserId(user);
    const normalizedRequestMeta = normalizeRequestMeta(requestMeta);
    const normalizedPayload = normalizeReadPayload(payload);
    const access = await resolveThreadAccess({
      threadId,
      userId,
      surfaceId,
      requireWrite: false
    });

    let resolvedSeq = normalizedPayload.threadSeq;
    let resolvedMessageId = normalizedPayload.messageId;

    if (normalizedPayload.messageId) {
      const cursorMessage = await chatMessagesRepository.findById(normalizedPayload.messageId);
      if (!cursorMessage || Number(cursorMessage.threadId) !== Number(access.thread.id)) {
        throw createReadCursorInvalidError({
          messageId: "messageId must reference a message in this thread."
        });
      }

      if (resolvedSeq && Number(resolvedSeq) !== Number(cursorMessage.threadSeq)) {
        throw createReadCursorInvalidError({
          threadSeq: "threadSeq must match the messageId sequence."
        });
      }

      resolvedSeq = Number(cursorMessage.threadSeq);
      resolvedMessageId = Number(cursorMessage.id);
    }

    if (!resolvedSeq) {
      throw createReadCursorInvalidError({
        threadSeq: "threadSeq is required when messageId cannot be resolved."
      });
    }

    const lastMessageSeq = Math.max(0, Number(access.thread.lastMessageSeq || 0));
    const clampedSeq = Math.min(lastMessageSeq, Math.max(0, Number(resolvedSeq || 0)));

    const updatedParticipant = await chatParticipantsRepository.updateReadCursorMonotonic(access.thread.id, userId, {
      lastReadSeq: clampedSeq,
      lastReadMessageId: resolvedMessageId,
      lastReadAt: new Date().toISOString()
    });

    if (!updatedParticipant) {
      throw createThreadNotFoundError();
    }

    const responsePayload = {
      threadId: Number(access.thread.id),
      lastReadSeq: Number(updatedParticipant.lastReadSeq || 0),
      lastReadMessageId:
        updatedParticipant.lastReadMessageId == null ? null : Number(updatedParticipant.lastReadMessageId)
    };

    const participantUserIds = await listActiveParticipantUserIds(access.thread.id);
    publishRealtimeSafely(
      () =>
        realtimePublisher.publishReadCursorUpdated({
          thread: access.thread,
          userId,
          lastReadSeq: responsePayload.lastReadSeq,
          lastReadMessageId: responsePayload.lastReadMessageId,
          actorUserId: userId,
          targetUserIds: participantUserIds,
          commandId: normalizedRequestMeta.commandId,
          sourceClientId: normalizedRequestMeta.sourceClientId
        }),
      {
        requestMeta: normalizedRequestMeta,
        logContext: {
          eventType: "chat.thread.read.updated",
          threadId: Number(access.thread.id)
        }
      }
    );

    return responsePayload;
  }

  async function listMessageReactions(threadId, messageId, userId) {
    const message = await chatMessagesRepository.findById(messageId);
    if (!message || Number(message.threadId) !== Number(threadId)) {
      throw createMessageNotFoundError();
    }

    const rows = await chatReactionsRepository.listByMessageIds([messageId]);
    return {
      message,
      summary: mapReactionSummary(rows, userId)
    };
  }

  async function addReaction({ user, threadId, surfaceId, payload, requestMeta }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    const userId = normalizeUserId(user);
    const normalizedRequestMeta = normalizeRequestMeta(requestMeta);
    const normalizedPayload = normalizeReactionPayload(payload);

    const access = await resolveThreadAccess({
      threadId,
      userId,
      surfaceId,
      requireWrite: true
    });

    const message = await chatMessagesRepository.findById(normalizedPayload.messageId);
    if (!message || Number(message.threadId) !== Number(access.thread.id)) {
      throw createMessageNotFoundError();
    }

    await chatReactionsRepository.addReaction({
      messageId: normalizedPayload.messageId,
      threadId: access.thread.id,
      userId,
      reaction: normalizedPayload.reaction
    });

    const reactionSummary = await listMessageReactions(access.thread.id, normalizedPayload.messageId, userId);
    const responsePayload = {
      messageId: Number(normalizedPayload.messageId),
      reactions: reactionSummary.summary
    };

    const participantUserIds = await listActiveParticipantUserIds(access.thread.id);
    publishRealtimeSafely(
      () =>
        realtimePublisher.publishReactionUpdated({
          thread: access.thread,
          messageId: responsePayload.messageId,
          reactions: responsePayload.reactions,
          actorUserId: userId,
          targetUserIds: participantUserIds,
          commandId: normalizedRequestMeta.commandId,
          sourceClientId: normalizedRequestMeta.sourceClientId
        }),
      {
        requestMeta: normalizedRequestMeta,
        logContext: {
          eventType: "chat.message.reaction.updated",
          threadId: Number(access.thread.id),
          messageId: responsePayload.messageId
        }
      }
    );

    return responsePayload;
  }

  async function removeReaction({ user, threadId, surfaceId, payload, requestMeta }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    const userId = normalizeUserId(user);
    const normalizedRequestMeta = normalizeRequestMeta(requestMeta);
    const normalizedPayload = normalizeReactionPayload(payload);

    const access = await resolveThreadAccess({
      threadId,
      userId,
      surfaceId,
      requireWrite: true
    });

    const message = await chatMessagesRepository.findById(normalizedPayload.messageId);
    if (!message || Number(message.threadId) !== Number(access.thread.id)) {
      throw createMessageNotFoundError();
    }

    await chatReactionsRepository.removeReaction({
      messageId: normalizedPayload.messageId,
      userId,
      reaction: normalizedPayload.reaction
    });

    const reactionSummary = await listMessageReactions(access.thread.id, normalizedPayload.messageId, userId);
    const responsePayload = {
      messageId: Number(normalizedPayload.messageId),
      reactions: reactionSummary.summary
    };

    const participantUserIds = await listActiveParticipantUserIds(access.thread.id);
    publishRealtimeSafely(
      () =>
        realtimePublisher.publishReactionUpdated({
          thread: access.thread,
          messageId: responsePayload.messageId,
          reactions: responsePayload.reactions,
          actorUserId: userId,
          targetUserIds: participantUserIds,
          commandId: normalizedRequestMeta.commandId,
          sourceClientId: normalizedRequestMeta.sourceClientId
        }),
      {
        requestMeta: normalizedRequestMeta,
        logContext: {
          eventType: "chat.message.reaction.updated",
          threadId: Number(access.thread.id),
          messageId: responsePayload.messageId
        }
      }
    );

    return responsePayload;
  }

  async function emitThreadTyping({ user, threadId, surfaceId, requestMeta }) {
    if (!options.chatEnabled) {
      throw createFeatureDisabledError();
    }

    const userId = normalizeUserId(user);
    const normalizedRequestMeta = normalizeRequestMeta(requestMeta);
    const access = await resolveThreadAccess({
      threadId,
      userId,
      surfaceId,
      requireWrite: true
    });

    const nowMs = Date.now();
    cleanupTypingRateState(nowMs);

    const threadUserKey = buildThreadUserKey(access.thread.id, userId);
    const rateState = typingRateStateByThreadUser.get(threadUserKey);
    if (!rateState || nowMs - Number(rateState.windowStartedAtMs || 0) >= options.chatTypingRateWindowMs) {
      typingRateStateByThreadUser.set(threadUserKey, {
        windowStartedAtMs: nowMs,
        requestCount: 1
      });
    } else {
      const nextRequestCount = Number(rateState.requestCount || 0) + 1;
      if (nextRequestCount > options.chatTypingRateLimit) {
        const retryAfterMs = Math.max(1000, options.chatTypingRateWindowMs - (nowMs - rateState.windowStartedAtMs));
        throw createRateLimitedError({
          retryAfterMs
        });
      }

      rateState.requestCount = nextRequestCount;
      typingRateStateByThreadUser.set(threadUserKey, rateState);
    }

    const targetUserIds = (await listActiveParticipantUserIds(access.thread.id)).filter((participantUserId) => {
      return Number(participantUserId) !== Number(userId);
    });

    const previousState = typingStateByThreadUser.get(threadUserKey) || null;
    const expiresAtMs = nowMs + options.chatTypingTtlMs;
    const shouldEmitStarted =
      !previousState ||
      nowMs - Number(previousState.lastStartedAtMs || 0) >= options.chatTypingThrottleMs ||
      Number(previousState.expiresAtMs || 0) <= nowMs;

    if (previousState) {
      clearTypingTimer(previousState);
    }

    const nextState = {
      lastStartedAtMs: shouldEmitStarted ? nowMs : Number(previousState?.lastStartedAtMs || 0),
      expiresAtMs,
      stopTimer: null
    };

    nextState.stopTimer = setTimeout(() => {
      const latestState = typingStateByThreadUser.get(threadUserKey);
      if (!latestState || Number(latestState.expiresAtMs) !== Number(expiresAtMs)) {
        return;
      }

      typingStateByThreadUser.delete(threadUserKey);
      publishRealtimeSafely(
        () =>
          realtimePublisher.emitTyping({
            thread: access.thread,
            actorUserId: userId,
            targetUserIds,
            state: "stopped",
            expiresAt: new Date(expiresAtMs).toISOString(),
            commandId: normalizedRequestMeta.commandId,
            sourceClientId: normalizedRequestMeta.sourceClientId
          }),
        {
          requestMeta: normalizedRequestMeta,
          logContext: {
            eventType: "chat.typing.stopped",
            threadId: Number(access.thread.id)
          }
        }
      );
    }, options.chatTypingTtlMs);

    if (typeof nextState.stopTimer.unref === "function") {
      nextState.stopTimer.unref();
    }

    typingStateByThreadUser.set(threadUserKey, nextState);

    if (shouldEmitStarted) {
      publishRealtimeSafely(
        () =>
          realtimePublisher.emitTyping({
            thread: access.thread,
            actorUserId: userId,
            targetUserIds,
            state: "started",
            expiresAt: new Date(expiresAtMs).toISOString(),
            commandId: normalizedRequestMeta.commandId,
            sourceClientId: normalizedRequestMeta.sourceClientId
          }),
        {
          requestMeta: normalizedRequestMeta,
          logContext: {
            eventType: "chat.typing.started",
            threadId: Number(access.thread.id)
          }
        }
      );
    }

    return {
      accepted: true,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  }

  return {
    ensureWorkspaceRoom,
    ensureDm,
    listDmCandidates,
    listInbox,
    getThread,
    listThreadMessages,
    reserveThreadAttachment,
    uploadThreadAttachment,
    deleteThreadAttachment,
    getAttachmentContent,
    sendThreadMessage,
    markThreadRead,
    addReaction,
    removeReaction,
    emitThreadTyping
  };
}

const __testables = {
  IDEMPOTENCY_VERSION,
  buildMessageIdempotencyFingerprint,
  createChatError,
  createChatValidationError,
  createDmTargetUnavailableError,
  createFeatureDisabledError,
  createIdempotencyConflictError,
  createMessageRetryBlockedError,
  createRateLimitedError,
  createReadCursorInvalidError,
  createReadCursorRequiredError,
  createThreadNotFoundError,
  isClientMessageDuplicateConflict,
  mapAttachmentForResponse,
  mapMessageForResponse,
  mapReactionSummary,
  mapThreadForResponse,
  normalizeAttachmentIds,
  normalizeReserveAttachmentPayload,
  normalizeUploadAttachmentId,
  normalizeUploadBuffer,
  normalizeClientMessageId,
  normalizeDmTargetPublicChatId,
  normalizeReactionPayload,
  normalizeRequestMeta,
  normalizeReadPayload,
  normalizeSendPayload,
  normalizeSurfaceIdForInbox,
  normalizeSurfaceIdForThreadAccess,
  normalizeUserIds,
  toBoundedMilliseconds,
  createService
};

export { createService, __testables };
