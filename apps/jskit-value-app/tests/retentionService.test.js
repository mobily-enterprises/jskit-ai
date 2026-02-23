import assert from "node:assert/strict";
import test from "node:test";

import { createService as createRetentionService, __testables } from "../server/domain/operations/services/retention.service.js";

function createDeque(values) {
  const queue = Array.isArray(values) ? [...values] : [];
  return () => {
    if (queue.length < 1) {
      return 0;
    }
    return queue.shift();
  };
}

function createBaseRepositories(overrides = {}) {
  const repositories = {
    consoleErrorLogsRepository: {
      async deleteBrowserErrorsOlderThan() {
        return 0;
      },
      async deleteServerErrorsOlderThan() {
        return 0;
      }
    },
    workspaceInvitesRepository: {
      async deleteArtifactsOlderThan() {
        return 0;
      }
    },
    consoleInvitesRepository: {
      async deleteArtifactsOlderThan() {
        return 0;
      }
    },
    auditEventsRepository: {
      async deleteOlderThan() {
        return 0;
      }
    },
    aiTranscriptMessagesRepository: {
      async deleteOlderThan() {
        return 0;
      }
    },
    aiTranscriptConversationsRepository: {
      async deleteWithoutMessagesOlderThan() {
        return 0;
      }
    },
    chatThreadsRepository: {
      async updateLastMessageCache() {
        return null;
      },
      async deleteWithoutMessagesOlderThan() {
        return 0;
      }
    },
    chatParticipantsRepository: {
      async repairPointersForThread() {
        return 0;
      }
    },
    chatMessagesRepository: {
      async listRetentionCandidatesOlderThan() {
        return [];
      },
      async deleteByIds() {
        return 0;
      },
      async findLatestByThreadId() {
        return null;
      },
      async transaction(callback) {
        return callback({});
      }
    },
    chatIdempotencyTombstonesRepository: {
      async insertForDeletedMessage() {
        return {
          ok: true,
          created: true,
          tombstone: {}
        };
      },
      async deleteExpiredBatch() {
        return 0;
      }
    },
    chatAttachmentsRepository: {
      async deleteExpiredUnattachedBatch() {
        return 0;
      },
      async deleteDetachedOlderThan() {
        return 0;
      }
    }
  };

  return {
    ...repositories,
    ...overrides
  };
}

test("retention service runs batched retention sweep across base and chat tables", async () => {
  const calls = {
    browser: [],
    server: [],
    workspaceInvites: [],
    consoleInvites: [],
    auditEvents: [],
    aiMessages: [],
    aiConversations: [],
    chatUnattachedUploads: [],
    chatDetachedAttachments: [],
    chatMessageCandidates: [],
    chatMessageDeletes: [],
    chatTombstoneWrites: [],
    chatTombstoneExpiryDeletes: [],
    chatThreadCacheUpdates: [],
    chatParticipantRepairs: []
  };
  const browserDeletes = createDeque([1000, 5]);
  const serverDeletes = createDeque([0]);
  const workspaceDeletes = createDeque([1000, 1000, 1]);
  const consoleDeletes = createDeque([2]);
  const auditDeletes = createDeque([0]);
  const aiMessageDeletes = createDeque([700, 25]);
  const aiConversationDeletes = createDeque([8, 0]);
  const chatUnattachedDeletes = createDeque([5]);
  const chatDetachedDeletes = createDeque([1]);
  const chatTombstoneDeletes = createDeque([3]);
  const chatMessageCandidates = createDeque([
    [
      {
        id: 801,
        threadId: 91,
        senderUserId: 77,
        clientMessageId: "cm-801",
        idempotencyPayloadVersion: 1,
        idempotencyPayloadSha256: "abc801",
        createdAt: "2026-02-01T00:00:00.000Z"
      }
    ]
  ]);

  const service = createRetentionService({
    ...createBaseRepositories({
      consoleErrorLogsRepository: {
        async deleteBrowserErrorsOlderThan(cutoffDate, batchSize) {
          calls.browser.push({ cutoffDate, batchSize });
          return browserDeletes();
        },
        async deleteServerErrorsOlderThan(cutoffDate, batchSize) {
          calls.server.push({ cutoffDate, batchSize });
          return serverDeletes();
        }
      },
      workspaceInvitesRepository: {
        async deleteArtifactsOlderThan(cutoffDate, batchSize) {
          calls.workspaceInvites.push({ cutoffDate, batchSize });
          return workspaceDeletes();
        }
      },
      consoleInvitesRepository: {
        async deleteArtifactsOlderThan(cutoffDate, batchSize) {
          calls.consoleInvites.push({ cutoffDate, batchSize });
          return consoleDeletes();
        }
      },
      auditEventsRepository: {
        async deleteOlderThan(cutoffDate, batchSize) {
          calls.auditEvents.push({ cutoffDate, batchSize });
          return auditDeletes();
        }
      },
      aiTranscriptMessagesRepository: {
        async deleteOlderThan(cutoffDate, batchSize) {
          calls.aiMessages.push({ cutoffDate, batchSize });
          return aiMessageDeletes();
        }
      },
      aiTranscriptConversationsRepository: {
        async deleteWithoutMessagesOlderThan(cutoffDate, batchSize) {
          calls.aiConversations.push({ cutoffDate, batchSize });
          return aiConversationDeletes();
        }
      },
      chatAttachmentsRepository: {
        async deleteExpiredUnattachedBatch(nowDate, batchSize) {
          calls.chatUnattachedUploads.push({ nowDate, batchSize });
          return chatUnattachedDeletes();
        },
        async deleteDetachedOlderThan(cutoffDate, batchSize) {
          calls.chatDetachedAttachments.push({ cutoffDate, batchSize });
          return chatDetachedDeletes();
        }
      },
      chatMessagesRepository: {
        async listRetentionCandidatesOlderThan(cutoffDate, batchSize, options) {
          calls.chatMessageCandidates.push({ cutoffDate, batchSize, options });
          return chatMessageCandidates();
        },
        async deleteByIds(messageIds) {
          calls.chatMessageDeletes.push([...messageIds]);
          return messageIds.length;
        },
        async findLatestByThreadId() {
          return null;
        },
        async transaction(callback) {
          return callback({ id: "trx" });
        }
      },
      chatIdempotencyTombstonesRepository: {
        async insertForDeletedMessage(payload) {
          calls.chatTombstoneWrites.push(payload);
          return {
            ok: true,
            created: true,
            tombstone: { id: 1 }
          };
        },
        async deleteExpiredBatch(nowDate, batchSize) {
          calls.chatTombstoneExpiryDeletes.push({ nowDate, batchSize });
          return chatTombstoneDeletes();
        }
      },
      chatThreadsRepository: {
        async updateLastMessageCache(threadId, patch) {
          calls.chatThreadCacheUpdates.push({ threadId, patch });
          return null;
        },
        async deleteWithoutMessagesOlderThan() {
          return 0;
        }
      },
      chatParticipantsRepository: {
        async repairPointersForThread(threadId, payload) {
          calls.chatParticipantRepairs.push({ threadId, payload });
          return 1;
        }
      }
    }),
    retentionConfig: {
      errorLogRetentionDays: 30,
      inviteArtifactRetentionDays: 90,
      securityAuditRetentionDays: 365,
      aiTranscriptsRetentionDays: 60,
      chatMessagesRetentionDays: 365,
      chatAttachmentsRetentionDays: 365,
      chatUnattachedUploadsRetentionHours: 24,
      chatMessageIdempotencyRetryWindowHours: 72,
      batchSize: 1000
    },
    now: () => new Date("2026-02-19T00:00:00.000Z")
  });

  const summary = await service.runSweep();

  assert.equal(summary.dryRun, false);
  assert.equal(summary.batchSize, 1000);
  assert.equal(summary.rules.length, 11);
  assert.equal(summary.totalDeletedRows, 3726);
  assert.equal(calls.browser.length, 2);
  assert.equal(calls.server.length, 1);
  assert.equal(calls.workspaceInvites.length, 3);
  assert.equal(calls.consoleInvites.length, 1);
  assert.equal(calls.auditEvents.length, 1);
  assert.equal(calls.aiMessages.length, 1);
  assert.equal(calls.aiConversations.length, 1);
  assert.equal(calls.chatUnattachedUploads.length, 1);
  assert.equal(calls.chatDetachedAttachments.length, 1);
  assert.equal(calls.chatMessageCandidates.length, 1);
  assert.equal(calls.chatMessageDeletes.length, 1);
  assert.equal(calls.chatTombstoneWrites.length, 1);
  assert.equal(calls.chatTombstoneExpiryDeletes.length, 1);
  assert.equal(calls.chatThreadCacheUpdates.length, 1);
  assert.equal(calls.chatParticipantRepairs.length, 1);
  assert.equal(summary.rules.find((entry) => entry.table === "workspace_invites").deletedRows, 2001);
  assert.equal(summary.rules.find((entry) => entry.table === "ai_messages").deletedRows, 700);
  assert.equal(summary.rules.find((entry) => entry.table === "ai_conversations").deletedRows, 8);
  assert.equal(summary.rules.find((entry) => entry.table === "chat_messages").deletedRows, 1);
});

test("retention service dry run does not execute delete methods", async () => {
  let deleteCalls = 0;
  const incrementAndZero = async () => {
    deleteCalls += 1;
    return 0;
  };

  const service = createRetentionService({
    ...createBaseRepositories({
      consoleErrorLogsRepository: {
        deleteBrowserErrorsOlderThan: incrementAndZero,
        deleteServerErrorsOlderThan: incrementAndZero
      },
      workspaceInvitesRepository: {
        deleteArtifactsOlderThan: incrementAndZero
      },
      consoleInvitesRepository: {
        deleteArtifactsOlderThan: incrementAndZero
      },
      auditEventsRepository: {
        deleteOlderThan: incrementAndZero
      },
      aiTranscriptMessagesRepository: {
        deleteOlderThan: incrementAndZero
      },
      aiTranscriptConversationsRepository: {
        deleteWithoutMessagesOlderThan: incrementAndZero
      },
      chatAttachmentsRepository: {
        deleteExpiredUnattachedBatch: incrementAndZero,
        deleteDetachedOlderThan: incrementAndZero
      },
      chatMessagesRepository: {
        async listRetentionCandidatesOlderThan() {
          deleteCalls += 1;
          return [];
        },
        deleteByIds: incrementAndZero,
        findLatestByThreadId: incrementAndZero,
        async transaction(callback) {
          deleteCalls += 1;
          return callback({});
        }
      },
      chatIdempotencyTombstonesRepository: {
        insertForDeletedMessage: incrementAndZero,
        deleteExpiredBatch: incrementAndZero
      },
      chatThreadsRepository: {
        updateLastMessageCache: incrementAndZero,
        deleteWithoutMessagesOlderThan: incrementAndZero
      },
      chatParticipantsRepository: {
        repairPointersForThread: incrementAndZero
      }
    }),
    now: () => new Date("2026-02-19T00:00:00.000Z")
  });

  const summary = await service.runSweep({ dryRun: true });
  assert.equal(summary.dryRun, true);
  assert.equal(summary.rules.length, 11);
  assert.equal(summary.totalDeletedRows, 0);
  assert.equal(deleteCalls, 0);
  assert.equal(summary.rules.every((entry) => entry.dryRun === true), true);
});

test("retention service config helpers normalize values", () => {
  const config = __testables.resolveRetentionConfig({
    errorLogRetentionDays: "0",
    inviteArtifactRetentionDays: "180",
    securityAuditRetentionDays: null,
    aiTranscriptsRetentionDays: "120",
    billingIdempotencyRetentionDays: "45",
    billingWebhookPayloadRetentionDays: "15",
    chatMessagesRetentionDays: "730",
    chatAttachmentsRetentionDays: "730",
    chatUnattachedUploadsRetentionHours: "72",
    chatMessageIdempotencyRetryWindowHours: "96",
    chatEmptyThreadCleanupEnabled: "true",
    batchSize: "99999"
  });

  assert.equal(config.errorLogRetentionDays, 30);
  assert.equal(config.inviteArtifactRetentionDays, 180);
  assert.equal(config.securityAuditRetentionDays, 365);
  assert.equal(config.aiTranscriptsRetentionDays, 120);
  assert.equal(config.billingIdempotencyRetentionDays, 45);
  assert.equal(config.billingWebhookPayloadRetentionDays, 15);
  assert.equal(config.chatMessagesRetentionDays, 730);
  assert.equal(config.chatAttachmentsRetentionDays, 730);
  assert.equal(config.chatUnattachedUploadsRetentionHours, 72);
  assert.equal(config.chatMessageIdempotencyRetryWindowHours, 96);
  assert.equal(config.chatEmptyThreadCleanupEnabled, true);
  assert.equal(config.batchSize, 10_000);
});

test("retention service runs billing retention rules when billing repository is wired", async () => {
  let billingIdempotencyCalls = 0;
  let billingWebhookPayloadCalls = 0;

  const service = createRetentionService({
    ...createBaseRepositories(),
    billingRepository: {
      async deleteTerminalIdempotencyOlderThan() {
        billingIdempotencyCalls += 1;
        return 2;
      },
      async scrubWebhookPayloadsPastRetention() {
        billingWebhookPayloadCalls += 1;
        return 3;
      }
    },
    retentionConfig: {
      billingIdempotencyRetentionDays: 30,
      billingWebhookPayloadRetentionDays: 30,
      batchSize: 1000
    },
    now: () => new Date("2026-02-20T00:00:00.000Z")
  });

  const summary = await service.runSweep();
  assert.equal(summary.rules.some((entry) => entry.table === "billing_idempotency_requests"), true);
  assert.equal(summary.rules.some((entry) => entry.table === "billing_webhook_payloads"), true);
  assert.equal(billingIdempotencyCalls, 1);
  assert.equal(billingWebhookPayloadCalls, 1);
  assert.equal(summary.totalDeletedRows, 5);
});

test("retention service fails closed when tombstone write fails", async () => {
  const calls = {
    deletedMessageIds: []
  };

  const service = createRetentionService({
    ...createBaseRepositories({
      chatMessagesRepository: {
        async listRetentionCandidatesOlderThan() {
          return [
            {
              id: 901,
              threadId: 31,
              senderUserId: 41,
              clientMessageId: "cm-901",
              idempotencyPayloadVersion: 1,
              idempotencyPayloadSha256: "hash901"
            }
          ];
        },
        async deleteByIds(messageIds) {
          calls.deletedMessageIds.push(...messageIds);
          return messageIds.length;
        },
        async findLatestByThreadId() {
          return null;
        },
        async transaction(callback) {
          return callback({});
        }
      },
      chatIdempotencyTombstonesRepository: {
        async insertForDeletedMessage() {
          return {
            ok: false,
            reason: "immutable_mismatch",
            tombstone: null
          };
        },
        async deleteExpiredBatch() {
          return 0;
        }
      }
    }),
    retentionConfig: {
      batchSize: 1000
    },
    now: () => new Date("2026-02-20T00:00:00.000Z")
  });

  await assert.rejects(
    () => service.runSweep(),
    (error) => {
      assert.equal(error.code, "CHAT_RETENTION_TOMBSTONE_WRITE_FAILED");
      assert.equal(error.reason, "immutable_mismatch");
      return true;
    }
  );
  assert.equal(calls.deletedMessageIds.length, 0);
});

test("retention service enables empty-thread cleanup only when configured", async () => {
  let emptyThreadCleanupCalls = 0;

  const service = createRetentionService({
    ...createBaseRepositories({
      chatThreadsRepository: {
        async updateLastMessageCache() {
          return null;
        },
        async deleteWithoutMessagesOlderThan() {
          emptyThreadCleanupCalls += 1;
          return 4;
        }
      }
    }),
    retentionConfig: {
      chatEmptyThreadCleanupEnabled: true
    },
    now: () => new Date("2026-02-20T00:00:00.000Z")
  });

  const summary = await service.runSweep();
  assert.equal(summary.rules.some((entry) => entry.table === "chat_empty_threads"), true);
  assert.equal(summary.rules.find((entry) => entry.table === "chat_empty_threads").deletedRows, 4);
  assert.equal(emptyThreadCleanupCalls, 1);
});
