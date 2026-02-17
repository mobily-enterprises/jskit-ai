import { AUTH_OAUTH_DEFAULT_PROVIDER, normalizeOAuthProvider } from "../../shared/auth/oauthProviders.js";

const OAUTH_PENDING_CONTEXT_STORAGE_KEY = "auth.oauth.pendingContext";
const OAUTH_QUERY_PARAM_PROVIDER = "oauthProvider";
const OAUTH_QUERY_PARAM_INTENT = "oauthIntent";
const OAUTH_QUERY_PARAM_RETURN_TO = "oauthReturnTo";

const OAUTH_KNOWN_SEARCH_PARAMS = new Set([
  "code",
  "error",
  "error_description",
  "state",
  "access_token",
  "refresh_token",
  "provider_token",
  "expires_at",
  "expires_in",
  "token_type",
  OAUTH_QUERY_PARAM_PROVIDER,
  OAUTH_QUERY_PARAM_INTENT,
  OAUTH_QUERY_PARAM_RETURN_TO,
  "sb"
]);

const OAUTH_KNOWN_HASH_PARAMS = new Set([
  "code",
  "error",
  "error_description",
  "state",
  "access_token",
  "refresh_token",
  "provider_token",
  "expires_at",
  "expires_in",
  "token_type",
  "type",
  "sb"
]);

function isSessionStorageAvailable() {
  if (typeof window === "undefined" || !window.sessionStorage) {
    return false;
  }

  try {
    const key = "__oauth_context_probe__";
    window.sessionStorage.setItem(key, "1");
    window.sessionStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function normalizeOAuthIntent(value, { fallback = "login" } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "login" || normalized === "link") {
    return normalized;
  }

  return fallback;
}

function normalizeReturnToPath(value, { fallback = "/" } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }

  return normalized;
}

function writePendingOAuthContext(context) {
  if (!isSessionStorageAvailable()) {
    return;
  }

  const provider = normalizeOAuthProvider(context?.provider, { fallback: null });
  if (!provider) {
    return;
  }

  const payload = {
    provider,
    intent: normalizeOAuthIntent(context?.intent, { fallback: "login" }),
    returnTo: normalizeReturnToPath(context?.returnTo, { fallback: "/" }),
    rememberAccountOnDevice: context?.rememberAccountOnDevice !== false
  };

  try {
    window.sessionStorage.setItem(OAUTH_PENDING_CONTEXT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // best effort only
  }
}

function readPendingOAuthContext() {
  if (!isSessionStorageAvailable()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(OAUTH_PENDING_CONTEXT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const provider = normalizeOAuthProvider(parsed?.provider, { fallback: null });
    if (!provider) {
      return null;
    }

    return {
      provider,
      intent: normalizeOAuthIntent(parsed?.intent, { fallback: "login" }),
      returnTo: normalizeReturnToPath(parsed?.returnTo, { fallback: "/" }),
      rememberAccountOnDevice: parsed?.rememberAccountOnDevice !== false
    };
  } catch {
    return null;
  }
}

function clearPendingOAuthContext() {
  if (!isSessionStorageAvailable()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(OAUTH_PENDING_CONTEXT_STORAGE_KEY);
  } catch {
    // best effort only
  }
}

function readOAuthCallbackStateFromLocation(options = {}) {
  if (typeof window === "undefined") {
    return null;
  }

  const pendingContext = options.pendingContext || null;
  const defaultProvider = options.defaultProvider || AUTH_OAUTH_DEFAULT_PROVIDER;
  const defaultIntent = options.defaultIntent || "login";
  const defaultReturnTo = options.defaultReturnTo || "/";

  const search = new URLSearchParams(window.location.search || "");
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));

  const code = String(search.get("code") || hash.get("code") || "").trim();
  const errorCode = String(search.get("error") || hash.get("error") || "").trim();
  const errorDescription = String(search.get("error_description") || hash.get("error_description") || "").trim();
  const accessToken = String(search.get("access_token") || hash.get("access_token") || "").trim();
  const refreshToken = String(search.get("refresh_token") || hash.get("refresh_token") || "").trim();
  const hasSessionPair = Boolean(accessToken && refreshToken);

  if (!code && !errorCode && !hasSessionPair) {
    return null;
  }

  const providerFromQuery = normalizeOAuthProvider(search.get(OAUTH_QUERY_PARAM_PROVIDER), {
    fallback: null
  });
  const providerFromContext = normalizeOAuthProvider(pendingContext?.provider, {
    fallback: null
  });
  const provider = normalizeOAuthProvider(providerFromQuery || providerFromContext || defaultProvider, {
    fallback: defaultProvider
  });

  const intent = normalizeOAuthIntent(search.get(OAUTH_QUERY_PARAM_INTENT) || pendingContext?.intent || defaultIntent, {
    fallback: defaultIntent
  });
  const returnTo = normalizeReturnToPath(search.get(OAUTH_QUERY_PARAM_RETURN_TO) || pendingContext?.returnTo || defaultReturnTo, {
    fallback: defaultReturnTo
  });

  const payload = {
    provider
  };
  if (code) {
    payload.code = code;
  }
  if (errorCode) {
    payload.error = errorCode;
  }
  if (errorDescription) {
    payload.errorDescription = errorDescription;
  }
  if (hasSessionPair) {
    payload.accessToken = accessToken;
    payload.refreshToken = refreshToken;
  }

  return {
    payload,
    provider,
    intent,
    returnTo
  };
}

function stripOAuthCallbackParamsFromLocation(options = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const preserveSearchKeys = new Set(
    Array.isArray(options.preserveSearchKeys) ? options.preserveSearchKeys.map((key) => String(key)) : []
  );

  const url = new URL(window.location.href);
  const search = new URLSearchParams(url.search);
  for (const key of OAUTH_KNOWN_SEARCH_PARAMS) {
    if (!preserveSearchKeys.has(key)) {
      search.delete(key);
    }
  }

  const hash = new URLSearchParams((url.hash || "").replace(/^#/, ""));
  for (const key of OAUTH_KNOWN_HASH_PARAMS) {
    hash.delete(key);
  }

  const nextSearch = search.toString();
  const nextHash = hash.toString();
  const nextPath = `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${nextHash ? `#${nextHash}` : ""}`;
  window.history.replaceState({}, "", nextPath || "/");
}

export {
  OAUTH_PENDING_CONTEXT_STORAGE_KEY,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  writePendingOAuthContext,
  readPendingOAuthContext,
  clearPendingOAuthContext,
  readOAuthCallbackStateFromLocation,
  stripOAuthCallbackParamsFromLocation
};
