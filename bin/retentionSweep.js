#!/usr/bin/env node

import { repositoryConfig } from "../config/index.js";
import { closeDatabase } from "../db/knex.js";
import { runtimeEnv } from "../server/lib/runtimeEnv.js";
import { createService as createRetentionService } from "../server/domain/operations/services/retention.service.js";
import { createRepositories } from "../server/runtime/repositories.js";

function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  return {
    dryRun: args.includes("--dry-run")
  };
}

async function main() {
  const { dryRun } = parseCliArgs(process.argv.slice(2));
  const repositories = createRepositories();
  const retentionService = createRetentionService({
    consoleErrorLogsRepository: repositories.consoleErrorLogsRepository,
    workspaceInvitesRepository: repositories.workspaceInvitesRepository,
    consoleInvitesRepository: repositories.consoleInvitesRepository,
    auditEventsRepository: repositories.auditEventsRepository,
    aiTranscriptConversationsRepository: repositories.aiTranscriptConversationsRepository,
    aiTranscriptMessagesRepository: repositories.aiTranscriptMessagesRepository,
    chatThreadsRepository: repositories.chatThreadsRepository,
    chatParticipantsRepository: repositories.chatParticipantsRepository,
    chatMessagesRepository: repositories.chatMessagesRepository,
    chatIdempotencyTombstonesRepository: repositories.chatIdempotencyTombstonesRepository,
    chatAttachmentsRepository: repositories.chatAttachmentsRepository,
    billingRepository: repositories.billingRepository,
    retentionConfig: {
      errorLogRetentionDays: repositoryConfig.retention.errorLogDays,
      inviteArtifactRetentionDays: repositoryConfig.retention.inviteArtifactDays,
      securityAuditRetentionDays: repositoryConfig.retention.securityAuditDays,
      aiTranscriptsRetentionDays: repositoryConfig.retention.aiTranscriptsDays,
      billingIdempotencyRetentionDays: repositoryConfig.billing.retention.idempotencyDays,
      billingWebhookPayloadRetentionDays: repositoryConfig.billing.retention.webhookPayloadDays,
      chatMessagesRetentionDays: repositoryConfig.retention.chat.messagesDays,
      chatAttachmentsRetentionDays: repositoryConfig.retention.chat.attachmentsDays,
      chatUnattachedUploadsRetentionHours: repositoryConfig.chat.unattachedUploadRetentionHours,
      chatMessageIdempotencyRetryWindowHours: repositoryConfig.retention.chat.messageIdempotencyRetryWindowHours,
      chatEmptyThreadCleanupEnabled: repositoryConfig.retention.chat.emptyThreadCleanupEnabled,
      batchSize: runtimeEnv.RETENTION_BATCH_SIZE
    }
  });

  const summary = await retentionService.runSweep({
    dryRun,
    logger: console
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  console.error("Retention sweep failed:", error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
