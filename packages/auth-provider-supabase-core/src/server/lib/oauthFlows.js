import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { authLoginOAuthStartParamsValidator, authLoginOAuthStartQueryValidator } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthStartCommand";
import { authLoginOAuthCompleteBodyValidator } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthCompleteCommand";

function createOauthFlows(deps) {
  const {
    ensureConfigured,
    normalizeOAuthProviderInput,
    normalizeReturnToPath,
    buildOAuthLoginRedirectUrl,
    appPublicUrl,
    authOAuthDefaultProvider,
    resolveOAuthProviderQueryParams = () => null,
    getSupabaseClient,
    mapAuthError,
    setSessionFromRequestCookies,
    buildOAuthLinkRedirectUrl,
    validationError,
    mapOAuthCallbackError,
    mapRecoveryError,
    syncProfileFromSupabaseUser,
    resolveCurrentAuthContext,
    buildOAuthMethodId,
    findAuthMethodById,
    findLinkedIdentityByProvider,
    buildSecurityStatusFromAuthMethodsStatus
  } = deps;

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

    if (typeof supabase.auth.linkIdentity !== "function") {
      throw new AppError(500, "Supabase client does not support identity linking in this environment.");
    }

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
    const errorDescription = String(parsed.errorDescription || parsed.error_description || "").trim();
    const hasSessionPair = Boolean(accessToken && refreshToken);
    const fieldErrors = {};

    if ((accessToken && !refreshToken) || (!accessToken && refreshToken)) {
      if (!accessToken) {
        fieldErrors.accessToken = "Access token is required when a refresh token is provided.";
      }
      if (!refreshToken) {
        fieldErrors.refreshToken = "Refresh token is required when an access token is provided.";
      }
    }

    if (!code && !errorCode && !hasSessionPair) {
      fieldErrors.code = "OAuth code is required when access/refresh tokens are not provided.";
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw validationError(fieldErrors);
    }

    const provider =
      !hasSessionPair || code || errorCode
        ? normalizeOAuthProviderInput(parsed.provider || authOAuthDefaultProvider)
        : null;

    if (errorCode) {
      throw mapOAuthCallbackError(errorCode, errorDescription);
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
    if (typeof supabase.auth.unlinkIdentity !== "function") {
      throw new AppError(500, "Supabase client does not support identity unlinking in this environment.");
    }

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
        provider: `${provider} is not linked to this account.`
      });
    }

    if (!providerMethod.canDisable) {
      throw new AppError(409, "At least one sign-in method must remain enabled.");
    }

    const identity = findLinkedIdentityByProvider(current.user, provider);
    if (!identity) {
      throw new AppError(409, "Linked identity details could not be resolved for this provider.");
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
      securityStatus: buildSecurityStatusFromAuthMethodsStatus(refreshed.authMethodsStatus)
    };
  }

  return {
    oauthStart,
    startProviderLink,
    oauthComplete,
    unlinkProvider
  };
}

export { createOauthFlows };
