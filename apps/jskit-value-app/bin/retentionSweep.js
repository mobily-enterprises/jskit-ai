#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPlatformRuntimeEnv } from "@jskit-ai/runtime-env-core/platformRuntimeEnv";
import { createRepositoryRegistry } from "@jskit-ai/server-runtime-core/composition";
import { createService as createRetentionService, buildRetentionPolicyFromRepositoryConfig } from "@jskit-ai/retention-core";
import { repositoryConfig } from "../config/index.js";
import { closeDatabase } from "../db/knex.js";
import { PLATFORM_REPOSITORY_DEFINITIONS } from "../server/runtime/repositories.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const runtimeEnv = createPlatformRuntimeEnv({
  rootDir: path.resolve(__dirname, "..")
});

function parseCliArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  return {
    dryRun: args.includes("--dry-run")
  };
}

async function main() {
  const { dryRun } = parseCliArgs(process.argv.slice(2));
  const repositories = createRepositoryRegistry(PLATFORM_REPOSITORY_DEFINITIONS);
  const retentionPolicy = buildRetentionPolicyFromRepositoryConfig({
    repositoryConfig,
    batchSize: runtimeEnv.RETENTION_BATCH_SIZE
  });
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
    retentionConfig: retentionPolicy
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
