import { appConfig as appDefaults } from "./app.js";
import { chatConfig as chatDefaults } from "./chat.js";
import { aiConfig as aiDefaults } from "./ai.js";
import { billingConfig as billingDefaults } from "./billing.js";
import { retentionConfig as retentionDefaults } from "./retention.js";
import {
  deepFreeze,
  expectBoolean,
  expectPositiveInteger,
  expectString,
  expectOneOf,
  expectPlainObject
} from "./helpers.js";

const TENANCY_MODES = ["personal", "team-single", "multi-workspace"];
const BILLING_PROVIDERS = ["stripe", "paddle"];

function validateAppConfig(config) {
  expectPlainObject("app", config);
  expectOneOf("app.tenancyMode", config.tenancyMode, TENANCY_MODES);
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
  expectString("ai.requiredPermission", config.requiredPermission, { allowEmpty: true });
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
  validateAiConfig(config.ai);
  validateBillingConfig(config.billing);
  validateRetentionConfig(config.retention);
}

function buildRepositoryConfig({ overrides = null } = {}) {
  const config = {
    app: structuredClone(appDefaults),
    chat: structuredClone(chatDefaults),
    ai: structuredClone(aiDefaults),
    billing: structuredClone(billingDefaults),
    retention: structuredClone(retentionDefaults)
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
