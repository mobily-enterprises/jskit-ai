import { createHash } from "node:crypto";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import {
  TENANCY_MODE_NONE,
  resolveTenancyProfile
} from "../../../shared/tenancyProfile.js";
import { coerceWorkspaceColor } from "../../../shared/settings.js";
import {
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
  const username = normalizeLowerText(user.username);
  if (username) {
    return toSlugPart(username);
  }
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

function buildPermissionsFromMembership(membership, appConfig = {}) {
  const roleId = normalizeLowerText(membership?.roleId || "member");
  return resolveRolePermissions(roleId, appConfig);
}

function hashInviteToken(token) {
  return createHash("sha256").update(normalizeText(token)).digest("hex");
}

function normalizeWorkspaceCreationInput(payload = {}) {
  const source = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  return {
    name: normalizeText(source.name),
    requestedSlug: normalizeLowerText(source.slug)
  };
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

  const resolvedTenancyProfile = resolveTenancyProfile(appConfig);
  const resolvedTenancyMode = resolvedTenancyProfile.mode;
  const workspacePolicy = resolvedTenancyProfile.workspace;
  const resolvedWorkspaceColor = coerceWorkspaceColor(appConfig.workspaceColor);
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

    const list = await workspacesRepository.listForUserId(normalizedUser.id, options);
    const accessible = list
      .map((entry) => mapWorkspaceSummary(entry, { roleId: entry.roleId, status: entry.membershipStatus }))
      .filter((entry) => entry.isAccessible);

    return accessible;
  }

  async function listWorkspacesForAuthenticatedUser(user, options = {}) {
    return listWorkspacesForUser(user, options);
  }

  async function provisionWorkspaceForNewUser(user, options = {}) {
    const normalizedUser = authenticatedUserValidator.normalize(user);
    if (!normalizedUser) {
      throw new AppError(400, "Invalid authenticated user payload.");
    }

    if (workspacePolicy.autoProvision !== true) {
      return null;
    }

    return ensurePersonalWorkspaceForUser(normalizedUser, options);
  }

  async function createWorkspaceForAuthenticatedUser(user, payload = {}, options = {}) {
    const normalizedUser = authenticatedUserValidator.normalize(user);
    if (!normalizedUser) {
      throw new AppError(401, "Authentication required.");
    }

    if (workspacePolicy.allowSelfCreate !== true) {
      throw new AppError(403, "Workspace creation is disabled for this tenancy mode.");
    }

    const createInput = normalizeWorkspaceCreationInput(payload);
    if (!createInput.name) {
      throw new AppError(400, "Workspace name is required.");
    }

    const slugBase = createInput.requestedSlug || toSlugPart(createInput.name);
    const slug = await ensureUniqueWorkspaceSlug(slugBase, options);
    const inserted = await workspacesRepository.insert(
      {
        slug,
        name: createInput.name,
        ownerUserId: normalizedUser.id,
        isPersonal: false,
        avatarUrl: "",
        color: resolvedWorkspaceColor
      },
      options
    );

    await workspaceMembershipsRepository.ensureOwnerMembership(inserted.id, normalizedUser.id, options);
    await ensureWorkspaceSettingsForWorkspace(inserted, options);
    return inserted;
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

    const workspace = await workspacesRepository.findBySlug(normalizedWorkspaceSlug, options);

    if (!workspace) {
      throw new AppError(404, "Workspace not found.");
    }

    let membership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(
      workspace.id,
      normalizedUser.id,
      options
    );
    const actorOwnsWorkspace = Number(workspace.ownerUserId) === Number(normalizedUser.id);
    const membershipIsActive = normalizeLowerText(membership?.status) === "active";

    if (!membershipIsActive && actorOwnsWorkspace) {
      membership = await workspaceMembershipsRepository.ensureOwnerMembership(workspace.id, normalizedUser.id, options);
    }

    if (!membership || normalizeLowerText(membership.status) !== "active") {
      throw new AppError(403, "You do not have access to this workspace.");
    }

    const workspaceSettings = await ensureWorkspaceSettingsForWorkspace(workspace, options);
    const permissions = buildPermissionsFromMembership(membership, appConfig);

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
    provisionWorkspaceForNewUser,
    createWorkspaceForAuthenticatedUser,
    listWorkspacesForUser,
    listWorkspacesForAuthenticatedUser,
    resolveWorkspaceContextForUserBySlug
  });
}

export { createService };
