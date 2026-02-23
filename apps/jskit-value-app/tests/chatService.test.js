import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../server/lib/errors.js";
import { createService as createChatService, __testables } from "../server/modules/chat/service.js";

function createChatServiceFixture(options = {}) {
  const state = {
    nextMessageId: 1,
    nextAttachmentId: 1,
    nextThreadId: 90,
    workspaceRoomByWorkspaceId: new Map(),
    workspaceRoomInsertDuplicateRemaining: Math.max(0, Number(options.workspaceRoomInsertDuplicateTimes || 0)),
    thread: {
      id: Number(options.threadId || 11),
      scopeKind: options.threadScopeKind || "global",
      workspaceId: options.threadScopeKind === "workspace" ? 19 : null,
      threadKind: "dm",
      title: null,
      participantCount: 2,
      nextMessageSeq: 1,
      lastMessageId: null,
      lastMessageSeq: null,
      lastMessageAt: null,
      lastMessagePreview: null,
      createdAt: "2026-02-22T00:00:00.000Z",
      updatedAt: "2026-02-22T00:00:00.000Z"
    },
    participantByThreadUser: new Map(),
    messages: [],
    tombstonesByKey: new Map(),
    attachmentsById: new Map(),
    attachmentStorageByKey: new Map(),
    reactionsByMessageId: new Map(),
    dmByPair: new Map(),
    realtimeEvents: [],
    actorSettings: {
      id: 10,
      userId: Number(options.actorUserId || 5),
      publicChatId: "actor_public",
      allowWorkspaceDms: true,
      allowGlobalDms: true,
      requireSharedWorkspaceForGlobalDm: false,
      discoverableByPublicChatId: true,
      createdAt: "2026-02-22T00:00:00.000Z",
      updatedAt: "2026-02-22T00:00:00.000Z"
    },
    targetSettingsByPublicChatId: new Map(),
    targetSettingsByUserId: new Map(),
    blockedPairKeys: new Set()
  };

  const actorUserId = Number(state.actorSettings.userId);
  const initialThreadId = Number(state.thread.id);
  const threadParticipant = {
    id: 1,
    threadId: initialThreadId,
    userId: actorUserId,
    participantRole: "member",
    status: "active",
    joinedAt: "2026-02-22T00:00:00.000Z",
    leftAt: null,
    removedByUserId: null,
    muteUntil: null,
    archivedAt: null,
    pinnedAt: null,
    lastDeliveredSeq: 0,
    lastDeliveredMessageId: null,
    lastReadSeq: 0,
    lastReadMessageId: null,
    lastReadAt: null,
    draftText: null,
    draftUpdatedAt: null,
    metadata: {},
    createdAt: "2026-02-22T00:00:00.000Z",
    updatedAt: "2026-02-22T00:00:00.000Z"
  };
  state.participantByThreadUser.set(`${initialThreadId}:${actorUserId}`, threadParticipant);

  const otherParticipantUserId = Number(options.otherParticipantUserId || 8);
  if (otherParticipantUserId > 0 && otherParticipantUserId !== actorUserId) {
    state.participantByThreadUser.set(`${initialThreadId}:${otherParticipantUserId}`, {
      ...threadParticipant,
      id: 2,
      userId: otherParticipantUserId
    });
  }

  function findMessageByClientMessageId(threadId, userId, clientMessageId) {
    return (
      state.messages.find(
        (message) =>
          Number(message.threadId) === Number(threadId) &&
          Number(message.senderUserId) === Number(userId) &&
          String(message.clientMessageId || "") === String(clientMessageId || "")
      ) || null
    );
  }

  function dmPairKey(userAId, userBId) {
    const left = Number(userAId);
    const right = Number(userBId);
    return left < right ? `${left}:${right}` : `${right}:${left}`;
  }

  function cloneAttachment(attachment) {
    if (!attachment) {
      return null;
    }

    return {
      ...attachment,
      metadata: attachment.metadata && typeof attachment.metadata === "object" ? { ...attachment.metadata } : {}
    };
  }

  function findAttachmentByClientAttachmentId(threadId, userId, clientAttachmentId) {
    const normalizedClientAttachmentId = String(clientAttachmentId || "").trim();
    if (!normalizedClientAttachmentId) {
      return null;
    }

    return (
      Array.from(state.attachmentsById.values()).find((attachment) => {
        return (
          Number(attachment.threadId) === Number(threadId) &&
          Number(attachment.uploadedByUserId) === Number(userId) &&
          String(attachment.clientAttachmentId || "") === normalizedClientAttachmentId
        );
      }) || null
    );
  }

  function createAttachmentTransitionError(currentStatus, nextStatus) {
    const error = new Error(`Invalid attachment status transition: ${currentStatus} -> ${nextStatus}`);
    error.code = "CHAT_ATTACHMENT_INVALID_STATUS_TRANSITION";
    error.currentStatus = currentStatus;
    error.nextStatus = nextStatus;
    return error;
  }

  const repositories = {
    chatThreadsRepository: {
      async findById(threadId) {
        if (Number(threadId) !== Number(state.thread.id)) {
          return null;
        }
        return { ...state.thread };
      },
      async findWorkspaceRoomByWorkspaceId(workspaceId, { threadKind = "workspace_room", scopeKey } = {}) {
        const entry = state.workspaceRoomByWorkspaceId.get(Number(workspaceId)) || null;
        if (!entry) {
          return null;
        }
        if (String(entry.threadKind || "") !== String(threadKind || "")) {
          return null;
        }
        if (scopeKey && String(entry.scopeKey || "") !== String(scopeKey || "")) {
          return null;
        }
        return { ...entry };
      },
      async findDmByCanonicalPair({ userAId, userBId }) {
        const threadId = state.dmByPair.get(dmPairKey(userAId, userBId));
        if (!threadId) {
          return null;
        }
        if (Number(threadId) === Number(state.thread.id)) {
          return { ...state.thread };
        }
        return {
          ...state.thread,
          id: Number(threadId)
        };
      },
      async insert(payload) {
        if (String(payload?.threadKind || "") === "workspace_room" && state.workspaceRoomInsertDuplicateRemaining > 0) {
          state.workspaceRoomInsertDuplicateRemaining -= 1;
          const error = new Error("Duplicate workspace room");
          error.errno = 1062;
          error.code = "ER_DUP_ENTRY";
          throw error;
        }

        const inserted = {
          ...state.thread,
          id: state.nextThreadId++,
          scopeKind: String(payload.scopeKind || "global"),
          workspaceId: payload.workspaceId == null ? null : Number(payload.workspaceId),
          threadKind: String(payload.threadKind || "dm"),
          createdByUserId: Number(payload.createdByUserId),
          scopeKey: String(payload.scopeKey || "global"),
          dmUserLowId: Number(payload.dmUserLowId),
          dmUserHighId: Number(payload.dmUserHighId),
          participantCount: Number(payload.participantCount || 2),
          nextMessageSeq: Number(payload.nextMessageSeq || 1),
          metadata: payload.metadata || {},
          createdAt: "2026-02-22T00:00:00.000Z",
          updatedAt: "2026-02-22T00:00:00.000Z"
        };

        if (String(inserted.threadKind || "") === "workspace_room" && Number(inserted.workspaceId) > 0) {
          state.workspaceRoomByWorkspaceId.set(Number(inserted.workspaceId), inserted);
        }
        state.thread = inserted;
        return { ...inserted };
      },
      async updateById(threadId, patch = {}) {
        if (Number(threadId) !== Number(state.thread.id)) {
          return null;
        }

        if (Object.hasOwn(patch, "participantCount")) {
          state.thread.participantCount = Number(patch.participantCount || 0);
        }
        state.thread.updatedAt = "2026-02-22T00:00:00.000Z";

        if (String(state.thread.threadKind || "") === "workspace_room" && Number(state.thread.workspaceId) > 0) {
          state.workspaceRoomByWorkspaceId.set(Number(state.thread.workspaceId), { ...state.thread });
        }

        return { ...state.thread };
      },
      async allocateNextMessageSequence(threadId) {
        if (Number(threadId) !== Number(state.thread.id)) {
          return null;
        }
        const allocated = Number(state.thread.nextMessageSeq || 1);
        state.thread.nextMessageSeq = allocated + 1;
        return allocated;
      },
      async updateLastMessageCache(threadId, patch) {
        if (Number(threadId) !== Number(state.thread.id)) {
          return null;
        }
        state.thread.lastMessageId = patch.lastMessageId == null ? null : Number(patch.lastMessageId);
        state.thread.lastMessageSeq = patch.lastMessageSeq == null ? null : Number(patch.lastMessageSeq);
        state.thread.lastMessageAt = patch.lastMessageAt || null;
        state.thread.lastMessagePreview = patch.lastMessagePreview || null;
        state.thread.updatedAt = "2026-02-22T00:00:00.000Z";
        return { ...state.thread };
      },
      async listForUser() {
        return [];
      },
      async transaction(callback) {
        return callback({ id: "trx" });
      }
    },
    chatParticipantsRepository: {
      async findByThreadIdAndUserId(threadId, userId) {
        const key = `${Number(threadId)}:${Number(userId)}`;
        const participant = state.participantByThreadUser.get(key);
        return participant ? { ...participant } : null;
      },
      async listByThreadId(threadId) {
        const numericThreadId = Number(threadId);
        return Array.from(state.participantByThreadUser.values())
          .filter((participant) => Number(participant.threadId) === numericThreadId)
          .map((participant) => ({ ...participant }));
      },
      async updateReadCursorMonotonic(threadId, userId, patch) {
        const key = `${Number(threadId)}:${Number(userId)}`;
        const participant = state.participantByThreadUser.get(key);
        if (!participant) {
          return null;
        }

        participant.lastReadSeq = Math.max(Number(participant.lastReadSeq || 0), Number(patch.lastReadSeq || 0));
        if (patch.lastReadMessageId) {
          participant.lastReadMessageId = Number(patch.lastReadMessageId);
        }
        if (patch.lastReadAt) {
          participant.lastReadAt = String(patch.lastReadAt);
        }

        state.participantByThreadUser.set(key, participant);
        return { ...participant };
      },
      async upsertDmParticipants(threadId, userIds) {
        for (const userId of userIds) {
          const key = `${Number(threadId)}:${Number(userId)}`;
          if (!state.participantByThreadUser.has(key)) {
            state.participantByThreadUser.set(key, {
              ...threadParticipant,
              id: state.participantByThreadUser.size + 1,
              threadId: Number(threadId),
              userId: Number(userId)
            });
          }
        }

        return Array.from(state.participantByThreadUser.values());
      },
      async upsertWorkspaceRoomParticipants(threadId, userIds) {
        for (const userId of userIds) {
          const key = `${Number(threadId)}:${Number(userId)}`;
          const existing = state.participantByThreadUser.get(key);
          if (existing) {
            state.participantByThreadUser.set(key, {
              ...existing,
              status: "active",
              leftAt: null,
              removedByUserId: null
            });
            continue;
          }

          state.participantByThreadUser.set(key, {
            ...threadParticipant,
            id: state.participantByThreadUser.size + 1,
            threadId: Number(threadId),
            userId: Number(userId),
            status: "active"
          });
        }

        return Array.from(state.participantByThreadUser.values()).filter(
          (participant) => Number(participant.threadId) === Number(threadId)
        );
      },
      async listActiveUserIdsByThreadId(threadId) {
        const numericThreadId = Number(threadId);
        return Array.from(state.participantByThreadUser.values())
          .filter((participant) => {
            return Number(participant.threadId) === numericThreadId && String(participant.status || "") === "active";
          })
          .map((participant) => Number(participant.userId))
          .filter((userId) => Number.isInteger(userId) && userId > 0);
      }
    },
    chatMessagesRepository: {
      async findByClientMessageId(threadId, senderUserId, clientMessageId) {
        const found = findMessageByClientMessageId(threadId, senderUserId, clientMessageId);
        return found ? { ...found } : null;
      },
      async insert(payload) {
        const inserted = {
          id: state.nextMessageId++,
          threadId: Number(payload.threadId),
          threadSeq: Number(payload.threadSeq),
          senderUserId: Number(payload.senderUserId),
          clientMessageId: payload.clientMessageId || null,
          idempotencyPayloadVersion: payload.idempotencyPayloadVersion || null,
          idempotencyPayloadSha256: payload.idempotencyPayloadSha256 || null,
          messageKind: payload.messageKind || "text",
          replyToMessageId: payload.replyToMessageId == null ? null : Number(payload.replyToMessageId),
          textContent: payload.textContent == null ? null : String(payload.textContent),
          metadata: payload.metadata || {},
          sentAt: "2026-02-22T00:00:00.000Z",
          editedAt: null,
          deletedAt: null,
          createdAt: "2026-02-22T00:00:00.000Z",
          updatedAt: "2026-02-22T00:00:00.000Z"
        };

        state.messages.push(inserted);
        return { ...inserted };
      },
      async findById(messageId) {
        const found = state.messages.find((message) => Number(message.id) === Number(messageId)) || null;
        return found ? { ...found } : null;
      },
      async listByThreadIdBeforeSeq(threadId, beforeSeq, limit = 50) {
        const rows = state.messages
          .filter(
            (message) => Number(message.threadId) === Number(threadId) && Number(message.threadSeq) < Number(beforeSeq)
          )
          .sort((left, right) => Number(right.threadSeq) - Number(left.threadSeq))
          .slice(0, Number(limit));

        return rows.map((row) => ({ ...row }));
      }
    },
    chatAttachmentsRepository: {
      async insertReserved(payload) {
        const existing = findAttachmentByClientAttachmentId(
          payload.threadId,
          payload.uploadedByUserId,
          payload.clientAttachmentId
        );
        if (existing) {
          const error = new Error("Duplicate attachment client key.");
          error.errno = 1062;
          error.code = "ER_DUP_ENTRY";
          error.sqlMessage = "Duplicate entry for key uq_chat_attachments_thread_user_client_attachment_id";
          throw error;
        }

        const inserted = {
          id: state.nextAttachmentId++,
          threadId: Number(payload.threadId),
          messageId: payload.messageId == null ? null : Number(payload.messageId),
          uploadedByUserId: Number(payload.uploadedByUserId),
          clientAttachmentId: String(payload.clientAttachmentId || ""),
          position: payload.position == null ? null : Number(payload.position),
          attachmentKind: String(payload.attachmentKind || "file"),
          status: "reserved",
          storageDriver: String(payload.storageDriver || "fs"),
          storageKey: payload.storageKey || null,
          deliveryPath: payload.deliveryPath || null,
          previewStorageKey: payload.previewStorageKey || null,
          previewDeliveryPath: payload.previewDeliveryPath || null,
          mimeType: payload.mimeType || null,
          fileName: payload.fileName || null,
          sizeBytes: payload.sizeBytes == null ? null : Number(payload.sizeBytes),
          sha256Hex: payload.sha256Hex || null,
          width: payload.width == null ? null : Number(payload.width),
          height: payload.height == null ? null : Number(payload.height),
          durationMs: payload.durationMs == null ? null : Number(payload.durationMs),
          uploadExpiresAt: payload.uploadExpiresAt || null,
          processedAt: payload.processedAt || null,
          failedReason: payload.failedReason || null,
          metadata: payload.metadata && typeof payload.metadata === "object" ? { ...payload.metadata } : {},
          createdAt: "2026-02-22T00:00:00.000Z",
          updatedAt: "2026-02-22T00:00:00.000Z",
          deletedAt: payload.deletedAt || null
        };

        state.attachmentsById.set(inserted.id, inserted);
        return cloneAttachment(inserted);
      },
      async findByClientAttachmentId(threadId, userId, clientAttachmentId) {
        return cloneAttachment(findAttachmentByClientAttachmentId(threadId, userId, clientAttachmentId));
      },
      async findById(attachmentId) {
        const found = state.attachmentsById.get(Number(attachmentId));
        return cloneAttachment(found);
      },
      async markUploading(attachmentId) {
        const attachment = state.attachmentsById.get(Number(attachmentId));
        if (!attachment) {
          return null;
        }

        const currentStatus = String(attachment.status || "");
        if (currentStatus !== "reserved" && currentStatus !== "failed") {
          throw createAttachmentTransitionError(currentStatus, "uploading");
        }

        attachment.status = "uploading";
        attachment.updatedAt = "2026-02-22T00:00:00.000Z";
        return cloneAttachment(attachment);
      },
      async markUploaded(attachmentId, patch) {
        const attachment = state.attachmentsById.get(Number(attachmentId));
        if (!attachment) {
          return null;
        }

        const currentStatus = String(attachment.status || "");
        if (currentStatus !== "uploading") {
          throw createAttachmentTransitionError(currentStatus, "uploaded");
        }

        attachment.status = "uploaded";
        attachment.storageDriver = patch.storageDriver || attachment.storageDriver;
        attachment.storageKey = patch.storageKey || null;
        attachment.deliveryPath = patch.deliveryPath || null;
        attachment.previewStorageKey = patch.previewStorageKey || null;
        attachment.previewDeliveryPath = patch.previewDeliveryPath || null;
        attachment.mimeType = patch.mimeType || attachment.mimeType;
        attachment.fileName = patch.fileName || attachment.fileName;
        attachment.sizeBytes = patch.sizeBytes == null ? attachment.sizeBytes : Number(patch.sizeBytes);
        attachment.sha256Hex = patch.sha256Hex || null;
        attachment.processedAt = "2026-02-22T00:00:00.000Z";
        attachment.updatedAt = "2026-02-22T00:00:00.000Z";
        return cloneAttachment(attachment);
      },
      async markFailed(attachmentId, failedReason) {
        const attachment = state.attachmentsById.get(Number(attachmentId));
        if (!attachment) {
          return null;
        }

        const currentStatus = String(attachment.status || "");
        if (currentStatus !== "reserved" && currentStatus !== "uploading" && currentStatus !== "uploaded") {
          throw createAttachmentTransitionError(currentStatus, "failed");
        }

        attachment.status = "failed";
        attachment.failedReason = failedReason ? String(failedReason) : null;
        attachment.updatedAt = "2026-02-22T00:00:00.000Z";
        return cloneAttachment(attachment);
      },
      async markDeleted(attachmentId, patch = {}) {
        const attachment = state.attachmentsById.get(Number(attachmentId));
        if (!attachment) {
          return null;
        }

        const currentStatus = String(attachment.status || "");
        if (!["reserved", "uploading", "uploaded", "attached", "failed", "quarantined"].includes(currentStatus)) {
          throw createAttachmentTransitionError(currentStatus, "deleted");
        }

        attachment.status = "deleted";
        attachment.storageKey = null;
        attachment.deliveryPath = null;
        attachment.previewStorageKey = null;
        attachment.previewDeliveryPath = null;
        attachment.deletedAt = patch.deletedAt || "2026-02-22T00:00:00.000Z";
        attachment.updatedAt = "2026-02-22T00:00:00.000Z";
        return cloneAttachment(attachment);
      },
      async attachToMessage(attachmentId, patch) {
        const attachment = state.attachmentsById.get(Number(attachmentId));
        if (!attachment) {
          return null;
        }

        attachment.messageId = Number(patch.messageId);
        attachment.position = Number(patch.position);
        attachment.status = "attached";
        return cloneAttachment(attachment);
      },
      async listByMessageId(messageId) {
        return Array.from(state.attachmentsById.values())
          .filter((attachment) => Number(attachment.messageId) === Number(messageId))
          .sort((left, right) => Number(left.position || 0) - Number(right.position || 0))
          .map(cloneAttachment);
      },
      async listByMessageIds(messageIds) {
        const idSet = new Set((Array.isArray(messageIds) ? messageIds : []).map((value) => Number(value)));
        return Array.from(state.attachmentsById.values())
          .filter((attachment) => idSet.has(Number(attachment.messageId)))
          .sort((left, right) => Number(left.id) - Number(right.id))
          .map(cloneAttachment);
      }
    },
    chatReactionsRepository: {
      async addReaction({ messageId, userId, reaction }) {
        const rows = state.reactionsByMessageId.get(Number(messageId)) || [];
        if (!rows.some((row) => Number(row.userId) === Number(userId) && String(row.reaction) === String(reaction))) {
          rows.push({
            id: rows.length + 1,
            messageId: Number(messageId),
            threadId: Number(state.thread.id),
            userId: Number(userId),
            reaction: String(reaction),
            createdAt: "2026-02-22T00:00:00.000Z"
          });
        }
        state.reactionsByMessageId.set(Number(messageId), rows);
        return rows[0] || null;
      },
      async removeReaction({ messageId, userId, reaction }) {
        const rows = state.reactionsByMessageId.get(Number(messageId)) || [];
        const filtered = rows.filter(
          (row) => !(Number(row.userId) === Number(userId) && String(row.reaction) === String(reaction))
        );
        state.reactionsByMessageId.set(Number(messageId), filtered);
        return rows.length - filtered.length;
      },
      async listByMessageIds(messageIds) {
        const idSet = new Set((Array.isArray(messageIds) ? messageIds : []).map((value) => Number(value)));
        const rows = [];
        for (const [messageId, reactions] of state.reactionsByMessageId.entries()) {
          if (!idSet.has(Number(messageId))) {
            continue;
          }

          rows.push(...reactions.map((reaction) => ({ ...reaction })));
        }

        return rows;
      }
    },
    chatIdempotencyTombstonesRepository: {
      async findByClientMessageId(threadId, senderUserId, clientMessageId) {
        const key = `${Number(threadId)}:${Number(senderUserId)}:${String(clientMessageId || "")}`;
        const tombstone = state.tombstonesByKey.get(key);
        return tombstone ? { ...tombstone } : null;
      }
    },
    chatUserSettingsRepository: {
      async ensureForUserId(userId) {
        if (Number(userId) === Number(state.actorSettings.userId)) {
          return { ...state.actorSettings };
        }
        return {
          ...state.actorSettings,
          id: 999,
          userId: Number(userId),
          publicChatId: null
        };
      },
      async findByUserId(userId) {
        const numericUserId = Number(userId);
        if (numericUserId === Number(state.actorSettings.userId)) {
          return { ...state.actorSettings };
        }

        const direct = state.targetSettingsByUserId.get(numericUserId);
        if (direct) {
          return { ...direct };
        }

        for (const target of state.targetSettingsByPublicChatId.values()) {
          if (Number(target?.userId) === numericUserId) {
            return { ...target };
          }
        }

        return null;
      },
      async findByPublicChatId(publicChatId) {
        const normalized = String(publicChatId || "")
          .trim()
          .toLowerCase();
        const target = state.targetSettingsByPublicChatId.get(normalized);
        return target ? { ...target } : null;
      }
    },
    chatBlocksRepository: {
      async isBlockedEitherDirection(userAId, userBId) {
        const key = dmPairKey(userAId, userBId);
        return state.blockedPairKeys.has(key);
      }
    },
    workspaceMembershipsRepository: {
      async listByUserId() {
        if (Array.isArray(options.workspaceMembershipsForSharedCheck)) {
          return options.workspaceMembershipsForSharedCheck;
        }
        return [];
      },
      async listActiveByWorkspaceId(workspaceId) {
        const byWorkspaceId = options.workspaceMembersByWorkspaceId;
        if (!(byWorkspaceId instanceof Map)) {
          return [];
        }
        return byWorkspaceId.get(Number(workspaceId)) || [];
      },
      async findByWorkspaceIdAndUserId(workspaceId, userId) {
        if (typeof options.findWorkspaceMembershipByWorkspaceIdAndUserId === "function") {
          return options.findWorkspaceMembershipByWorkspaceIdAndUserId(workspaceId, userId);
        }
        return null;
      }
    },
    userSettingsRepository: {
      async findByUserId() {
        return {
          lastActiveWorkspaceId: options.lastActiveWorkspaceId == null ? null : Number(options.lastActiveWorkspaceId)
        };
      }
    }
  };

  const chatAttachmentStorageService = options.chatAttachmentStorageService || {
    driver: "fs",
    async saveAttachment({ attachmentId, buffer }) {
      const storageKey = `chat/attachments/${Number(attachmentId)}/${Date.now()}`;
      state.attachmentStorageByKey.set(storageKey, Buffer.from(buffer));
      return {
        storageKey
      };
    },
    async readAttachment(storageKey) {
      const buffer = state.attachmentStorageByKey.get(String(storageKey || ""));
      return buffer ? Buffer.from(buffer) : null;
    },
    async deleteAttachment(storageKey) {
      state.attachmentStorageByKey.delete(String(storageKey || ""));
    }
  };

  const chatRealtimeService = options.chatRealtimeService || {
    publishThreadEvent(payload) {
      state.realtimeEvents.push({
        kind: "thread",
        payload
      });
      return payload;
    },
    publishMessageEvent(payload) {
      state.realtimeEvents.push({
        kind: "message",
        payload
      });
      return payload;
    },
    publishReadCursorUpdated(payload) {
      state.realtimeEvents.push({
        kind: "read",
        payload
      });
      return payload;
    },
    publishReactionUpdated(payload) {
      state.realtimeEvents.push({
        kind: "reaction",
        payload
      });
      return payload;
    },
    publishAttachmentUpdated(payload) {
      state.realtimeEvents.push({
        kind: "attachment",
        payload
      });
      return payload;
    },
    emitTyping(payload) {
      state.realtimeEvents.push({
        kind: "typing",
        payload
      });
      return payload;
    }
  };

  const service = createChatService({
    ...repositories,
    chatRealtimeService,
    chatAttachmentStorageService,
    rbacManifest: {
      version: 1,
      defaultInviteRole: null,
      roles: {
        owner: {
          assignable: false,
          permissions: ["*"]
        }
      },
      collaborationEnabled: false,
      assignableRoleIds: []
    },
    config: {
      chatEnabled: options.chatEnabled !== false,
      chatGlobalDmsEnabled: options.chatGlobalDmsEnabled !== false,
      chatWorkspaceThreadsEnabled: options.chatWorkspaceThreadsEnabled === true,
      chatGlobalDmsRequireSharedWorkspace: options.chatGlobalDmsRequireSharedWorkspace === true,
      chatMessageMaxTextChars: 4000,
      chatMessagesPageSizeMax: 100,
      chatThreadsPageSizeMax: 50,
      chatAttachmentsEnabled: options.chatAttachmentsEnabled !== false,
      chatAttachmentsMaxFilesPerMessage: 5,
      chatAttachmentMaxUploadBytes: options.chatAttachmentMaxUploadBytes || 20_000_000,
      chatUnattachedUploadRetentionHours: options.chatUnattachedUploadRetentionHours || 24,
      chatTypingRateLimit: options.chatTypingRateLimit,
      chatTypingRateWindowMs: options.chatTypingRateWindowMs,
      chatTypingThrottleMs: options.chatTypingThrottleMs,
      chatTypingTtlMs: options.chatTypingTtlMs
    }
  });

  return {
    service,
    state
  };
}

test("sendThreadMessage replays identical idempotent payload and rejects conflicting payloads", async () => {
  const { service } = createChatServiceFixture();
  const user = {
    id: 5
  };

  const first = await service.sendThreadMessage({
    user,
    threadId: 11,
    surfaceId: "app",
    payload: {
      clientMessageId: "cm_1",
      text: "hello"
    }
  });

  assert.equal(first.idempotencyStatus, "created");
  assert.equal(first.message.clientMessageId, "cm_1");

  const replay = await service.sendThreadMessage({
    user,
    threadId: 11,
    surfaceId: "app",
    payload: {
      clientMessageId: "cm_1",
      text: "hello"
    }
  });

  assert.equal(replay.idempotencyStatus, "replayed");
  assert.equal(replay.message.id, first.message.id);

  await assert.rejects(
    () =>
      service.sendThreadMessage({
        user,
        threadId: 11,
        surfaceId: "app",
        payload: {
          clientMessageId: "cm_1",
          text: "different"
        }
      }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.details?.code, "CHAT_IDEMPOTENCY_CONFLICT");
      return true;
    }
  );
});

test("mapThreadForResponse normalizes missing participant nullable fields to null", () => {
  const mapped = __testables.mapThreadForResponse(
    {
      id: 11,
      scopeKind: "global",
      workspaceId: null,
      threadKind: "dm",
      title: null,
      participantCount: 2,
      lastMessageId: null,
      lastMessageSeq: null,
      lastMessageAt: null,
      lastMessagePreview: null,
      createdAt: "2026-02-22T00:00:00.000Z",
      updatedAt: "2026-02-22T00:00:00.000Z"
    },
    {
      status: "active",
      lastReadSeq: 0,
      lastReadMessageId: null
    }
  );

  assert.equal(mapped.participant.status, "active");
  assert.equal(mapped.participant.lastReadSeq, 0);
  assert.equal(mapped.participant.lastReadMessageId, null);
  assert.equal(mapped.participant.lastReadAt, null);
  assert.equal(mapped.participant.mutedUntil, null);
  assert.equal(mapped.participant.archivedAt, null);
  assert.equal(mapped.participant.pinnedAt, null);
});

test("sendThreadMessage returns CHAT_MESSAGE_RETRY_BLOCKED for matching tombstone", async () => {
  const { service, state } = createChatServiceFixture();
  const user = {
    id: 5
  };

  const fingerprint = __testables.buildMessageIdempotencyFingerprint({
    text: "hello",
    attachmentIds: [],
    replyToMessageId: null,
    metadata: {}
  });

  state.tombstonesByKey.set("11:5:cm_retry", {
    id: 1,
    threadId: 11,
    senderUserId: 5,
    clientMessageId: "cm_retry",
    idempotencyPayloadVersion: fingerprint.version,
    idempotencyPayloadSha256: fingerprint.sha256,
    originalMessageId: 3,
    deletedAt: "2026-02-22T00:00:00.000Z",
    expiresAt: "2026-03-22T00:00:00.000Z",
    deleteReason: "retention",
    metadata: {},
    createdAt: "2026-02-22T00:00:00.000Z",
    updatedAt: "2026-02-22T00:00:00.000Z"
  });

  await assert.rejects(
    () =>
      service.sendThreadMessage({
        user,
        threadId: 11,
        surfaceId: "app",
        payload: {
          clientMessageId: "cm_retry",
          text: "hello"
        }
      }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.details?.code, "CHAT_MESSAGE_RETRY_BLOCKED");
      return true;
    }
  );
});

test("ensureDm keeps anti-enumeration behavior for unknown and blocked targets", async () => {
  const { service, state } = createChatServiceFixture({
    chatGlobalDmsRequireSharedWorkspace: false
  });

  const user = {
    id: 5
  };

  await assert.rejects(
    () =>
      service.ensureDm({
        user,
        targetPublicChatId: "missing_target"
      }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.details?.code, "CHAT_DM_TARGET_UNAVAILABLE");
      return true;
    }
  );

  state.targetSettingsByPublicChatId.set("target_public", {
    id: 22,
    userId: 8,
    publicChatId: "target_public",
    allowWorkspaceDms: true,
    allowGlobalDms: true,
    requireSharedWorkspaceForGlobalDm: false,
    discoverableByPublicChatId: true,
    createdAt: "2026-02-22T00:00:00.000Z",
    updatedAt: "2026-02-22T00:00:00.000Z"
  });
  state.blockedPairKeys.add("5:8");

  await assert.rejects(
    () =>
      service.ensureDm({
        user,
        targetPublicChatId: "target_public"
      }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.details?.code, "CHAT_DM_TARGET_UNAVAILABLE");
      return true;
    }
  );
});

test("listDmCandidates returns discoverable shared-workspace users and supports search filtering", async () => {
  const { service, state } = createChatServiceFixture({
    chatGlobalDmsRequireSharedWorkspace: true,
    workspaceMembershipsForSharedCheck: [
      {
        workspaceId: 19,
        status: "active"
      },
      {
        workspaceId: 21,
        status: "active"
      }
    ],
    workspaceMembersByWorkspaceId: new Map([
      [
        19,
        [
          { userId: 5, status: "active" },
          { userId: 8, status: "active" },
          { userId: 12, status: "active" }
        ]
      ],
      [
        21,
        [
          { userId: 5, status: "active" },
          { userId: 8, status: "active" }
        ]
      ]
    ])
  });

  state.targetSettingsByUserId.set(8, {
    id: 18,
    userId: 8,
    publicChatId: "u8",
    allowWorkspaceDms: true,
    allowGlobalDms: true,
    requireSharedWorkspaceForGlobalDm: true,
    discoverableByPublicChatId: true,
    createdAt: "2026-02-22T00:00:00.000Z",
    updatedAt: "2026-02-22T00:00:00.000Z"
  });
  state.targetSettingsByUserId.set(12, {
    id: 22,
    userId: 12,
    publicChatId: "u12",
    allowWorkspaceDms: true,
    allowGlobalDms: false,
    requireSharedWorkspaceForGlobalDm: true,
    discoverableByPublicChatId: true,
    createdAt: "2026-02-22T00:00:00.000Z",
    updatedAt: "2026-02-22T00:00:00.000Z"
  });

  const result = await service.listDmCandidates({
    user: { id: 5 },
    query: {
      q: "u8",
      limit: 10
    }
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].userId, 8);
  assert.equal(result.items[0].publicChatId, "u8");
  assert.equal(result.items[0].sharedWorkspaceCount, 2);
});

test("listDmCandidates does not require actor allowGlobalDms to discover eligible targets", async () => {
  const { service, state } = createChatServiceFixture({
    chatGlobalDmsRequireSharedWorkspace: true,
    workspaceMembershipsForSharedCheck: [
      {
        workspaceId: 19,
        status: "active"
      }
    ],
    workspaceMembersByWorkspaceId: new Map([
      [
        19,
        [
          { userId: 5, status: "active" },
          { userId: 8, status: "active" }
        ]
      ]
    ])
  });

  state.actorSettings.allowGlobalDms = false;
  state.actorSettings.discoverableByPublicChatId = false;

  state.targetSettingsByUserId.set(8, {
    id: 18,
    userId: 8,
    publicChatId: "u8",
    allowWorkspaceDms: true,
    allowGlobalDms: true,
    requireSharedWorkspaceForGlobalDm: true,
    discoverableByPublicChatId: true,
    createdAt: "2026-02-22T00:00:00.000Z",
    updatedAt: "2026-02-22T00:00:00.000Z"
  });

  const result = await service.listDmCandidates({
    user: { id: 5 },
    query: {
      q: "u8",
      limit: 10
    }
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].userId, 8);
  assert.equal(result.items[0].publicChatId, "u8");
});

test("ensureDm allows actor with allowGlobalDms disabled when target permits global DMs", async () => {
  const { service, state } = createChatServiceFixture({
    chatGlobalDmsRequireSharedWorkspace: false
  });

  state.actorSettings.allowGlobalDms = false;
  state.actorSettings.discoverableByPublicChatId = false;

  state.targetSettingsByPublicChatId.set("target_public", {
    id: 22,
    userId: 8,
    publicChatId: "target_public",
    allowWorkspaceDms: true,
    allowGlobalDms: true,
    requireSharedWorkspaceForGlobalDm: false,
    discoverableByPublicChatId: true,
    createdAt: "2026-02-22T00:00:00.000Z",
    updatedAt: "2026-02-22T00:00:00.000Z"
  });

  const result = await service.ensureDm({
    user: {
      id: 5
    },
    targetPublicChatId: "target_public"
  });

  assert.equal(Number(result.thread?.id) > 0, true);
  assert.equal(Boolean(result.thread?.peerUser), true);
});

test("ensureWorkspaceRoom creates canonical workspace room and syncs active workspace members", async () => {
  const { service, state } = createChatServiceFixture({
    chatWorkspaceThreadsEnabled: true,
    lastActiveWorkspaceId: 19,
    workspaceMembersByWorkspaceId: new Map([
      [
        19,
        [
          { userId: 5, status: "active" },
          { userId: 8, status: "active" }
        ]
      ]
    ]),
    findWorkspaceMembershipByWorkspaceIdAndUserId(workspaceId, userId) {
      if (Number(workspaceId) === 19 && Number(userId) === 5) {
        return {
          workspaceId: 19,
          userId: 5,
          roleId: "owner",
          status: "active"
        };
      }
      return null;
    }
  });

  const result = await service.ensureWorkspaceRoom({
    user: {
      id: 5
    }
  });

  assert.equal(result.created, true);
  assert.equal(result.thread.scopeKind, "workspace");
  assert.equal(result.thread.threadKind, "workspace_room");
  assert.equal(result.thread.workspaceId, 19);
  assert.equal(Number(result.thread.participantCount) >= 2, true);
  assert.ok(state.participantByThreadUser.has(`${Number(result.thread.id)}:8`));
});

test("ensureWorkspaceRoom reuses existing canonical workspace room on subsequent calls", async () => {
  const { service } = createChatServiceFixture({
    chatWorkspaceThreadsEnabled: true,
    lastActiveWorkspaceId: 19,
    workspaceMembersByWorkspaceId: new Map([
      [
        19,
        [
          { userId: 5, status: "active" },
          { userId: 8, status: "active" }
        ]
      ]
    ]),
    findWorkspaceMembershipByWorkspaceIdAndUserId(workspaceId, userId) {
      if (Number(workspaceId) === 19 && Number(userId) === 5) {
        return {
          workspaceId: 19,
          userId: 5,
          roleId: "owner",
          status: "active"
        };
      }
      return null;
    }
  });

  const first = await service.ensureWorkspaceRoom({
    user: {
      id: 5
    }
  });
  const second = await service.ensureWorkspaceRoom({
    user: {
      id: 5
    }
  });

  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.thread.id, first.thread.id);
});

test("ensureWorkspaceRoom is duplicate-safe when another request creates room concurrently", async () => {
  const { service, state } = createChatServiceFixture({
    chatWorkspaceThreadsEnabled: true,
    lastActiveWorkspaceId: 19,
    workspaceRoomInsertDuplicateTimes: 1,
    workspaceMembersByWorkspaceId: new Map([
      [
        19,
        [
          { userId: 5, status: "active" },
          { userId: 8, status: "active" }
        ]
      ]
    ]),
    findWorkspaceMembershipByWorkspaceIdAndUserId(workspaceId, userId) {
      if (Number(workspaceId) === 19 && Number(userId) === 5) {
        return {
          workspaceId: 19,
          userId: 5,
          roleId: "owner",
          status: "active"
        };
      }
      return null;
    }
  });

  const racedThread = {
    ...state.thread,
    id: 501,
    scopeKind: "workspace",
    workspaceId: 19,
    threadKind: "workspace_room",
    scopeKey: "workspace:19:room",
    participantCount: 2
  };
  state.workspaceRoomByWorkspaceId.set(19, racedThread);
  state.thread = racedThread;
  state.participantByThreadUser.set("501:5", {
    ...state.participantByThreadUser.get("11:5"),
    id: 10,
    threadId: 501,
    userId: 5
  });

  const result = await service.ensureWorkspaceRoom({
    user: {
      id: 5
    }
  });

  assert.equal(result.created, false);
  assert.equal(result.thread.id, 501);
});

test("sendThreadMessage remains successful when realtime publish fails post-commit", async () => {
  const { service } = createChatServiceFixture({
    chatRealtimeService: {
      publishThreadEvent() {
        return null;
      },
      publishMessageEvent() {
        throw new Error("realtime down");
      },
      publishReadCursorUpdated() {
        return null;
      },
      publishReactionUpdated() {
        return null;
      },
      emitTyping() {
        return null;
      }
    }
  });

  const result = await service.sendThreadMessage({
    user: {
      id: 5
    },
    threadId: 11,
    surfaceId: "app",
    payload: {
      clientMessageId: "cm_realtime_failure",
      text: "hello"
    }
  });

  assert.equal(result.idempotencyStatus, "created");
  assert.equal(result.message.clientMessageId, "cm_realtime_failure");
});

test("reserveThreadAttachment replays identical payload and rejects metadata conflicts", async () => {
  const { service } = createChatServiceFixture();
  const user = { id: 5 };

  const first = await service.reserveThreadAttachment({
    user,
    threadId: 11,
    surfaceId: "app",
    payload: {
      clientAttachmentId: "ca_1",
      fileName: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      kind: "file",
      metadata: {
        source: "composer"
      }
    }
  });
  assert.equal(first.attachment.clientAttachmentId, "ca_1");

  const replay = await service.reserveThreadAttachment({
    user,
    threadId: 11,
    surfaceId: "app",
    payload: {
      clientAttachmentId: "ca_1",
      fileName: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      kind: "file",
      metadata: {
        source: "composer"
      }
    }
  });
  assert.equal(replay.attachment.id, first.attachment.id);

  await assert.rejects(
    () =>
      service.reserveThreadAttachment({
        user,
        threadId: 11,
        surfaceId: "app",
        payload: {
          clientAttachmentId: "ca_1",
          fileName: "other.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
          kind: "file",
          metadata: {
            source: "composer"
          }
        }
      }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.details?.code, "CHAT_ATTACHMENT_CONFLICT");
      return true;
    }
  );
});

test("uploadThreadAttachment returns CHAT_ATTACHMENT_UPLOAD_IN_PROGRESS for uploading rows", async () => {
  const { service, state } = createChatServiceFixture();
  const user = { id: 5 };

  const reserved = await service.reserveThreadAttachment({
    user,
    threadId: 11,
    surfaceId: "app",
    payload: {
      clientAttachmentId: "ca_uploading",
      fileName: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 5
    }
  });

  const attachment = state.attachmentsById.get(Number(reserved.attachment.id));
  attachment.status = "uploading";

  await assert.rejects(
    () =>
      service.uploadThreadAttachment({
        user,
        threadId: 11,
        surfaceId: "app",
        attachmentId: reserved.attachment.id,
        payload: {
          fileBuffer: Buffer.from("hello"),
          uploadFileName: "note.txt",
          uploadMimeType: "text/plain"
        }
      }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.details?.code, "CHAT_ATTACHMENT_UPLOAD_IN_PROGRESS");
      return true;
    }
  );
});

test("uploadThreadAttachment replays same bytes and rejects conflicting bytes for the same attachment", async () => {
  const { service } = createChatServiceFixture();
  const user = { id: 5 };

  const reserved = await service.reserveThreadAttachment({
    user,
    threadId: 11,
    surfaceId: "app",
    payload: {
      clientAttachmentId: "ca_upload",
      fileName: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 5
    }
  });

  const first = await service.uploadThreadAttachment({
    user,
    threadId: 11,
    surfaceId: "app",
    attachmentId: reserved.attachment.id,
    payload: {
      fileBuffer: Buffer.from("hello"),
      uploadFileName: "note.txt",
      uploadMimeType: "text/plain"
    }
  });
  assert.equal(first.attachment.status, "uploaded");

  const replay = await service.uploadThreadAttachment({
    user,
    threadId: 11,
    surfaceId: "app",
    attachmentId: reserved.attachment.id,
    payload: {
      fileBuffer: Buffer.from("hello"),
      uploadFileName: "note.txt",
      uploadMimeType: "text/plain"
    }
  });
  assert.equal(replay.attachment.id, first.attachment.id);

  await assert.rejects(
    () =>
      service.uploadThreadAttachment({
        user,
        threadId: 11,
        surfaceId: "app",
        attachmentId: reserved.attachment.id,
        payload: {
          fileBuffer: Buffer.from("jello"),
          uploadFileName: "note.txt",
          uploadMimeType: "text/plain"
        }
      }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.details?.code, "CHAT_ATTACHMENT_CONFLICT");
      return true;
    }
  );
});

test("getAttachmentContent restricts staged access to uploader and allows attached thread participants", async () => {
  const { service, state } = createChatServiceFixture({
    otherParticipantUserId: 8
  });

  const reserved = await service.reserveThreadAttachment({
    user: { id: 5 },
    threadId: 11,
    surfaceId: "app",
    payload: {
      clientAttachmentId: "ca_content",
      fileName: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 5
    }
  });

  await service.uploadThreadAttachment({
    user: { id: 5 },
    threadId: 11,
    surfaceId: "app",
    attachmentId: reserved.attachment.id,
    payload: {
      fileBuffer: Buffer.from("hello"),
      uploadFileName: "note.txt",
      uploadMimeType: "text/plain"
    }
  });

  const uploaderResult = await service.getAttachmentContent({
    user: { id: 5 },
    attachmentId: reserved.attachment.id,
    surfaceId: "app"
  });
  assert.equal(Buffer.isBuffer(uploaderResult.contentBuffer), true);
  assert.equal(uploaderResult.contentBuffer.toString("utf8"), "hello");

  await assert.rejects(
    () =>
      service.getAttachmentContent({
        user: { id: 8 },
        attachmentId: reserved.attachment.id,
        surfaceId: "app"
      }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 404);
      assert.equal(error.details?.code, "CHAT_ATTACHMENT_NOT_FOUND");
      return true;
    }
  );

  const attachment = state.attachmentsById.get(Number(reserved.attachment.id));
  attachment.status = "attached";
  attachment.messageId = 1;

  const participantResult = await service.getAttachmentContent({
    user: { id: 8 },
    attachmentId: reserved.attachment.id,
    surfaceId: "app"
  });
  assert.equal(participantResult.contentBuffer.toString("utf8"), "hello");
});

test("deleteThreadAttachment clears staged storage and rejects attached attachments", async () => {
  const { service, state } = createChatServiceFixture();
  const user = { id: 5 };

  const reserved = await service.reserveThreadAttachment({
    user,
    threadId: 11,
    surfaceId: "app",
    payload: {
      clientAttachmentId: "ca_delete",
      fileName: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 5
    }
  });

  await service.uploadThreadAttachment({
    user,
    threadId: 11,
    surfaceId: "app",
    attachmentId: reserved.attachment.id,
    payload: {
      fileBuffer: Buffer.from("hello"),
      uploadFileName: "note.txt",
      uploadMimeType: "text/plain"
    }
  });

  const beforeDeleteKeys = Array.from(state.attachmentStorageByKey.keys());
  assert.equal(beforeDeleteKeys.length > 0, true);

  await service.deleteThreadAttachment({
    user,
    threadId: 11,
    surfaceId: "app",
    attachmentId: reserved.attachment.id
  });

  assert.equal(state.attachmentStorageByKey.size, 0);
  assert.equal(state.attachmentsById.get(Number(reserved.attachment.id))?.status, "deleted");

  const attachedReserved = await service.reserveThreadAttachment({
    user,
    threadId: 11,
    surfaceId: "app",
    payload: {
      clientAttachmentId: "ca_delete_attached",
      fileName: "note.txt",
      mimeType: "text/plain",
      sizeBytes: 5
    }
  });
  await service.uploadThreadAttachment({
    user,
    threadId: 11,
    surfaceId: "app",
    attachmentId: attachedReserved.attachment.id,
    payload: {
      fileBuffer: Buffer.from("hello"),
      uploadFileName: "note.txt",
      uploadMimeType: "text/plain"
    }
  });

  const attached = state.attachmentsById.get(Number(attachedReserved.attachment.id));
  attached.status = "attached";
  attached.messageId = 2;

  await assert.rejects(
    () =>
      service.deleteThreadAttachment({
        user,
        threadId: 11,
        surfaceId: "app",
        attachmentId: attachedReserved.attachment.id
      }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 409);
      assert.equal(error.details?.code, "CHAT_ATTACHMENT_CONFLICT");
      return true;
    }
  );
});

test("emitThreadTyping excludes actor and applies throttle plus ttl stop emit", async () => {
  const { service, state } = createChatServiceFixture({
    chatTypingThrottleMs: 1000,
    chatTypingTtlMs: 70,
    chatTypingRateLimit: 30
  });

  const first = await service.emitThreadTyping({
    user: {
      id: 5
    },
    threadId: 11,
    surfaceId: "app"
  });

  const second = await service.emitThreadTyping({
    user: {
      id: 5
    },
    threadId: 11,
    surfaceId: "app"
  });

  assert.equal(first.accepted, true);
  assert.equal(typeof first.expiresAt, "string");
  assert.equal(second.accepted, true);
  assert.equal(typeof second.expiresAt, "string");

  const typingEvents = state.realtimeEvents.filter((event) => event.kind === "typing");
  assert.equal(typingEvents.length, 1);
  assert.equal(typingEvents[0].payload.state, "started");
  assert.deepEqual(typingEvents[0].payload.targetUserIds, [8]);

  await new Promise((resolve) => {
    setTimeout(resolve, 180);
  });

  const typingEventsAfterTtl = state.realtimeEvents.filter((event) => event.kind === "typing");
  assert.equal(typingEventsAfterTtl.length, 2);
  assert.equal(typingEventsAfterTtl[1].payload.state, "stopped");
  assert.deepEqual(typingEventsAfterTtl[1].payload.targetUserIds, [8]);
});

test("emitThreadTyping enforces service-level rate limiting per user/thread", async () => {
  const { service } = createChatServiceFixture({
    chatTypingRateLimit: 2,
    chatTypingRateWindowMs: 60_000,
    chatTypingTtlMs: 1000
  });

  await service.emitThreadTyping({
    user: {
      id: 5
    },
    threadId: 11,
    surfaceId: "app"
  });
  await service.emitThreadTyping({
    user: {
      id: 5
    },
    threadId: 11,
    surfaceId: "app"
  });

  await assert.rejects(
    () =>
      service.emitThreadTyping({
        user: {
          id: 5
        },
        threadId: 11,
        surfaceId: "app"
      }),
    (error) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.statusCode, 429);
      assert.equal(error.details?.code, "CHAT_RATE_LIMITED");
      return true;
    }
  );
});
