import { isLostDuplicateInsertRace } from "@jskit-ai/database-runtime/shared";
import { returnJsonApiData } from "@jskit-ai/http-runtime/shared";
import { pickOwnProperties } from "@jskit-ai/kernel/shared/support";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeLowerText, normalizeRecordId, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { WORKSPACE_PATCH_FIELD_KEYS } from "../../../shared/resources/workspaceResource.js";
import { listCatalogRolePermissions } from "../../../shared/roles.js";
import { TENANCY_MODE_NONE } from "../../../shared/tenancyProfile.js";
import { mapWorkspaceSummary } from "../formatters/workspaceFormatter.js";

const WORKSPACE_SLUG_CANDIDATE_LIMIT = 1000;
// How many times a new workspace picks a free slug again after another owner's create took the one it picked.
const WORKSPACE_SLUG_ATTEMPTS = 3;

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
 * @param {import("../../types.js").WorkspaceCreatedParticipant} dependencies.createdParticipant
 * @param {import("../../types.js").WorkspacesRepository} dependencies.workspacesRepository
 * @param {import("../../types.js").WorkspaceMembershipsRepository} dependencies.workspaceMembershipsRepository
 * @param {import("../../types.js").WorkspaceSettingsRepository} dependencies.workspaceSettingsRepository
 */
function createService({
  tenancyProfile,
  roleCatalog,
  personalWorkspaceName,
  createdParticipant,
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

  /**
   * Creates a workspace under the first free slug from baseSlug, its owner's membership and its settings, then runs the
   * `workspaces.workspace-created-participant`, all in one transaction: the caller's (`options.trx`), or one of its own.
   * Any failure, the participant's included, rolls the whole creation back. When another create takes the slug between
   * the read and the insert, a transaction of its own answers the winner when it is the same owner's same kind of
   * workspace (a personal workspace made at two first sign-ins at once, a form sent twice), and otherwise runs again
   * under a new slug; inside the caller's transaction the duplicate fails the caller's transaction.
   * @param {string} baseSlug
   * @param {{ name: string, isPersonal: boolean, avatarUrl: string }} payload The workspace, without its slug and owner.
   * @param {{ id: string }} owner The user who owns it.
   * @param {object} [options]
   */
  async function createOwnedWorkspace(baseSlug, payload, owner, options = {}) {
    // The slug while the workspace's own insert runs: a duplicate from a later write is not a lost slug.
    let insertingSlug = null;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await workspacesRepository.withTransaction(options, async (txOptions) => {
          insertingSlug = await ensureUniqueWorkspaceSlug(baseSlug, txOptions);
          const workspace = await workspacesRepository.insert(
            { ...payload, slug: insertingSlug, ownerUserId: owner.id },
            txOptions
          );
          insertingSlug = null;
          await workspaceMembershipsRepository.ensureOwnerMembership(workspace.id, owner.id, txOptions);
          await ensureWorkspaceSettingsForWorkspace(workspace, txOptions);
          await createdParticipant({ workspace: Object.freeze({ ...workspace }), owner: Object.freeze({ ...owner }) }, txOptions);
          return workspace;
        });
      } catch (error) {
        if (attempt >= WORKSPACE_SLUG_ATTEMPTS || !insertingSlug || !isLostDuplicateInsertRace(error, options)) {
          throw error;
        }
        const winner = await workspacesRepository.findBySlug(insertingSlug, options);
        if (winner && winner.ownerUserId === owner.id && winner.isPersonal === payload.isPersonal) {
          return winner;
        }
      }
    }
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

    return createOwnedWorkspace(
      buildWorkspaceBaseSlug(user),
      {
        name: normalizeText(personalWorkspaceName(user)) || buildWorkspaceName(user),
        isPersonal: true,
        avatarUrl: ""
      },
      { ...user, id: normalizedUserId },
      options
    );
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

    return returnJsonApiData(await createOwnedWorkspace(
      requestedSlug || toSlugPart(name),
      {
        name,
        isPersonal: false,
        avatarUrl: ""
      },
      { ...user, id: normalizedUserId },
      options
    ));
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

  // The checks that run before a request's handler (its auth policy, its route visibility and its action context) each
  // need the request's workspace context, some requiring membership and some not (a route with contextPolicy
  // "optional" and no permission). They pass the request and share one read of the workspace, the user's membership
  // and the settings for the same user and slug; each call then applies its own membership requirement. A call
  // without a request reads on its own.
  const requestWorkspaceContexts = new WeakMap();

  /**
   * A surface that requires membership refuses an anonymous visitor (401) and a non-member (403); one that does not (a
   * public payment link) resolves the workspace for them with no membership and no permissions.
   * @param {{ id?: unknown } | null} user
   * @param {string} workspaceSlug
   * @param {{ request?: object, requireMembership?: boolean }} [options]
   */
  async function resolveWorkspaceContextForUserBySlug(user, workspaceSlug, options = {}) {
    const requireMembership = options.requireMembership !== false;
    if (requireMembership && !normalizeRecordId(user?.id, { fallback: null })) {
      throw new AppError(401, "Authentication required.", { code: "workspaces.auth.required" });
    }
    const workspaceContext = await readRequestWorkspaceContext(user, workspaceSlug, options);
    return requireMembership ? requireMember(workspaceContext) : workspaceContext;
  }

  function requireMember(workspaceContext) {
    if (!workspaceContext.membership) {
      throw new AppError(403, "You do not have access to this workspace.", { code: "workspaces.workspace.accessDenied" });
    }
    return workspaceContext;
  }

  function readRequestWorkspaceContext(user, workspaceSlug, options) {
    const request = options.request;
    if (!request || typeof request !== "object") {
      return readWorkspaceContextForUserBySlug(user, workspaceSlug, options);
    }
    const key = `${normalizeRecordId(user?.id, { fallback: "" })}\0${normalizeLowerText(workspaceSlug)}`;
    let reads = requestWorkspaceContexts.get(request);
    if (!reads) {
      reads = new Map();
      requestWorkspaceContexts.set(request, reads);
    }
    if (!reads.has(key)) {
      reads.set(key, readWorkspaceContextForUserBySlug(user, workspaceSlug, options));
    }
    return reads.get(key);
  }

  /**
   * The workspace context of one member of the workspace with this id, for background work done as that member: what
   * resolveWorkspaceContextForUserBySlug resolves for the member's request on a surface that requires membership, by
   * the same reads and checks. A deleted or missing workspace is 404 `workspaces.workspace.notFound`, as an unknown
   * slug is, and a user who is no active member of it (removed, inactive, never one, or no user at all) 403
   * `workspaces.workspace.accessDenied`; the owner's membership is ensured, as at the owner's request.
   * @param {{ id?: unknown } | null} user
   * @param {unknown} workspaceId
   * @param {object} [options]
   */
  async function resolveMemberWorkspaceContextById(user, workspaceId, options = {}) {
    requireWorkspaceContext();
    const workspace = await workspacesRepository.findById(workspaceId, options);
    // findById keeps a deleted workspace, which findBySlug does not find.
    return requireMember(await readWorkspaceContextForUser(user, workspace?.deletedAt ? null : workspace, options));
  }

  /**
   * The workspace context of a user acting in the workspace with this id in a role of the role catalog, for installer
   * and seed work (the `roleContext` of `workspaces.core`): the workspace, an active membership of the user in that
   * role, which is never saved and replaces any membership the user has there, the role's permissions and the
   * workspace's settings as stored. It writes nothing. A deleted or missing workspace is 404
   * `workspaces.workspace.notFound`, as for resolveMemberWorkspaceContextById.
   * @param {{ id: string }} user
   * @param {unknown} workspaceId
   * @param {string} roleSid The id of a role of the role catalog.
   * @param {object} [options]
   */
  async function resolveRoleWorkspaceContextById(user, workspaceId, roleSid, options = {}) {
    requireWorkspaceContext();
    const workspace = await workspacesRepository.findById(workspaceId, options);
    if (!workspace || workspace.deletedAt) {
      throw new AppError(404, "Workspace not found.", { code: "workspaces.workspace.notFound" });
    }
    return {
      workspace,
      membership: Object.freeze({ workspaceId: workspace.id, userId: user.id, roleSid, status: "active" }),
      permissions: listCatalogRolePermissions(roleCatalog, roleSid),
      workspaceSettings: await workspaceSettingsRepository.findByWorkspaceId(workspace.id, options)
    };
  }

  function requireWorkspaceContext() {
    if (resolvedTenancyMode === TENANCY_MODE_NONE) {
      throw new AppError(403, "Workspace context is disabled.", { code: "workspaces.workspace.contextDisabled" });
    }
  }

  async function readWorkspaceContextForUserBySlug(user, workspaceSlug, options = {}) {
    requireWorkspaceContext();
    const normalizedWorkspaceSlug = normalizeLowerText(workspaceSlug);
    if (!normalizedWorkspaceSlug) {
      throw new AppError(400, "workspaceSlug is required.", { code: "workspaces.workspace.slugRequired" });
    }
    return readWorkspaceContextForUser(user, await workspacesRepository.findBySlug(normalizedWorkspaceSlug, options), options);
  }

  // The workspace (404 when it is null), the user's active membership (null for an anonymous visitor or a non-member)
  // with its role's permissions, and the settings: every workspace context, a request's and a member's, is this one.
  async function readWorkspaceContextForUser(user, workspace, options) {
    if (!workspace) {
      throw new AppError(404, "Workspace not found.", { code: "workspaces.workspace.notFound" });
    }

    const normalizedUserId = normalizeRecordId(user?.id, { fallback: null });
    let membership = normalizedUserId
      ? await workspaceMembershipsRepository.findByWorkspaceIdAndUserId(workspace.id, normalizedUserId, options)
      : null;
    const actorOwnsWorkspace = normalizedUserId !== null &&
      normalizeRecordId(workspace.ownerUserId, { fallback: null }) === normalizedUserId;
    const membershipIsActive = normalizeLowerText(membership?.status) === "active";

    if (!membershipIsActive && actorOwnsWorkspace) {
      membership = await workspaceMembershipsRepository.ensureOwnerMembership(workspace.id, normalizedUserId, options);
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
    resolveWorkspaceContextForUserBySlug,
    resolveMemberWorkspaceContextById,
    resolveRoleWorkspaceContextById
  });
}

export { buildWorkspaceName, createService };
