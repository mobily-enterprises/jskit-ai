import { createHash } from "node:crypto";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACE,
  normalizeTenancyMode
} from "@jskit-ai/kernel/shared/surface";
import { coerceWorkspaceColor } from "../../../shared/settings.js";
import {
  OWNER_ROLE_ID,
  resolveRolePermissions
} from "../../../shared/roles.js";
import {
  mapWorkspaceSummary
} from "../formatters/workspaceFormatter.js";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { authenticatedUserValidator } from "../validators/authenticatedUserValidator.js";

function toSlugPart(value) {
  const normalized = normalizeLowerText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "workspace";
}

function buildWorkspaceBaseSlug(user = {}) {
  const displayName = normalizeText(user.displayName);
  if (displayName) {
    return toSlugPart(displayName);
  }
  const email = normalizeLowerText(user.email);
  if (email.includes("@")) {
    return toSlugPart(email.split("@")[0]);
  }
  return "workspace";
}

function buildWorkspaceName(user = {}) {
  const displayName = normalizeText(user.displayName);
  if (displayName) {
    return `${displayName}'s Workspace`;
  }
  const email = normalizeLowerText(user.email);
  if (email) {
    return `${email}'s Workspace`;
  }
  return "Workspace";
}

function buildPermissionsFromMembership(membership) {
  const roleId = normalizeLowerText(membership?.roleId || "member");
  return resolveRolePermissions(roleId);
}

function hashInviteToken(token) {
  return createHash("sha256").update(normalizeText(token)).digest("hex");
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = normalizeLowerText(value);
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return fallback;
}

function createService({
  appConfig = {},
  workspacesRepository,
  workspaceMembershipsRepository,
  workspaceSettingsRepository
} = {}) {
  if (
    !workspacesRepository ||
    !workspaceMembershipsRepository ||
    !workspaceSettingsRepository
  ) {
    throw new Error("workspaceService requires repositories.");
  }

  const defaultAppFeatures = Object.freeze({
    workspaceSwitching: true,
    workspaceInvites: true,
    workspaceCreateEnabled: false,
    assistantEnabled: false,
    assistantRequiredPermission: "",
    socialEnabled: false,
    socialFederationEnabled: false
  });
  const resolvedTenancyMode = normalizeTenancyMode(appConfig.tenancyMode);
  const resolvedWorkspaceColor = coerceWorkspaceColor(appConfig.workspaceColor);
  const resolvedAppFeatures = Object.freeze({
    workspaceSwitching: normalizeBoolean(appConfig.workspaceSwitching, defaultAppFeatures.workspaceSwitching),
    workspaceInvites: normalizeBoolean(appConfig.workspaceInvites, defaultAppFeatures.workspaceInvites),
    workspaceCreateEnabled: normalizeBoolean(appConfig.workspaceCreateEnabled, defaultAppFeatures.workspaceCreateEnabled),
    assistantEnabled: normalizeBoolean(appConfig.assistantEnabled, defaultAppFeatures.assistantEnabled),
    assistantRequiredPermission: normalizeText(appConfig.assistantRequiredPermission),
    socialEnabled: normalizeBoolean(appConfig.socialEnabled, defaultAppFeatures.socialEnabled),
    socialFederationEnabled: normalizeBoolean(appConfig.socialFederationEnabled, defaultAppFeatures.socialFederationEnabled)
  });
  async function ensureUniqueWorkspaceSlug(baseSlug, options = {}) {
    let suffix = 0;
    while (suffix < 1000) {
      suffix += 1;
      const candidate = suffix === 1 ? toSlugPart(baseSlug) : `${toSlugPart(baseSlug)}-${suffix}`;
      const existing = await workspacesRepository.findBySlug(candidate, options);
      if (!existing) {
        return candidate;
      }
    }
    throw new AppError(500, "Unable to generate unique workspace slug.");
  }

  async function ensureWorkspaceSettingsForWorkspace(workspace, options = {}) {
    return workspaceSettingsRepository.ensureForWorkspaceId(workspace?.id, {
      ...options,
      workspace
    });
  }

  async function ensurePersonalWorkspaceForUser(user, options = {}) {
    const normalizedUser = authenticatedUserValidator.normalize(user);
    if (!normalizedUser) {
      throw new AppError(400, "Invalid authenticated user payload.");
    }

    const existing = await workspacesRepository.findPersonalByOwnerUserId(normalizedUser.id, options);
    if (existing) {
      await workspaceMembershipsRepository.ensureOwnerMembership(existing.id, normalizedUser.id, options);
      await ensureWorkspaceSettingsForWorkspace(existing, options);
      return existing;
    }

    const slug = await ensureUniqueWorkspaceSlug(buildWorkspaceBaseSlug(normalizedUser), options);
    const inserted = await workspacesRepository.insert(
      {
        slug,
        name: buildWorkspaceName(normalizedUser),
        ownerUserId: normalizedUser.id,
        isPersonal: true,
        avatarUrl: "",
        color: resolvedWorkspaceColor
      },
      options
    );

    await workspaceMembershipsRepository.ensureOwnerMembership(inserted.id, normalizedUser.id, options);
    await ensureWorkspaceSettingsForWorkspace(inserted, options);
    return inserted;
  }

  async function listWorkspacesForUser(user, options = {}) {
    const normalizedUser = authenticatedUserValidator.normalize(user);
    if (!normalizedUser) {
      return [];
    }

    if (resolvedTenancyMode === TENANCY_MODE_NONE) {
      return [];
    }

    await ensurePersonalWorkspaceForUser(normalizedUser, options);
    const list = await workspacesRepository.listForUserId(normalizedUser.id, options);
    const accessible = list
      .map((entry) => mapWorkspaceSummary(entry, { roleId: entry.roleId, status: entry.membershipStatus }))
      .filter((entry) => entry.isAccessible);

    if (resolvedTenancyMode === TENANCY_MODE_PERSONAL) {
      const personalWorkspace = await workspacesRepository.findPersonalByOwnerUserId(normalizedUser.id, options);
      if (!personalWorkspace) {
        return [];
      }
      const personalWorkspaceId = Number(personalWorkspace.id);
      return accessible.filter((entry) => Number(entry.id) === personalWorkspaceId);
    }

    return accessible;
  }

  async function listWorkspacesForAuthenticatedUser(user, options = {}) {
    return listWorkspacesForUser(user, options);
  }

  async function resolveWorkspaceContextForUserBySlug(user, workspaceSlug, options = {}) {
    const normalizedUser = authenticatedUserValidator.normalize(user);
    if (!normalizedUser) {
      throw new AppError(401, "Authentication required.");
    }

    if (resolvedTenancyMode === TENANCY_MODE_NONE) {
      throw new AppError(403, "Workspace context is disabled.");
    }

    const normalizedWorkspaceSlug = normalizeLowerText(workspaceSlug);
    if (!normalizedWorkspaceSlug) {
      throw new AppError(400, "workspaceSlug is required.");
    }

    let workspace = null;
    if (resolvedTenancyMode === TENANCY_MODE_PERSONAL) {
      workspace = await ensurePersonalWorkspaceForUser(normalizedUser, options);
      const personalWorkspaceSlug = normalizeLowerText(workspace.slug);
      if (normalizedWorkspaceSlug !== personalWorkspaceSlug) {
        throw new AppError(403, "Only the personal workspace can be used.");
      }
    } else {
      workspace = await workspacesRepository.findBySlug(normalizedWorkspaceSlug, options);
    }

    if (!workspace) {
      throw new AppError(404, "Workspace not found.");
    }

    const membership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(
      workspace.id,
      normalizedUser.id,
      options
    );
    if (!membership || normalizeLowerText(membership.status) !== "active") {
      throw new AppError(403, "You do not have access to this workspace.");
    }

    const workspaceSettings = await ensureWorkspaceSettingsForWorkspace(workspace, options);
    const permissions = buildPermissionsFromMembership(membership);

    return {
      workspace,
      membership,
      permissions,
      workspaceSettings
    };
  }

  return Object.freeze({
    toSlugPart,
    buildWorkspaceName,
    buildWorkspaceBaseSlug,
    hashInviteToken,
    ensurePersonalWorkspaceForUser,
    listWorkspacesForUser,
    listWorkspacesForAuthenticatedUser,
    resolveWorkspaceContextForUserBySlug
  });
}

export { createService };
