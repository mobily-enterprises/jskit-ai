import {
  OAUTH_QUERY_PARAM_PROVIDER,
  OAUTH_QUERY_PARAM_RETURN_TO
} from "@jskit-ai/auth-core/shared/oauthCallbackParams";
import { readOAuthCallbackParamsFromUrl } from "../../runtime/oauthCallbackRuntime.js";
import { OAUTH_CALLBACK_PARAM_KEYS } from "../../runtime/authCallbackUrlParams.js";
import { pageLocation } from "../../browser.js";

function stripOAuthParamsFromLocation() {
  const location = pageLocation();
  if (!location) {
    return;
  }

  const nextUrl = new URL(location.href);
  const oauthParamKeys = [...OAUTH_CALLBACK_PARAM_KEYS, OAUTH_QUERY_PARAM_PROVIDER, OAUTH_QUERY_PARAM_RETURN_TO];

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
  const location = pageLocation();
  if (!location) {
    return null;
  }

  return readOAuthCallbackParamsFromUrl(location.href);
}

export {
  stripOAuthParamsFromLocation,
  readOAuthCallbackParamsFromLocation
};
