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

test("retention service runs batched retention sweep across all tables", async () => {
  const calls = {
    browser: [],
    server: [],
    workspaceInvites: [],
    consoleInvites: [],
    auditEvents: [],
    aiMessages: [],
    aiConversations: []
  };
  const browserDeletes = createDeque([1000, 5]);
  const serverDeletes = createDeque([0]);
  const workspaceDeletes = createDeque([1000, 1000, 1]);
  const consoleDeletes = createDeque([2]);
  const auditDeletes = createDeque([0]);
  const aiMessageDeletes = createDeque([700, 25]);
  const aiConversationDeletes = createDeque([8, 0]);

  const service = createRetentionService({
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
    retentionConfig: {
      errorLogRetentionDays: 30,
      inviteArtifactRetentionDays: 90,
      securityAuditRetentionDays: 365,
      aiTranscriptsRetentionDays: 60,
      batchSize: 1000
    },
    now: () => new Date("2026-02-19T00:00:00.000Z")
  });

  const summary = await service.runSweep();

  assert.equal(summary.dryRun, false);
  assert.equal(summary.batchSize, 1000);
  assert.equal(summary.rules.length, 7);
  assert.equal(summary.totalDeletedRows, 3716);
  assert.equal(calls.browser.length, 2);
  assert.equal(calls.server.length, 1);
  assert.equal(calls.workspaceInvites.length, 3);
  assert.equal(calls.consoleInvites.length, 1);
  assert.equal(calls.auditEvents.length, 1);
  assert.equal(calls.aiMessages.length, 1);
  assert.equal(calls.aiConversations.length, 1);
  assert.equal(summary.rules.find((entry) => entry.table === "workspace_invites").deletedRows, 2001);
  assert.equal(summary.rules.find((entry) => entry.table === "ai_messages").deletedRows, 700);
  assert.equal(summary.rules.find((entry) => entry.table === "ai_conversations").deletedRows, 8);
});

test("retention service dry run does not delete rows", async () => {
  let deleteCalls = 0;
  const service = createRetentionService({
    consoleErrorLogsRepository: {
      async deleteBrowserErrorsOlderThan() {
        deleteCalls += 1;
        return 0;
      },
      async deleteServerErrorsOlderThan() {
        deleteCalls += 1;
        return 0;
      }
    },
    workspaceInvitesRepository: {
      async deleteArtifactsOlderThan() {
        deleteCalls += 1;
        return 0;
      }
    },
    consoleInvitesRepository: {
      async deleteArtifactsOlderThan() {
        deleteCalls += 1;
        return 0;
      }
    },
    auditEventsRepository: {
      async deleteOlderThan() {
        deleteCalls += 1;
        return 0;
      }
    },
    aiTranscriptMessagesRepository: {
      async deleteOlderThan() {
        deleteCalls += 1;
        return 0;
      }
    },
    aiTranscriptConversationsRepository: {
      async deleteWithoutMessagesOlderThan() {
        deleteCalls += 1;
        return 0;
      }
    },
    now: () => new Date("2026-02-19T00:00:00.000Z")
  });

  const summary = await service.runSweep({ dryRun: true });
  assert.equal(summary.dryRun, true);
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
    batchSize: "99999"
  });

  assert.equal(config.errorLogRetentionDays, 30);
  assert.equal(config.inviteArtifactRetentionDays, 180);
  assert.equal(config.securityAuditRetentionDays, 365);
  assert.equal(config.aiTranscriptsRetentionDays, 120);
  assert.equal(config.billingIdempotencyRetentionDays, 45);
  assert.equal(config.billingWebhookPayloadRetentionDays, 15);
  assert.equal(config.batchSize, 10_000);
});

test("retention service runs billing retention rules when billing repository is wired", async () => {
  let billingIdempotencyCalls = 0;
  let billingWebhookPayloadCalls = 0;

  const service = createRetentionService({
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
