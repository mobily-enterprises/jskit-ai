import { AppError, parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveWorkspace } from "@jskit-ai/users-core/server/support/resolveWorkspace";
import { assistantRuntimeConfig } from "../../shared/assistantRuntimeConfig.js";

function createService({ assistantConfigRepository, consoleService = null } = {}) {
  if (!assistantConfigRepository || typeof assistantConfigRepository.findByScope !== "function") {
    throw new Error("assistantConfigService requires assistantConfigRepository.findByScope().");
  }
  if (typeof assistantConfigRepository.upsertByScope !== "function") {
    throw new Error("assistantConfigService requires assistantConfigRepository.upsertByScope().");
  }
  if (typeof assistantConfigRepository.createDefaultRecord !== "function") {
    throw new Error("assistantConfigService requires assistantConfigRepository.createDefaultRecord().");
  }
  if (
    assistantRuntimeConfig.settingsSurfaceRequiresConsoleOwner &&
    (!consoleService || typeof consoleService.requireConsoleOwner !== "function")
  ) {
    throw new Error("assistantConfigService requires consoleService.requireConsoleOwner() for console-owner settings surfaces.");
  }

  async function requireSettingsAccess(context = {}, options = {}) {
    if (assistantRuntimeConfig.settingsSurfaceRequiresConsoleOwner !== true) {
      return;
    }

    await consoleService.requireConsoleOwner(context, options);
  }

  function resolveConfigWorkspaceId(workspace = null, input = {}, context = {}) {
    if (assistantRuntimeConfig.configScope !== "workspace") {
      return null;
    }

    const resolvedWorkspace = workspace || resolveWorkspace(context, input);
    const workspaceId = parsePositiveInteger(resolvedWorkspace?.id);
    if (!workspaceId) {
      throw new AppError(409, "Workspace selection required.");
    }

    return workspaceId;
  }

  async function getSettings(input = {}, options = {}) {
    await requireSettingsAccess(options?.context, options);

    const workspaceId = resolveConfigWorkspaceId(null, input, options?.context);
    const existing = await assistantConfigRepository.findByScope({
      targetSurfaceId: assistantRuntimeConfig.runtimeSurfaceId,
      workspaceId
    });

    return existing || assistantConfigRepository.createDefaultRecord({
      targetSurfaceId: assistantRuntimeConfig.runtimeSurfaceId,
      workspaceId
    });
  }

  async function updateSettings(input = {}, patch = {}, options = {}) {
    await requireSettingsAccess(options?.context, options);

    const workspaceId = resolveConfigWorkspaceId(null, input, options?.context);
    const normalizedPatch = normalizeObject(patch);

    return assistantConfigRepository.upsertByScope({
      targetSurfaceId: assistantRuntimeConfig.runtimeSurfaceId,
      workspaceId,
      patch: normalizedPatch
    });
  }

  async function resolveSystemPrompt(workspace = null, _options = {}, serviceOptions = {}) {
    const workspaceId = resolveConfigWorkspaceId(workspace, serviceOptions?.input || {}, serviceOptions?.context);
    const existing = await assistantConfigRepository.findByScope({
      targetSurfaceId: assistantRuntimeConfig.runtimeSurfaceId,
      workspaceId
    });

    return String(existing?.settings?.systemPrompt || "");
  }

  return Object.freeze({
    getSettings,
    updateSettings,
    resolveSystemPrompt
  });
}

export { createService };
