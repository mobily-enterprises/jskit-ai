import { requireServiceMethod } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeLowerText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  TENANCY_MODE_NONE,
  resolveTenancyProfile
} from "../shared/tenancyProfile.js";
import { workspacePendingInvitationsResource } from "../shared/resources/workspacePendingInvitationsResource.js";
import {
  mapMembershipSummary,
  mapWorkspaceSettingsPublic,
  mapWorkspaceSummary
} from "./common/formatters/workspaceFormatter.js";

const REQUESTED_WORKSPACE_STATUS_RESOLVED = "resolved";
const REQUESTED_WORKSPACE_STATUS_NOT_FOUND = "not_found";
const REQUESTED_WORKSPACE_STATUS_FORBIDDEN = "forbidden";
const REQUESTED_WORKSPACE_STATUS_UNAUTHENTICATED = "unauthenticated";

function normalizePendingInvites(invites) {
  return workspacePendingInvitationsResource.operations.list.outputValidator.normalize({
    pendingInvites: invites
  }).pendingInvites;
}

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

function resolveBootstrapTenancyProfile(tenancyProfile = null, appConfig = {}) {
  const fallback = resolveTenancyProfile(appConfig);
  return Object.freeze({
    mode: fallback.mode,
    workspace: Object.freeze({
      enabled: fallback.workspace.enabled === true,
      autoProvision: fallback.workspace.autoProvision === true,
      allowSelfCreate: fallback.workspace.allowSelfCreate === true,
      slugPolicy: fallback.workspace.slugPolicy
    })
  });
}

function createWorkspaceBootstrapContributor({
  workspaceService,
  workspacePendingInvitationsService,
  userProfilesRepository,
  workspaceInvitationsEnabled = false,
  appConfig = {},
  tenancyProfile = null
} = {}) {
  const contributorId = "users.workspace.bootstrap";
  const resolvedTenancyProfile = resolveBootstrapTenancyProfile(tenancyProfile, appConfig);

  requireServiceMethod(workspaceService, "listWorkspacesForUser", contributorId, {
    serviceLabel: "workspaceService"
  });
  requireServiceMethod(workspaceService, "resolveWorkspaceContextForUserBySlug", contributorId, {
    serviceLabel: "workspaceService"
  });
  if (workspaceInvitationsEnabled) {
    requireServiceMethod(workspacePendingInvitationsService, "listPendingInvitesForUser", contributorId, {
      serviceLabel: "workspacePendingInvitationsService"
    });
  }
  requireServiceMethod(userProfilesRepository, "findById", contributorId, {
    serviceLabel: "internal.repository.user-profiles"
  });

  return Object.freeze({
    contributorId,
    order: 200,
    async contribute({ request = null, query = {}, payload = {} } = {}) {
      const inheritedAppState = payload?.app && typeof payload.app === "object" ? payload.app : {};
      const inheritedFeatures =
        inheritedAppState.features && typeof inheritedAppState.features === "object" ? inheritedAppState.features : {};
      const normalizedUserId = normalizeRecordId(
        payload?.session?.authenticated === true ? payload?.session?.userId : null,
        { fallback: null }
      );
      const normalizedWorkspaceSlug = resolveBootstrapWorkspaceSlug({ query, request });
      if (!normalizedUserId) {
        if (!normalizedWorkspaceSlug || resolvedTenancyProfile.mode === TENANCY_MODE_NONE) {
          return {};
        }

        return {
          tenancy: resolvedTenancyProfile,
          app: {
            ...inheritedAppState,
            features: {
              ...inheritedFeatures,
              workspaceSwitching: normalizeLowerText(resolvedTenancyProfile.mode) !== TENANCY_MODE_NONE,
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
          ? normalizePendingInvites(
              await workspacePendingInvitationsService.listPendingInvitesForUser(latestProfile, {
                context: {
                  actor: latestProfile
                }
              })
            )
          : [];
      const workspaces = await workspaceService.listWorkspacesForUser(latestProfile, { request });
      let workspaceContext = null;
      let requestedWorkspace = null;
      if (normalizedWorkspaceSlug && resolvedTenancyProfile.mode !== TENANCY_MODE_NONE) {
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
        tenancy: resolvedTenancyProfile,
        app: {
          ...inheritedAppState,
          features: {
            ...inheritedFeatures,
            workspaceSwitching: normalizeLowerText(resolvedTenancyProfile.mode) !== TENANCY_MODE_NONE,
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
  });
}

export { createWorkspaceBootstrapContributor };
