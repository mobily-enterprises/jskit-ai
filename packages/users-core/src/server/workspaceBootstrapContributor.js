import { AppError } from "@jskit-ai/kernel/server/runtime";
import { requireServiceMethod } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACES,
  WORKSPACE_SLUG_POLICY_NONE,
  WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME,
  WORKSPACE_SLUG_POLICY_USER_SELECTED,
  resolveTenancyProfile
} from "../shared/tenancyProfile.js";
import { workspacePendingInvitationsResource } from "../shared/resources/workspacePendingInvitationsResource.js";
import {
  mapMembershipSummary,
  mapWorkspaceSettingsPublic,
  mapWorkspaceSummary
} from "./common/formatters/workspaceFormatter.js";
import { accountAvatarFormatter } from "./common/formatters/accountAvatarFormatter.js";
import { authenticatedUserValidator } from "./common/validators/authenticatedUserValidator.js";
import { userSettingsFields } from "../shared/resources/userSettingsFields.js";

const REQUESTED_WORKSPACE_STATUS_RESOLVED = "resolved";
const REQUESTED_WORKSPACE_STATUS_NOT_FOUND = "not_found";
const REQUESTED_WORKSPACE_STATUS_FORBIDDEN = "forbidden";
const REQUESTED_WORKSPACE_STATUS_UNAUTHENTICATED = "unauthenticated";

function normalizePendingInvites(invites) {
  return workspacePendingInvitationsResource.operations.list.outputValidator.normalize({
    pendingInvites: invites
  }).pendingInvites;
}

function getOAuthProviderCatalogPayload(authService) {
  if (!authService || typeof authService.getOAuthProviderCatalog !== "function") {
    return {
      oauthProviders: [],
      oauthDefaultProvider: null
    };
  }

  const catalog = authService.getOAuthProviderCatalog();
  const providers = Array.isArray(catalog?.providers)
    ? catalog.providers
        .map((provider) => ({
          id: normalizeLowerText(provider?.id),
          label: normalizeText(provider?.label)
        }))
        .filter((provider) => provider.id && provider.label)
    : [];
  const defaultProvider = normalizeLowerText(catalog?.defaultProvider);

  return {
    oauthProviders: providers,
    oauthDefaultProvider: providers.some((provider) => provider.id === defaultProvider) ? defaultProvider : null
  };
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

function resolveAppState(appConfig = {}, { workspaceInvitationsEnabled = true } = {}) {
  const features = {
    workspaceSwitching: normalizeBoolean(appConfig.workspaceSwitching, true),
    workspaceInvites: workspaceInvitationsEnabled === true,
    assistantEnabled: normalizeBoolean(appConfig.assistantEnabled, false),
    assistantRequiredPermission: normalizeText(appConfig.assistantRequiredPermission),
    socialEnabled: normalizeBoolean(appConfig.socialEnabled, false),
    socialFederationEnabled: normalizeBoolean(appConfig.socialFederationEnabled, false)
  };

  return {
    features
  };
}

function normalizeSlugPolicy(value = "") {
  const normalizedValue = normalizeLowerText(value);
  if (
    normalizedValue === WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME ||
    normalizedValue === WORKSPACE_SLUG_POLICY_USER_SELECTED
  ) {
    return normalizedValue;
  }
  return WORKSPACE_SLUG_POLICY_NONE;
}

function isSupportedTenancyMode(value = "") {
  return value === TENANCY_MODE_NONE || value === TENANCY_MODE_PERSONAL || value === TENANCY_MODE_WORKSPACES;
}

function resolveBootstrapTenancyProfile(tenancyProfile = null, appConfig = {}) {
  const fallback = resolveTenancyProfile(appConfig);
  const source = tenancyProfile && typeof tenancyProfile === "object" ? tenancyProfile : fallback;
  const mode = isSupportedTenancyMode(source?.mode) ? source.mode : fallback.mode;
  const workspace = source?.workspace && typeof source.workspace === "object" ? source.workspace : fallback.workspace;

  return Object.freeze({
    mode,
    workspace: Object.freeze({
      enabled: workspace.enabled === true,
      autoProvision: workspace.autoProvision === true,
      allowSelfCreate: workspace.allowSelfCreate === true,
      slugPolicy: normalizeSlugPolicy(workspace.slugPolicy)
    })
  });
}

function createAnonymousBootstrapPayload({ appState, tenancyProfile }) {
  return {
    session: {
      authenticated: false
    },
    profile: null,
    tenancy: tenancyProfile,
    app: appState,
    workspaces: [],
    pendingInvites: [],
    activeWorkspace: null,
    membership: null,
    requestedWorkspace: null,
    permissions: [],
    surfaceAccess: {
      consoleowner: false
    },
    workspaceSettings: null,
    userSettings: null
  };
}

function mapUserSettingsBootstrap(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const mapped = {};

  for (const field of userSettingsFields) {
    if (field.includeInBootstrap === false) {
      continue;
    }
    const rawValue = Object.hasOwn(source, field.key)
      ? source[field.key]
      : field.resolveDefault({
          settings: source
        });
    mapped[field.key] = field.normalizeOutput(rawValue, {
      settings: source
    });
  }

  return mapped;
}

function createWorkspaceBootstrapContributor({
  workspaceService,
  workspacePendingInvitationsService,
  userProfilesRepository,
  userSettingsRepository,
  workspaceInvitationsEnabled = false,
  appConfig = {},
  tenancyProfile = null,
  authService,
  consoleService = null
} = {}) {
  const contributorId = "users.bootstrap";
  const appState = resolveAppState(appConfig, {
    workspaceInvitationsEnabled
  });
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
  requireServiceMethod(userProfilesRepository, "findByIdentity", contributorId, {
    serviceLabel: "userProfilesRepository"
  });
  requireServiceMethod(userSettingsRepository, "ensureForUserId", contributorId, {
    serviceLabel: "userSettingsRepository"
  });

  return Object.freeze({
    contributorId,
    async contribute({ request = null, reply = null, query = {} } = {}) {
      const authResult = await request.executeAction({
        actionId: "auth.session.read"
      });

      if (authResult?.clearSession === true && typeof authService?.clearSessionCookies === "function") {
        authService.clearSessionCookies(reply);
      }
      if (authResult?.session && typeof authService?.writeSessionCookies === "function") {
        authService.writeSessionCookies(reply, authResult.session);
      }
      if (authResult?.transientFailure === true) {
        throw new AppError(503, "Authentication service temporarily unavailable. Please retry.");
      }
      let seededConsoleOwnerUserId = 0;
      if (
        authResult?.authenticated &&
        authResult?.profile?.id != null &&
        consoleService &&
        typeof consoleService.ensureInitialConsoleMember === "function"
      ) {
        seededConsoleOwnerUserId = Number(await consoleService.ensureInitialConsoleMember(authResult.profile.id));
      }

      const user = authResult?.authenticated ? authResult.profile : null;
      const normalizedUser = authenticatedUserValidator.normalize(user);
      const pendingInvites =
        workspaceInvitationsEnabled && normalizedUser
          ? normalizePendingInvites(
              await workspacePendingInvitationsService.listPendingInvitesForUser(normalizedUser, {
                context: {
                  actor: normalizedUser
                }
              })
            )
          : [];
      const normalizedWorkspaceSlug = resolveBootstrapWorkspaceSlug({ query, request });
      let payload = createAnonymousBootstrapPayload({
        appState,
        tenancyProfile: resolvedTenancyProfile
      });
      if (normalizedWorkspaceSlug && !normalizedUser) {
        payload = {
          ...payload,
          requestedWorkspace: createRequestedWorkspacePayload(
            normalizedWorkspaceSlug,
            REQUESTED_WORKSPACE_STATUS_UNAUTHENTICATED
          )
        };
      }

      if (normalizedUser) {
        const latestProfile =
          (await userProfilesRepository.findByIdentity({
            provider: normalizedUser.authProvider,
            providerUserId: normalizedUser.authProviderUserSid
          })) || normalizedUser;

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

        const userSettings = await userSettingsRepository.ensureForUserId(latestProfile.id);
        payload = {
          session: {
            authenticated: true,
            userId: latestProfile.id
          },
          profile: {
            displayName: latestProfile.displayName,
            email: latestProfile.email,
            avatar: accountAvatarFormatter(latestProfile, userSettings)
          },
          tenancy: resolvedTenancyProfile,
          app: appState,
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
          surfaceAccess: {
            consoleowner: seededConsoleOwnerUserId > 0 && seededConsoleOwnerUserId === Number(latestProfile.id)
          },
          workspaceSettings: workspaceContext
            ? mapWorkspaceSettingsPublic(workspaceContext.workspaceSettings, {
                workspaceInvitationsEnabled
              })
            : null,
          userSettings: mapUserSettingsBootstrap(userSettings),
          requestMeta: {
            hasRequest: Boolean(request)
          }
        };
      }

      const oauthCatalogPayload = getOAuthProviderCatalogPayload(authService);
      const session = payload?.session && typeof payload.session === "object" ? payload.session : { authenticated: false };

      return {
        ...payload,
        session: {
          ...session,
          ...oauthCatalogPayload
        }
      };
    }
  });
}

export { createWorkspaceBootstrapContributor };
