import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { validateOperationSection } from "@jskit-ai/http-runtime/shared/contracts/operationValidation";
import { normalizeText, normalizeLowerText } from "@jskit-ai/kernel/shared/actions/textNormalization.js";
import { listRoleDescriptors, resolveAssignableRoleIds } from "../../shared/roles.js";
import { DEFAULT_WORKSPACE_SETTINGS, coerceWorkspaceColor } from "../../shared/settings.js";
import { workspaceSettingsSchema } from "../../shared/schemas/resources/workspaceSettingsSchema.js";

function isRecord(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeWorkspaceFeatures(features) {
  const source = isRecord(features) ? features : {};
  const surfaceAccess = isRecord(source.surfaceAccess) ? source.surfaceAccess : {};
  const appSurfaceAccess = isRecord(surfaceAccess.app) ? surfaceAccess.app : {};

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

function mapWorkspaceAdminSummary(workspace) {
  return {
    id: Number(workspace.id),
    slug: normalizeText(workspace.slug),
    name: normalizeText(workspace.name),
    ownerUserId: Number(workspace.ownerUserId),
    avatarUrl: normalizeText(workspace.avatarUrl),
    color: coerceWorkspaceColor(workspace.color)
  };
}

function mapWorkspaceSettingsResponse(settings, options = {}) {
  const normalizedFeatures = normalizeWorkspaceFeatures(settings?.features);
  const appPolicy = normalizedFeatures.surfaceAccess.app;
  const includeAppSurfaceDenyLists = options.includeAppSurfaceDenyLists === true;

  const response = {
    invitesEnabled: settings?.invitesEnabled !== false,
    invitesAvailable: true,
    invitesEffective: settings?.invitesEnabled !== false
  };

  if (includeAppSurfaceDenyLists) {
    response.appDenyEmails = [...appPolicy.denyEmails];
    response.appDenyUserIds = [...appPolicy.denyUserIds];
  }

  return response;
}

function parseWorkspaceSettingsUpdatePayload(payload = {}) {
  const operation = workspaceSettingsSchema.operations.patch;
  const parsed = validateOperationSection({
    operation,
    section: "body",
    value: payload
  });

  if (!parsed.ok) {
    return {
      workspacePatch: {},
      settingsPatch: {},
      fieldErrors: parsed.fieldErrors && typeof parsed.fieldErrors === "object" ? parsed.fieldErrors : {}
    };
  }

  const normalized = parsed.value && typeof parsed.value === "object" ? parsed.value : {};
  const workspacePatch = {};
  const settingsPatch = {};

  if (Object.hasOwn(normalized, "name")) {
    workspacePatch.name = normalized.name;
  }
  if (Object.hasOwn(normalized, "avatarUrl")) {
    workspacePatch.avatarUrl = normalized.avatarUrl;
  }
  if (Object.hasOwn(normalized, "color")) {
    workspacePatch.color = normalized.color;
  }
  if (Object.hasOwn(normalized, "invitesEnabled")) {
    settingsPatch.invitesEnabled = normalized.invitesEnabled;
  }
  if (Object.hasOwn(normalized, "appDenyEmails")) {
    settingsPatch.appDenyEmails = [...normalized.appDenyEmails];
  }
  if (Object.hasOwn(normalized, "appDenyUserIds")) {
    settingsPatch.appDenyUserIds = [...normalized.appDenyUserIds];
  }

  return {
    workspacePatch,
    settingsPatch,
    fieldErrors: {}
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

    return {
      workspace: mapWorkspaceAdminSummary(workspace),
      settings: mapWorkspaceSettingsResponse(settings, {
        includeAppSurfaceDenyLists: options.includeAppSurfaceDenyLists === true
      }),
      roleCatalog: getRoleCatalog()
    };
  }

  async function updateWorkspaceSettings(workspaceContext, payload = {}, options = {}) {
    const parsed = parseWorkspaceSettingsUpdatePayload(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      const operationMessages = workspaceSettingsSchema.operationMessages || {};
      throw new AppError(
        400,
        String(operationMessages.apiValidation || operationMessages.validation || "Validation failed."),
        {
          details: {
            fieldErrors: parsed.fieldErrors
          }
        }
      );
    }

    const workspace = await requireWorkspace(workspaceContext, options);
    if (Object.keys(parsed.workspacePatch).length > 0) {
      await workspacesRepository.updateById(workspace.id, parsed.workspacePatch, options);
    }

    if (Object.keys(parsed.settingsPatch).length > 0) {
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

      if (Object.hasOwn(parsed.settingsPatch, "appDenyEmails")) {
        nextFeatures.surfaceAccess.app.denyEmails = [...parsed.settingsPatch.appDenyEmails];
      }
      if (Object.hasOwn(parsed.settingsPatch, "appDenyUserIds")) {
        nextFeatures.surfaceAccess.app.denyUserIds = [...parsed.settingsPatch.appDenyUserIds];
      }

      await workspaceSettingsRepository.updateByWorkspaceId(
        workspace.id,
        {
          ...(Object.hasOwn(parsed.settingsPatch, "invitesEnabled")
            ? { invitesEnabled: parsed.settingsPatch.invitesEnabled }
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
