import assert from "node:assert/strict";
import test from "node:test";

import {
  createService as createRetentionService,
  __testables
} from "@jskit-ai/retention-core";

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
    },
    billingRepository: null
  };

  return {
    ...repositories,
    ...overrides
  };
}

test("retention service runs rule-pack sweep across base and chat domains", async () => {
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
  assert.equal(summary.rules.find((entry) => entry.ruleId === "workspace_invites").deletedRows, 2001);
  assert.equal(summary.rules.find((entry) => entry.ruleId === "ai_messages").deletedRows, 700);
  assert.equal(summary.rules.find((entry) => entry.ruleId === "ai_conversations").deletedRows, 8);
  assert.equal(summary.rules.find((entry) => entry.ruleId === "chat_messages").deletedRows, 1);
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
  assert.equal(
    summary.rules.every((entry) => entry.dryRun === true),
    true
  );
});

test("retention policy config helper normalizes values", () => {
  const config = __testables.resolveRetentionPolicyConfig({
    errorLogRetentionDays: "0",
    inviteArtifactRetentionDays: "30",
    securityAuditRetentionDays: "9999",
    aiTranscriptsRetentionDays: "",
    billingIdempotencyRetentionDays: 10,
    billingWebhookPayloadRetentionDays: null,
    chatMessagesRetentionDays: "12",
    chatAttachmentsRetentionDays: "0",
    chatUnattachedUploadsRetentionHours: "2",
    chatMessageIdempotencyRetryWindowHours: "999999",
    chatEmptyThreadCleanupEnabled: "true",
    batchSize: "20000"
  });

  assert.equal(config.errorLogRetentionDays, 30);
  assert.equal(config.inviteArtifactRetentionDays, 30);
  assert.equal(config.securityAuditRetentionDays, 3650);
  assert.equal(config.aiTranscriptsRetentionDays, 60);
  assert.equal(config.billingIdempotencyRetentionDays, 10);
  assert.equal(config.billingWebhookPayloadRetentionDays, 30);
  assert.equal(config.chatMessagesRetentionDays, 12);
  assert.equal(config.chatAttachmentsRetentionDays, 365);
  assert.equal(config.chatUnattachedUploadsRetentionHours, 2);
  assert.equal(config.chatMessageIdempotencyRetryWindowHours, 24 * 3650);
  assert.equal(config.chatEmptyThreadCleanupEnabled, true);
  assert.equal(config.batchSize, 10000);
});

test("retention service runs billing retention rules when billing repository is wired", async () => {
  const billingCalls = {
    idempotency: [],
    payloadScrub: []
  };

  const service = createRetentionService({
    ...createBaseRepositories({
      billingRepository: {
        async deleteTerminalIdempotencyOlderThan(cutoffDate, batchSize) {
          billingCalls.idempotency.push({ cutoffDate, batchSize });
          return 4;
        },
        async scrubWebhookPayloadsPastRetention({ now, batchSize }) {
          billingCalls.payloadScrub.push({ now, batchSize });
          return 2;
        }
      }
    }),
    retentionConfig: {
      billingIdempotencyRetentionDays: 14,
      billingWebhookPayloadRetentionDays: 21,
      batchSize: 50
    },
    now: () => new Date("2026-02-19T00:00:00.000Z")
  });

  const summary = await service.runSweep();
  assert.equal(summary.rules.some((entry) => entry.ruleId === "billing_idempotency_requests"), true);
  assert.equal(summary.rules.some((entry) => entry.ruleId === "billing_webhook_payloads"), true);
  assert.equal(summary.totalDeletedRows, 6);
  assert.equal(billingCalls.idempotency.length, 1);
  assert.equal(billingCalls.payloadScrub.length, 1);
  assert.equal(billingCalls.idempotency[0].batchSize, 50);
  assert.equal(billingCalls.payloadScrub[0].batchSize, 50);
});

test("retention service fails closed when tombstone write fails", async () => {
  const service = createRetentionService({
    ...createBaseRepositories({
      chatMessagesRepository: {
        async listRetentionCandidatesOlderThan() {
          return [
            {
              id: 900,
              threadId: 77,
              senderUserId: 45,
              clientMessageId: "cm_fail_900",
              idempotencyPayloadVersion: 1,
              idempotencyPayloadSha256: "sha_900"
            }
          ];
        },
        async deleteByIds() {
          return 1;
        },
        async findLatestByThreadId() {
          return null;
        },
        async transaction(callback) {
          return callback({ id: "trx_fail" });
        }
      },
      chatIdempotencyTombstonesRepository: {
        async insertForDeletedMessage() {
          return {
            ok: false,
            reason: "duplicate"
          };
        },
        async deleteExpiredBatch() {
          return 0;
        }
      }
    }),
    retentionConfig: {
      chatMessagesRetentionDays: 365,
      chatMessageIdempotencyRetryWindowHours: 72,
      batchSize: 100
    },
    now: () => new Date("2026-02-19T00:00:00.000Z")
  });

  await assert.rejects(
    () => service.runSweep(),
    (error) => String(error?.code || "") === "CHAT_RETENTION_TOMBSTONE_WRITE_FAILED"
  );
});

test("retention service enables empty-thread cleanup only when configured", async () => {
  const deleteCalls = [];

  const createServiceWithFlag = (flag) =>
    createRetentionService({
      ...createBaseRepositories({
        chatThreadsRepository: {
          async updateLastMessageCache() {
            return null;
          },
          async deleteWithoutMessagesOlderThan(cutoffDate, batchSize) {
            deleteCalls.push({ flag, cutoffDate, batchSize });
            return 2;
          }
        }
      }),
      retentionConfig: {
        chatEmptyThreadCleanupEnabled: flag,
        batchSize: 25
      },
      now: () => new Date("2026-02-19T00:00:00.000Z")
    });

  const disabledSummary = await createServiceWithFlag(false).runSweep();
  assert.equal(disabledSummary.rules.some((entry) => entry.ruleId === "chat_empty_threads"), false);

  const enabledSummary = await createServiceWithFlag(true).runSweep();
  assert.equal(enabledSummary.rules.some((entry) => entry.ruleId === "chat_empty_threads"), true);
  assert.equal(deleteCalls.length, 1);
  assert.equal(deleteCalls[0].flag, true);
  assert.equal(deleteCalls[0].batchSize, 25);
});
