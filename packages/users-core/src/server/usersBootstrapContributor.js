import { AppError } from "@jskit-ai/kernel/server/runtime";
import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import { accountAvatarFormatter } from "./common/formatters/accountAvatarFormatter.js";
import { formatUserSettingsSection } from "./common/formatters/accountSettingsResponseFormatter.js";
import { USER_SETTINGS_BOOTSTRAP_KEYS } from "../shared/resources/userSettingsResource.js";

/** @param {import("@jskit-ai/auth-core/server/types").AuthService} authService */
function getOAuthProviderCatalogPayload(authService) {
  // readable-check: allow method-probe - optional operation: getOAuthProviderCatalog is an optional auth.service operation
  if (typeof authService.getOAuthProviderCatalog !== "function") {
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

function createAnonymousBootstrapPayload({ surfaceAccess = {} }) {
  return {
    session: {
      authenticated: false
    },
    profile: null,
    app: {},
    surfaceAccess: normalizeObject(surfaceAccess),
    userSettings: null,
    requestMeta: {
      hasRequest: false
    }
  };
}

/**
 * @param {object} dependencies
 * @param {import("./types.js").UserProfilesRepository} dependencies.userProfilesRepository
 * @param {import("./types.js").UserSettingsRepository} dependencies.userSettingsRepository
 * @param {import("@jskit-ai/auth-core/server/types").AuthService} dependencies.authService
 */
function createUsersBootstrapContributor({ userProfilesRepository, userSettingsRepository, authService }) {
  return Object.freeze({
    async contribute({ request, reply, payload: existingPayload }) {
      const authResult = await request.executeAction({
        actionId: "auth.session.read"
      });

      if (authResult?.clearSession === true) {
        authService.clearSessionCookies(reply);
      }
      if (authResult?.session) {
        authService.writeSessionCookies(reply, authResult.session);
      }
      if (authResult?.transientFailure === true) {
        throw new AppError(503, "Authentication service temporarily unavailable. Please retry.", {
          code: "users.bootstrap.authUnavailable"
        });
      }

      const normalizedUser = authResult?.authenticated === true ? authResult?.actor || null : null;
      const inheritedSurfaceAccess = normalizeObject(existingPayload.surfaceAccess);
      let payload = createAnonymousBootstrapPayload({
        surfaceAccess: inheritedSurfaceAccess
      });

      if (normalizedUser) {
        const latestProfile = (await userProfilesRepository.findById(normalizedUser.id)) || normalizedUser;
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
          app: {},
          surfaceAccess: inheritedSurfaceAccess,
          userSettings: formatUserSettingsSection(USER_SETTINGS_BOOTSTRAP_KEYS, userSettings),
          requestMeta: {
            hasRequest: true
          }
        };
      }

      return {
        ...payload,
        session: {
          ...payload.session,
          ...getOAuthProviderCatalogPayload(authService)
        }
      };
    }
  });
}

export { createUsersBootstrapContributor };
