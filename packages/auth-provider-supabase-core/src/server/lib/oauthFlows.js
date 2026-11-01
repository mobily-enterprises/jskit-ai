import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { authLoginOAuthStartParamsValidator, authLoginOAuthStartQueryValidator } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthStartCommand";
import { authLoginOAuthCompleteBodyValidator } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthCompleteCommand";
import { buildOAuthMethodId } from "@jskit-ai/auth-core/shared/authMethods";
import { mapAuthError, mapRecoveryError, validationError } from "./authErrorMappers.js";
import { normalizeReturnToPath } from "@jskit-ai/auth-core/server/utils";
import { mapOAuthCallbackError, normalizeOAuthProviderInput } from "./authInputParsers.js";
import { buildOAuthLinkRedirectUrl, buildOAuthLoginRedirectUrl } from "./authRedirectUrls.js";
import { resolveOAuthProviderQueryParams } from "./oauthProviderCatalog.js";
import { findAuthMethodById, findLinkedIdentityByProvider } from "./authMethodStatus.js";

/**
 * Signing in with, linking and unlinking an OAuth provider through Supabase.
 * @param {object} dependencies
 * @param {import("../types.js").SupabaseConfig} dependencies.config
 * @param {import("../types.js").SupabaseClients} dependencies.clients
 * @param {import("../types.js").SupabaseSessions} dependencies.sessions
 * @param {import("../types.js").SupabaseProfileMirror} dependencies.profileMirror
 * @param {import("../types.js").SupabaseSecurityStatus} dependencies.securityStatus
 */
function createSupabaseOAuthFlows({ config, clients, sessions, profileMirror, securityStatus }) {
  /** A provider the app offers, else its default one. */
  function configuredProvider(value) {
    return normalizeOAuthProviderInput(value, {
      providerIds: config.oauth.providerIds,
      defaultProvider: config.oauth.defaultProvider
    });
  }

  function allowedReturnTo(value) {
    return normalizeReturnToPath(value, { fallback: "/", allowedOrigins: config.allowedReturnToOrigins });
  }

  async function requestOAuthRedirectUrl(supabase, provider, redirectTo, requestFlow) {
    let response;
    try {
      const queryParams = resolveOAuthProviderQueryParams(provider, {
        providerQueryParamsById: config.oauth.providerQueryParamsById
      });
      response = await requestFlow({
        provider,
        options: {
          redirectTo,
          queryParams: queryParams || undefined
        }
      });
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error || !response.data?.url) {
      throw mapAuthError(response.error, 400);
    }

    return String(response.data.url);
  }

  async function oauthStart(payload) {
    clients.ensureConfigured();

    const paramsResult = authLoginOAuthStartParamsValidator.schema.patch({
      provider: payload.provider || config.oauth.defaultProvider
    });
    if (Object.keys(paramsResult.errors).length > 0) {
      throw validationError(paramsResult.errors);
    }

    const queryResult = authLoginOAuthStartQueryValidator.schema.patch({
      returnTo: payload.returnTo
    });
    if (Object.keys(queryResult.errors).length > 0) {
      throw validationError(queryResult.errors);
    }

    const provider = configuredProvider(paramsResult.validatedObject.provider);
    const returnTo = allowedReturnTo(queryResult.validatedObject.returnTo);
    const redirectTo = buildOAuthLoginRedirectUrl({
      appPublicUrl: config.appPublicUrl,
      providerIds: config.oauth.providerIds,
      provider,
      returnTo
    });
    const supabase = clients.createSupabaseClient();
    const url = await requestOAuthRedirectUrl(supabase, provider, redirectTo, (input) =>
      supabase.auth.signInWithOAuth(input)
    );

    return {
      provider,
      returnTo,
      url
    };
  }

  async function startProviderLink(request, payload) {
    clients.ensureConfigured();

    const paramsResult = authLoginOAuthStartParamsValidator.schema.patch({
      provider: payload.provider || config.oauth.defaultProvider
    });
    if (Object.keys(paramsResult.errors).length > 0) {
      throw validationError(paramsResult.errors);
    }

    const queryResult = authLoginOAuthStartQueryValidator.schema.patch({
      returnTo: payload.returnTo
    });
    if (Object.keys(queryResult.errors).length > 0) {
      throw validationError(queryResult.errors);
    }

    const provider = configuredProvider(paramsResult.validatedObject.provider);
    const returnTo = allowedReturnTo(queryResult.validatedObject.returnTo);
    const supabase = clients.createSupabaseClient();
    await sessions.setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });

    const redirectTo = buildOAuthLinkRedirectUrl({
      appPublicUrl: config.appPublicUrl,
      providerIds: config.oauth.providerIds,
      provider,
      returnTo
    });
    const url = await requestOAuthRedirectUrl(supabase, provider, redirectTo, (input) =>
      supabase.auth.linkIdentity(input)
    );

    return {
      provider,
      returnTo,
      url
    };
  }

  async function oauthComplete(payload) {
    clients.ensureConfigured();

    const result = authLoginOAuthCompleteBodyValidator.schema.patch(payload);
    if (Object.keys(result.errors).length > 0) {
      throw validationError(result.errors);
    }
    const parsed = result.validatedObject;
    const code = String(parsed.code || "").trim();
    const accessToken = String(parsed.accessToken || "").trim();
    const refreshToken = String(parsed.refreshToken || "").trim();
    const errorCode = String(parsed.error || parsed.error_code || "").trim();
    const hasSessionPair = Boolean(accessToken && refreshToken);
    const fieldErrors = {};

    if ((accessToken && !refreshToken) || (!accessToken && refreshToken)) {
      if (!accessToken) {
        fieldErrors.accessToken = {
          code: "auth.supabase.tokens.accessTokenRequired",
          message: "Access token is required when a refresh token is provided."
        };
      }
      if (!refreshToken) {
        fieldErrors.refreshToken = {
          code: "auth.supabase.tokens.refreshTokenRequired",
          message: "Refresh token is required when an access token is provided."
        };
      }
    }

    if (!code && !errorCode && !hasSessionPair) {
      fieldErrors.code = {
        code: "auth.supabase.oauth.codeRequired",
        message: "OAuth code is required when access/refresh tokens are not provided."
      };
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw validationError(fieldErrors);
    }

    const provider =
      !hasSessionPair || code || errorCode
        ? configuredProvider(parsed.provider || config.oauth.defaultProvider)
        : null;

    if (errorCode) {
      throw mapOAuthCallbackError(errorCode);
    }

    const supabase = clients.createSupabaseClient();
    let response;
    try {
      if (hasSessionPair) {
        response = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken
        });
      } else {
        response = await supabase.auth.exchangeCodeForSession(code);
      }
    } catch (error) {
      throw mapRecoveryError(error);
    }

    if (response.error || !response.data?.session || !response.data?.user) {
      throw mapRecoveryError(response.error);
    }

    const profile = await profileMirror.syncProfileFromSupabaseUser(response.data.user, response.data.user.email);

    return {
      provider,
      profile,
      session: response.data.session
    };
  }

  async function unlinkProvider(request, payload) {
    clients.ensureConfigured();

    const provider = configuredProvider(payload.provider);
    const supabase = clients.createSupabaseClient();

    await sessions.setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });
    const current = await securityStatus.currentAuthContext(request, {
      supabaseClient: supabase
    });
    const methodId = buildOAuthMethodId(provider);
    const providerMethod = findAuthMethodById(current.authMethodsStatus, methodId);
    if (!providerMethod || !providerMethod.configured) {
      throw validationError({
        provider: { code: "auth.supabase.unlink.notLinked", params: { provider }, message: `${provider} is not linked to this account.` }
      });
    }

    if (!providerMethod.canDisable) {
      throw new AppError(409, "At least one sign-in method must remain enabled.", { code: "auth.supabase.methods.lastEnabled" });
    }

    const identity = findLinkedIdentityByProvider(current.user, provider);
    if (!identity) {
      throw new AppError(409, "Linked identity details could not be resolved for this provider.", {
        code: "auth.supabase.unlink.identityUnresolved"
      });
    }

    let response;
    try {
      response = await supabase.auth.unlinkIdentity(identity);
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error) {
      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }

    const refreshed = await securityStatus.currentAuthContext(request, {
      supabaseClient: supabase
    });
    return {
      securityStatus: securityStatus.buildSecurityStatus(refreshed.authMethodsStatus)
    };
  }

  return Object.freeze({
    oauthStart,
    startProviderLink,
    oauthComplete,
    unlinkProvider
  });
}

export { createSupabaseOAuthFlows };
