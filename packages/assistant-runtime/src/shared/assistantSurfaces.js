import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const CONSOLE_OWNER_ACCESS_POLICY_ID = "console_owner";

/** Declare one surface explicitly; full application surface maps remain supported. */
function defineAssistantSurface(surfaceId, { pagesRoot = "", requiresWorkspace = false,
  configScope = requiresWorkspace ? "workspace" : "global", ...definition } = {}) {
  const id = normalizeSurfaceId(surfaceId);
  if (!id) throw new TypeError("An assistant surface id is required.");
  return Object.freeze({
    surfaceDefinitions: Object.freeze({ [id]: Object.freeze({ ...definition, pagesRoot, requiresWorkspace }) }),
    assistantSurfaces: Object.freeze({ [id]: Object.freeze({
      settingsSurfaceId: id, configScope: normalizeAssistantConfigScope(configScope)
    }) })
  });
}

function resolveSurfaceDefinitions(appConfig = {}) {
  const source = normalizeObject(appConfig?.surfaceDefinitions);
  const resolved = {};

  for (const [rawSurfaceId, rawDefinition] of Object.entries(source)) {
    const surfaceId = normalizeSurfaceId(rawSurfaceId);
    const definition = normalizeObject(rawDefinition);
    if (!surfaceId || definition.enabled === false) {
      continue;
    }

    resolved[surfaceId] = Object.freeze({
      id: surfaceId,
      requiresWorkspace: definition.requiresWorkspace === true,
      accessPolicyId: normalizeText(definition.accessPolicyId).toLowerCase()
    });
  }

  return Object.freeze(resolved);
}

function resolveAssistantSurfacesConfig(appConfig = {}) {
  const source = normalizeObject(appConfig?.assistantSurfaces);
  const resolved = {};

  for (const [rawSurfaceId, rawEntry] of Object.entries(source)) {
    const targetSurfaceId = normalizeSurfaceId(rawSurfaceId);
    const entry = normalizeObject(rawEntry);
    if (!targetSurfaceId) {
      continue;
    }

    resolved[targetSurfaceId] = Object.freeze({
      settingsSurfaceId: normalizeSurfaceId(entry.settingsSurfaceId),
      configScope: normalizeAssistantConfigScope(entry.configScope)
    });
  }

  return Object.freeze(resolved);
}

function normalizeAssistantConfigScope(value = "") {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "workspace") {
    return "workspace";
  }

  return "global";
}

function resolveAssistantSurfaceConfig(appConfig = {}, targetSurfaceId = "") {
  const normalizedTargetSurfaceId = normalizeSurfaceId(targetSurfaceId);
  if (!normalizedTargetSurfaceId) {
    return null;
  }

  const assistantSurfaces = resolveAssistantSurfacesConfig(appConfig);
  const surfaceConfig = assistantSurfaces[normalizedTargetSurfaceId];
  if (!surfaceConfig) {
    return null;
  }

  const surfaceDefinitions = resolveSurfaceDefinitions(appConfig);
  const runtimeSurface = surfaceDefinitions[normalizedTargetSurfaceId];
  const settingsSurface = surfaceDefinitions[surfaceConfig.settingsSurfaceId];
  if (!runtimeSurface || !settingsSurface) {
    return null;
  }

  if (
    surfaceConfig.configScope === "workspace" &&
    (runtimeSurface.requiresWorkspace !== true || settingsSurface.requiresWorkspace !== true)
  ) {
    return null;
  }

  return Object.freeze({
    targetSurfaceId: normalizedTargetSurfaceId,
    settingsSurfaceId: settingsSurface.id,
    configScope: surfaceConfig.configScope,
    runtimeSurfaceRequiresWorkspace: runtimeSurface.requiresWorkspace === true,
    settingsSurfaceRequiresWorkspace: settingsSurface.requiresWorkspace === true,
    settingsSurfaceRequiresConsoleOwner: settingsSurface.accessPolicyId === CONSOLE_OWNER_ACCESS_POLICY_ID
  });
}

export {
  defineAssistantSurface,
  normalizeAssistantConfigScope,
  resolveAssistantSurfaceConfig,
  resolveAssistantSurfacesConfig,
  resolveSurfaceDefinitions
};
