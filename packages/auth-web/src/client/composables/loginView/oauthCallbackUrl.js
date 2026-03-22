import {
  OAUTH_QUERY_PARAM_PROVIDER,
  OAUTH_QUERY_PARAM_RETURN_TO
} from "@jskit-ai/auth-core/shared/oauthCallbackParams";

function stripOAuthParamsFromLocation() {
  if (typeof window !== "object" || !window.location) {
    return;
  }

  const nextUrl = new URL(window.location.href);
  const oauthParamKeys = [
    "code",
    "access_token",
    "refresh_token",
    "provider_token",
    "expires_in",
    "expires_at",
    "token_type",
    "state",
    "sb",
    "type",
    "error",
    "error_description",
    "errorCode",
    "errorDescription",
    OAUTH_QUERY_PARAM_PROVIDER,
    OAUTH_QUERY_PARAM_RETURN_TO
  ];

  oauthParamKeys.forEach((key) => {
    nextUrl.searchParams.delete(key);
  });

  const hashParams = new URLSearchParams((nextUrl.hash || "").replace(/^#/, ""));
  oauthParamKeys.forEach((key) => {
    hashParams.delete(key);
  });

  const nextHash = hashParams.toString();
  window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextHash ? `#${nextHash}` : ""}`);
}

function readOAuthCallbackParamsFromLocation() {
  if (typeof window !== "object" || !window.location) {
    return null;
  }

  const searchParams = new URLSearchParams(window.location.search || "");
  const hashParams = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));

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

  return {
    code,
    accessToken,
    refreshToken,
    hasSessionPair,
    errorCode,
    errorDescription,
    provider: String(searchParams.get(OAUTH_QUERY_PARAM_PROVIDER) || "").trim().toLowerCase(),
    returnTo: String(searchParams.get(OAUTH_QUERY_PARAM_RETURN_TO) || "").trim()
  };
}

export {
  stripOAuthParamsFromLocation,
  readOAuthCallbackParamsFromLocation
};
