import { parsePositiveInteger } from "../../../lib/primitives/integers.js";
import { normalizeBatchSize as normalizeRetentionBatchSize } from "../../../lib/primitives/retention.js";

const DEFAULT_ERROR_LOG_RETENTION_DAYS = 30;
const DEFAULT_INVITE_ARTIFACT_RETENTION_DAYS = 90;
const DEFAULT_SECURITY_AUDIT_RETENTION_DAYS = 365;
const DEFAULT_AI_TRANSCRIPTS_RETENTION_DAYS = 60;
const DEFAULT_BILLING_IDEMPOTENCY_RETENTION_DAYS = 30;
const DEFAULT_BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS = 30;
const DEFAULT_CHAT_MESSAGES_RETENTION_DAYS = 365;
const DEFAULT_CHAT_ATTACHMENTS_RETENTION_DAYS = 365;
const DEFAULT_CHAT_UNATTACHED_UPLOAD_RETENTION_HOURS = 24;
const DEFAULT_CHAT_MESSAGE_IDEMPOTENCY_RETRY_WINDOW_HOURS = 72;
const DEFAULT_CHAT_EMPTY_THREAD_CLEANUP_ENABLED = false;
const DEFAULT_RETENTION_BATCH_SIZE = 1000;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const HOUR_IN_MILLISECONDS = 60 * 60 * 1000;
const MAX_BATCH_ITERATIONS = 50_000;

function normalizeRetentionDays(value, fallbackValue) {
  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    return fallbackValue;
  }

  return Math.min(parsed, 3650);
}

function normalizeRetentionHours(value, fallbackValue) {
  const parsed = parsePositiveInteger(value);
  if (!parsed) {
    return fallbackValue;
  }

  return Math.min(parsed, 24 * 3650);
}

function normalizeBoolean(value, fallbackValue = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value == null) {
    return fallbackValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return fallbackValue;
  }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallbackValue;
}

function normalizeBatchSize(value) {
  return normalizeRetentionBatchSize(value, {
    fallback: DEFAULT_RETENTION_BATCH_SIZE,
    max: 10_000
  });
}

function normalizeDateOrThrow(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError("Invalid current time.");
  }

  return parsed;
}

function resolveCutoff(nowDate, retentionDays) {
  return new Date(nowDate.getTime() - retentionDays * DAY_IN_MILLISECONDS);
}

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
    new Set(values.map((value) => parsePositiveInteger(value)).filter((value) => Number.isInteger(value) && value > 0))
  );
}

function resolveRetentionConfig(config = {}) {
  return {
    errorLogRetentionDays: normalizeRetentionDays(config.errorLogRetentionDays, DEFAULT_ERROR_LOG_RETENTION_DAYS),
    inviteArtifactRetentionDays: normalizeRetentionDays(
      config.inviteArtifactRetentionDays,
      DEFAULT_INVITE_ARTIFACT_RETENTION_DAYS
    ),
    securityAuditRetentionDays: normalizeRetentionDays(
      config.securityAuditRetentionDays,
      DEFAULT_SECURITY_AUDIT_RETENTION_DAYS
    ),
    aiTranscriptsRetentionDays: normalizeRetentionDays(
      config.aiTranscriptsRetentionDays,
      DEFAULT_AI_TRANSCRIPTS_RETENTION_DAYS
    ),
    billingIdempotencyRetentionDays: normalizeRetentionDays(
      config.billingIdempotencyRetentionDays,
      DEFAULT_BILLING_IDEMPOTENCY_RETENTION_DAYS
    ),
    billingWebhookPayloadRetentionDays: normalizeRetentionDays(
      config.billingWebhookPayloadRetentionDays,
      DEFAULT_BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS
    ),
    chatMessagesRetentionDays: normalizeRetentionDays(
      config.chatMessagesRetentionDays,
      DEFAULT_CHAT_MESSAGES_RETENTION_DAYS
    ),
    chatAttachmentsRetentionDays: normalizeRetentionDays(
      config.chatAttachmentsRetentionDays,
      DEFAULT_CHAT_ATTACHMENTS_RETENTION_DAYS
    ),
    chatUnattachedUploadsRetentionHours: normalizeRetentionHours(
      config.chatUnattachedUploadsRetentionHours,
      DEFAULT_CHAT_UNATTACHED_UPLOAD_RETENTION_HOURS
    ),
    chatMessageIdempotencyRetryWindowHours: normalizeRetentionHours(
      config.chatMessageIdempotencyRetryWindowHours,
      DEFAULT_CHAT_MESSAGE_IDEMPOTENCY_RETRY_WINDOW_HOURS
    ),
    chatEmptyThreadCleanupEnabled: normalizeBoolean(
      config.chatEmptyThreadCleanupEnabled,
      DEFAULT_CHAT_EMPTY_THREAD_CLEANUP_ENABLED
    ),
    batchSize: normalizeBatchSize(config.batchSize)
  };
}

async function runBatchedDeletion({ deleteBatch, cutoffDate, batchSize }) {
  let totalDeletedRows = 0;
  let batches = 0;

  for (let index = 0; index < MAX_BATCH_ITERATIONS; index += 1) {
    const deletedRows = Number(await deleteBatch(cutoffDate, batchSize));
    const normalizedDeletedRows = Number.isFinite(deletedRows) && deletedRows > 0 ? deletedRows : 0;
    if (normalizedDeletedRows < 1) {
      break;
    }

    totalDeletedRows += normalizedDeletedRows;
    batches += 1;
    if (normalizedDeletedRows < batchSize) {
      break;
    }
  }

  return {
    totalDeletedRows,
    batches
  };
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

function createService({
  consoleErrorLogsRepository,
  workspaceInvitesRepository,
  consoleInvitesRepository,
  auditEventsRepository,
  aiTranscriptConversationsRepository,
  aiTranscriptMessagesRepository,
  chatThreadsRepository,
  chatParticipantsRepository,
  chatMessagesRepository,
  chatIdempotencyTombstonesRepository,
  chatAttachmentsRepository,
  billingRepository = null,
  retentionConfig,
  now = () => new Date()
}) {
  if (
    !consoleErrorLogsRepository ||
    !workspaceInvitesRepository ||
    !consoleInvitesRepository ||
    !auditEventsRepository ||
    !aiTranscriptConversationsRepository ||
    !aiTranscriptMessagesRepository ||
    !chatThreadsRepository ||
    !chatParticipantsRepository ||
    !chatMessagesRepository ||
    !chatIdempotencyTombstonesRepository ||
    !chatAttachmentsRepository
  ) {
    throw new Error("retention repositories are required.");
  }
  if (
    typeof consoleErrorLogsRepository.deleteBrowserErrorsOlderThan !== "function" ||
    typeof consoleErrorLogsRepository.deleteServerErrorsOlderThan !== "function"
  ) {
    throw new Error("consoleErrorLogsRepository retention methods are required.");
  }
  if (typeof workspaceInvitesRepository.deleteArtifactsOlderThan !== "function") {
    throw new Error("workspaceInvitesRepository.deleteArtifactsOlderThan is required.");
  }
  if (typeof consoleInvitesRepository.deleteArtifactsOlderThan !== "function") {
    throw new Error("consoleInvitesRepository.deleteArtifactsOlderThan is required.");
  }
  if (typeof auditEventsRepository.deleteOlderThan !== "function") {
    throw new Error("auditEventsRepository.deleteOlderThan is required.");
  }
  if (typeof aiTranscriptConversationsRepository.deleteWithoutMessagesOlderThan !== "function") {
    throw new Error("aiTranscriptConversationsRepository.deleteWithoutMessagesOlderThan is required.");
  }
  if (typeof aiTranscriptMessagesRepository.deleteOlderThan !== "function") {
    throw new Error("aiTranscriptMessagesRepository.deleteOlderThan is required.");
  }
  if (typeof chatThreadsRepository.updateLastMessageCache !== "function") {
    throw new Error("chatThreadsRepository.updateLastMessageCache is required.");
  }
  if (typeof chatThreadsRepository.deleteWithoutMessagesOlderThan !== "function") {
    throw new Error("chatThreadsRepository.deleteWithoutMessagesOlderThan is required.");
  }
  if (typeof chatParticipantsRepository.repairPointersForThread !== "function") {
    throw new Error("chatParticipantsRepository.repairPointersForThread is required.");
  }
  if (typeof chatMessagesRepository.listRetentionCandidatesOlderThan !== "function") {
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
  if (typeof chatIdempotencyTombstonesRepository.insertForDeletedMessage !== "function") {
    throw new Error("chatIdempotencyTombstonesRepository.insertForDeletedMessage is required.");
  }
  if (typeof chatIdempotencyTombstonesRepository.deleteExpiredBatch !== "function") {
    throw new Error("chatIdempotencyTombstonesRepository.deleteExpiredBatch is required.");
  }
  if (typeof chatAttachmentsRepository.deleteExpiredUnattachedBatch !== "function") {
    throw new Error("chatAttachmentsRepository.deleteExpiredUnattachedBatch is required.");
  }
  if (typeof chatAttachmentsRepository.deleteDetachedOlderThan !== "function") {
    throw new Error("chatAttachmentsRepository.deleteDetachedOlderThan is required.");
  }
  if (billingRepository) {
    if (typeof billingRepository.deleteTerminalIdempotencyOlderThan !== "function") {
      throw new Error("billingRepository.deleteTerminalIdempotencyOlderThan is required.");
    }
    if (typeof billingRepository.scrubWebhookPayloadsPastRetention !== "function") {
      throw new Error("billingRepository.scrubWebhookPayloadsPastRetention is required.");
    }
  }

  const config = resolveRetentionConfig(retentionConfig);

  async function repairThreadCacheAndParticipantPointers(threadIds, options = {}) {
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

  async function runChatMessageRetention(cutoffDate, batchSize, nowDate) {
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

        const tombstoneExpiresAt = resolveTombstoneExpiryDate(nowDate, config.chatMessageIdempotencyRetryWindowHours);
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
        Number.isFinite(Number(batch.deletedRows)) && Number(batch.deletedRows) > 0 ? batch.deletedRows : 0;
      totalDeletedRows += normalizedDeletedRows;
      if (normalizedDeletedRows > 0) {
        batches += 1;
      }

      if (batch.candidateCount < batchSize) {
        break;
      }
      if (normalizedDeletedRows < 1) {
        break;
      }
    }

    return {
      totalDeletedRows,
      batches
    };
  }

  async function runSweep({ dryRun = false, logger } = {}) {
    const nowDate = normalizeDateOrThrow(now());
    const rules = [
      {
        key: "console_browser_errors",
        retentionDays: config.errorLogRetentionDays,
        deleteBatch: (cutoffDate, batchSize) =>
          consoleErrorLogsRepository.deleteBrowserErrorsOlderThan(cutoffDate, batchSize)
      },
      {
        key: "console_server_errors",
        retentionDays: config.errorLogRetentionDays,
        deleteBatch: (cutoffDate, batchSize) =>
          consoleErrorLogsRepository.deleteServerErrorsOlderThan(cutoffDate, batchSize)
      },
      {
        key: "workspace_invites",
        retentionDays: config.inviteArtifactRetentionDays,
        deleteBatch: (cutoffDate, batchSize) =>
          workspaceInvitesRepository.deleteArtifactsOlderThan(cutoffDate, batchSize)
      },
      {
        key: "console_invites",
        retentionDays: config.inviteArtifactRetentionDays,
        deleteBatch: (cutoffDate, batchSize) => consoleInvitesRepository.deleteArtifactsOlderThan(cutoffDate, batchSize)
      },
      {
        key: "security_audit_events",
        retentionDays: config.securityAuditRetentionDays,
        deleteBatch: (cutoffDate, batchSize) => auditEventsRepository.deleteOlderThan(cutoffDate, batchSize)
      },
      {
        key: "ai_messages",
        retentionDays: config.aiTranscriptsRetentionDays,
        deleteBatch: (cutoffDate, batchSize) => aiTranscriptMessagesRepository.deleteOlderThan(cutoffDate, batchSize)
      },
      {
        key: "ai_conversations",
        retentionDays: config.aiTranscriptsRetentionDays,
        deleteBatch: (cutoffDate, batchSize) =>
          aiTranscriptConversationsRepository.deleteWithoutMessagesOlderThan(cutoffDate, batchSize)
      },
      {
        key: "chat_unattached_uploads",
        retentionDays: Math.max(1, Math.ceil(config.chatUnattachedUploadsRetentionHours / 24)),
        deleteBatch: (_cutoffDate, batchSize) =>
          chatAttachmentsRepository.deleteExpiredUnattachedBatch(nowDate, batchSize)
      },
      {
        key: "chat_detached_attachments",
        retentionDays: config.chatAttachmentsRetentionDays,
        deleteBatch: (cutoffDate, batchSize) => chatAttachmentsRepository.deleteDetachedOlderThan(cutoffDate, batchSize)
      },
      {
        key: "chat_messages",
        retentionDays: config.chatMessagesRetentionDays,
        execute: ({ cutoffDate, batchSize }) => runChatMessageRetention(cutoffDate, batchSize, nowDate)
      },
      {
        key: "chat_message_idempotency_tombstones",
        retentionDays: Math.max(1, Math.ceil(config.chatMessageIdempotencyRetryWindowHours / 24)),
        deleteBatch: (_cutoffDate, batchSize) =>
          chatIdempotencyTombstonesRepository.deleteExpiredBatch(nowDate, batchSize)
      }
    ];

    if (config.chatEmptyThreadCleanupEnabled) {
      rules.push({
        key: "chat_empty_threads",
        retentionDays: config.chatMessagesRetentionDays,
        deleteBatch: (cutoffDate, batchSize) =>
          chatThreadsRepository.deleteWithoutMessagesOlderThan(cutoffDate, batchSize)
      });
    }

    if (billingRepository) {
      rules.push({
        key: "billing_idempotency_requests",
        retentionDays: config.billingIdempotencyRetentionDays,
        deleteBatch: (cutoffDate, batchSize) =>
          billingRepository.deleteTerminalIdempotencyOlderThan(cutoffDate, batchSize)
      });
      rules.push({
        key: "billing_webhook_payloads",
        retentionDays: config.billingWebhookPayloadRetentionDays,
        deleteBatch: (_cutoffDate, batchSize) =>
          billingRepository.scrubWebhookPayloadsPastRetention({
            now: nowDate,
            batchSize
          })
      });
    }

    const sweepSummary = [];
    for (const rule of rules) {
      const cutoffDate = resolveCutoff(nowDate, rule.retentionDays);
      if (dryRun) {
        sweepSummary.push({
          table: rule.key,
          retentionDays: rule.retentionDays,
          cutoffDate: cutoffDate.toISOString(),
          deletedRows: 0,
          batches: 0,
          dryRun: true
        });
        continue;
      }

      const deletion = rule.execute
        ? await rule.execute({
            cutoffDate,
            batchSize: config.batchSize,
            nowDate
          })
        : await runBatchedDeletion({
            deleteBatch: rule.deleteBatch,
            cutoffDate,
            batchSize: config.batchSize
          });
      sweepSummary.push({
        table: rule.key,
        retentionDays: rule.retentionDays,
        cutoffDate: cutoffDate.toISOString(),
        deletedRows: deletion.totalDeletedRows,
        batches: deletion.batches,
        dryRun: false
      });
    }

    const totalDeletedRows = sweepSummary.reduce(
      (count, ruleSummary) => count + Number(ruleSummary.deletedRows || 0),
      0
    );
    const result = {
      executedAt: nowDate.toISOString(),
      dryRun: Boolean(dryRun),
      batchSize: config.batchSize,
      totalDeletedRows,
      rules: sweepSummary
    };

    if (logger && typeof logger.info === "function") {
      logger.info(result, "retention.sweep.completed");
    }

    return result;
  }

  return {
    runSweep
  };
}

const __testables = {
  DEFAULT_ERROR_LOG_RETENTION_DAYS,
  DEFAULT_INVITE_ARTIFACT_RETENTION_DAYS,
  DEFAULT_SECURITY_AUDIT_RETENTION_DAYS,
  DEFAULT_AI_TRANSCRIPTS_RETENTION_DAYS,
  DEFAULT_BILLING_IDEMPOTENCY_RETENTION_DAYS,
  DEFAULT_BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS,
  DEFAULT_CHAT_MESSAGES_RETENTION_DAYS,
  DEFAULT_CHAT_ATTACHMENTS_RETENTION_DAYS,
  DEFAULT_CHAT_UNATTACHED_UPLOAD_RETENTION_HOURS,
  DEFAULT_CHAT_MESSAGE_IDEMPOTENCY_RETRY_WINDOW_HOURS,
  DEFAULT_CHAT_EMPTY_THREAD_CLEANUP_ENABLED,
  DEFAULT_RETENTION_BATCH_SIZE,
  DAY_IN_MILLISECONDS,
  HOUR_IN_MILLISECONDS,
  normalizeRetentionDays,
  normalizeRetentionHours,
  normalizeBoolean,
  normalizeBatchSize,
  normalizeDateOrThrow,
  resolveCutoff,
  resolveTombstoneExpiryDate,
  buildPreviewText,
  normalizeThreadIdList,
  resolveRetentionConfig,
  runBatchedDeletion,
  createTombstoneWriteError
};

export { createService, __testables };
