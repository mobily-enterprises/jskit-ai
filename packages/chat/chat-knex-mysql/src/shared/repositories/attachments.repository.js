import { toIsoString, toMysqlDateTimeUtc } from "@jskit-ai/knex-mysql-core/dateUtils";
import { parsePositiveInteger } from "@jskit-ai/server-runtime-core/integers";
import { normalizeBatchSize, normalizeCutoffDateOrThrow } from "@jskit-ai/knex-mysql-core/retention";
import {
  normalizeClientKey,
  normalizeIdList,
  normalizePagination,
  parseJsonObject,
  resolveClient,
  stringifyJsonObject
} from "./shared.js";

const ATTACHMENT_STATUS = {
  RESERVED: "reserved",
  UPLOADING: "uploading",
  UPLOADED: "uploaded",
  ATTACHED: "attached",
  FAILED: "failed",
  QUARANTINED: "quarantined",
  EXPIRED: "expired",
  DELETED: "deleted"
};

const ALLOWED_ATTACHMENT_STATUS_TRANSITIONS = {
  [ATTACHMENT_STATUS.RESERVED]: new Set([
    ATTACHMENT_STATUS.UPLOADING,
    ATTACHMENT_STATUS.FAILED,
    ATTACHMENT_STATUS.EXPIRED,
    ATTACHMENT_STATUS.DELETED
  ]),
  [ATTACHMENT_STATUS.UPLOADING]: new Set([
    ATTACHMENT_STATUS.UPLOADED,
    ATTACHMENT_STATUS.FAILED,
    ATTACHMENT_STATUS.EXPIRED,
    ATTACHMENT_STATUS.DELETED
  ]),
  [ATTACHMENT_STATUS.UPLOADED]: new Set([
    ATTACHMENT_STATUS.ATTACHED,
    ATTACHMENT_STATUS.FAILED,
    ATTACHMENT_STATUS.EXPIRED,
    ATTACHMENT_STATUS.DELETED
  ]),
  [ATTACHMENT_STATUS.ATTACHED]: new Set([ATTACHMENT_STATUS.DELETED]),
  [ATTACHMENT_STATUS.FAILED]: new Set([
    ATTACHMENT_STATUS.UPLOADING,
    ATTACHMENT_STATUS.EXPIRED,
    ATTACHMENT_STATUS.DELETED
  ]),
  [ATTACHMENT_STATUS.QUARANTINED]: new Set([ATTACHMENT_STATUS.DELETED]),
  [ATTACHMENT_STATUS.EXPIRED]: new Set([]),
  [ATTACHMENT_STATUS.DELETED]: new Set([])
};

function normalizeAttachmentStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return normalized || ATTACHMENT_STATUS.RESERVED;
}

function isAttachmentStatusTransitionAllowed(fromStatus, toStatus) {
  const from = normalizeAttachmentStatus(fromStatus);
  const to = normalizeAttachmentStatus(toStatus);
  const allowed = ALLOWED_ATTACHMENT_STATUS_TRANSITIONS[from];
  if (!allowed) {
    return false;
  }
  return allowed.has(to);
}

function createAttachmentStateTransitionError(currentStatus, nextStatus) {
  const error = new Error(`Invalid attachment status transition: ${currentStatus} -> ${nextStatus}`);
  error.code = "CHAT_ATTACHMENT_INVALID_STATUS_TRANSITION";
  error.currentStatus = currentStatus;
  error.nextStatus = nextStatus;
  return error;
}

function mapAttachmentRowRequired(row) {
  if (!row) {
    throw new TypeError("mapAttachmentRowRequired expected a row object.");
  }

  return {
    id: Number(row.id),
    threadId: Number(row.thread_id),
    messageId: row.message_id == null ? null : Number(row.message_id),
    uploadedByUserId: Number(row.uploaded_by_user_id),
    clientAttachmentId: row.client_attachment_id == null ? null : String(row.client_attachment_id),
    position: row.position == null ? null : Number(row.position),
    attachmentKind: String(row.attachment_kind || "file"),
    status: normalizeAttachmentStatus(row.status),
    storageDriver: String(row.storage_driver || "fs"),
    storageKey: row.storage_key == null ? null : String(row.storage_key),
    deliveryPath: row.delivery_path == null ? null : String(row.delivery_path),
    previewStorageKey: row.preview_storage_key == null ? null : String(row.preview_storage_key),
    previewDeliveryPath: row.preview_delivery_path == null ? null : String(row.preview_delivery_path),
    mimeType: row.mime_type == null ? null : String(row.mime_type),
    fileName: row.file_name == null ? null : String(row.file_name),
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    sha256Hex: row.sha256_hex == null ? null : String(row.sha256_hex),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    uploadExpiresAt: row.upload_expires_at ? toIsoString(row.upload_expires_at) : null,
    processedAt: row.processed_at ? toIsoString(row.processed_at) : null,
    failedReason: row.failed_reason == null ? null : String(row.failed_reason),
    metadata: parseJsonObject(row.metadata_json),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    deletedAt: row.deleted_at ? toIsoString(row.deleted_at) : null
  };
}

function mapAttachmentRowNullable(row) {
  if (!row) {
    return null;
  }
  return mapAttachmentRowRequired(row);
}

function createAttachmentsRepository(dbClient) {
  async function repoFindById(attachmentId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericAttachmentId = parsePositiveInteger(attachmentId);
    if (!numericAttachmentId) {
      return null;
    }

    const row = await client("chat_attachments").where({ id: numericAttachmentId }).first();
    return mapAttachmentRowNullable(row);
  }

  async function repoInsertReserved(payload, options = {}) {
    const client = resolveClient(dbClient, options);
    const threadId = parsePositiveInteger(payload?.threadId);
    const uploadedByUserId = parsePositiveInteger(payload?.uploadedByUserId);
    if (!threadId || !uploadedByUserId) {
      throw new TypeError("threadId and uploadedByUserId are required.");
    }

    const now = new Date();
    const [id] = await client("chat_attachments").insert({
      thread_id: threadId,
      message_id: parsePositiveInteger(payload?.messageId),
      uploaded_by_user_id: uploadedByUserId,
      client_attachment_id: normalizeClientKey(payload?.clientAttachmentId),
      position: parsePositiveInteger(payload?.position),
      attachment_kind:
        String(payload?.attachmentKind || "")
          .trim()
          .toLowerCase() || "file",
      status: ATTACHMENT_STATUS.RESERVED,
      storage_driver:
        String(payload?.storageDriver || "")
          .trim()
          .toLowerCase() || "fs",
      storage_key: payload?.storageKey == null ? null : String(payload.storageKey),
      delivery_path: payload?.deliveryPath == null ? null : String(payload.deliveryPath),
      preview_storage_key: payload?.previewStorageKey == null ? null : String(payload.previewStorageKey),
      preview_delivery_path: payload?.previewDeliveryPath == null ? null : String(payload.previewDeliveryPath),
      mime_type: payload?.mimeType == null ? null : String(payload.mimeType),
      file_name: payload?.fileName == null ? null : String(payload.fileName),
      size_bytes: payload?.sizeBytes == null ? null : Math.max(0, Number(payload.sizeBytes || 0)),
      sha256_hex: payload?.sha256Hex == null ? null : String(payload.sha256Hex).trim().toLowerCase(),
      width: parsePositiveInteger(payload?.width),
      height: parsePositiveInteger(payload?.height),
      duration_ms: parsePositiveInteger(payload?.durationMs),
      upload_expires_at: payload?.uploadExpiresAt ? toMysqlDateTimeUtc(new Date(payload.uploadExpiresAt)) : null,
      processed_at: payload?.processedAt ? toMysqlDateTimeUtc(new Date(payload.processedAt)) : null,
      failed_reason: payload?.failedReason == null ? null : String(payload.failedReason),
      metadata_json: stringifyJsonObject(payload?.metadata),
      created_at: toMysqlDateTimeUtc(payload?.createdAt ? new Date(payload.createdAt) : now),
      updated_at: toMysqlDateTimeUtc(payload?.updatedAt ? new Date(payload.updatedAt) : now),
      deleted_at: payload?.deletedAt ? toMysqlDateTimeUtc(new Date(payload.deletedAt)) : null
    });

    return repoFindById(id, options);
  }

  async function repoFindByClientAttachmentId(threadId, uploadedByUserId, clientAttachmentId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    const numericUploadedByUserId = parsePositiveInteger(uploadedByUserId);
    const normalizedClientAttachmentId = normalizeClientKey(clientAttachmentId);
    if (!numericThreadId || !numericUploadedByUserId || !normalizedClientAttachmentId) {
      return null;
    }

    const row = await client("chat_attachments")
      .where({
        thread_id: numericThreadId,
        uploaded_by_user_id: numericUploadedByUserId,
        client_attachment_id: normalizedClientAttachmentId
      })
      .first();

    return mapAttachmentRowNullable(row);
  }

  async function repoListByMessageId(messageId, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericMessageId = parsePositiveInteger(messageId);
    if (!numericMessageId) {
      return [];
    }

    const rows = await client("chat_attachments")
      .where({ message_id: numericMessageId })
      .orderBy("position", "asc")
      .orderBy("id", "asc");

    return rows.map(mapAttachmentRowRequired);
  }

  async function repoListByMessageIds(messageIds, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedMessageIds = normalizeIdList(messageIds);
    if (normalizedMessageIds.length < 1) {
      return [];
    }

    const rows = await client("chat_attachments")
      .whereIn("message_id", normalizedMessageIds)
      .orderBy("message_id", "asc")
      .orderBy("position", "asc")
      .orderBy("id", "asc");

    return rows.map(mapAttachmentRowRequired);
  }

  async function repoListStagedByUserIdAndThreadId(threadId, userId, pagination = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericThreadId = parsePositiveInteger(threadId);
    const numericUserId = parsePositiveInteger(userId);
    if (!numericThreadId || !numericUserId) {
      return [];
    }

    const paging = normalizePagination(pagination, {
      defaultPageSize: 50,
      maxPageSize: 200
    });
    const rows = await client("chat_attachments")
      .where({
        thread_id: numericThreadId,
        uploaded_by_user_id: numericUserId
      })
      .whereNull("message_id")
      .whereIn("status", [
        ATTACHMENT_STATUS.RESERVED,
        ATTACHMENT_STATUS.UPLOADING,
        ATTACHMENT_STATUS.UPLOADED,
        ATTACHMENT_STATUS.FAILED,
        ATTACHMENT_STATUS.QUARANTINED
      ])
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .limit(paging.pageSize)
      .offset(paging.offset);

    return rows.map(mapAttachmentRowRequired);
  }

  async function repoApplyStatusTransition(attachmentId, nextStatus, allowedCurrentStatuses, patch = {}, options = {}) {
    const client = resolveClient(dbClient, options);
    const numericAttachmentId = parsePositiveInteger(attachmentId);
    if (!numericAttachmentId) {
      return null;
    }

    const normalizedNextStatus = normalizeAttachmentStatus(nextStatus);
    const normalizedAllowed = Array.isArray(allowedCurrentStatuses)
      ? allowedCurrentStatuses.map((status) => normalizeAttachmentStatus(status))
      : [];

    const dbPatch = {
      status: normalizedNextStatus,
      updated_at: toMysqlDateTimeUtc(new Date())
    };
    if (Object.hasOwn(patch, "messageId")) {
      dbPatch.message_id = parsePositiveInteger(patch.messageId);
    }
    if (Object.hasOwn(patch, "position")) {
      dbPatch.position = parsePositiveInteger(patch.position);
    }
    if (Object.hasOwn(patch, "storageDriver")) {
      dbPatch.storage_driver =
        String(patch.storageDriver || "")
          .trim()
          .toLowerCase() || "fs";
    }
    if (Object.hasOwn(patch, "storageKey")) {
      dbPatch.storage_key = patch.storageKey == null ? null : String(patch.storageKey);
    }
    if (Object.hasOwn(patch, "deliveryPath")) {
      dbPatch.delivery_path = patch.deliveryPath == null ? null : String(patch.deliveryPath);
    }
    if (Object.hasOwn(patch, "previewStorageKey")) {
      dbPatch.preview_storage_key = patch.previewStorageKey == null ? null : String(patch.previewStorageKey);
    }
    if (Object.hasOwn(patch, "previewDeliveryPath")) {
      dbPatch.preview_delivery_path = patch.previewDeliveryPath == null ? null : String(patch.previewDeliveryPath);
    }
    if (Object.hasOwn(patch, "mimeType")) {
      dbPatch.mime_type = patch.mimeType == null ? null : String(patch.mimeType);
    }
    if (Object.hasOwn(patch, "fileName")) {
      dbPatch.file_name = patch.fileName == null ? null : String(patch.fileName);
    }
    if (Object.hasOwn(patch, "sizeBytes")) {
      dbPatch.size_bytes = patch.sizeBytes == null ? null : Math.max(0, Number(patch.sizeBytes || 0));
    }
    if (Object.hasOwn(patch, "sha256Hex")) {
      dbPatch.sha256_hex = patch.sha256Hex == null ? null : String(patch.sha256Hex).trim().toLowerCase();
    }
    if (Object.hasOwn(patch, "width")) {
      dbPatch.width = parsePositiveInteger(patch.width);
    }
    if (Object.hasOwn(patch, "height")) {
      dbPatch.height = parsePositiveInteger(patch.height);
    }
    if (Object.hasOwn(patch, "durationMs")) {
      dbPatch.duration_ms = parsePositiveInteger(patch.durationMs);
    }
    if (Object.hasOwn(patch, "uploadExpiresAt")) {
      dbPatch.upload_expires_at = patch.uploadExpiresAt ? toMysqlDateTimeUtc(new Date(patch.uploadExpiresAt)) : null;
    }
    if (Object.hasOwn(patch, "processedAt")) {
      dbPatch.processed_at = patch.processedAt ? toMysqlDateTimeUtc(new Date(patch.processedAt)) : null;
    }
    if (Object.hasOwn(patch, "failedReason")) {
      dbPatch.failed_reason = patch.failedReason == null ? null : String(patch.failedReason);
    }
    if (Object.hasOwn(patch, "metadata")) {
      dbPatch.metadata_json = stringifyJsonObject(patch.metadata);
    }
    if (Object.hasOwn(patch, "deletedAt")) {
      dbPatch.deleted_at = patch.deletedAt ? toMysqlDateTimeUtc(new Date(patch.deletedAt)) : null;
    }

    const updated = await client("chat_attachments")
      .where({ id: numericAttachmentId })
      .whereIn("status", normalizedAllowed)
      .update(dbPatch);
    if (Number(updated) > 0) {
      return repoFindById(numericAttachmentId, options);
    }

    const current = await repoFindById(numericAttachmentId, options);
    if (!current) {
      return null;
    }
    if (!isAttachmentStatusTransitionAllowed(current.status, normalizedNextStatus)) {
      throw createAttachmentStateTransitionError(current.status, normalizedNextStatus);
    }

    return current;
  }

  async function repoMarkUploading(attachmentId, options = {}) {
    return repoApplyStatusTransition(
      attachmentId,
      ATTACHMENT_STATUS.UPLOADING,
      [ATTACHMENT_STATUS.RESERVED, ATTACHMENT_STATUS.FAILED],
      {},
      options
    );
  }

  async function repoMarkUploaded(attachmentId, patch = {}, options = {}) {
    return repoApplyStatusTransition(
      attachmentId,
      ATTACHMENT_STATUS.UPLOADED,
      [ATTACHMENT_STATUS.UPLOADING],
      {
        storageDriver: patch.storageDriver,
        storageKey: patch.storageKey,
        deliveryPath: patch.deliveryPath,
        previewStorageKey: patch.previewStorageKey,
        previewDeliveryPath: patch.previewDeliveryPath,
        mimeType: patch.mimeType,
        fileName: patch.fileName,
        sizeBytes: patch.sizeBytes,
        sha256Hex: patch.sha256Hex,
        width: patch.width,
        height: patch.height,
        durationMs: patch.durationMs,
        processedAt: patch.processedAt || new Date(),
        metadata: patch.metadata
      },
      options
    );
  }

  async function repoAttachToMessage(attachmentId, { messageId, position = null } = {}, options = {}) {
    return repoApplyStatusTransition(
      attachmentId,
      ATTACHMENT_STATUS.ATTACHED,
      [ATTACHMENT_STATUS.UPLOADED],
      {
        messageId,
        position,
        processedAt: new Date()
      },
      options
    );
  }

  async function repoMarkFailed(attachmentId, failedReason = null, options = {}) {
    return repoApplyStatusTransition(
      attachmentId,
      ATTACHMENT_STATUS.FAILED,
      [ATTACHMENT_STATUS.RESERVED, ATTACHMENT_STATUS.UPLOADING, ATTACHMENT_STATUS.UPLOADED],
      {
        failedReason
      },
      options
    );
  }

  async function repoMarkExpired(attachmentId, options = {}) {
    return repoApplyStatusTransition(
      attachmentId,
      ATTACHMENT_STATUS.EXPIRED,
      [
        ATTACHMENT_STATUS.RESERVED,
        ATTACHMENT_STATUS.UPLOADING,
        ATTACHMENT_STATUS.UPLOADED,
        ATTACHMENT_STATUS.FAILED,
        ATTACHMENT_STATUS.QUARANTINED
      ],
      {},
      options
    );
  }

  async function repoMarkDeleted(attachmentId, patch = {}, options = {}) {
    return repoApplyStatusTransition(
      attachmentId,
      ATTACHMENT_STATUS.DELETED,
      [
        ATTACHMENT_STATUS.RESERVED,
        ATTACHMENT_STATUS.UPLOADING,
        ATTACHMENT_STATUS.UPLOADED,
        ATTACHMENT_STATUS.ATTACHED,
        ATTACHMENT_STATUS.FAILED,
        ATTACHMENT_STATUS.QUARANTINED
      ],
      {
        storageKey: null,
        deliveryPath: null,
        previewStorageKey: null,
        previewDeliveryPath: null,
        failedReason: patch.failedReason,
        deletedAt: patch.deletedAt || new Date()
      },
      options
    );
  }

  async function repoListExpiredUnattached(now = new Date(), batchSize = 1000, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedBatchSize = normalizeBatchSize(batchSize, {
      fallback: 1000,
      max: 10_000
    });
    const threshold = toMysqlDateTimeUtc(now);
    const rows = await client("chat_attachments")
      .whereNull("message_id")
      .whereNotNull("upload_expires_at")
      .andWhere("upload_expires_at", "<", threshold)
      .whereIn("status", [
        ATTACHMENT_STATUS.RESERVED,
        ATTACHMENT_STATUS.UPLOADING,
        ATTACHMENT_STATUS.UPLOADED,
        ATTACHMENT_STATUS.FAILED,
        ATTACHMENT_STATUS.QUARANTINED,
        ATTACHMENT_STATUS.EXPIRED
      ])
      .orderBy("upload_expires_at", "asc")
      .orderBy("id", "asc")
      .limit(normalizedBatchSize);

    return rows.map(mapAttachmentRowRequired);
  }

  async function repoDeleteExpiredUnattachedBatch(now = new Date(), batchSize = 1000, options = {}) {
    const client = resolveClient(dbClient, options);
    const candidates = await repoListExpiredUnattached(now, batchSize, options);
    const ids = candidates.map((row) => row.id);
    if (ids.length < 1) {
      return 0;
    }

    const deleted = await client("chat_attachments").whereIn("id", ids).whereNull("message_id").del();
    return Number.isFinite(Number(deleted)) && Number(deleted) > 0 ? Number(deleted) : 0;
  }

  async function repoDeleteDetachedOlderThan(cutoffDate, batchSize = 1000, options = {}) {
    const client = resolveClient(dbClient, options);
    const normalizedCutoff = toMysqlDateTimeUtc(normalizeCutoffDateOrThrow(cutoffDate));
    const normalizedBatchSize = normalizeBatchSize(batchSize, {
      fallback: 1000,
      max: 10_000
    });

    const rows = await client("chat_attachments")
      .select("id")
      .whereNull("message_id")
      .whereNotNull("deleted_at")
      .andWhere("deleted_at", "<", normalizedCutoff)
      .orderBy("deleted_at", "asc")
      .orderBy("id", "asc")
      .limit(normalizedBatchSize);

    const ids = rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length < 1) {
      return 0;
    }

    const deleted = await client("chat_attachments").whereIn("id", ids).del();
    return Number.isFinite(Number(deleted)) && Number(deleted) > 0 ? Number(deleted) : 0;
  }

  async function repoTransaction(callback) {
    if (typeof dbClient.transaction === "function") {
      return dbClient.transaction(callback);
    }
    return callback(dbClient);
  }

  return {
    insertReserved: repoInsertReserved,
    findById: repoFindById,
    findByClientAttachmentId: repoFindByClientAttachmentId,
    listByMessageId: repoListByMessageId,
    listByMessageIds: repoListByMessageIds,
    listStagedByUserIdAndThreadId: repoListStagedByUserIdAndThreadId,
    markUploading: repoMarkUploading,
    markUploaded: repoMarkUploaded,
    attachToMessage: repoAttachToMessage,
    markFailed: repoMarkFailed,
    markExpired: repoMarkExpired,
    markDeleted: repoMarkDeleted,
    listExpiredUnattached: repoListExpiredUnattached,
    deleteExpiredUnattachedBatch: repoDeleteExpiredUnattachedBatch,
    deleteDetachedOlderThan: repoDeleteDetachedOlderThan,
    transaction: repoTransaction
  };
}


const __testables = {
  ALLOWED_ATTACHMENT_STATUS_TRANSITIONS,
  ATTACHMENT_STATUS,
  createAttachmentStateTransitionError,
  isAttachmentStatusTransitionAllowed,
  mapAttachmentRowRequired,
  mapAttachmentRowNullable,
  normalizeAttachmentStatus,
  createAttachmentsRepository
};


export { createAttachmentsRepository as createRepository, createAttachmentsRepository, __testables };
