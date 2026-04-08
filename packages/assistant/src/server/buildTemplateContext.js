import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  loadAppConfigFromModuleUrl,
  resolveShellOutletPlacementTargetFromApp
} from "@jskit-ai/kernel/server/support";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { toSnakeCase } from "@jskit-ai/kernel/shared/support/stringCase";

const DEFAULT_MENU_COMPONENT_TOKEN = "users.web.shell.surface-aware-menu-link-item";

function normalizeConfigScope(value = "") {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "global" || normalized === "workspace") {
    return normalized;
  }

  throw new Error('assistant generator option "config-scope" must be "global" or "workspace".');
}

async function loadAppConfig(appRoot = "") {
  const publicConfigUrl = pathToFileURL(path.join(appRoot, "config", "public.js")).href;
  return loadAppConfigFromModuleUrl({
    moduleUrl: publicConfigUrl
  });
}

function resolveSurfaceDefinition(appConfig = {}, surfaceId = "", optionName = "surface") {
  const normalizedSurfaceId = normalizeSurfaceId(surfaceId);
  if (!normalizedSurfaceId) {
    throw new Error(`assistant generator requires --${optionName}.`);
  }

  const sourceDefinitions = appConfig && typeof appConfig.surfaceDefinitions === "object" && !Array.isArray(appConfig.surfaceDefinitions)
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

function resolveTableSuffix(surfaceId = "") {
  return toSnakeCase(surfaceId) || "assistant";
}

async function resolveMenuPlacementTarget(appRoot = "", options = {}) {
  return resolveShellOutletPlacementTargetFromApp({
    appRoot,
    context: "assistant-generator",
    placement: normalizeText(options?.placement)
  });
}

async function buildTemplateContext({ appRoot, options } = {}) {
  const appConfig = await loadAppConfig(appRoot);
  const runtimeSurface = resolveSurfaceDefinition(appConfig, options?.["runtime-surface"], "runtime-surface");
  const settingsSurface = resolveSurfaceDefinition(appConfig, options?.["settings-surface"], "settings-surface");
  const configScope = normalizeConfigScope(options?.["config-scope"]);

  if (configScope === "workspace" && runtimeSurface.requiresWorkspace !== true) {
    throw new Error(
      `assistant generator config-scope "workspace" requires runtime surface "${runtimeSurface.id}" with requiresWorkspace=true.`
    );
  }
  if (configScope === "workspace" && settingsSurface.requiresWorkspace !== true) {
    throw new Error(
      `assistant generator config-scope "workspace" requires settings surface "${settingsSurface.id}" with requiresWorkspace=true.`
    );
  }

  const placementTarget = await resolveMenuPlacementTarget(appRoot, options);
  const tableSuffix = resolveTableSuffix(runtimeSurface.id);
  const menuComponentToken = normalizeText(options?.["placement-component-token"]) || DEFAULT_MENU_COMPONENT_TOKEN;

  return Object.freeze({
    "__ASSISTANT_RUNTIME_SURFACE_ID__": runtimeSurface.id,
    "__ASSISTANT_SETTINGS_SURFACE_ID__": settingsSurface.id,
    "__ASSISTANT_RUNTIME_SURFACE_REQUIRES_WORKSPACE__": runtimeSurface.requiresWorkspace ? "true" : "false",
    "__ASSISTANT_SETTINGS_SURFACE_REQUIRES_WORKSPACE__": settingsSurface.requiresWorkspace ? "true" : "false",
    "__ASSISTANT_SETTINGS_SURFACE_REQUIRES_CONSOLE_OWNER__":
      settingsSurface.accessPolicyId === "console_owner" ? "true" : "false",
    "__ASSISTANT_CONFIG_SCOPE__": configScope,
    "__ASSISTANT_SETTINGS_HOST__": `${settingsSurface.id}-settings`,
    "__ASSISTANT_CONFIG_TABLE__": "assistant_config",
    "__ASSISTANT_CONVERSATIONS_TABLE__": `assistant_${tableSuffix}_conversations`,
    "__ASSISTANT_MESSAGES_TABLE__": `assistant_${tableSuffix}_messages`,
    "__ASSISTANT_MENU_PLACEMENT_HOST__": placementTarget.host,
    "__ASSISTANT_MENU_PLACEMENT_POSITION__": placementTarget.position,
    "__ASSISTANT_MENU_COMPONENT_TOKEN__": menuComponentToken,
    "__ASSISTANT_MENU_LABEL__": normalizeText(options?.["menu-label"]) || "Assistant",
    "__ASSISTANT_MENU_WORKSPACE_SUFFIX__": "/assistant",
    "__ASSISTANT_MENU_NON_WORKSPACE_SUFFIX__": "/assistant"
  });
}

export { buildTemplateContext };
