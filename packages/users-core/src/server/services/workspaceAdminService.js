import { randomBytes } from "node:crypto";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  listRoleDescriptors,
  resolveAssignableRoleIds,
  OWNER_ROLE_ID,
  hasPermission
} from "../../shared/roles.js";
import {
  DEFAULT_WORKSPACE_SETTINGS,
  coerceWorkspaceColor
} from "../../shared/settings.js";
import {
  parseWorkspaceSettingsPatch,
  workspaceSettingsSchema
} from "../../shared/contracts/resources/workspaceSettingsSchema.js";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeLowerText(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeEmail(value) {
  return normalizeLowerText(value);
}

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
    response.appSurfaceAccess = {
      denyEmails: [...appPolicy.denyEmails],
      denyUserIds: [...appPolicy.denyUserIds]
    };
  }

  return response;
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

function mapMemberSummary(member, workspace) {
  return {
    userId: Number(member.userId),
    roleId: normalizeLowerText(member.roleId || "member") || "member",
    status: normalizeLowerText(member.status || "active") || "active",
    displayName: normalizeText(member.displayName),
    email: normalizeLowerText(member.email),
    isOwner:
      Number(member.userId) === Number(workspace.ownerUserId) ||
      normalizeLowerText(member.roleId) === OWNER_ROLE_ID
  };
}

function mapInviteSummary(invite) {
  return {
    id: Number(invite.id),
    email: normalizeLowerText(invite.email),
    roleId: normalizeLowerText(invite.roleId || "member") || "member",
    status: normalizeLowerText(invite.status || "pending") || "pending",
    expiresAt: invite.expiresAt,
    invitedByUserId: invite.invitedByUserId == null ? null : Number(invite.invitedByUserId)
  };
}

function createService({
  workspacesRepository,
  workspaceSettingsRepository,
  workspaceMembershipsRepository,
  workspaceInvitesRepository,
  workspaceService
} = {}) {
  if (
    !workspacesRepository ||
    !workspaceSettingsRepository ||
    !workspaceMembershipsRepository ||
    !workspaceInvitesRepository ||
    !workspaceService
  ) {
    throw new Error("workspaceAdminService requires repositories and workspaceService.");
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
    const parsed = parseWorkspaceSettingsPatch(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      const operationMessages = workspaceSettingsSchema.operations.patch.messages || {};
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

  async function listMembers(workspaceContext, options = {}) {
    const workspace = await requireWorkspace(workspaceContext, options);
    const members = await workspaceMembershipsRepository.listActiveByWorkspaceId(workspace.id, options);

    return {
      workspace: mapWorkspaceAdminSummary(workspace),
      members: members.map((member) => mapMemberSummary(member, workspace)),
      roleCatalog: getRoleCatalog()
    };
  }

  async function updateMemberRole(workspaceContext, payload = {}, options = {}) {
    const workspace = await requireWorkspace(workspaceContext, options);
    const memberUserId = Number(payload.memberUserId);
    if (!Number.isInteger(memberUserId) || memberUserId < 1) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            memberUserId: "memberUserId is required."
          }
        }
      });
    }

    const roleId = normalizeLowerText(payload.roleId);
    if (!roleId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleId: "Role is required."
          }
        }
      });
    }
    if (!assignableRoleIds.includes(roleId)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleId: "Role is not assignable."
          }
        }
      });
    }

    const existingMembership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(
      workspace.id,
      memberUserId,
      options
    );
    if (!existingMembership || existingMembership.status !== "active") {
      throw new AppError(404, "Member not found.");
    }
    if (Number(memberUserId) === Number(workspace.ownerUserId) || existingMembership.roleId === OWNER_ROLE_ID) {
      throw new AppError(409, "Cannot change workspace owner role.");
    }

    await workspaceMembershipsRepository.upsertMembership(
      workspace.id,
      memberUserId,
      {
        roleId,
        status: "active"
      },
      options
    );

    return listMembers({ id: workspace.id }, options);
  }

  async function listInvites(workspaceContext, options = {}) {
    const workspace = await requireWorkspace(workspaceContext, options);
    const invites = await workspaceInvitesRepository.listPendingByWorkspaceIdWithWorkspace(workspace.id, options);

    return {
      workspace: mapWorkspaceAdminSummary(workspace),
      invites: invites.map(mapInviteSummary),
      roleCatalog: getRoleCatalog()
    };
  }

  async function createInvite(workspaceContext, user, payload = {}, options = {}) {
    const workspace = await requireWorkspace(workspaceContext, options);
    const email = normalizeEmail(payload.email);
    if (!email || !email.includes("@")) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            email: "Valid email is required."
          }
        }
      });
    }

    const roleId = normalizeLowerText(payload.roleId || "member") || "member";
    if (!assignableRoleIds.includes(roleId)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleId: "Role is not assignable."
          }
        }
      });
    }

    const token = randomBytes(24).toString("hex");
    const tokenHash = workspaceService.hashInviteToken(token);
    await workspaceInvitesRepository.expirePendingByWorkspaceIdAndEmail(workspace.id, email, options);
    await workspaceInvitesRepository.insert(
      {
        workspaceId: workspace.id,
        email,
        roleId,
        status: "pending",
        tokenHash,
        invitedByUserId: Number(user?.id || 0) || null,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      },
      options
    );

    const response = await listInvites({ id: workspace.id }, options);
    return {
      ...response,
      inviteTokenPreview: token
    };
  }

  async function revokeInvite(workspaceContext, inviteId, options = {}) {
    const workspace = await requireWorkspace(workspaceContext, options);
    const numericInviteId = Number(inviteId);
    if (!Number.isInteger(numericInviteId) || numericInviteId < 1) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            inviteId: "inviteId must be a positive integer."
          }
        }
      });
    }

    const invite = await workspaceInvitesRepository.findPendingByIdForWorkspace(numericInviteId, workspace.id, options);
    if (!invite) {
      throw new AppError(404, "Invite not found.");
    }

    await workspaceInvitesRepository.revokeById(numericInviteId, options);
    return listInvites({ id: workspace.id }, options);
  }

  async function respondToPendingInviteByToken({ user, inviteToken, decision } = {}, options = {}) {
    const normalizedDecision = normalizeLowerText(decision);
    if (normalizedDecision !== "accept" && normalizedDecision !== "refuse") {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            decision: "decision must be accept or refuse."
          }
        }
      });
    }

    const token = normalizeText(inviteToken);
    if (!token) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            token: "token is required."
          }
        }
      });
    }

    return workspaceService.redeemInviteByToken(
      {
        user,
        token,
        decision: normalizedDecision
      },
      options
    );
  }

  function canAccessWorkspaceSettings(permissions = []) {
    return hasPermission(permissions, "workspace.settings.view") || hasPermission(permissions, "workspace.settings.update");
  }

  return Object.freeze({
    getRoleCatalog,
    getWorkspaceSettings,
    updateWorkspaceSettings,
    listMembers,
    updateMemberRole,
    listInvites,
    createInvite,
    revokeInvite,
    respondToPendingInviteByToken,
    canAccessWorkspaceSettings
  });
}

export { createService };
