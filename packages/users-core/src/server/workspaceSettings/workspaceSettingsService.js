import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeObjectInput } from "@jskit-ai/kernel/shared/contracts/inputNormalization";
import { listRoleDescriptors, resolveAssignableRoleIds } from "../../shared/roles.js";
import { DEFAULT_WORKSPACE_SETTINGS } from "../../shared/settings.js";

function normalizeWorkspaceFeatures(features) {
  const source = normalizeObjectInput(features);
  const surfaceAccess = normalizeObjectInput(source.surfaceAccess);
  const appSurfaceAccess = normalizeObjectInput(surfaceAccess.app);

  return {
    ...source,
    surfaceAccess: {
      ...surfaceAccess,
      app: {
        denyEmails: Array.isArray(appSurfaceAccess.denyEmails) ? [...appSurfaceAccess.denyEmails] : [],
        denyUserIds: Array.isArray(appSurfaceAccess.denyUserIds) ? [...appSurfaceAccess.denyUserIds] : []
      }
    }
  };
}

function createService({ workspacesRepository, workspaceSettingsRepository } = {}) {
  if (!workspacesRepository || !workspaceSettingsRepository) {
    throw new Error("workspaceSettingsService requires workspacesRepository and workspaceSettingsRepository.");
  }

  const roleDescriptors = listRoleDescriptors();
  const assignableRoleIds = resolveAssignableRoleIds();

  async function requireWorkspace(workspaceContext, options = {}) {
    const workspaceId = Number(workspaceContext?.id);
    if (!Number.isInteger(workspaceId) || workspaceId < 1) {
      throw new AppError(409, "Workspace selection required.");
    }

    const workspace = await workspacesRepository.findById(workspaceId, options);
    if (!workspace) {
      throw new AppError(404, "Workspace not found.");
    }

    return workspace;
  }

  function getRoleCatalog() {
    return {
      collaborationEnabled: true,
      defaultInviteRole: "member",
      roles: roleDescriptors,
      assignableRoleIds
    };
  }

  async function getWorkspaceSettings(workspaceContext, options = {}) {
    const workspace = await requireWorkspace(workspaceContext, options);
    const settings = await workspaceSettingsRepository.ensureForWorkspaceId(
      workspace.id,
      DEFAULT_WORKSPACE_SETTINGS,
      options
    );
    const normalizedFeatures = normalizeWorkspaceFeatures(settings.features);
    const appSurfaceAccess = normalizedFeatures.surfaceAccess.app;
    const includeAppSurfaceDenyLists = options.includeAppSurfaceDenyLists === true;

    const settingsView = {
      invitesEnabled: settings?.invitesEnabled !== false
    };

    if (includeAppSurfaceDenyLists) {
      settingsView.appDenyEmails = [...appSurfaceAccess.denyEmails];
      settingsView.appDenyUserIds = [...appSurfaceAccess.denyUserIds];
    }

    return {
      workspace,
      settings: settingsView,
      roleCatalog: getRoleCatalog()
    };
  }

  async function updateWorkspaceSettings(workspaceContext, payload = {}, options = {}) {
    const source = normalizeObjectInput(payload);
    const workspacePatch = {};
    const settingsPatch = {};

    if (Object.hasOwn(source, "name")) {
      workspacePatch.name = source.name;
    }
    if (Object.hasOwn(source, "avatarUrl")) {
      workspacePatch.avatarUrl = source.avatarUrl;
    }
    if (Object.hasOwn(source, "color")) {
      workspacePatch.color = source.color;
    }
    if (Object.hasOwn(source, "invitesEnabled")) {
      settingsPatch.invitesEnabled = source.invitesEnabled;
    }
    if (Object.hasOwn(source, "appDenyEmails")) {
      settingsPatch.appDenyEmails = Array.isArray(source.appDenyEmails) ? [...source.appDenyEmails] : [];
    }
    if (Object.hasOwn(source, "appDenyUserIds")) {
      settingsPatch.appDenyUserIds = Array.isArray(source.appDenyUserIds) ? [...source.appDenyUserIds] : [];
    }

    const workspace = await requireWorkspace(workspaceContext, options);
    if (Object.keys(workspacePatch).length > 0) {
      await workspacesRepository.updateById(workspace.id, workspacePatch, options);
    }

    if (Object.keys(settingsPatch).length > 0) {
      const currentSettings = await workspaceSettingsRepository.ensureForWorkspaceId(
        workspace.id,
        DEFAULT_WORKSPACE_SETTINGS,
        options
      );
      const normalizedFeatures = normalizeWorkspaceFeatures(currentSettings.features);
      const nextFeatures = {
        ...normalizedFeatures,
        surfaceAccess: {
          ...normalizedFeatures.surfaceAccess,
          app: {
            ...normalizedFeatures.surfaceAccess.app
          }
        }
      };

      if (Object.hasOwn(settingsPatch, "appDenyEmails")) {
        nextFeatures.surfaceAccess.app.denyEmails = [...settingsPatch.appDenyEmails];
      }
      if (Object.hasOwn(settingsPatch, "appDenyUserIds")) {
        nextFeatures.surfaceAccess.app.denyUserIds = [...settingsPatch.appDenyUserIds];
      }

      await workspaceSettingsRepository.updateByWorkspaceId(
        workspace.id,
        {
          ...(Object.hasOwn(settingsPatch, "invitesEnabled")
            ? { invitesEnabled: settingsPatch.invitesEnabled }
            : {}),
          features: nextFeatures
        },
        options
      );
    }

    return getWorkspaceSettings(
      { id: workspace.id },
      {
        ...options,
        includeAppSurfaceDenyLists: true
      }
    );
  }

  return Object.freeze({
    getRoleCatalog,
    getWorkspaceSettings,
    updateWorkspaceSettings
  });
}

export { createService };
