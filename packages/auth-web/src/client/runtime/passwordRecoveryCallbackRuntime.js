import {
  readAuthCallbackParam,
  readAuthCallbackUrlParams,
  stripAuthCallbackParamsFromUrl
} from "./authCallbackUrlParams.js";

const PASSWORD_RECOVERY_CALLBACK_PARAM_KEYS = Object.freeze([
  "token",
  "code",
  "token_hash",
  "access_token",
  "refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "type"
]);

function readPasswordRecoveryCallbackPayloadFromUrl(url = "") {
  const callbackUrlParams = readAuthCallbackUrlParams(url);
  if (!callbackUrlParams) {
    return null;
  }

  const accessToken = readAuthCallbackParam(callbackUrlParams, "access_token");
  const refreshToken = readAuthCallbackParam(callbackUrlParams, "refresh_token");
  const tokenHash = readAuthCallbackParam(callbackUrlParams, "token_hash");
  const code =
    readAuthCallbackParam(callbackUrlParams, "token") ||
    readAuthCallbackParam(callbackUrlParams, "code");

  if (accessToken && refreshToken) {
    return Object.freeze({
      accessToken,
      refreshToken,
      type: "recovery"
    });
  }
  if (tokenHash) {
    return Object.freeze({
      tokenHash,
      type: "recovery"
    });
  }
  if (code) {
    return Object.freeze({
      code,
      type: "recovery"
    });
  }
  if (accessToken || refreshToken) {
    return Object.freeze({
      accessToken,
      refreshToken,
      type: "recovery"
    });
  }
  return null;
}

function stripPasswordRecoveryCallbackParamsFromUrl(url = "") {
  return stripAuthCallbackParamsFromUrl(url, PASSWORD_RECOVERY_CALLBACK_PARAM_KEYS);
}

function stripPasswordRecoveryCallbackParamsFromLocation() {
  if (typeof window !== "object" || !window.location || !window.history) {
    return;
  }

  window.history.replaceState(
    {},
    "",
    stripPasswordRecoveryCallbackParamsFromUrl(window.location.href)
  );
}

export {
  PASSWORD_RECOVERY_CALLBACK_PARAM_KEYS,
  readPasswordRecoveryCallbackPayloadFromUrl,
  stripPasswordRecoveryCallbackParamsFromLocation,
  stripPasswordRecoveryCallbackParamsFromUrl
};
