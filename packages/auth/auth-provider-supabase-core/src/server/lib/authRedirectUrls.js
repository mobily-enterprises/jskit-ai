import {
  OAUTH_QUERY_PARAM_INTENT,
  OAUTH_QUERY_PARAM_PROVIDER,
  OAUTH_QUERY_PARAM_RETURN_TO
} from "@jskit-ai/access-core/oauthCallbackParams";
import { normalizeOAuthProviderList } from "@jskit-ai/access-core/oauthProviders";
import { normalizeOAuthProviderFromCatalog } from "./oauthProviderCatalog.js";
import { normalizeOAuthIntent, normalizeReturnToPath } from "@jskit-ai/access-core/utils";

const PASSWORD_RESET_PATH = "reset-password";
const OAUTH_LOGIN_PATH = "login";
const OAUTH_LOGIN_INTENT = "login";
const OAUTH_LINK_INTENT = "link";

function parseHttpUrl(rawValue, variableName) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawValue);
  } catch {
    throw new Error(`${variableName} must be a valid absolute URL.`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`${variableName} must start with http:// or https://.`);
  }

  return parsedUrl;
}

function buildPasswordResetRedirectUrl(options) {
  const appPublicUrl = String(options.appPublicUrl || "").trim();

  if (!appPublicUrl) {
    throw new Error("APP_PUBLIC_URL is required to build password reset links.");
  }

  const baseUrl = parseHttpUrl(appPublicUrl, "APP_PUBLIC_URL");
  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname = `${baseUrl.pathname}/`;
  }
  baseUrl.search = "";
  baseUrl.hash = "";
  return new URL(PASSWORD_RESET_PATH, baseUrl).toString();
}

function buildOtpLoginRedirectUrl(options) {
  const appPublicUrl = String(options.appPublicUrl || "").trim();
  const returnTo = normalizeReturnToPath(options.returnTo, { fallback: "" });

  if (!appPublicUrl) {
    throw new Error("APP_PUBLIC_URL is required to build OTP login redirects.");
  }

  const baseUrl = parseHttpUrl(appPublicUrl, "APP_PUBLIC_URL");
  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname = `${baseUrl.pathname}/`;
  }
  baseUrl.search = "";
  baseUrl.hash = "";
  const redirectUrl = new URL(OAUTH_LOGIN_PATH, baseUrl);
  if (returnTo) {
    redirectUrl.searchParams.set("returnTo", returnTo);
  }
  return redirectUrl.toString();
}

function buildOAuthRedirectUrl(options) {
  const appPublicUrl = String(options.appPublicUrl || "").trim();
  const providerIds = normalizeOAuthProviderList(options.providerIds, { fallback: [] });
  const provider = normalizeOAuthProviderFromCatalog(options.provider, {
    providerIds,
    fallback: null
  });
  const intent = normalizeOAuthIntent(options.intent, { fallback: OAUTH_LOGIN_INTENT });
  const callbackPath = String(options.callbackPath || OAUTH_LOGIN_PATH).trim();
  const returnTo = normalizeReturnToPath(options.returnTo, { fallback: "/" });

  if (!appPublicUrl) {
    throw new Error("APP_PUBLIC_URL is required to build OAuth login redirects.");
  }

  if (providerIds.length < 1) {
    throw new Error("OAuth providers are not configured.");
  }

  if (!provider) {
    throw new Error(`OAuth provider must be one of: ${providerIds.join(", ")}.`);
  }

  if (!callbackPath) {
    throw new Error("OAuth callback path is required.");
  }

  const baseUrl = parseHttpUrl(appPublicUrl, "APP_PUBLIC_URL");
  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname = `${baseUrl.pathname}/`;
  }
  baseUrl.search = "";
  baseUrl.hash = "";

  const redirectUrl = new URL(callbackPath, baseUrl);
  redirectUrl.searchParams.set(OAUTH_QUERY_PARAM_PROVIDER, provider);
  redirectUrl.searchParams.set(OAUTH_QUERY_PARAM_INTENT, intent);
  if (returnTo) {
    redirectUrl.searchParams.set(OAUTH_QUERY_PARAM_RETURN_TO, returnTo);
  }
  return redirectUrl.toString();
}

function buildOAuthLoginRedirectUrl(options) {
  return buildOAuthRedirectUrl({
    ...options,
    intent: OAUTH_LOGIN_INTENT,
    callbackPath: OAUTH_LOGIN_PATH
  });
}

function buildOAuthLinkRedirectUrl(options) {
  return buildOAuthRedirectUrl({
    ...options,
    intent: OAUTH_LINK_INTENT,
    callbackPath: OAUTH_LOGIN_PATH
  });
}

export {
  parseHttpUrl,
  buildPasswordResetRedirectUrl,
  buildOtpLoginRedirectUrl,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  buildOAuthRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildOAuthLinkRedirectUrl
};
