import { authLoginOAuthCompleteCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthCompleteCommand";
import { resolveAuthDeniedLoginMessage } from "@jskit-ai/auth-core/shared/authDenied";
import {
  OAUTH_QUERY_PARAM_PROVIDER,
  OAUTH_QUERY_PARAM_RETURN_TO
} from "@jskit-ai/auth-core/shared/oauthCallbackParams";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { normalizeAuthReturnToPath } from "../lib/returnToPath.js";
import { authHttpRequest } from "./authHttpClient.js";
import {
  readAuthCallbackParam,
  readAuthCallbackUrlParams
} from "./authCallbackUrlParams.js";
import { ensureCommandSectionValid } from "../composables/loginView/validationHelpers.js";

function readOAuthCallbackParamsFromUrl(url = "") {
  const callbackUrlParams = readAuthCallbackUrlParams(url);
  if (!callbackUrlParams) {
    return null;
  }

  const { searchParams } = callbackUrlParams;
  const code = readAuthCallbackParam(callbackUrlParams, "code");
  const accessToken = readAuthCallbackParam(callbackUrlParams, "access_token");
  const refreshToken = readAuthCallbackParam(callbackUrlParams, "refresh_token");
  const errorCode = String(
    readAuthCallbackParam(callbackUrlParams, "error") ||
      readAuthCallbackParam(callbackUrlParams, "errorCode")
  ).trim();
  const errorDescription = String(
    readAuthCallbackParam(callbackUrlParams, "error_description") ||
      readAuthCallbackParam(callbackUrlParams, "errorDescription")
  ).trim();
  const hasSessionPair = Boolean(accessToken && refreshToken);

  if (!code && !hasSessionPair && !errorCode) {
    return null;
  }

  return Object.freeze({
    code,
    accessToken,
    refreshToken,
    hasSessionPair,
    errorCode,
    errorDescription,
    provider: String(searchParams.get(OAUTH_QUERY_PARAM_PROVIDER) || "").trim().toLowerCase(),
    returnTo: String(searchParams.get(OAUTH_QUERY_PARAM_RETURN_TO) || "").trim()
  });
}

function buildOAuthCompletePayload({ callbackParams = null, provider = "", hasSessionPair = false } = {}) {
  const payload = {};
  if (provider) {
    payload.provider = provider;
  }
  if (callbackParams?.code) {
    payload.code = callbackParams.code;
  }
  if (hasSessionPair) {
    payload.accessToken = callbackParams?.accessToken;
    payload.refreshToken = callbackParams?.refreshToken;
  }
  return payload;
}

async function completeOAuthCallbackFromUrl({
  url = "",
  fallbackReturnTo = "/",
  allowedReturnToOrigins = [],
  defaultProvider = "",
  request = authHttpRequest,
  refreshSession = async () => null
} = {}) {
  const callbackParams = readOAuthCallbackParamsFromUrl(url);
  if (!callbackParams) {
    return Object.freeze({
      handled: false,
      completed: false,
      returnTo: normalizeAuthReturnToPath("", fallbackReturnTo, {
        allowedOrigins: allowedReturnToOrigins
      })
    });
  }

  const returnTo = normalizeAuthReturnToPath(callbackParams.returnTo, fallbackReturnTo, {
    allowedOrigins: allowedReturnToOrigins
  });
  const provider = String(callbackParams.provider || defaultProvider || "")
    .trim()
    .toLowerCase();
  const oauthError = callbackParams.errorCode;
  const oauthErrorDescription = callbackParams.errorDescription;
  const hasSessionPair = callbackParams.hasSessionPair === true;

  if (oauthError) {
    return Object.freeze({
      handled: true,
      completed: false,
      returnTo,
      errorMessage: oauthErrorDescription || oauthError,
      callbackParams
    });
  }

  if (!provider && !hasSessionPair) {
    return Object.freeze({
      handled: true,
      completed: false,
      returnTo,
      errorMessage: "OAuth provider is missing from callback.",
      callbackParams
    });
  }

  try {
    const payload = buildOAuthCompletePayload({
      callbackParams,
      provider,
      hasSessionPair
    });
    ensureCommandSectionValid(
      authLoginOAuthCompleteCommand,
      "body",
      payload,
      "Invalid OAuth callback payload."
    );

    const oauthResult = await request(AUTH_PATHS.OAUTH_COMPLETE, {
      method: "POST",
      body: payload
    });
    const session = await refreshSession();
    if (!session?.authenticated) {
      const authDeniedMessage = resolveAuthDeniedLoginMessage(session?.authDenied);
      if (authDeniedMessage) {
        throw new Error(authDeniedMessage);
      }
      throw new Error("Login succeeded but the session is not active yet. Please retry.");
    }

    return Object.freeze({
      handled: true,
      completed: true,
      returnTo,
      callbackParams,
      oauthResult,
      session
    });
  } catch (error) {
    return Object.freeze({
      handled: true,
      completed: false,
      returnTo,
      callbackParams,
      errorMessage: String(error?.message || "Unable to complete OAuth sign-in.")
    });
  }
}

async function completeOAuthCallbackFromCurrentLocation(options = {}) {
  if (typeof window !== "object" || !window?.location) {
    return Object.freeze({
      handled: false,
      completed: false,
      returnTo: normalizeAuthReturnToPath("", options.fallbackReturnTo || "/", {
        allowedOrigins: options.allowedReturnToOrigins
      })
    });
  }

  return completeOAuthCallbackFromUrl({
    ...options,
    url: window.location.href
  });
}

export {
  completeOAuthCallbackFromCurrentLocation,
  completeOAuthCallbackFromUrl,
  readOAuthCallbackParamsFromUrl
};
