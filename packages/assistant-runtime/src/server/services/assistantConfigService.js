import { AppError, requireAuth } from "@jskit-ai/kernel/server/runtime";
import { normalizeObject, normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { requireAssistantSurface } from "../support/assistantSurface.js";
import { resolveAssistantServerConfig, resolveAssistantServerConfigMap } from "../support/assistantServerConfig.js";

/** @typedef {import("../types.js").AssistantConfigRepository} AssistantConfigRepository */
/** @typedef {import("../types.js").WorkspaceScopeSupport} WorkspaceScopeSupport */

const WORKSPACE_SETTINGS_UPDATE_POLICY = Object.freeze({ require: "all", permissions: Object.freeze(["workspace.settings.update"]) });
const ASSISTANT_SETTINGS_UPDATE_POLICY = Object.freeze({ require: "all", permissions: Object.freeze(["assistant.settings.update"]) });
// The statuses of an access check's refusal (not signed in, not allowed), as against a failure.
const ACCESS_REFUSED_STATUSES = Object.freeze([401, 403]);

/**
 * An assistant surface's saved settings: who may read and change them, and the
 * system prompt they give the surface's conversations. Changing them needs the
 * surface's `assistantServer.<surface>.settingsUpdatePermission`, by default
 * `workspace.settings.update` on a workspace settings surface, the console owner
 * on a console-owner surface, and `assistant.settings.update` everywhere else.
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
  // Read once here, so a malformed settingsUpdatePermission or maxToolArgumentBytes stops the server from starting.
  resolveAssistantServerConfigMap(appConfig);

  /**
   * The auth policy that changing a surface's settings needs, or null when its console-owner check is all.
   * @param {ReturnType<typeof requireAssistantSurface>} assistantSurface
   */
  function resolveSettingsUpdatePolicy(assistantSurface) {
    const configured = resolveAssistantServerConfig(appConfig, assistantSurface.targetSurfaceId).settingsUpdatePermission;
    if (configured) {
      return configured;
    }
    if (assistantSurface.settingsSurfaceRequiresWorkspace === true) {
      return WORKSPACE_SETTINGS_UPDATE_POLICY;
    }
    return assistantSurface.settingsSurfaceRequiresConsoleOwner === true ? null : ASSISTANT_SETTINGS_UPDATE_POLICY;
  }

  async function requireSettingsAccess(assistantSurface, context = {}, { mode = "read" } = {}) {
    requireAuth({ context }, {
      require: "authenticated"
    });

    const updatePolicy = mode === "write" ? resolveSettingsUpdatePolicy(assistantSurface) : null;
    if (updatePolicy) {
      requireAuth({ context }, {
        ...updatePolicy,
        message: "You do not have permission to change the assistant's instructions.",
        code: "assistant.runtime.settings.updateForbidden"
      });
    } else if (mode !== "write" && assistantSurface.settingsSurfaceRequiresWorkspace === true) {
      requireAuth({ context }, {
        require: "any",
        permissions: ["workspace.settings.view", "workspace.settings.update"]
      });
    }

    if (assistantSurface.settingsSurfaceRequiresWorkspace === true || assistantSurface.settingsSurfaceRequiresConsoleOwner !== true) {
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

  /**
   * Whether the context may change a surface's settings: the check updateSettings makes, answered instead of thrown,
   * so the settings screen offers Save only to the people the server lets save.
   */
  async function canUpdateSettings(input = {}, options = {}) {
    const assistantSurface = requireAssistantSurface(appConfig, input.targetSurfaceId);
    try {
      await requireSettingsAccess(assistantSurface, options.context, {
        mode: "write"
      });
      return true;
    } catch (error) {
      if (ACCESS_REFUSED_STATUSES.includes(Number(error?.status))) {
        return false;
      }
      throw error;
    }
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
    canUpdateSettings,
    updateSettings,
    resolveSystemPrompt
  });
}

export { createService };
