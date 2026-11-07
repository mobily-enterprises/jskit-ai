import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { WORKSPACE_PATCH_FIELD_KEYS } from "../../../shared/resources/workspaceResource.js";
import { listCatalogRolePermissions } from "../../../shared/roles.js";
import { TENANCY_MODE_NONE } from "../../../shared/tenancyProfile.js";
import { mapWorkspaceSummary } from "../formatters/workspaceFormatter.js";

const WORKSPACE_SLUG_CANDIDATE_LIMIT = 1000;

function toSlugPart(value) {
  const normalized = normalizeLowerText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "workspace";
}

function buildWorkspaceBaseSlug(user) {
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

/**
 * The `workspaces.personal-workspace-name` default: the user's display name or
 * email, followed by "'s Workspace".
 * @type {import("../../types.js").PersonalWorkspaceName}
 */
function buildWorkspaceName(user) {
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

/**
 * @param {object} dependencies
 * @param {import("../../types.js").WorkspaceTenancyProfile} dependencies.tenancyProfile
 * @param {import("../../types.js").WorkspaceRoleCatalog} dependencies.roleCatalog
 * @param {import("../../types.js").PersonalWorkspaceName} dependencies.personalWorkspaceName
 * @param {import("../../types.js").WorkspacesRepository} dependencies.workspacesRepository
 * @param {import("../../types.js").WorkspaceMembershipsRepository} dependencies.workspaceMembershipsRepository
 * @param {import("../../types.js").WorkspaceSettingsRepository} dependencies.workspaceSettingsRepository
 */
function createService({
  tenancyProfile,
  roleCatalog,
  personalWorkspaceName,
  workspacesRepository,
  workspaceMembershipsRepository,
  workspaceSettingsRepository
}) {
  const resolvedTenancyMode = tenancyProfile.mode;
  const workspacePolicy = tenancyProfile.workspace;

  async function ensureUniqueWorkspaceSlug(baseSlug, options = {}) {
    const slugPart = toSlugPart(baseSlug);
    // The base, then base-2 to base-1000, read in one query however many are taken.
    const candidates = Array.from(
      { length: WORKSPACE_SLUG_CANDIDATE_LIMIT },
      (_, index) => (index === 0 ? slugPart : `${slugPart}-${index + 1}`)
    );
    const takenSlugs = await workspacesRepository.listSlugsIn(candidates, options);
    const candidate = candidates.find((slug) => !takenSlugs.has(slug));
    if (candidate) {
      return candidate;
    }
    throw new Error("Unable to generate unique workspace slug.");
  }

  async function ensureWorkspaceSettingsForWorkspace(workspace, options = {}) {
    return workspaceSettingsRepository.ensureForWorkspaceId(workspace.id, {
      ...options,
      workspace
    });
  }

  async function ensurePersonalWorkspaceForUser(user, options = {}) {
    const normalizedUserId = normalizeRecordId(user?.id, { fallback: null });
    if (!normalizedUserId) {
      throw new AppError(400, "Invalid authenticated user payload.", { code: "workspaces.user.invalidPayload" });
    }

    const existing = await workspacesRepository.findPersonalByOwnerUserId(normalizedUserId, options);
    if (existing) {
      await workspaceMembershipsRepository.ensureOwnerMembership(existing.id, normalizedUserId, options);
      await ensureWorkspaceSettingsForWorkspace(existing, options);
      return existing;
    }

    const slug = await ensureUniqueWorkspaceSlug(buildWorkspaceBaseSlug(user), options);
    const inserted = await workspacesRepository.insert(
      {
        slug,
        name: normalizeText(personalWorkspaceName(user)) || buildWorkspaceName(user),
        ownerUserId: normalizedUserId,
        isPersonal: true,
        avatarUrl: ""
      },
      options
    );

    await workspaceMembershipsRepository.ensureOwnerMembership(inserted.id, normalizedUserId, options);
    await ensureWorkspaceSettingsForWorkspace(inserted, options);
    return inserted;
  }

  async function listWorkspacesForUser(user, options = {}) {
    const normalizedUserId = normalizeRecordId(user?.id, { fallback: null });
    if (!normalizedUserId) {
      return [];
    }

    if (resolvedTenancyMode === TENANCY_MODE_NONE) {
      return [];
    }

    const list = await workspacesRepository.listForUserId(normalizedUserId, options);
    const accessible = list
      .map((entry) => mapWorkspaceSummary(
        entry,
        { roleSid: entry.roleSid, status: entry.membershipStatus },
        roleCatalog
      ))
      .filter((entry) => entry.isAccessible);

    return accessible;
  }

  async function listWorkspacesForAuthenticatedUser(user, options = {}) {
    return returnJsonApiData({ items: await listWorkspacesForUser(user, options), nextCursor: null });
  }

  async function ensureProvisionedWorkspaceForAuthenticatedUser(user, options = {}) {
    const normalizedUserId = normalizeRecordId(user?.id, { fallback: null });
    if (!normalizedUserId) {
      throw new AppError(400, "Invalid authenticated user payload.", { code: "workspaces.user.invalidPayload" });
    }

    if (workspacePolicy.autoProvision !== true) {
      return null;
    }

    return ensurePersonalWorkspaceForUser({
      ...user,
      id: normalizedUserId
    }, options);
  }

  /**
   * Creates a workspace the user owns. The action's input schema has already
   * trimmed the name and slug and lowercased the slug.
   * @param {{ id?: unknown } | null} user
   * @param {{ name: string, slug?: string }} input
   * @param {object} [options]
   */
  async function createWorkspaceForAuthenticatedUser(user, { name, slug: requestedSlug }, options = {}) {
    const normalizedUserId = normalizeRecordId(user?.id, { fallback: null });
    if (!normalizedUserId) {
      throw new AppError(401, "Authentication required.", { code: "workspaces.auth.required" });
    }

    if (workspacePolicy.allowSelfCreate !== true) {
      throw new AppError(403, "Workspace creation is disabled for this tenancy mode.", {
        code: "workspaces.workspace.creationDisabled"
      });
    }

    const slug = await ensureUniqueWorkspaceSlug(requestedSlug || toSlugPart(name), options);
    const inserted = await workspacesRepository.insert(
      {
        slug,
        name,
        ownerUserId: normalizedUserId,
        isPersonal: false,
        avatarUrl: ""
      },
      options
    );

    await workspaceMembershipsRepository.ensureOwnerMembership(inserted.id, normalizedUserId, options);
    await ensureWorkspaceSettingsForWorkspace(inserted, options);
    return returnJsonApiData(inserted);
  }

  async function getWorkspaceForAuthenticatedUser(user, workspaceSlug, options = {}) {
    const workspaceContext = await resolveWorkspaceContextForUserBySlug(user, workspaceSlug, options);
    return returnJsonApiData(workspaceContext.workspace);
  }

  /** The repository writes every field it receives, so only the patchable fields go to it. */
  async function updateWorkspaceForAuthenticatedUser(user, workspaceSlug, input, options = {}) {
    const workspaceContext = await resolveWorkspaceContextForUserBySlug(user, workspaceSlug, options);
    const patch = pickOwnProperties(input, WORKSPACE_PATCH_FIELD_KEYS);
    return returnJsonApiData(await workspacesRepository.updateById(workspaceContext.workspace.id, patch, options));
  }

  // The checks that run before a request's handler (its auth policy and its action context)
  // each need the request's workspace context. They pass the request and share one resolution
  // for the same user, slug and membership requirement, instead of reading the workspace, the
  // membership and the settings again for each check. A call in a transaction, or without a
  // request, resolves on its own.
  const requestWorkspaceContexts = new WeakMap();

  /**
   * @param {{ id?: unknown } | null} user
   * @param {string} workspaceSlug
   * @param {{ request?: object, requireMembership?: boolean, trx?: unknown }} [options]
   */
  function resolveWorkspaceContextForUserBySlug(user, workspaceSlug, options = {}) {
    const request = options.request;
    if (!request || typeof request !== "object" || workspacesRepository.inTransaction(options)) {
      return readWorkspaceContextForUserBySlug(user, workspaceSlug, options);
    }
    const key = [
      normalizeRecordId(user?.id, { fallback: "" }),
      normalizeLowerText(workspaceSlug),
      options.requireMembership !== false
    ].join("\0");
    let resolutions = requestWorkspaceContexts.get(request);
    if (!resolutions) {
      resolutions = new Map();
      requestWorkspaceContexts.set(request, resolutions);
    }
    if (!resolutions.has(key)) {
      resolutions.set(key, readWorkspaceContextForUserBySlug(user, workspaceSlug, options));
    }
    return resolutions.get(key);
  }

  async function readWorkspaceContextForUserBySlug(user, workspaceSlug, options = {}) {
    const requireMembership = options.requireMembership !== false;
    const normalizedUserId = normalizeRecordId(user?.id, { fallback: null });
    if (!normalizedUserId) {
      throw new AppError(401, "Authentication required.", { code: "workspaces.auth.required" });
    }

    if (resolvedTenancyMode === TENANCY_MODE_NONE) {
      throw new AppError(403, "Workspace context is disabled.", { code: "workspaces.workspace.contextDisabled" });
    }

    const normalizedWorkspaceSlug = normalizeLowerText(workspaceSlug);
    if (!normalizedWorkspaceSlug) {
      throw new AppError(400, "workspaceSlug is required.", { code: "workspaces.workspace.slugRequired" });
    }

    const workspace = await workspacesRepository.findBySlug(normalizedWorkspaceSlug, options);

    if (!workspace) {
      throw new AppError(404, "Workspace not found.", { code: "workspaces.workspace.notFound" });
    }

    let membership = await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(
      workspace.id,
      normalizedUserId,
      options
    );
    const actorOwnsWorkspace =
      normalizeRecordId(workspace.ownerUserId, { fallback: null }) ===
      normalizedUserId;
    const membershipIsActive = normalizeLowerText(membership?.status) === "active";

    if (!membershipIsActive && actorOwnsWorkspace) {
      membership = await workspaceMembershipsRepository.ensureOwnerMembership(workspace.id, normalizedUserId, options);
    }

    if ((!membership || normalizeLowerText(membership.status) !== "active") && requireMembership) {
      throw new AppError(403, "You do not have access to this workspace.", { code: "workspaces.workspace.accessDenied" });
    }

    if (!membership || normalizeLowerText(membership.status) !== "active") {
      membership = null;
    }

    const workspaceSettings = await ensureWorkspaceSettingsForWorkspace(workspace, options);
    const permissions = membership ? listCatalogRolePermissions(roleCatalog, membership.roleSid) : [];

    return {
      workspace,
      membership,
      permissions,
      workspaceSettings
    };
  }

  return Object.freeze({
    ensurePersonalWorkspaceForUser,
    ensureProvisionedWorkspaceForAuthenticatedUser,
    createWorkspaceForAuthenticatedUser,
    getWorkspaceForAuthenticatedUser,
    updateWorkspaceForAuthenticatedUser,
    listWorkspacesForUser,
    listWorkspacesForAuthenticatedUser,
    resolveWorkspaceContextForUserBySlug
  });
}

export { buildWorkspaceName, createService };
