import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { isRecord, normalizeObject, normalizeText, normalizeUniqueTextList } from "@jskit-ai/kernel/shared/support/normalize";
import {
  DEFAULT_AI_TIMEOUT_MS,
  normalizeOptionalHttpUrl,
  normalizeTimeoutMs
} from "@jskit-ai/assistant-core/server";

const SETTINGS_UPDATE_REQUIRE_MODES = Object.freeze(["authenticated", "all", "any"]);

/**
 * Who may change a surface's assistant settings, as configured: a permission, an auth policy
 * (`{ require, permissions }`), or null for the surface's default.
 * @param {unknown} value
 * @param {string} targetSurfaceId
 */
function normalizeSettingsUpdatePermission(value, targetSurfaceId) {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "string" && normalizeText(value)) {
    return Object.freeze({
      require: "all",
      permissions: Object.freeze([normalizeText(value)])
    });
  }
  const permissions = isRecord(value) ? normalizeUniqueTextList(value.permissions) : [];
  if (isRecord(value) && SETTINGS_UPDATE_REQUIRE_MODES.includes(value.require) && (value.require === "authenticated" || permissions.length > 0)) {
    return Object.freeze({
      require: value.require,
      permissions: Object.freeze(permissions)
    });
  }
  throw new TypeError(
    `assistantServer.${targetSurfaceId}.settingsUpdatePermission must be a permission or { require: "authenticated" | "all" | "any", permissions }.`
  );
}

function resolveAssistantServerConfigMap(appConfig) {
  const source = normalizeObject(appConfig?.assistantServer);
  const resolved = {};

  for (const [rawSurfaceId, rawEntry] of Object.entries(source)) {
    const targetSurfaceId = normalizeSurfaceId(rawSurfaceId);
    const entry = normalizeObject(rawEntry);
    if (!targetSurfaceId) {
      continue;
    }

    resolved[targetSurfaceId] = Object.freeze({
      aiIntegrationId: normalizeText(entry.aiIntegrationId),
      aiIntegrationIds: Object.freeze(normalizeUniqueTextList(entry.aiIntegrationIds)),
      aiConfigPrefix: normalizeText(entry.aiConfigPrefix),
      provider: normalizeText(entry.provider).toLowerCase(),
      apiKey: normalizeText(entry.apiKey),
      baseUrl: normalizeText(entry.baseUrl),
      model: normalizeText(entry.model),
      timeoutMs: entry.timeoutMs,
      barredActionIds: Object.freeze(normalizeUniqueTextList(entry.barredActionIds, { acceptSingle: true })),
      toolSkipActionPrefixes: Object.freeze(normalizeUniqueTextList(entry.toolSkipActionPrefixes, { acceptSingle: true })),
      settingsUpdatePermission: normalizeSettingsUpdatePermission(entry.settingsUpdatePermission, targetSurfaceId)
    });
  }

  return Object.freeze(resolved);
}

function resolveAssistantServerConfig(appConfig = {}, targetSurfaceId = "") {
  const normalizedTargetSurfaceId = normalizeSurfaceId(targetSurfaceId);
  if (!normalizedTargetSurfaceId) {
    return Object.freeze({});
  }

  const serverConfigMap = resolveAssistantServerConfigMap(appConfig);
  return serverConfigMap[normalizedTargetSurfaceId] || Object.freeze({});
}

function readPrefixedEnvValue(env = {}, prefix = "", key = "") {
  const normalizedPrefix = normalizeText(prefix);
  const normalizedKey = normalizeText(key);
  if (!normalizedPrefix || !normalizedKey) {
    return "";
  }

  return normalizeText(env[`${normalizedPrefix}_${normalizedKey}`]);
}

function resolveAssistantAiConfig({ appConfig = {}, env = {} } = {}, targetSurfaceId = "") {
  const surfaceServerConfig = resolveAssistantServerConfig(appConfig, targetSurfaceId);
  const normalizedTargetSurfaceId = normalizeSurfaceId(targetSurfaceId);
  if (!normalizedTargetSurfaceId) {
    throw new Error("assistant AI config requires targetSurfaceId.");
  }

  const aiConfigPrefix = normalizeText(surfaceServerConfig.aiConfigPrefix);
  if (!aiConfigPrefix) {
    throw new Error(
      `assistant server config for surface "${normalizedTargetSurfaceId}" requires assistantServer.${normalizedTargetSurfaceId}.aiConfigPrefix.`
    );
  }

  const provider = normalizeText(
    readPrefixedEnvValue(env, aiConfigPrefix, "AI_PROVIDER") || surfaceServerConfig.provider
  ).toLowerCase() || "openai";
  const apiKey = normalizeText(
    readPrefixedEnvValue(env, aiConfigPrefix, "AI_API_KEY") || surfaceServerConfig.apiKey
  );
  const baseUrl = normalizeOptionalHttpUrl(
    readPrefixedEnvValue(env, aiConfigPrefix, "AI_BASE_URL") || surfaceServerConfig.baseUrl,
    {
      context: "assistant AI_BASE_URL"
    }
  );
  const model = normalizeText(
    readPrefixedEnvValue(env, aiConfigPrefix, "AI_MODEL") || surfaceServerConfig.model
  );
  const timeoutMs = normalizeTimeoutMs(
    readPrefixedEnvValue(env, aiConfigPrefix, "AI_TIMEOUT_MS") || surfaceServerConfig.timeoutMs,
    DEFAULT_AI_TIMEOUT_MS
  );

  return Object.freeze({
    aiConfigPrefix,
    ai: Object.freeze({
      enabled: Boolean(apiKey),
      provider,
      apiKey,
      baseUrl,
      model,
      timeoutMs
    })
  });
}

export {
  resolveAssistantServerConfigMap,
  resolveAssistantServerConfig,
  resolveAssistantAiConfig
};
