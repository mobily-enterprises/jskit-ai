import { parsePositiveInteger } from "@jskit-ai/kernel/server/runtime";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/validators";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import {
  ASSISTANT_CONSOLE_SETTINGS_CHANGED_EVENT,
  ASSISTANT_WORKSPACE_SETTINGS_CHANGED_EVENT
} from "../../shared/settingsEvents.js";

const serviceEvents = Object.freeze({
  updateConsoleSettings: Object.freeze([
    Object.freeze({
      type: "entity.changed",
      source: "assistant",
      entity: "console.settings",
      operation: "updated",
      entityId: 1,
      realtime: Object.freeze({
        event: ASSISTANT_CONSOLE_SETTINGS_CHANGED_EVENT,
        audience: "all_users"
      })
    })
  ]),
  updateWorkspaceSettings: Object.freeze([
    Object.freeze({
      type: "entity.changed",
      source: "assistant",
      entity: "workspace.settings",
      operation: "updated",
      entityId: ({ args }) => args?.[0]?.id || null,
      realtime: Object.freeze({
        event: ASSISTANT_WORKSPACE_SETTINGS_CHANGED_EVENT,
        audience: "event_scope",
        payload: ({ args }) => ({
          workspaceSlug: String(args?.[0]?.slug || "").trim()
        })
      })
    })
  ])
});

function normalizeSurface(value) {
  return normalizeText(value).toLowerCase();
}

function mapConsoleResponse(record = {}) {
  return {
    settings: {
      workspaceSurfacePrompt: String(record.workspaceSurfacePrompt || "")
    }
  };
}

function mapWorkspaceResponse(record = {}) {
  return {
    settings: {
      appSurfacePrompt: String(record.appSurfacePrompt || "")
    }
  };
}

function createService({ assistantSettingsRepository, consoleService } = {}) {
  if (!assistantSettingsRepository || typeof assistantSettingsRepository.ensureConsoleSettings !== "function") {
    throw new Error("assistantSettingsService requires assistantSettingsRepository.ensureConsoleSettings().");
  }
  if (!assistantSettingsRepository || typeof assistantSettingsRepository.ensureWorkspaceSettings !== "function") {
    throw new Error("assistantSettingsService requires assistantSettingsRepository.ensureWorkspaceSettings().");
  }
  if (!assistantSettingsRepository || typeof assistantSettingsRepository.updateConsoleSettings !== "function") {
    throw new Error("assistantSettingsService requires assistantSettingsRepository.updateConsoleSettings().");
  }
  if (!assistantSettingsRepository || typeof assistantSettingsRepository.updateWorkspaceSettings !== "function") {
    throw new Error("assistantSettingsService requires assistantSettingsRepository.updateWorkspaceSettings().");
  }
  if (!consoleService || typeof consoleService.requireConsoleOwner !== "function") {
    throw new Error("assistantSettingsService requires consoleService.requireConsoleOwner().");
  }

  async function getConsoleSettings(options = {}) {
    await consoleService.requireConsoleOwner(options?.context, options);
    const settings = await assistantSettingsRepository.ensureConsoleSettings(options);
    return mapConsoleResponse(settings);
  }

  async function updateConsoleSettings(payload = {}, options = {}) {
    await consoleService.requireConsoleOwner(options?.context, options);
    const source = normalizeObjectInput(payload);
    const patch = pickOwnProperties(source, ["workspaceSurfacePrompt"]);
    if (Object.keys(patch).length < 1) {
      const settings = await assistantSettingsRepository.ensureConsoleSettings(options);
      return mapConsoleResponse(settings);
    }
    const settings = await assistantSettingsRepository.updateConsoleSettings({
      workspaceSurfacePrompt: String(patch.workspaceSurfacePrompt || "")
    }, options);
    return mapConsoleResponse(settings);
  }

  async function getWorkspaceSettings(workspace, options = {}) {
    const workspaceId = parsePositiveInteger(workspace?.id);
    if (!workspaceId) {
      throw new Error("assistantSettingsService.getWorkspaceSettings requires workspace.id.");
    }

    const settings = await assistantSettingsRepository.ensureWorkspaceSettings(workspaceId, options);
    return mapWorkspaceResponse(settings);
  }

  async function updateWorkspaceSettings(workspace, payload = {}, options = {}) {
    const workspaceId = parsePositiveInteger(workspace?.id);
    if (!workspaceId) {
      throw new Error("assistantSettingsService.updateWorkspaceSettings requires workspace.id.");
    }

    const source = normalizeObjectInput(payload);
    const patch = pickOwnProperties(source, ["appSurfacePrompt"]);
    if (Object.keys(patch).length < 1) {
      const settings = await assistantSettingsRepository.ensureWorkspaceSettings(workspaceId, options);
      return mapWorkspaceResponse(settings);
    }
    const settings = await assistantSettingsRepository.updateWorkspaceSettings(
      workspaceId,
      {
        appSurfacePrompt: String(patch.appSurfacePrompt || "")
      },
      options
    );

    return mapWorkspaceResponse(settings);
  }

  async function resolveSystemPrompt(workspace, { surface = "" } = {}, options = {}) {
    const normalizedSurface = normalizeSurface(surface);

    if (normalizedSurface === "app") {
      const workspaceSettings = await getWorkspaceSettings(workspace, options);
      return String(workspaceSettings?.settings?.appSurfacePrompt || "");
    }

    const consoleSettings = await assistantSettingsRepository.ensureConsoleSettings(options);
    return String(consoleSettings.workspaceSurfacePrompt || "");
  }

  return Object.freeze({
    getConsoleSettings,
    updateConsoleSettings,
    getWorkspaceSettings,
    updateWorkspaceSettings,
    resolveSystemPrompt
  });
}

export { createService, serviceEvents };
