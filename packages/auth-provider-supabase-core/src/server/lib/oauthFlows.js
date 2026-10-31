import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { authLoginOAuthStartParamsValidator, authLoginOAuthStartQueryValidator } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthStartCommand";
import { authLoginOAuthCompleteBodyValidator } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthCompleteCommand";
import { buildOAuthMethodId } from "@jskit-ai/auth-core/shared/authMethods";
import { mapAuthError, mapRecoveryError, validationError } from "./authErrorMappers.js";
import { mapOAuthCallbackError } from "./authInputParsers.js";
import { findAuthMethodById, findLinkedIdentityByProvider } from "./authMethodStatus.js";

// Signing in with, linking and unlinking an OAuth provider through Supabase.
/**
 * @param {object} dependencies
 * @param {string} dependencies.appPublicUrl
 * @param {string} dependencies.authOAuthDefaultProvider
 * @param {(input: { appPublicUrl: string, provider: string, returnTo: string }) => string} dependencies.buildOAuthLinkRedirectUrl The link redirect URL for a configured provider.
 * @param {(input: { appPublicUrl: string, provider: string, returnTo: string }) => string} dependencies.buildOAuthLoginRedirectUrl The sign-in redirect URL for a configured provider.
 * @param {(authMethodsStatus: any) => object} dependencies.buildProviderSecurityStatus The security status, with the actions this app offers.
 * @param {() => void} dependencies.ensureConfigured Throws when Supabase is not configured.
 * @param {() => import("@supabase/supabase-js").SupabaseClient} dependencies.getSupabaseClient
 * @param {(value: unknown) => string} dependencies.normalizeOAuthProviderInput A configured provider id.
 * @param {(value: unknown, options?: { fallback?: string }) => string} dependencies.normalizeReturnToPath A return path on an allowed origin.
 * @param {(request: object, options?: { supabaseClient?: import("@supabase/supabase-js").SupabaseClient }) => Promise<{ user: import("@supabase/supabase-js").User, profile: { id: string }, authMethodsStatus: any }>} dependencies.resolveCurrentAuthContext
 * @param {(providerId: string) => Record<string, string> | null} dependencies.resolveOAuthProviderQueryParams The provider's configured query parameters.
 * @param {ReturnType<typeof import("./sessions.js").createSupabaseSessions>["setSessionFromRequestCookies"]} dependencies.setSessionFromRequestCookies
 * @param {ReturnType<typeof import("./profileMirror.js").createProfileMirror>["syncProfileFromSupabaseUser"]} dependencies.syncProfileFromSupabaseUser
 */
function createSupabaseOAuthFlows({
  appPublicUrl,
  authOAuthDefaultProvider,
  buildOAuthLinkRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildProviderSecurityStatus,
  ensureConfigured,
  getSupabaseClient,
  normalizeOAuthProviderInput,
  normalizeReturnToPath,
  resolveCurrentAuthContext,
  resolveOAuthProviderQueryParams,
  setSessionFromRequestCookies,
  syncProfileFromSupabaseUser
}) {
  async function requestOAuthRedirectUrl(supabase, provider, redirectTo, requestFlow) {
    let response;
    try {
      const queryParams = resolveOAuthProviderQueryParams(provider);
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

  async function oauthStart(payload = {}) {
    ensureConfigured();

    const paramsResult = authLoginOAuthStartParamsValidator.schema.patch({
      provider: payload.provider || authOAuthDefaultProvider
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

    const provider = normalizeOAuthProviderInput(paramsResult.validatedObject.provider);
    const returnTo = normalizeReturnToPath(queryResult.validatedObject.returnTo, { fallback: "/" });
    const redirectTo = buildOAuthLoginRedirectUrl({
      appPublicUrl,
      provider,
      returnTo
    });
    const supabase = getSupabaseClient();
    const url = await requestOAuthRedirectUrl(supabase, provider, redirectTo, (input) =>
      supabase.auth.signInWithOAuth(input)
    );

    return {
      provider,
      returnTo,
      url
    };
  }

  async function startProviderLink(request, payload = {}) {
    ensureConfigured();

    const paramsResult = authLoginOAuthStartParamsValidator.schema.patch({
      provider: payload.provider || authOAuthDefaultProvider
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

    const provider = normalizeOAuthProviderInput(paramsResult.validatedObject.provider);
    const returnTo = normalizeReturnToPath(queryResult.validatedObject.returnTo, { fallback: "/" });
    const supabase = getSupabaseClient();
    await setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });

    const redirectTo = buildOAuthLinkRedirectUrl({
      appPublicUrl,
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

  async function oauthComplete(payload = {}) {
    ensureConfigured();

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
        ? normalizeOAuthProviderInput(parsed.provider || authOAuthDefaultProvider)
        : null;

    if (errorCode) {
      throw mapOAuthCallbackError(errorCode);
    }

    const supabase = getSupabaseClient();
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

    const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email);

    return {
      provider,
      profile,
      session: response.data.session
    };
  }

  async function unlinkProvider(request, payload = {}) {
    ensureConfigured();

    const provider = normalizeOAuthProviderInput(payload.provider);
    const supabase = getSupabaseClient();

    await setSessionFromRequestCookies(request, {
      supabaseClient: supabase
    });
    const current = await resolveCurrentAuthContext(request, {
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

    const refreshed = await resolveCurrentAuthContext(request, {
      supabaseClient: supabase
    });
    return {
      securityStatus: buildProviderSecurityStatus(refreshed.authMethodsStatus)
    };
  }

  return {
    oauthStart,
    startProviderLink,
    oauthComplete,
    unlinkProvider
  };
}

export { createSupabaseOAuthFlows };
