import {
  OAUTH_QUERY_PARAM_PROVIDER,
  OAUTH_QUERY_PARAM_RETURN_TO
} from "@jskit-ai/auth-core/shared/oauthCallbackParams";
import { readOAuthCallbackParamsFromUrl } from "../../runtime/oauthCallbackRuntime.js";

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

  return readOAuthCallbackParamsFromUrl(window.location.href);
}

export {
  stripOAuthParamsFromLocation,
  readOAuthCallbackParamsFromLocation
};
