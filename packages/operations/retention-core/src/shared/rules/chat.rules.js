const HOUR_IN_MILLISECONDS = 60 * 60 * 1000;
const MAX_BATCH_ITERATIONS = 50_000;

function resolveTombstoneExpiryDate(nowDate, retryWindowHours) {
  return new Date(nowDate.getTime() + retryWindowHours * HOUR_IN_MILLISECONDS);
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

function normalizeThreadIdList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

function createTombstoneWriteError(candidate, reason) {
  const error = new Error(`Chat message tombstone write failed for message ${Number(candidate?.id || 0)}.`);
  error.code = "CHAT_RETENTION_TOMBSTONE_WRITE_FAILED";
  error.reason = String(reason || "unknown");
  error.messageId = Number(candidate?.id || 0);
  error.threadId = Number(candidate?.threadId || 0);
  error.senderUserId = Number(candidate?.senderUserId || 0);
  error.clientMessageId = candidate?.clientMessageId == null ? null : String(candidate.clientMessageId);
  return error;
}

function ensureChatRetentionRepositories({
  chatThreadsRepository,
  chatParticipantsRepository,
  chatMessagesRepository,
  chatIdempotencyTombstonesRepository,
  chatAttachmentsRepository
}) {
  if (!chatThreadsRepository || typeof chatThreadsRepository.updateLastMessageCache !== "function") {
    throw new Error("chatThreadsRepository.updateLastMessageCache is required.");
  }
  if (typeof chatThreadsRepository.deleteWithoutMessagesOlderThan !== "function") {
    throw new Error("chatThreadsRepository.deleteWithoutMessagesOlderThan is required.");
  }
  if (!chatParticipantsRepository || typeof chatParticipantsRepository.repairPointersForThread !== "function") {
    throw new Error("chatParticipantsRepository.repairPointersForThread is required.");
  }
  if (!chatMessagesRepository || typeof chatMessagesRepository.listRetentionCandidatesOlderThan !== "function") {
    throw new Error("chatMessagesRepository.listRetentionCandidatesOlderThan is required.");
  }
  if (typeof chatMessagesRepository.deleteByIds !== "function") {
    throw new Error("chatMessagesRepository.deleteByIds is required.");
  }
  if (typeof chatMessagesRepository.findLatestByThreadId !== "function") {
    throw new Error("chatMessagesRepository.findLatestByThreadId is required.");
  }
  if (typeof chatMessagesRepository.transaction !== "function") {
    throw new Error("chatMessagesRepository.transaction is required.");
  }
  if (
    !chatIdempotencyTombstonesRepository ||
    typeof chatIdempotencyTombstonesRepository.insertForDeletedMessage !== "function"
  ) {
    throw new Error("chatIdempotencyTombstonesRepository.insertForDeletedMessage is required.");
  }
  if (typeof chatIdempotencyTombstonesRepository.deleteExpiredBatch !== "function") {
    throw new Error("chatIdempotencyTombstonesRepository.deleteExpiredBatch is required.");
  }
  if (!chatAttachmentsRepository || typeof chatAttachmentsRepository.deleteExpiredUnattachedBatch !== "function") {
    throw new Error("chatAttachmentsRepository.deleteExpiredUnattachedBatch is required.");
  }
  if (typeof chatAttachmentsRepository.deleteDetachedOlderThan !== "function") {
    throw new Error("chatAttachmentsRepository.deleteDetachedOlderThan is required.");
  }
}

async function repairThreadCacheAndParticipantPointers(
  threadIds,
  {
    chatThreadsRepository,
    chatParticipantsRepository,
    chatMessagesRepository
  },
  options = {}
) {
  const normalizedThreadIds = normalizeThreadIdList(threadIds);
  if (normalizedThreadIds.length < 1) {
    return;
  }

  for (const threadId of normalizedThreadIds) {
    const latestMessage = await chatMessagesRepository.findLatestByThreadId(threadId, options);
    if (latestMessage) {
      await chatThreadsRepository.updateLastMessageCache(
        threadId,
        {
          lastMessageId: latestMessage.id,
          lastMessageSeq: latestMessage.threadSeq,
          lastMessageAt: latestMessage.sentAt,
          lastMessagePreview: buildPreviewText(latestMessage.textContent)
        },
        options
      );
    } else {
      await chatThreadsRepository.updateLastMessageCache(
        threadId,
        {
          lastMessageId: null,
          lastMessageSeq: null,
          lastMessageAt: null,
          lastMessagePreview: null
        },
        options
      );
    }

    await chatParticipantsRepository.repairPointersForThread(
      threadId,
      {
        lastMessageSeq: latestMessage ? latestMessage.threadSeq : null
      },
      options
    );
  }
}

async function runChatMessageRetention({
  cutoffDate,
  batchSize,
  nowDate,
  retentionConfig,
  repositories
}) {
  const {
    chatThreadsRepository,
    chatParticipantsRepository,
    chatMessagesRepository,
    chatIdempotencyTombstonesRepository
  } = repositories;

  let totalDeletedRows = 0;
  let batches = 0;

  for (let index = 0; index < MAX_BATCH_ITERATIONS; index += 1) {
    const batch = await chatMessagesRepository.transaction(async (trx) => {
      const scopedOptions = { trx };
      const candidates = await chatMessagesRepository.listRetentionCandidatesOlderThan(cutoffDate, batchSize, {
        ...scopedOptions,
        selectionMode: "tombstone-eligible-only"
      });

      if (!Array.isArray(candidates) || candidates.length < 1) {
        return {
          candidateCount: 0,
          deletedRows: 0
        };
      }

      const tombstoneExpiresAt = resolveTombstoneExpiryDate(
        nowDate,
        Number(retentionConfig.chatMessageIdempotencyRetryWindowHours || 72)
      );
      const deletableMessageIds = [];

      for (const candidate of candidates) {
        const clientMessageId = candidate?.clientMessageId == null ? null : String(candidate.clientMessageId);
        if (clientMessageId) {
          const tombstone = await chatIdempotencyTombstonesRepository.insertForDeletedMessage(
            {
              threadId: candidate.threadId,
              senderUserId: candidate.senderUserId,
              clientMessageId,
              idempotencyPayloadVersion: candidate.idempotencyPayloadVersion,
              idempotencyPayloadSha256: candidate.idempotencyPayloadSha256,
              originalMessageId: candidate.id,
              deletedAt: nowDate,
              expiresAt: tombstoneExpiresAt,
              deleteReason: "retention",
              metadata: {}
            },
            scopedOptions
          );

          if (!tombstone || tombstone.ok !== true) {
            throw createTombstoneWriteError(candidate, tombstone?.reason || "unknown");
          }
        }

        deletableMessageIds.push(candidate.id);
      }

      const deletedRows = await chatMessagesRepository.deleteByIds(deletableMessageIds, scopedOptions);
      if (deletedRows > 0) {
        await repairThreadCacheAndParticipantPointers(
          candidates.map((candidate) => candidate.threadId),
          {
            chatThreadsRepository,
            chatParticipantsRepository,
            chatMessagesRepository
          },
          scopedOptions
        );
      }

      return {
        candidateCount: candidates.length,
        deletedRows
      };
    });

    if (batch.candidateCount < 1) {
      break;
    }

    const normalizedDeletedRows =
      Number.isFinite(Number(batch.deletedRows)) && Number(batch.deletedRows) > 0 ? Number(batch.deletedRows) : 0;

    totalDeletedRows += normalizedDeletedRows;
    if (normalizedDeletedRows > 0) {
      batches += 1;
    }

    if (batch.candidateCount < batchSize || normalizedDeletedRows < 1) {
      break;
    }
  }

  return {
    totalDeletedRows,
    batches
  };
}

function createChatRetentionRules(
  {
    chatThreadsRepository,
    chatParticipantsRepository,
    chatMessagesRepository,
    chatIdempotencyTombstonesRepository,
    chatAttachmentsRepository
  },
  { chatEmptyThreadCleanupEnabled = false } = {}
) {
  ensureChatRetentionRepositories({
    chatThreadsRepository,
    chatParticipantsRepository,
    chatMessagesRepository,
    chatIdempotencyTombstonesRepository,
    chatAttachmentsRepository
  });

  const repositories = {
    chatThreadsRepository,
    chatParticipantsRepository,
    chatMessagesRepository,
    chatIdempotencyTombstonesRepository,
    chatAttachmentsRepository
  };

  const rules = [
    {
      id: "chat_unattached_uploads",
      resolveRetentionDays({ retentionConfig }) {
        const retentionHours = Number(retentionConfig.chatUnattachedUploadsRetentionHours || 24);
        return Math.max(1, Math.ceil(retentionHours / 24));
      },
      async deleteBatch({ nowDate, batchSize }) {
        return chatAttachmentsRepository.deleteExpiredUnattachedBatch(nowDate, batchSize);
      }
    },
    {
      id: "chat_detached_attachments",
      retentionConfigKey: "chatAttachmentsRetentionDays",
      async deleteBatch({ cutoffDate, batchSize }) {
        return chatAttachmentsRepository.deleteDetachedOlderThan(cutoffDate, batchSize);
      }
    },
    {
      id: "chat_messages",
      retentionConfigKey: "chatMessagesRetentionDays",
      async execute({ cutoffDate, batchSize, nowDate, retentionConfig }) {
        return runChatMessageRetention({
          cutoffDate,
          batchSize,
          nowDate,
          retentionConfig,
          repositories
        });
      }
    },
    {
      id: "chat_message_idempotency_tombstones",
      resolveRetentionDays({ retentionConfig }) {
        const retryWindowHours = Number(retentionConfig.chatMessageIdempotencyRetryWindowHours || 72);
        return Math.max(1, Math.ceil(retryWindowHours / 24));
      },
      async deleteBatch({ nowDate, batchSize }) {
        return chatIdempotencyTombstonesRepository.deleteExpiredBatch(nowDate, batchSize);
      }
    }
  ];

  if (chatEmptyThreadCleanupEnabled) {
    rules.push({
      id: "chat_empty_threads",
      retentionConfigKey: "chatMessagesRetentionDays",
      async deleteBatch({ cutoffDate, batchSize }) {
        return chatThreadsRepository.deleteWithoutMessagesOlderThan(cutoffDate, batchSize);
      }
    });
  }

  return rules;
}

const __testables = {
  HOUR_IN_MILLISECONDS,
  MAX_BATCH_ITERATIONS,
  resolveTombstoneExpiryDate,
  buildPreviewText,
  normalizeThreadIdList,
  createTombstoneWriteError,
  runChatMessageRetention
};

export { createChatRetentionRules, __testables };
