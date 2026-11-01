import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeLowerText } from "@jskit-ai/kernel/shared/support/normalize";
import { TENANCY_MODE_NONE } from "../shared/tenancyProfile.js";
import {
  mapMembershipSummary,
  mapWorkspaceSettingsPublic,
  mapWorkspaceSummary
} from "./common/formatters/workspaceFormatter.js";

const REQUESTED_WORKSPACE_STATUS_RESOLVED = "resolved";
const REQUESTED_WORKSPACE_STATUS_NOT_FOUND = "not_found";
const REQUESTED_WORKSPACE_STATUS_FORBIDDEN = "forbidden";
const REQUESTED_WORKSPACE_STATUS_UNAUTHENTICATED = "unauthenticated";

function normalizeQueryPayload(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function resolveBootstrapWorkspaceSlug({ query = {}, request = null } = {}) {
  const normalizedQuery = normalizeQueryPayload(query);
  if (Object.hasOwn(normalizedQuery, "workspaceSlug")) {
    return normalizeLowerText(normalizedQuery.workspaceSlug);
  }

  const normalizedInputQuery = normalizeQueryPayload(request?.input?.query);
  if (Object.hasOwn(normalizedInputQuery, "workspaceSlug")) {
    return normalizeLowerText(normalizedInputQuery.workspaceSlug);
  }

  const normalizedRequestQuery = normalizeQueryPayload(request?.query);
  if (Object.hasOwn(normalizedRequestQuery, "workspaceSlug")) {
    return normalizeLowerText(normalizedRequestQuery.workspaceSlug);
  }

  return "";
}

function normalizeRequestedWorkspaceStatus(value = "") {
  const normalizedValue = normalizeLowerText(value);
  if (
    normalizedValue === REQUESTED_WORKSPACE_STATUS_RESOLVED ||
    normalizedValue === REQUESTED_WORKSPACE_STATUS_NOT_FOUND ||
    normalizedValue === REQUESTED_WORKSPACE_STATUS_FORBIDDEN ||
    normalizedValue === REQUESTED_WORKSPACE_STATUS_UNAUTHENTICATED
  ) {
    return normalizedValue;
  }
  return "";
}

function createRequestedWorkspacePayload(workspaceSlug = "", status = "") {
  const normalizedWorkspaceSlug = normalizeLowerText(workspaceSlug);
  const normalizedStatus = normalizeRequestedWorkspaceStatus(status);
  if (!normalizedWorkspaceSlug || !normalizedStatus) {
    return null;
  }
  return {
    slug: normalizedWorkspaceSlug,
    status: normalizedStatus
  };
}

function resolveRequestedWorkspaceStatusFromError(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  if (statusCode === 404) {
    return REQUESTED_WORKSPACE_STATUS_NOT_FOUND;
  }
  if (statusCode === 403) {
    return REQUESTED_WORKSPACE_STATUS_FORBIDDEN;
  }
  if (statusCode === 401) {
    return REQUESTED_WORKSPACE_STATUS_UNAUTHENTICATED;
  }
  return "";
}

/**
 * @param {object} dependencies
 * @param {import("./common/services/workspaceContextService.js").WorkspaceContextService} dependencies.workspaceService
 * @param {import("./workspacePendingInvitations/workspacePendingInvitationsService.js").WorkspacePendingInvitationsService} dependencies.workspacePendingInvitationsService
 * @param {import("@jskit-ai/users-core/server/types").UserProfilesRepository} dependencies.userProfilesRepository
 * @param {boolean} dependencies.workspaceInvitationsEnabled
 * @param {import("./types.js").WorkspaceTenancyProfile} dependencies.tenancyProfile
 */
function createWorkspaceBootstrapContributor({
  workspaceService,
  workspacePendingInvitationsService,
  userProfilesRepository,
  workspaceInvitationsEnabled,
  tenancyProfile
}) {
  async function contribute({ request = null, query = {}, payload = {} } = {}) {
    const inheritedAppState = payload.app && typeof payload.app === "object" ? payload.app : {};
    const inheritedFeatures =
      inheritedAppState.features && typeof inheritedAppState.features === "object" ? inheritedAppState.features : {};
    const normalizedUserId = normalizeRecordId(
      payload.session?.authenticated === true ? payload.session?.userId : null,
      { fallback: null }
    );
    const normalizedWorkspaceSlug = resolveBootstrapWorkspaceSlug({ query, request });
    if (!normalizedUserId) {
      if (!normalizedWorkspaceSlug || tenancyProfile.mode === TENANCY_MODE_NONE) {
        return {};
      }

      return {
        tenancy: tenancyProfile,
        app: {
          ...inheritedAppState,
          features: {
            ...inheritedFeatures,
            workspaceSwitching: normalizeLowerText(tenancyProfile.mode) !== TENANCY_MODE_NONE,
            workspaceInvites: workspaceInvitationsEnabled === true
          }
        },
        requestedWorkspace: createRequestedWorkspacePayload(
          normalizedWorkspaceSlug,
          REQUESTED_WORKSPACE_STATUS_UNAUTHENTICATED
        )
      };
    }

    const latestProfile = await userProfilesRepository.findById(normalizedUserId);
    if (!latestProfile) {
      return {};
    }

    const pendingInvites =
      workspaceInvitationsEnabled
        ? await workspacePendingInvitationsService.listPendingInvitesForUser(latestProfile, {
            context: {
              actor: latestProfile
            }
          })
        : [];
    const workspaces = await workspaceService.listWorkspacesForUser(latestProfile, { request });
    let workspaceContext = null;
    let requestedWorkspace = null;
    if (normalizedWorkspaceSlug && tenancyProfile.mode !== TENANCY_MODE_NONE) {
      try {
        workspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(
          latestProfile,
          normalizedWorkspaceSlug,
          { request }
        );
        requestedWorkspace = createRequestedWorkspacePayload(
          normalizedWorkspaceSlug,
          REQUESTED_WORKSPACE_STATUS_RESOLVED
        );
      } catch (error) {
        const requestedWorkspaceStatus = resolveRequestedWorkspaceStatusFromError(error);
        if (!requestedWorkspaceStatus) {
          throw error;
        }
        requestedWorkspace = createRequestedWorkspacePayload(normalizedWorkspaceSlug, requestedWorkspaceStatus);
      }
    }

    return {
      tenancy: tenancyProfile,
      app: {
        ...inheritedAppState,
        features: {
          ...inheritedFeatures,
          workspaceSwitching: normalizeLowerText(tenancyProfile.mode) !== TENANCY_MODE_NONE,
          workspaceInvites: workspaceInvitationsEnabled === true
        }
      },
      workspaces: [...workspaces],
      pendingInvites,
      activeWorkspace: workspaceContext
        ? mapWorkspaceSummary(workspaceContext.workspace, {
            roleSid: workspaceContext.membership?.roleSid,
            status: workspaceContext.membership?.status
          })
        : null,
      membership: mapMembershipSummary(workspaceContext?.membership, workspaceContext?.workspace),
      requestedWorkspace,
      permissions: workspaceContext ? [...workspaceContext.permissions] : [],
      workspaceSettings: workspaceContext
        ? mapWorkspaceSettingsPublic(workspaceContext.workspaceSettings, {
            workspaceInvitationsEnabled
          })
        : null
    };
  }

  return Object.freeze({ contribute });
}

export { createWorkspaceBootstrapContributor };
