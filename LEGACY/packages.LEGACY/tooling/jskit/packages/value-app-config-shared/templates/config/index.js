import { appConfig as appDefaults } from "./app.js";
import { chatConfig as chatDefaults } from "./chat.js";
import { socialConfig as socialDefaults } from "./social.js";
import { aiConfig as aiDefaults } from "./ai.js";
import { billingConfig as billingDefaults } from "./billing.js";
import { retentionConfig as retentionDefaults } from "./retention.js";
import { actionsConfig as actionsDefaults } from "./actions.js";
import {
  deepFreeze,
  expectBoolean,
  expectPositiveInteger,
  expectNumber,
  expectString,
  expectOneOf,
  expectPlainObject
} from "./lib/helpers.js";

const TENANCY_MODES = ["personal", "team-single", "multi-workspace"];
const WORKSPACE_PROVISIONING_MODES = ["self-serve", "governed"];
const BILLING_PROVIDERS = ["stripe", "paddle"];

function validateAppConfig(config) {
  expectPlainObject("app", config);
  expectOneOf("app.tenancyMode", config.tenancyMode, TENANCY_MODES);
  expectOneOf(
    "app.workspaceProvisioningMode",
    config.workspaceProvisioningMode,
    WORKSPACE_PROVISIONING_MODES
  );
  expectPlainObject("app.features", config.features);
  expectBoolean("app.features.workspaceSwitching", config.features.workspaceSwitching);
  expectBoolean("app.features.workspaceInvites", config.features.workspaceInvites);
  expectBoolean("app.features.workspaceCreateEnabled", config.features.workspaceCreateEnabled);
  expectPlainObject("app.limits", config.limits);
  expectPositiveInteger("app.limits.maxWorkspacesPerUser", config.limits.maxWorkspacesPerUser);
}

function validateChatConfig(config) {
  expectPlainObject("chat", config);
  expectBoolean("chat.enabled", config.enabled);
  expectBoolean("chat.workspaceThreadsEnabled", config.workspaceThreadsEnabled);
  expectBoolean("chat.globalDmsEnabled", config.globalDmsEnabled);
  expectBoolean("chat.globalDmsRequireSharedWorkspace", config.globalDmsRequireSharedWorkspace);
  expectBoolean("chat.attachmentsEnabled", config.attachmentsEnabled);
  expectPositiveInteger("chat.messageMaxTextChars", config.messageMaxTextChars);
  expectPositiveInteger("chat.messagesPageSizeMax", config.messagesPageSizeMax);
  expectPositiveInteger("chat.threadsPageSizeMax", config.threadsPageSizeMax);
  expectPositiveInteger("chat.attachmentsMaxFilesPerMessage", config.attachmentsMaxFilesPerMessage);
  expectPositiveInteger("chat.attachmentMaxUploadBytes", config.attachmentMaxUploadBytes);
  expectPositiveInteger("chat.unattachedUploadRetentionHours", config.unattachedUploadRetentionHours);
}

function validateAiConfig(config) {
  expectPlainObject("ai", config);
  expectBoolean("ai.enabled", config.enabled);
  expectString("ai.model", config.model);
  expectPositiveInteger("ai.maxInputChars", config.maxInputChars);
  expectPositiveInteger("ai.maxHistoryMessages", config.maxHistoryMessages);
  expectPositiveInteger("ai.maxToolCallsPerTurn", config.maxToolCallsPerTurn);
  expectPositiveInteger("ai.streamTimeoutMs", config.streamTimeoutMs);
  expectPositiveInteger("ai.historyPageSize", config.historyPageSize);
  expectPositiveInteger("ai.restoreMessagesPageSize", config.restoreMessagesPageSize);
  expectString("ai.requiredPermission", config.requiredPermission, { allowEmpty: true });
}

function validateSocialConfig(config) {
  expectPlainObject("social", config);
  expectBoolean("social.enabled", config.enabled);
  expectBoolean("social.federationEnabled", config.federationEnabled);
  expectPlainObject("social.limits", config.limits);
  expectPositiveInteger("social.limits.feedPageSizeMax", config.limits.feedPageSizeMax);
  expectPositiveInteger("social.limits.commentsPageSizeMax", config.limits.commentsPageSizeMax);
  expectPositiveInteger("social.limits.notificationsPageSizeMax", config.limits.notificationsPageSizeMax);
  expectPositiveInteger("social.limits.actorSearchLimitMax", config.limits.actorSearchLimitMax);
  expectPositiveInteger("social.limits.postMaxChars", config.limits.postMaxChars);
  expectPositiveInteger("social.limits.commentMaxChars", config.limits.commentMaxChars);
  expectPositiveInteger("social.limits.inboxMaxPayloadBytes", config.limits.inboxMaxPayloadBytes);
  expectPlainObject("social.retry", config.retry);
  expectPositiveInteger("social.retry.baseDelayMs", config.retry.baseDelayMs);
  expectPositiveInteger("social.retry.maxDelayMs", config.retry.maxDelayMs);
  expectPositiveInteger("social.retry.maxAttempts", config.retry.maxAttempts);
  expectNumber("social.retry.jitterRatio", config.retry.jitterRatio, {
    min: 0,
    max: 1
  });
  expectPlainObject("social.workers", config.workers);
  expectPositiveInteger("social.workers.outboxPollSeconds", config.workers.outboxPollSeconds);
  expectPositiveInteger("social.workers.outboxWorkspaceBatchSize", config.workers.outboxWorkspaceBatchSize);
  expectPlainObject("social.identity", config.identity);
  expectBoolean("social.identity.treatHandleWithDomainAsRemote", config.identity.treatHandleWithDomainAsRemote);
  expectBoolean("social.identity.allowRemoteLookupForLocalHandles", config.identity.allowRemoteLookupForLocalHandles);
  expectPlainObject("social.moderation", config.moderation);
  expectOneOf("social.moderation.accessMode", config.moderation.accessMode, ["permission", "operator"]);
  expectBoolean(
    "social.moderation.requireManualApprovalForRemoteFollows",
    config.moderation.requireManualApprovalForRemoteFollows
  );
  expectBoolean(
    "social.moderation.autoSuspendOnRepeatedSignatureFailures",
    config.moderation.autoSuspendOnRepeatedSignatureFailures
  );
  expectPositiveInteger(
    "social.moderation.signatureFailureSuspendThreshold",
    config.moderation.signatureFailureSuspendThreshold
  );

  if (!Array.isArray(config.moderation.defaultBlockedDomains)) {
    throw new Error("social.moderation.defaultBlockedDomains must be an array.");
  }
  for (let index = 0; index < config.moderation.defaultBlockedDomains.length; index += 1) {
    expectString(
      `social.moderation.defaultBlockedDomains[${index}]`,
      config.moderation.defaultBlockedDomains[index]
    );
  }
}

function validateBillingConfig(config) {
  expectPlainObject("billing", config);
  expectBoolean("billing.enabled", config.enabled);
  expectOneOf("billing.provider", config.provider, BILLING_PROVIDERS);
  expectString("billing.currency", config.currency);
  expectPlainObject("billing.idempotency", config.idempotency);
  expectPositiveInteger(
    "billing.idempotency.providerReplayWindowSeconds",
    config.idempotency.providerReplayWindowSeconds
  );
  expectPositiveInteger("billing.idempotency.pendingLeaseSeconds", config.idempotency.pendingLeaseSeconds);
  expectPlainObject("billing.checkout", config.checkout);
  expectPositiveInteger("billing.checkout.providerExpiresSeconds", config.checkout.providerExpiresSeconds);
  expectPositiveInteger("billing.checkout.sessionExpiresAtGraceSeconds", config.checkout.sessionExpiresAtGraceSeconds);
  expectPositiveInteger("billing.checkout.completionSlaSeconds", config.checkout.completionSlaSeconds);
  expectPlainObject("billing.workers", config.workers);
  expectPlainObject("billing.workers.outbox", config.workers.outbox);
  expectPositiveInteger("billing.workers.outbox.retryDelaySeconds", config.workers.outbox.retryDelaySeconds);
  expectPositiveInteger("billing.workers.outbox.maxAttempts", config.workers.outbox.maxAttempts);
  expectPlainObject("billing.workers.remediation", config.workers.remediation);
  expectPositiveInteger("billing.workers.remediation.retryDelaySeconds", config.workers.remediation.retryDelaySeconds);
  expectPositiveInteger("billing.workers.remediation.maxAttempts", config.workers.remediation.maxAttempts);
  expectPlainObject("billing.retention", config.retention);
  expectPositiveInteger("billing.retention.idempotencyDays", config.retention.idempotencyDays);
  expectPositiveInteger("billing.retention.webhookPayloadDays", config.retention.webhookPayloadDays);
}

function validateRetentionConfig(config) {
  expectPlainObject("retention", config);
  expectPositiveInteger("retention.errorLogDays", config.errorLogDays);
  expectPositiveInteger("retention.inviteArtifactDays", config.inviteArtifactDays);
  expectPositiveInteger("retention.securityAuditDays", config.securityAuditDays);
  expectPositiveInteger("retention.aiTranscriptsDays", config.aiTranscriptsDays);
  expectPlainObject("retention.chat", config.chat);
  expectPositiveInteger("retention.chat.messagesDays", config.chat.messagesDays);
  expectPositiveInteger("retention.chat.attachmentsDays", config.chat.attachmentsDays);
  expectPositiveInteger(
    "retention.chat.messageIdempotencyRetryWindowHours",
    config.chat.messageIdempotencyRetryWindowHours
  );
  expectBoolean("retention.chat.emptyThreadCleanupEnabled", config.chat.emptyThreadCleanupEnabled);
}

function validateActionExposureConfig(config, pathName) {
  expectPlainObject(pathName, config);
  expectBoolean(`${pathName}.enabled`, config.enabled);

  const exposedActionIds = Array.isArray(config.exposedActionIds) ? config.exposedActionIds : null;
  if (!exposedActionIds) {
    throw new Error(`${pathName}.exposedActionIds must be an array.`);
  }
  for (let index = 0; index < exposedActionIds.length; index += 1) {
    expectString(`${pathName}.exposedActionIds[${index}]`, exposedActionIds[index]);
  }

  const blockedActionIds = Array.isArray(config.blockedActionIds) ? config.blockedActionIds : null;
  if (!blockedActionIds) {
    throw new Error(`${pathName}.blockedActionIds must be an array.`);
  }
  for (let index = 0; index < blockedActionIds.length; index += 1) {
    expectString(`${pathName}.blockedActionIds[${index}]`, blockedActionIds[index]);
  }
}

function validateActionsConfig(config) {
  expectPlainObject("actions", config);
  validateActionExposureConfig(config.assistant, "actions.assistant");
  validateActionExposureConfig(config.internal, "actions.internal");
}

function mergePlainObjectOverrides(baseValue, overrideValue, pathName = "config") {
  if (overrideValue == null) {
    return baseValue;
  }
  if (Array.isArray(overrideValue)) {
    throw new Error(`config override for ${pathName} must not be an array.`);
  }
  if (typeof overrideValue !== "object") {
    throw new Error(`config override for ${pathName} must be an object.`);
  }
  if (!baseValue || typeof baseValue !== "object" || Array.isArray(baseValue)) {
    throw new Error(`config override target ${pathName} is not an object.`);
  }

  const output = structuredClone(baseValue);
  for (const [key, value] of Object.entries(overrideValue)) {
    if (!Object.prototype.hasOwnProperty.call(baseValue, key)) {
      throw new Error(`Unknown config override key at ${pathName}.${key}.`);
    }
    const nextPath = `${pathName}.${key}`;
    const baseEntry = baseValue[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      baseEntry &&
      typeof baseEntry === "object" &&
      !Array.isArray(baseEntry)
    ) {
      output[key] = mergePlainObjectOverrides(baseEntry, value, nextPath);
      continue;
    }

    output[key] = value;
  }

  return output;
}

function validateRepositoryConfig(config) {
  expectPlainObject("root", config);
  validateAppConfig(config.app);
  validateChatConfig(config.chat);
  validateSocialConfig(config.social);
  validateAiConfig(config.ai);
  validateBillingConfig(config.billing);
  validateRetentionConfig(config.retention);
  validateActionsConfig(config.actions);
}

function buildRepositoryConfig({ overrides = null } = {}) {
  const config = {
    app: structuredClone(appDefaults),
    chat: structuredClone(chatDefaults),
    social: structuredClone(socialDefaults),
    ai: structuredClone(aiDefaults),
    billing: structuredClone(billingDefaults),
    retention: structuredClone(retentionDefaults),
    actions: structuredClone(actionsDefaults)
  };

  const mergedConfig = overrides ? mergePlainObjectOverrides(config, overrides, "config") : config;
  validateRepositoryConfig(mergedConfig);

  return deepFreeze(mergedConfig);
}

const repositoryConfig = buildRepositoryConfig();

function resolveRepositoryConfigForRuntime({ globalObject = globalThis, nodeEnv = "" } = {}) {
  if (
    String(nodeEnv || "")
      .trim()
      .toLowerCase() !== "test"
  ) {
    return repositoryConfig;
  }

  const override = globalObject?.__JSKIT_TEST_REPOSITORY_CONFIG_OVERRIDE__;
  if (override == null) {
    return repositoryConfig;
  }

  return buildRepositoryConfig({
    overrides: override
  });
}

export { repositoryConfig, buildRepositoryConfig, validateRepositoryConfig, resolveRepositoryConfigForRuntime };
