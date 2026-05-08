import {
  assertAssistantSurfaceIsAvailable,
  loadAppConfig,
  normalizeConfigScope,
  resolveAiConfigPrefix,
  resolveSurfaceDefinition
} from "./support.js";

async function buildTemplateContext({ appRoot, options } = {}) {
  const appConfig = await loadAppConfig(appRoot);
  const runtimeSurface = resolveSurfaceDefinition(appConfig, options?.surface, "surface");
  const settingsSurface = resolveSurfaceDefinition(appConfig, options?.["settings-surface"], "settings-surface");
  const configScope = normalizeConfigScope(options?.["config-scope"]);

  assertAssistantSurfaceIsAvailable(appConfig, runtimeSurface.id, {
    settingsSurfaceId: settingsSurface.id,
    configScope
  });

  if (configScope === "workspace" && runtimeSurface.requiresWorkspace !== true) {
    throw new Error(
      `assistant generator config-scope "workspace" requires surface "${runtimeSurface.id}" with requiresWorkspace=true.`
    );
  }
  if (configScope === "workspace" && settingsSurface.requiresWorkspace !== true) {
    throw new Error(
      `assistant generator config-scope "workspace" requires settings surface "${settingsSurface.id}" with requiresWorkspace=true.`
    );
  }

  return Object.freeze({
    "__ASSISTANT_SETTINGS_SURFACE_ID__": settingsSurface.id,
    "__ASSISTANT_CONFIG_SCOPE__": configScope,
    "__ASSISTANT_AI_CONFIG_PREFIX__": resolveAiConfigPrefix(runtimeSurface.id, options?.["ai-config-prefix"])
  });
}

export { buildTemplateContext };
