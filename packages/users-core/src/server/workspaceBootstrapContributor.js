import { AppError } from "@jskit-ai/kernel/server/runtime";
import { requireServiceMethod } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import {
  TENANCY_MODE_NONE,
  normalizeTenancyMode
} from "@jskit-ai/kernel/shared/surface";
import { workspacePendingInvitationsResource } from "../shared/resources/workspacePendingInvitationsResource.js";
import {
  mapMembershipSummary,
  mapWorkspaceSettingsPublic,
  mapWorkspaceSummary
} from "./common/formatters/workspaceFormatter.js";
import { accountAvatarFormatter } from "./common/formatters/accountAvatarFormatter.js";
import { authenticatedUserValidator } from "./common/validators/authenticatedUserValidator.js";
import { userSettingsFields } from "../shared/resources/userSettingsFields.js";

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

function resolveAppState(appConfig = {}) {
  const features = {
    workspaceSwitching: normalizeBoolean(appConfig.workspaceSwitching, true),
    workspaceInvites: normalizeBoolean(appConfig.workspaceInvites, true),
    workspaceCreateEnabled: normalizeBoolean(appConfig.workspaceCreateEnabled, false),
    assistantEnabled: normalizeBoolean(appConfig.assistantEnabled, false),
    assistantRequiredPermission: normalizeText(appConfig.assistantRequiredPermission),
    socialEnabled: normalizeBoolean(appConfig.socialEnabled, false),
    socialFederationEnabled: normalizeBoolean(appConfig.socialFederationEnabled, false)
  };

  return {
    tenancyMode: normalizeTenancyMode(appConfig.tenancyMode),
    features
  };
}

function createAnonymousBootstrapPayload(appState) {
  return {
    session: {
      authenticated: false
    },
    profile: null,
    app: appState,
    workspaces: [],
    pendingInvites: [],
    activeWorkspace: null,
    membership: null,
    permissions: [],
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
  workspaceTenancyEnabled = false,
  appConfig = {},
  authService,
  consoleService = null
} = {}) {
  const contributorId = "users.bootstrap";
  const appState = resolveAppState(appConfig);

  requireServiceMethod(workspaceService, "listWorkspacesForUser", contributorId, {
    serviceLabel: "workspaceService"
  });
  requireServiceMethod(workspaceService, "resolveWorkspaceContextForUserBySlug", contributorId, {
    serviceLabel: "workspaceService"
  });
  if (workspaceTenancyEnabled) {
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
    async contribute({ request = null, reply = null, workspaceSlug = "" } = {}) {
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
      if (
        authResult?.authenticated &&
        authResult?.profile?.id != null &&
        consoleService &&
        typeof consoleService.ensureInitialConsoleMember === "function"
      ) {
        await consoleService.ensureInitialConsoleMember(authResult.profile.id);
      }

      const user = authResult?.authenticated ? authResult.profile : null;
      const normalizedUser = authenticatedUserValidator.normalize(user);
      const pendingInvites =
        workspaceTenancyEnabled && normalizedUser
          ? normalizePendingInvites(
              await workspacePendingInvitationsService.listPendingInvitesForUser(normalizedUser, {
                context: {
                  actor: normalizedUser
                }
              })
            )
          : [];
      let payload = createAnonymousBootstrapPayload(appState);

      if (normalizedUser) {
        const latestProfile =
          (await userProfilesRepository.findByIdentity({
            provider: normalizedUser.authProvider,
            providerUserId: normalizedUser.authProviderUserId
          })) || normalizedUser;

        const workspaces = await workspaceService.listWorkspacesForUser(latestProfile, { request });
        const normalizedWorkspaceSlug = normalizeText(workspaceSlug);
        let workspaceContext = null;
        if (normalizedWorkspaceSlug && appState.tenancyMode !== TENANCY_MODE_NONE) {
          workspaceContext = await workspaceService.resolveWorkspaceContextForUserBySlug(
            latestProfile,
            normalizedWorkspaceSlug,
            { request }
          );
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
          app: appState,
          workspaces: [...workspaces],
          pendingInvites,
          activeWorkspace: workspaceContext
            ? mapWorkspaceSummary(workspaceContext.workspace, {
                roleId: workspaceContext.membership?.roleId,
                status: workspaceContext.membership?.status
              })
            : null,
          membership: mapMembershipSummary(workspaceContext?.membership, workspaceContext?.workspace),
          permissions: workspaceContext ? [...workspaceContext.permissions] : [],
          workspaceSettings: workspaceContext ? mapWorkspaceSettingsPublic(workspaceContext.workspaceSettings) : null,
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
