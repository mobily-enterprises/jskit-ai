import { AppError } from "@jskit-ai/kernel/server/runtime";
import { requireServiceMethod } from "@jskit-ai/kernel/shared/actions/actionContributorHelpers";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/actions/textNormalization";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import {
  TENANCY_MODE_NONE,
  TENANCY_MODE_PERSONAL,
  TENANCY_MODE_WORKSPACES,
  WORKSPACE_SLUG_POLICY_NONE,
  WORKSPACE_SLUG_POLICY_IMMUTABLE_USERNAME,
  WORKSPACE_SLUG_POLICY_USER_SELECTED,
  resolveTenancyProfile
} from "../shared/tenancyProfile.js";
import { accountAvatarFormatter } from "./common/formatters/accountAvatarFormatter.js";
import { authenticatedUserValidator } from "./common/validators/authenticatedUserValidator.js";
import { userSettingsFields } from "../shared/resources/userSettingsFields.js";

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

function resolveAppState(appConfig = {}, { workspaceInvitationsEnabled = false } = {}) {
  const features = {
    workspaceSwitching: normalizeBoolean(appConfig.workspaceSwitching, false),
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

function createAnonymousBootstrapPayload({ appState, tenancyProfile, surfaceAccess = {} }) {
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
    surfaceAccess: normalizeObject(surfaceAccess),
    workspaceSettings: null,
    userSettings: null,
    requestMeta: {
      hasRequest: false
    }
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

function createUsersBootstrapContributor({
  usersRepository,
  userSettingsRepository,
  appConfig = {},
  tenancyProfile = null,
  authService
} = {}) {
  const contributorId = "users.bootstrap";
  const appState = resolveAppState(appConfig);
  const resolvedTenancyProfile = resolveBootstrapTenancyProfile(tenancyProfile, appConfig);

  requireServiceMethod(usersRepository, "findById", contributorId, {
    serviceLabel: "usersRepository"
  });
  requireServiceMethod(userSettingsRepository, "ensureForUserId", contributorId, {
    serviceLabel: "userSettingsRepository"
  });

  return Object.freeze({
    contributorId,
    order: 100,
    async contribute({ request = null, reply = null, payload: existingPayload = {} } = {}) {
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

      const normalizedUser = authenticatedUserValidator.normalize(authResult?.authenticated ? authResult?.profile : null);
      const inheritedSurfaceAccess = normalizeObject(existingPayload?.surfaceAccess);
      let payload = createAnonymousBootstrapPayload({
        appState,
        tenancyProfile: resolvedTenancyProfile,
        surfaceAccess: inheritedSurfaceAccess
      });

      if (normalizedUser) {
        const latestProfile = (await usersRepository.findById(normalizedUser.id)) || normalizedUser;
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
          workspaces: [],
          pendingInvites: [],
          activeWorkspace: null,
          membership: null,
          requestedWorkspace: null,
          permissions: [],
          surfaceAccess: inheritedSurfaceAccess,
          workspaceSettings: null,
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

export { createUsersBootstrapContributor };
