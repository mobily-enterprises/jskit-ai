import {
  normalizeBoolean,
  normalizeRetentionBatchSize,
  normalizeRetentionDays,
  normalizeRetentionHours
} from "@jskit-ai/redis-ops-core/retentionOrchestrator";

const DEFAULT_RETENTION_POLICY = Object.freeze({
  errorLogRetentionDays: 30,
  inviteArtifactRetentionDays: 90,
  securityAuditRetentionDays: 365,
  aiTranscriptsRetentionDays: 60,
  billingIdempotencyRetentionDays: 30,
  billingWebhookPayloadRetentionDays: 30,
  chatMessagesRetentionDays: 365,
  chatAttachmentsRetentionDays: 365,
  chatUnattachedUploadsRetentionHours: 24,
  chatMessageIdempotencyRetryWindowHours: 72,
  chatEmptyThreadCleanupEnabled: false,
  batchSize: 1000
});

function resolveRetentionPolicyConfig(policy = {}) {
  const source = policy && typeof policy === "object" ? policy : {};

  return {
    errorLogRetentionDays: normalizeRetentionDays(
      source.errorLogRetentionDays,
      DEFAULT_RETENTION_POLICY.errorLogRetentionDays
    ),
    inviteArtifactRetentionDays: normalizeRetentionDays(
      source.inviteArtifactRetentionDays,
      DEFAULT_RETENTION_POLICY.inviteArtifactRetentionDays
    ),
    securityAuditRetentionDays: normalizeRetentionDays(
      source.securityAuditRetentionDays,
      DEFAULT_RETENTION_POLICY.securityAuditRetentionDays
    ),
    aiTranscriptsRetentionDays: normalizeRetentionDays(
      source.aiTranscriptsRetentionDays,
      DEFAULT_RETENTION_POLICY.aiTranscriptsRetentionDays
    ),
    billingIdempotencyRetentionDays: normalizeRetentionDays(
      source.billingIdempotencyRetentionDays,
      DEFAULT_RETENTION_POLICY.billingIdempotencyRetentionDays
    ),
    billingWebhookPayloadRetentionDays: normalizeRetentionDays(
      source.billingWebhookPayloadRetentionDays,
      DEFAULT_RETENTION_POLICY.billingWebhookPayloadRetentionDays
    ),
    chatMessagesRetentionDays: normalizeRetentionDays(
      source.chatMessagesRetentionDays,
      DEFAULT_RETENTION_POLICY.chatMessagesRetentionDays
    ),
    chatAttachmentsRetentionDays: normalizeRetentionDays(
      source.chatAttachmentsRetentionDays,
      DEFAULT_RETENTION_POLICY.chatAttachmentsRetentionDays
    ),
    chatUnattachedUploadsRetentionHours: normalizeRetentionHours(
      source.chatUnattachedUploadsRetentionHours,
      DEFAULT_RETENTION_POLICY.chatUnattachedUploadsRetentionHours
    ),
    chatMessageIdempotencyRetryWindowHours: normalizeRetentionHours(
      source.chatMessageIdempotencyRetryWindowHours,
      DEFAULT_RETENTION_POLICY.chatMessageIdempotencyRetryWindowHours
    ),
    chatEmptyThreadCleanupEnabled: normalizeBoolean(
      source.chatEmptyThreadCleanupEnabled,
      DEFAULT_RETENTION_POLICY.chatEmptyThreadCleanupEnabled
    ),
    batchSize: normalizeRetentionBatchSize(source.batchSize, DEFAULT_RETENTION_POLICY.batchSize)
  };
}

function buildRetentionPolicyFromRepositoryConfig({ repositoryConfig, batchSize } = {}) {
  const config = repositoryConfig && typeof repositoryConfig === "object" ? repositoryConfig : {};
  const retention = config.retention || {};
  const chat = retention.chat || {};
  const billing = config.billing || {};

  return resolveRetentionPolicyConfig({
    errorLogRetentionDays: retention.errorLogDays,
    inviteArtifactRetentionDays: retention.inviteArtifactDays,
    securityAuditRetentionDays: retention.securityAuditDays,
    aiTranscriptsRetentionDays: retention.aiTranscriptsDays,
    billingIdempotencyRetentionDays: billing.retention?.idempotencyDays,
    billingWebhookPayloadRetentionDays: billing.retention?.webhookPayloadDays,
    chatMessagesRetentionDays: chat.messagesDays,
    chatAttachmentsRetentionDays: chat.attachmentsDays,
    chatUnattachedUploadsRetentionHours: config.chat?.unattachedUploadRetentionHours,
    chatMessageIdempotencyRetryWindowHours: chat.messageIdempotencyRetryWindowHours,
    chatEmptyThreadCleanupEnabled: chat.emptyThreadCleanupEnabled,
    batchSize
  });
}

const __testables = {
  DEFAULT_RETENTION_POLICY
};

export { resolveRetentionPolicyConfig, buildRetentionPolicyFromRepositoryConfig, __testables };
