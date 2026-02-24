import { createRetentionSweepOrchestrator } from "@jskit-ai/redis-ops-core/retentionOrchestrator";
import { resolveRetentionPolicyConfig } from "./policy.js";
import { createRetentionRulePack } from "./rules/index.js";

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
  const repositories = {
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
    billingRepository
  };

  const normalizedRetentionConfig = resolveRetentionPolicyConfig(retentionConfig);
  const rules = createRetentionRulePack({
    repositories,
    retentionConfig: normalizedRetentionConfig
  });
  const orchestrator = createRetentionSweepOrchestrator({
    rules,
    retentionConfig: normalizedRetentionConfig,
    batchSize: normalizedRetentionConfig.batchSize,
    now,
    failFast: true
  });

  return {
    runSweep: orchestrator.runSweep
  };
}

const __testables = {
  resolveRetentionPolicyConfig,
  createRetentionRulePack
};

export { createService, __testables };
