import { authLoginOAuthCompleteCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthCompleteCommand";
import {
  OAUTH_QUERY_PARAM_PROVIDER,
  OAUTH_QUERY_PARAM_RETURN_TO
} from "@jskit-ai/auth-core/shared/oauthCallbackParams";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { normalizeAuthReturnToPath } from "../lib/returnToPath.js";
import { authHttpRequest } from "./authHttpClient.js";
import { ensureCommandSectionValid } from "../composables/loginView/validationHelpers.js";

function parseCallbackUrl(url = "") {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    return null;
  }

  try {
    return new URL(normalizedUrl, "https://jskit.invalid");
  } catch {
    return null;
  }
}

function readOAuthCallbackParamsFromUrl(url = "") {
  const parsedUrl = parseCallbackUrl(url);
  if (!parsedUrl) {
    return null;
  }

  const searchParams = new URLSearchParams(parsedUrl.search || "");
  const hashParams = new URLSearchParams(String(parsedUrl.hash || "").replace(/^#/, ""));

  const code = String(searchParams.get("code") || hashParams.get("code") || "").trim();
  const accessToken = String(searchParams.get("access_token") || hashParams.get("access_token") || "").trim();
  const refreshToken = String(searchParams.get("refresh_token") || hashParams.get("refresh_token") || "").trim();
  const errorCode = String(
    searchParams.get("error") ||
      hashParams.get("error") ||
      searchParams.get("errorCode") ||
      hashParams.get("errorCode") ||
      ""
  ).trim();
  const errorDescription = String(
    searchParams.get("error_description") ||
      hashParams.get("error_description") ||
      searchParams.get("errorDescription") ||
      hashParams.get("errorDescription") ||
      ""
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
