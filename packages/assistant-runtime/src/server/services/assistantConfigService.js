import { AppError, requireAuth } from "@jskit-ai/kernel/server/runtime";
import { normalizeObject, normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { resolveAssistantSurfaceConfig } from "../../shared/assistantSurfaces.js";

function createService({
  assistantConfigRepository,
  consoleService = null,
  appConfig = {},
  resolveAppConfig = null,
  workspaceScopeSupport = null
} = {}) {
  if (!assistantConfigRepository || typeof assistantConfigRepository.findByScope !== "function") {
    throw new Error("assistantConfigService requires assistantConfigRepository.findByScope().");
  }
  if (typeof assistantConfigRepository.upsertByScope !== "function") {
    throw new Error("assistantConfigService requires assistantConfigRepository.upsertByScope().");
  }
  if (typeof assistantConfigRepository.createDefaultRecord !== "function") {
    throw new Error("assistantConfigService requires assistantConfigRepository.createDefaultRecord().");
  }

  const resolveCurrentAppConfig =
    typeof resolveAppConfig === "function" ? resolveAppConfig : () => appConfig;

  function requireAssistantSurface(targetSurfaceId = "") {
    const assistantSurface = resolveAssistantSurfaceConfig(resolveCurrentAppConfig(), targetSurfaceId);
    if (assistantSurface) {
      return assistantSurface;
    }

    throw new AppError(404, "Assistant not found.");
  }

  async function requireSettingsAccess(assistantSurface, context = {}, { mode = "read" } = {}) {
    requireAuth({ context }, {
      require: "authenticated"
    });

    if (assistantSurface?.settingsSurfaceRequiresWorkspace === true) {
      requireAuth(
        { context },
        mode === "write"
          ? {
              require: "all",
              permissions: ["workspace.settings.update"]
            }
          : {
              require: "any",
              permissions: ["workspace.settings.view", "workspace.settings.update"]
            }
      );
      return;
    }

    if (assistantSurface?.settingsSurfaceRequiresConsoleOwner !== true) {
      return;
    }

    if (!consoleService || typeof consoleService.requireConsoleOwner !== "function") {
      throw new Error("assistantConfigService requires consoleService.requireConsoleOwner() for console-owner settings surfaces.");
    }

    await consoleService.requireConsoleOwner(context);
  }

  function resolveConfigWorkspaceId(assistantSurface, workspace = null, input = {}, context = {}) {
    if (assistantSurface?.configScope !== "workspace") {
      return null;
    }

    if (!workspaceScopeSupport || typeof workspaceScopeSupport.resolveWorkspace !== "function") {
      throw new Error("assistant.config.service requires workspace server scope support for workspace-scoped settings.");
    }

    const resolvedWorkspace = workspace || workspaceScopeSupport.resolveWorkspace(context, input);
    const workspaceId = normalizeRecordId(resolvedWorkspace?.id, { fallback: null });
    if (!workspaceId) {
      throw new AppError(409, "Workspace selection required.");
    }

    return workspaceId;
  }

  async function getSettings(input = {}, options = {}) {
    const assistantSurface = requireAssistantSurface(input?.targetSurfaceId);
    await requireSettingsAccess(assistantSurface, options?.context, {
      mode: "read"
    });

    const workspaceId = resolveConfigWorkspaceId(assistantSurface, null, input, options?.context);
    const existing = await assistantConfigRepository.findByScope({
      targetSurfaceId: assistantSurface.targetSurfaceId,
      workspaceId
    });

    return existing || assistantConfigRepository.createDefaultRecord({
      targetSurfaceId: assistantSurface.targetSurfaceId,
      workspaceId
    });
  }

  async function updateSettings(input = {}, patch = {}, options = {}) {
    const assistantSurface = requireAssistantSurface(input?.targetSurfaceId);
    await requireSettingsAccess(assistantSurface, options?.context, {
      mode: "write"
    });

    const workspaceId = resolveConfigWorkspaceId(assistantSurface, null, input, options?.context);
    const normalizedPatch = normalizeObject(patch);

    return assistantConfigRepository.upsertByScope({
      targetSurfaceId: assistantSurface.targetSurfaceId,
      workspaceId,
      patch: normalizedPatch
    });
  }

  async function resolveSystemPrompt(assistantSurface, workspace = null, _options = {}, serviceOptions = {}) {
    const resolvedAssistantSurface = requireAssistantSurface(assistantSurface?.targetSurfaceId);
    const workspaceId = resolveConfigWorkspaceId(
      resolvedAssistantSurface,
      workspace,
      serviceOptions?.input || {},
      serviceOptions?.context
    );
    const existing = await assistantConfigRepository.findByScope({
      targetSurfaceId: resolvedAssistantSurface.targetSurfaceId,
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
