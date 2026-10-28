import { authLoginOAuthCompleteCommand } from "@jskit-ai/auth-core/shared/commands/authLoginOAuthCompleteCommand";
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
import { inactiveSessionMessage } from "./inactiveSessionMessage.js";
import { useJskitText } from "../i18n.js";

// The params of a sign-in error the server explained by redirect (error_params).
function readErrorParams(value = "") {
  try {
    const params = JSON.parse(value || "{}");
    return params && typeof params === "object" && !Array.isArray(params) ? params : {};
  } catch {
    return {};
  }
}

function readOAuthCallbackParamsFromUrl(url = "") {
  const callbackUrlParams = readAuthCallbackUrlParams(url);
  if (!callbackUrlParams) {
    return null;
  }

  const { searchParams } = callbackUrlParams;
  const code = readAuthCallbackParam(callbackUrlParams, "code");
  const state = readAuthCallbackParam(callbackUrlParams, "state");
  const iss = readAuthCallbackParam(callbackUrlParams, "iss");
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
  // The description's code and params, sent when the app's server explained the
  // error. A provider's own error_code is translated only if its English matches.
  const errorDescriptionCode = String(readAuthCallbackParam(callbackUrlParams, "error_code")).trim();
  const errorDescriptionParams = readErrorParams(readAuthCallbackParam(callbackUrlParams, "error_params"));
  const hasSessionPair = Boolean(accessToken && refreshToken);

  if (!code && !hasSessionPair && !errorCode) {
    return null;
  }

  return Object.freeze({
    code,
    state,
    iss,
    accessToken,
    refreshToken,
    hasSessionPair,
    errorCode,
    errorDescription,
    errorDescriptionCode,
    errorDescriptionParams,
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
  if (callbackParams?.state) {
    payload.state = callbackParams.state;
  }
  if (callbackParams?.iss) {
    payload.iss = callbackParams.iss;
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
  const hasSessionPair = callbackParams.hasSessionPair === true;
  const { serverMessage, t } = useJskitText();

  if (oauthError) {
    return Object.freeze({
      handled: true,
      completed: false,
      returnTo,
      errorMessage: serverMessage({
        code: callbackParams.errorDescriptionCode,
        params: callbackParams.errorDescriptionParams,
        message: callbackParams.errorDescription
      }, oauthError),
      callbackParams
    });
  }

  if (!provider && !hasSessionPair) {
    return Object.freeze({
      handled: true,
      completed: false,
      returnTo,
      errorMessage: t("jskit.auth.oauth.providerMissing"),
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
      t("jskit.auth.oauth.invalidCallback")
    );

    const oauthResult = await request(AUTH_PATHS.OAUTH_COMPLETE, {
      method: "POST",
      body: payload
    });
    const session = await refreshSession();
    if (!session?.authenticated) {
      throw new Error(inactiveSessionMessage(session));
    }

    return Object.freeze({
      handled: true,
      completed: true,
      // A provider with one fixed redirect address returns the requested page itself.
      returnTo: oauthResult?.returnTo && !callbackParams.returnTo
        ? normalizeAuthReturnToPath(oauthResult.returnTo, fallbackReturnTo, { allowedOrigins: allowedReturnToOrigins })
        : returnTo,
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
      errorMessage: serverMessage(error, t("jskit.auth.login.error.oauthCompleteFailed"))
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
