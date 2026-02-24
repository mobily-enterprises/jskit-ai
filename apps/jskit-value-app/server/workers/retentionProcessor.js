import { createRepositoryRegistry } from "@jskit-ai/server-runtime-core/composition";
import {
  createRetentionSweepProcessor as createRetentionSweepProcessorCore,
  RetentionLockHeldError,
  isRetentionLockHeldError,
  __testables as coreTestables
} from "@jskit-ai/redis-ops-core/retentionProcessor";
import { createService as createRetentionService, resolveRetentionPolicyConfig } from "@jskit-ai/retention-core";
import { PLATFORM_REPOSITORY_DEFINITIONS } from "../runtime/repositories.js";

function createDefaultRepositories() {
  return createRepositoryRegistry(PLATFORM_REPOSITORY_DEFINITIONS);
}

function createRetentionSweepProcessor({
  logger = null,
  retentionConfig = {},
  redisNamespace,
  lockConnection = null,
  lockTtlMs = 30 * 60 * 1000,
  createRepositoriesImpl = createDefaultRepositories,
  createRetentionServiceImpl = createRetentionService,
  createRetentionSweepProcessorImpl = createRetentionSweepProcessorCore,
  acquireDistributedLockImpl,
  releaseDistributedLockImpl,
  extendDistributedLockImpl
} = {}) {
  const repositories = createRepositoriesImpl();
  const resolvedRetentionConfig = resolveRetentionPolicyConfig(retentionConfig);
  const retentionService = createRetentionServiceImpl({
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
    billingRepository: repositories.billingRepository || null,
    retentionConfig: resolvedRetentionConfig
  });

  return createRetentionSweepProcessorImpl({
    logger,
    redisNamespace,
    lockConnection,
    lockTtlMs,
    acquireDistributedLockImpl,
    releaseDistributedLockImpl,
    extendDistributedLockImpl,
    runSweep: ({ dryRun, logger: sweepLogger }) =>
      retentionService.runSweep({
        dryRun,
        logger: sweepLogger
      })
  });
}

const __testables = {
  createDefaultRepositories,
  resolveRetentionPolicyConfig,
  ...coreTestables
};

export { createRetentionSweepProcessor, RetentionLockHeldError, isRetentionLockHeldError, __testables };
