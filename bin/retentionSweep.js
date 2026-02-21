#!/usr/bin/env node

import { closeDatabase } from "../db/knex.js";
import { env } from "../server/lib/env.js";
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
    billingRepository: repositories.billingRepository,
    retentionConfig: {
      errorLogRetentionDays: env.ERROR_LOG_RETENTION_DAYS,
      inviteArtifactRetentionDays: env.INVITE_ARTIFACT_RETENTION_DAYS,
      securityAuditRetentionDays: env.SECURITY_AUDIT_RETENTION_DAYS,
      aiTranscriptsRetentionDays: env.AI_TRANSCRIPTS_RETENTION_DAYS,
      billingIdempotencyRetentionDays: env.BILLING_IDEMPOTENCY_RETENTION_DAYS,
      billingWebhookPayloadRetentionDays: env.BILLING_WEBHOOK_PAYLOAD_RETENTION_DAYS,
      batchSize: env.RETENTION_BATCH_SIZE
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
