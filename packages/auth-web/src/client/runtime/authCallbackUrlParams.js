const AUTH_CALLBACK_URL_BASE = "https://jskit.invalid";

// The params a provider's or Supabase's sign-in callback brings to the page.
const OAUTH_CALLBACK_PARAM_KEYS = Object.freeze([
  "code",
  "access_token",
  "refresh_token",
  "provider_token",
  "expires_in",
  "expires_at",
  "token_type",
  "state",
  "iss",
  "sb",
  "type",
  "error",
  "error_code",
  "error_description",
  "error_params",
  "errorCode",
  "errorDescription",
  "token_hash"
]);

function readAuthCallbackUrlParams(url = "") {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(normalizedUrl, AUTH_CALLBACK_URL_BASE);
    return {
      parsedUrl,
      searchParams: new URLSearchParams(parsedUrl.search || ""),
      hashParams: new URLSearchParams(String(parsedUrl.hash || "").replace(/^#/, ""))
    };
  } catch {
    return null;
  }
}

function readAuthCallbackParam(callbackUrlParams, key) {
  const normalizedKey = String(key || "").trim();
  if (!callbackUrlParams || !normalizedKey) {
    return "";
  }

  return String(
    callbackUrlParams.searchParams.get(normalizedKey) ||
      callbackUrlParams.hashParams.get(normalizedKey) ||
      ""
  ).trim();
}

/**
 * Whether the params are a sign-in callback, which the sign-in page completes: an authorization code, an access and
 * refresh token pair, or an error. The other callback params only come with one of these, so alone they are the page's
 * own: a list filtered by `?state=all` or `?type=x` is no callback.
 * @param {ReturnType<typeof readAuthCallbackUrlParams>} callbackUrlParams
 * @returns {boolean}
 */
function isOAuthCallback(callbackUrlParams) {
  const param = (key) => readAuthCallbackParam(callbackUrlParams, key);
  return Boolean(param("code") || (param("access_token") && param("refresh_token")) || param("error") || param("errorCode"));
}

function stripAuthCallbackParamsFromUrl(url = "", keys = []) {
  const callbackUrlParams = readAuthCallbackUrlParams(url);
  if (!callbackUrlParams) {
    return "";
  }

  const normalizedKeys = Array.isArray(keys)
    ? keys.map((key) => String(key || "").trim()).filter(Boolean)
    : [];
  normalizedKeys.forEach((key) => {
    callbackUrlParams.parsedUrl.searchParams.delete(key);
    callbackUrlParams.hashParams.delete(key);
  });

  const nextHash = callbackUrlParams.hashParams.toString();
  return `${callbackUrlParams.parsedUrl.pathname}${callbackUrlParams.parsedUrl.search}${nextHash ? `#${nextHash}` : ""}`;
}

export {
  OAUTH_CALLBACK_PARAM_KEYS,
  isOAuthCallback,
  readAuthCallbackParam,
  readAuthCallbackUrlParams,
  stripAuthCallbackParamsFromUrl
};
