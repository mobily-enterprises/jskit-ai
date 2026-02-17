import crypto from "node:crypto";
import { AppError } from "../lib/errors.js";
import { OWNER_ROLE_ID } from "../lib/rbacManifest.js";
import { SETTINGS_MODE_OPTIONS, SETTINGS_TIMING_OPTIONS } from "../shared/settings/index.js";

const INVITE_EXPIRY_DAYS = 7;

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function parsePositiveInteger(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1) {
    return null;
  }

  return numeric;
}

function normalizeWorkspaceAvatarUrl(value) {
  if (value == null) {
    return "";
  }

  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          avatarUrl: "Workspace avatar URL must be a valid absolute URL."
        }
      }
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(400, "Validation failed.", {
      details: {
        fieldErrors: {
          avatarUrl: "Workspace avatar URL must start with http:// or https://."
        }
      }
    });
  }

  return parsed.toString();
}

function toRoleDescriptor(roleId, role) {
  const normalizedRole = role && typeof role === "object" ? role : {};
  const permissions = Array.isArray(normalizedRole.permissions)
    ? Array.from(
        new Set(
          normalizedRole.permissions.map((permission) => String(permission || "").trim()).filter(Boolean)
        )
      )
    : [];

  return {
    id: String(roleId || ""),
    assignable: Boolean(normalizedRole.assignable),
    permissions
  };
}

function listRoleDescriptors(rbacManifest) {
  const roles = rbacManifest && typeof rbacManifest.roles === "object" ? rbacManifest.roles : {};
  const descriptors = Object.entries(roles)
    .map(([roleId, role]) => toRoleDescriptor(roleId, role))
    .filter((role) => role.id)
    .sort((left, right) => {
      if (left.id === OWNER_ROLE_ID) {
        return -1;
      }
      if (right.id === OWNER_ROLE_ID) {
        return 1;
      }

      return left.id.localeCompare(right.id);
    });

  return descriptors;
}

function resolveAssignableRoleIds(rbacManifest) {
  return listRoleDescriptors(rbacManifest)
    .filter((role) => role.id !== OWNER_ROLE_ID && role.assignable)
    .map((role) => role.id);
}

function resolveWorkspaceDefaults(policy) {
  const normalizedPolicy = policy && typeof policy === "object" ? policy : {};

  const defaultModeCandidate = String(normalizedPolicy.defaultMode || "").trim().toLowerCase();
  const defaultTimingCandidate = String(normalizedPolicy.defaultTiming || "").trim().toLowerCase();
  const defaultPaymentsPerYearCandidate = Number(normalizedPolicy.defaultPaymentsPerYear);
  const defaultHistoryPageSizeCandidate = Number(normalizedPolicy.defaultHistoryPageSize);

  return {
    defaultMode: SETTINGS_MODE_OPTIONS.includes(defaultModeCandidate) ? defaultModeCandidate : "fv",
    defaultTiming: SETTINGS_TIMING_OPTIONS.includes(defaultTimingCandidate) ? defaultTimingCandidate : "ordinary",
    defaultPaymentsPerYear:
      Number.isInteger(defaultPaymentsPerYearCandidate) &&
      defaultPaymentsPerYearCandidate >= 1 &&
      defaultPaymentsPerYearCandidate <= 365
        ? defaultPaymentsPerYearCandidate
        : 12,
    defaultHistoryPageSize:
      Number.isInteger(defaultHistoryPageSizeCandidate) &&
      defaultHistoryPageSizeCandidate >= 1 &&
      defaultHistoryPageSizeCandidate <= 100
        ? defaultHistoryPageSizeCandidate
        : 10
  };
}

function parseWorkspaceSettingsPatch(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const fieldErrors = {};
  const workspacePatch = {};
  const settingsPatch = {};
  const defaultsPatch = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    const name = String(body.name || "").trim();
    if (!name) {
      fieldErrors.name = "Workspace name is required.";
    } else if (name.length > 160) {
      fieldErrors.name = "Workspace name must be at most 160 characters.";
    } else {
      workspacePatch.name = name;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "avatarUrl")) {
    try {
      workspacePatch.avatarUrl = normalizeWorkspaceAvatarUrl(body.avatarUrl);
    } catch (error) {
      if (error instanceof AppError && error.details?.fieldErrors?.avatarUrl) {
        fieldErrors.avatarUrl = String(error.details.fieldErrors.avatarUrl);
      } else {
        fieldErrors.avatarUrl = "Workspace avatar URL is invalid.";
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "invitesEnabled")) {
    if (typeof body.invitesEnabled !== "boolean") {
      fieldErrors.invitesEnabled = "Invites enabled must be a boolean.";
    } else {
      settingsPatch.invitesEnabled = body.invitesEnabled;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "defaultMode")) {
    const value = String(body.defaultMode || "").trim().toLowerCase();
    if (!SETTINGS_MODE_OPTIONS.includes(value)) {
      fieldErrors.defaultMode = "Default mode must be fv or pv.";
    } else {
      defaultsPatch.defaultMode = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "defaultTiming")) {
    const value = String(body.defaultTiming || "").trim().toLowerCase();
    if (!SETTINGS_TIMING_OPTIONS.includes(value)) {
      fieldErrors.defaultTiming = "Default timing must be ordinary or due.";
    } else {
      defaultsPatch.defaultTiming = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "defaultPaymentsPerYear")) {
    const value = Number(body.defaultPaymentsPerYear);
    if (!Number.isInteger(value) || value < 1 || value > 365) {
      fieldErrors.defaultPaymentsPerYear = "Default payments per year must be an integer from 1 to 365.";
    } else {
      defaultsPatch.defaultPaymentsPerYear = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "defaultHistoryPageSize")) {
    const value = Number(body.defaultHistoryPageSize);
    if (!Number.isInteger(value) || value < 1 || value > 100) {
      fieldErrors.defaultHistoryPageSize = "Default history page size must be an integer from 1 to 100.";
    } else {
      defaultsPatch.defaultHistoryPageSize = value;
    }
  }

  if (Object.keys(defaultsPatch).length > 0) {
    settingsPatch.defaults = defaultsPatch;
  }

  return {
    workspacePatch,
    settingsPatch,
    fieldErrors
  };
}

function mapWorkspaceSummary(workspace) {
  return {
    id: Number(workspace.id),
    slug: String(workspace.slug || ""),
    name: String(workspace.name || ""),
    avatarUrl: workspace.avatarUrl ? String(workspace.avatarUrl) : "",
    ownerUserId: Number(workspace.ownerUserId),
    isPersonal: Boolean(workspace.isPersonal)
  };
}

function createWorkspaceAdminService({
  appConfig,
  rbacManifest,
  workspacesRepository,
  workspaceSettingsRepository,
  workspaceMembershipsRepository,
  workspaceInvitesRepository,
  userProfilesRepository,
  userSettingsRepository
}) {
  if (
    !workspacesRepository ||
    !workspaceSettingsRepository ||
    !workspaceMembershipsRepository ||
    !workspaceInvitesRepository ||
    !userProfilesRepository
  ) {
    throw new Error("workspace admin repositories are required.");
  }

  const roleDescriptors = listRoleDescriptors(rbacManifest);
  const assignableRoleIds = resolveAssignableRoleIds(rbacManifest);

  async function requireWorkspace(workspaceContext) {
    const workspaceId = parsePositiveInteger(workspaceContext?.id);
    if (!workspaceId) {
      throw new AppError(409, "Workspace selection required.");
    }

    const workspace = await workspacesRepository.findById(workspaceId);
    if (!workspace) {
      throw new AppError(404, "Workspace not found.");
    }

    return workspace;
  }

  function normalizeRoleForAssignment(roleId) {
    const normalized = String(roleId || "").trim();
    if (!normalized) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleId: "Role is required."
          }
        }
      });
    }

    if (!assignableRoleIds.includes(normalized)) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            roleId: "Role is not assignable."
          }
        }
      });
    }

    return normalized;
  }

  async function ensureWorkspaceSettings(workspaceId) {
    return workspaceSettingsRepository.ensureForWorkspaceId(workspaceId, {
      invitesEnabled: Boolean(appConfig.features.workspaceInvites),
      features: {},
      policy: {
        defaultMode: "fv",
        defaultTiming: "ordinary",
        defaultPaymentsPerYear: 12,
        defaultHistoryPageSize: 10
      }
    });
  }

  function mapWorkspaceSettingsResponse(workspace, workspaceSettings) {
    const defaults = resolveWorkspaceDefaults(workspaceSettings?.policy);
    const invitesAvailable = Boolean(appConfig.features.workspaceInvites && rbacManifest.collaborationEnabled);
    const invitesEnabled = Boolean(workspaceSettings?.invitesEnabled);

    return {
      workspace: mapWorkspaceSummary(workspace),
      settings: {
        invitesEnabled,
        invitesAvailable,
        invitesEffective: invitesAvailable && invitesEnabled,
        ...defaults
      }
    };
  }

  function mapMember(member, workspace) {
    return {
      userId: Number(member.userId),
      email: String(member.user?.email || ""),
      displayName: String(member.user?.displayName || ""),
      roleId: String(member.roleId || ""),
      status: String(member.status || "active"),
      isOwner: Number(member.userId) === Number(workspace.ownerUserId) || String(member.roleId || "") === OWNER_ROLE_ID
    };
  }

  function mapInvite(invite) {
    return {
      id: Number(invite.id),
      workspaceId: Number(invite.workspaceId),
      email: String(invite.email || ""),
      roleId: String(invite.roleId || ""),
      status: String(invite.status || "pending"),
      expiresAt: invite.expiresAt,
      invitedByUserId: invite.invitedByUserId == null ? null : Number(invite.invitedByUserId),
      invitedByDisplayName: invite.invitedBy?.displayName || "",
      invitedByEmail: invite.invitedBy?.email || "",
      workspace: invite.workspace
        ? {
            id: Number(invite.workspace.id),
            slug: String(invite.workspace.slug || ""),
            name: String(invite.workspace.name || ""),
            avatarUrl: invite.workspace.avatarUrl ? String(invite.workspace.avatarUrl) : ""
          }
        : null
    };
  }

  function buildInviteTokenHash() {
    const token = crypto.randomBytes(24).toString("hex");
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  function resolveInviteExpiresAt() {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + INVITE_EXPIRY_DAYS);
    return date.toISOString();
  }

  async function getWorkspaceSettings(workspaceContext) {
    const workspace = await requireWorkspace(workspaceContext);
    const workspaceSettings = await ensureWorkspaceSettings(workspace.id);

    return {
      ...mapWorkspaceSettingsResponse(workspace, workspaceSettings),
      roleCatalog: {
        collaborationEnabled: Boolean(rbacManifest.collaborationEnabled),
        defaultInviteRole: rbacManifest.defaultInviteRole,
        roles: roleDescriptors,
        assignableRoleIds
      }
    };
  }

  async function updateWorkspaceSettings(workspaceContext, payload) {
    const workspace = await requireWorkspace(workspaceContext);
    const parsed = parseWorkspaceSettingsPatch(payload);

    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: parsed.fieldErrors
        }
      });
    }

    if (Object.keys(parsed.workspacePatch).length > 0) {
      await workspacesRepository.updateById(workspace.id, parsed.workspacePatch);
    }

    const currentSettings = await ensureWorkspaceSettings(workspace.id);
    const settingsPatch = {};

    if (Object.prototype.hasOwnProperty.call(parsed.settingsPatch, "invitesEnabled")) {
      settingsPatch.invitesEnabled = parsed.settingsPatch.invitesEnabled;
    }

    if (parsed.settingsPatch.defaults) {
      settingsPatch.policy = {
        ...(currentSettings?.policy && typeof currentSettings.policy === "object" ? currentSettings.policy : {}),
        ...parsed.settingsPatch.defaults
      };
    }

    if (Object.keys(settingsPatch).length > 0) {
      await workspaceSettingsRepository.updateByWorkspaceId(workspace.id, settingsPatch);
    }

    const updatedWorkspace = await workspacesRepository.findById(workspace.id);
    const updatedSettings = await ensureWorkspaceSettings(workspace.id);

    return {
      ...mapWorkspaceSettingsResponse(updatedWorkspace, updatedSettings),
      roleCatalog: {
        collaborationEnabled: Boolean(rbacManifest.collaborationEnabled),
        defaultInviteRole: rbacManifest.defaultInviteRole,
        roles: roleDescriptors,
        assignableRoleIds
      }
    };
  }

  async function listMembers(workspaceContext) {
    const workspace = await requireWorkspace(workspaceContext);
    const members = await workspaceMembershipsRepository.listActiveByWorkspaceId(workspace.id);

    return {
      workspace: mapWorkspaceSummary(workspace),
      members: members.map((member) => mapMember(member, workspace)),
      roleCatalog: {
        collaborationEnabled: Boolean(rbacManifest.collaborationEnabled),
        defaultInviteRole: rbacManifest.defaultInviteRole,
        roles: roleDescriptors,
        assignableRoleIds
      }
    };
  }

  async function updateMemberRole(workspaceContext, payload) {
    const workspace = await requireWorkspace(workspaceContext);
    const memberUserId = parsePositiveInteger(payload?.memberUserId);
    if (!memberUserId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            memberUserId: "memberUserId is required."
          }
        }
      });
    }

    const roleId = normalizeRoleForAssignment(payload?.roleId);

    const existingMembership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspace.id, memberUserId);
    if (!existingMembership || existingMembership.status !== "active") {
      throw new AppError(404, "Member not found.");
    }

    if (Number(memberUserId) === Number(workspace.ownerUserId) || String(existingMembership.roleId || "") === OWNER_ROLE_ID) {
      throw new AppError(409, "Cannot change workspace owner role.");
    }

    await workspaceMembershipsRepository.updateRoleByWorkspaceIdAndUserId(workspace.id, memberUserId, roleId);
    return listMembers(workspace);
  }

  async function listInvites(workspaceContext) {
    const workspace = await requireWorkspace(workspaceContext);
    await workspaceInvitesRepository.markExpiredPendingInvites();
    const invites = await workspaceInvitesRepository.listPendingByWorkspaceIdWithWorkspace(workspace.id);

    return {
      workspace: mapWorkspaceSummary(workspace),
      invites: invites.map(mapInvite),
      roleCatalog: {
        collaborationEnabled: Boolean(rbacManifest.collaborationEnabled),
        defaultInviteRole: rbacManifest.defaultInviteRole,
        roles: roleDescriptors,
        assignableRoleIds
      }
    };
  }

  async function createInvite(workspaceContext, actorUser, payload) {
    const workspace = await requireWorkspace(workspaceContext);
    const settings = await ensureWorkspaceSettings(workspace.id);
    const invitesAvailable = Boolean(appConfig.features.workspaceInvites && rbacManifest.collaborationEnabled);

    if (!invitesAvailable || !settings.invitesEnabled) {
      throw new AppError(403, "Workspace invites are disabled.");
    }

    const email = normalizeEmail(payload?.email);
    if (!email) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            email: "Invite email is required."
          }
        }
      });
    }

    const roleId = normalizeRoleForAssignment(payload?.roleId || rbacManifest.defaultInviteRole);
    const existingMembership = await userProfilesRepository.findByEmail(email);
    if (existingMembership) {
      const memberInWorkspace = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspace.id, existingMembership.id);
      if (memberInWorkspace && memberInWorkspace.status === "active") {
        throw new AppError(409, "User is already a workspace member.");
      }
    }

    const pendingExisting = await workspaceInvitesRepository.findPendingByWorkspaceIdAndEmail(workspace.id, email);
    if (pendingExisting) {
      throw new AppError(409, "A pending invite for this email already exists.");
    }

    await workspaceInvitesRepository.insert({
      workspaceId: workspace.id,
      email,
      roleId,
      tokenHash: buildInviteTokenHash(),
      invitedByUserId: Number(actorUser?.id) || null,
      expiresAt: resolveInviteExpiresAt(),
      status: "pending"
    });

    return listInvites(workspace);
  }

  async function revokeInvite(workspaceContext, inviteId) {
    const workspace = await requireWorkspace(workspaceContext);
    const numericInviteId = parsePositiveInteger(inviteId);
    if (!numericInviteId) {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            inviteId: "inviteId is required."
          }
        }
      });
    }

    const invite = await workspaceInvitesRepository.findPendingByIdForWorkspace(numericInviteId, workspace.id);
    if (!invite) {
      throw new AppError(404, "Invite not found.");
    }

    await workspaceInvitesRepository.revokeById(numericInviteId);
    return listInvites(workspace);
  }

  async function listPendingInvitesForUser(user) {
    const email = normalizeEmail(user?.email);
    if (!email) {
      return [];
    }

    await workspaceInvitesRepository.markExpiredPendingInvites();
    const pending = await workspaceInvitesRepository.listPendingByEmail(email);
    const userId = parsePositiveInteger(user?.id);

    if (!userId) {
      return pending.map(mapInvite);
    }

    const filtered = [];
    for (const invite of pending) {
      const membership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(invite.workspaceId, userId);
      if (!membership || membership.status !== "active") {
        filtered.push(invite);
      }
    }

    return filtered.map(mapInvite);
  }

  async function respondToPendingInvite({ user, inviteId, decision }) {
    const userId = parsePositiveInteger(user?.id);
    const email = normalizeEmail(user?.email);
    if (!userId || !email) {
      throw new AppError(401, "Authentication required.");
    }

    const normalizedDecision = String(decision || "").trim().toLowerCase();
    if (normalizedDecision !== "accept" && normalizedDecision !== "refuse") {
      throw new AppError(400, "Validation failed.", {
        details: {
          fieldErrors: {
            decision: "decision must be accept or refuse."
          }
        }
      });
    }

    await workspaceInvitesRepository.markExpiredPendingInvites();
    const invite = await workspaceInvitesRepository.findPendingByIdAndEmail(inviteId, email);
    if (!invite) {
      throw new AppError(404, "Invite not found.");
    }

    if (normalizedDecision === "refuse") {
      await workspaceInvitesRepository.revokeById(invite.id);
      return {
        ok: true,
        decision: "refused",
        inviteId: Number(invite.id),
        workspace: invite.workspace
          ? {
              id: Number(invite.workspace.id),
              slug: String(invite.workspace.slug || ""),
              name: String(invite.workspace.name || ""),
              avatarUrl: invite.workspace.avatarUrl ? String(invite.workspace.avatarUrl) : ""
            }
          : null
      };
    }

    const roleId = normalizeRoleForAssignment(invite.roleId || rbacManifest.defaultInviteRole);
    await workspaceMembershipsRepository.ensureActiveByWorkspaceIdAndUserId(invite.workspaceId, userId, roleId);
    await workspaceInvitesRepository.markAcceptedById(invite.id);

    if (userSettingsRepository && typeof userSettingsRepository.updateLastActiveWorkspaceId === "function") {
      await userSettingsRepository.updateLastActiveWorkspaceId(userId, invite.workspaceId);
    }

    const workspace = invite.workspace ? await workspacesRepository.findById(invite.workspace.id) : null;

    return {
      ok: true,
      decision: "accepted",
      inviteId: Number(invite.id),
      workspace: workspace
        ? {
            id: Number(workspace.id),
            slug: String(workspace.slug || ""),
            name: String(workspace.name || ""),
            avatarUrl: workspace.avatarUrl ? String(workspace.avatarUrl) : ""
          }
        : null
    };
  }

  function getRoleCatalog() {
    return {
      collaborationEnabled: Boolean(rbacManifest.collaborationEnabled),
      defaultInviteRole: rbacManifest.defaultInviteRole,
      roles: roleDescriptors,
      assignableRoleIds
    };
  }

  return {
    getRoleCatalog,
    getWorkspaceSettings,
    updateWorkspaceSettings,
    listMembers,
    updateMemberRole,
    listInvites,
    createInvite,
    revokeInvite,
    listPendingInvitesForUser,
    respondToPendingInvite
  };
}

export {
  createWorkspaceAdminService,
  normalizeEmail,
  parseWorkspaceSettingsPatch,
  listRoleDescriptors,
  resolveAssignableRoleIds,
  resolveWorkspaceDefaults
};
