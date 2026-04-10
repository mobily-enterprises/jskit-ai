import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadAppConfigFromModuleUrl, resolveRequiredAppRoot } from "@jskit-ai/kernel/server/support";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";

function normalizeConfigScope(value = "") {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "global" || normalized === "workspace") {
    return normalized;
  }

  throw new Error('assistant generator option "config-scope" must be "global" or "workspace".');
}

async function loadAppConfig(appRoot = "") {
  const resolvedAppRoot = resolveRequiredAppRoot(appRoot, {
    context: "assistant generator"
  });
  const publicConfigUrl = pathToFileURL(path.join(resolvedAppRoot, "config", "public.js")).href;
  return loadAppConfigFromModuleUrl({
    moduleUrl: publicConfigUrl
  });
}

function resolveSurfaceDefinition(appConfig = {}, surfaceId = "", optionName = "surface") {
  const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
  if (!normalizedSurfaceId) {
    throw new Error(`assistant generator requires --${optionName}.`);
  }

  const sourceDefinitions =
    appConfig && typeof appConfig.surfaceDefinitions === "object" && !Array.isArray(appConfig.surfaceDefinitions)
      ? appConfig.surfaceDefinitions
      : {};
  const rawDefinition = sourceDefinitions[normalizedSurfaceId];
  if (!rawDefinition || typeof rawDefinition !== "object" || Array.isArray(rawDefinition)) {
    throw new Error(`assistant generator surface "${normalizedSurfaceId}" is not defined in config/public.js.`);
  }
  if (rawDefinition.enabled === false) {
    throw new Error(`assistant generator surface "${normalizedSurfaceId}" is disabled in config/public.js.`);
  }

  return Object.freeze({
    id: normalizedSurfaceId,
    requiresWorkspace: rawDefinition.requiresWorkspace === true,
    accessPolicyId: normalizeText(rawDefinition.accessPolicyId).toLowerCase()
  });
}

function assertAssistantSurfaceIsAvailable(appConfig = {}, surfaceId = "") {
  const assistantSurfaces =
    appConfig && typeof appConfig.assistantSurfaces === "object" && !Array.isArray(appConfig.assistantSurfaces)
      ? appConfig.assistantSurfaces
      : {};
  if (assistantSurfaces[surfaceId]) {
    throw new Error(`assistant generator surface "${surfaceId}" already has an assistant configured in config/public.js.`);
  }
}

function resolveAiConfigPrefix(surfaceId = "", explicitPrefix = "") {
  const normalizedExplicitPrefix = normalizeText(explicitPrefix);
  if (normalizedExplicitPrefix) {
    return normalizedExplicitPrefix;
  }

  const surfacePrefix = toSnakeCase(surfaceId).toUpperCase();
  return surfacePrefix ? `${surfacePrefix}_ASSISTANT` : "ASSISTANT";
}

export {
  normalizeConfigScope,
  loadAppConfig,
  resolveSurfaceDefinition,
  assertAssistantSurfaceIsAvailable,
  resolveAiConfigPrefix
};
