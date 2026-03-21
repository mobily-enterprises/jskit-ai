import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

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
    parseOAuthCompletePayload,
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

    const provider = normalizeOAuthProviderInput(payload.provider || authOAuthDefaultProvider);
    const returnTo = normalizeReturnToPath(payload.returnTo, { fallback: "/" });
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

    const supabase = getSupabaseClient();
    const provider = normalizeOAuthProviderInput(payload.provider || authOAuthDefaultProvider);
    const returnTo = normalizeReturnToPath(payload.returnTo, { fallback: "/" });
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

    const parsed = parseOAuthCompletePayload(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    if (parsed.errorCode) {
      throw mapOAuthCallbackError(parsed.errorCode, parsed.errorDescription);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      if (parsed.hasSessionPair) {
        response = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken
        });
      } else {
        response = await supabase.auth.exchangeCodeForSession(parsed.code);
      }
    } catch (error) {
      throw mapRecoveryError(error);
    }

    if (response.error || !response.data?.session || !response.data?.user) {
      throw mapRecoveryError(response.error);
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email);

    return {
      provider: parsed.provider,
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
