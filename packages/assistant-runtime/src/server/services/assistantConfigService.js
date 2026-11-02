import { AppError, requireAuth } from "@jskit-ai/kernel/server/runtime";
import { normalizeObject, normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { requireAssistantSurface } from "../support/assistantSurface.js";

/** @typedef {import("../types.js").AssistantConfigRepository} AssistantConfigRepository */
/** @typedef {import("../types.js").WorkspaceScopeSupport} WorkspaceScopeSupport */

/**
 * An assistant surface's saved settings: who may read and change them, and the
 * system prompt they give the surface's conversations.
 * @param {object} dependencies
 * @param {AssistantConfigRepository} dependencies.assistantConfigRepository
 * @param {import("@jskit-ai/console-core/server/types").ConsoleService | null} dependencies.consoleService The console access service, when the console is installed.
 * @param {Record<string, any>} dependencies.appConfig
 * @param {WorkspaceScopeSupport | null} dependencies.workspaceScopeSupport
 */
function createService({
  assistantConfigRepository,
  consoleService,
  appConfig,
  workspaceScopeSupport
}) {
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

    if (!consoleService) {
      throw new Error("assistantConfigService requires consoleService.requireConsoleOwner() for console-owner settings surfaces.");
    }

    await consoleService.requireConsoleOwner(context);
  }

  function resolveConfigWorkspaceId(assistantSurface, workspace = null, input = {}, context = {}) {
    if (assistantSurface?.configScope !== "workspace") {
      return null;
    }

    if (!workspaceScopeSupport) {
      throw new Error("assistant.config.service requires workspace server scope support for workspace-scoped settings.");
    }

    const resolvedWorkspace = workspace || workspaceScopeSupport.resolveWorkspace(context, input);
    const workspaceId = normalizeRecordId(resolvedWorkspace?.id, { fallback: null });
    if (!workspaceId) {
      throw new AppError(409, "Workspace selection required.", { code: "assistant.runtime.workspace.selectionRequired" });
    }

    return workspaceId;
  }

  async function getSettings(input = {}, options = {}) {
    const assistantSurface = requireAssistantSurface(appConfig, input.targetSurfaceId);
    await requireSettingsAccess(assistantSurface, options.context, {
      mode: "read"
    });

    const workspaceId = resolveConfigWorkspaceId(assistantSurface, null, input, options.context);
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
    const assistantSurface = requireAssistantSurface(appConfig, input.targetSurfaceId);
    await requireSettingsAccess(assistantSurface, options.context, {
      mode: "write"
    });

    const workspaceId = resolveConfigWorkspaceId(assistantSurface, null, input, options.context);
    const normalizedPatch = normalizeObject(patch);

    return assistantConfigRepository.upsertByScope({
      targetSurfaceId: assistantSurface.targetSurfaceId,
      workspaceId,
      patch: normalizedPatch
    });
  }

  async function resolveSystemPrompt(assistantSurface, workspace = null, _options = {}, serviceOptions) {
    const resolvedAssistantSurface = requireAssistantSurface(appConfig, assistantSurface?.targetSurfaceId);
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
