import {
  APP_OAUTH_DEFAULT_PROVIDER,
  appOAuthProviders,
  normalizeAppOAuthProvider,
  normalizeOAuthProviderCatalog
} from "./oauthProviders.js";
import {
  OAUTH_QUERY_PARAM_INTENT,
  OAUTH_QUERY_PARAM_PROVIDER,
  OAUTH_QUERY_PARAM_RETURN_TO
} from "@jskit-ai/access-core/oauthCallbackParams";
import { normalizeOAuthIntent, normalizeReturnToPath } from "@jskit-ai/access-core/utils";

const OAUTH_PENDING_CONTEXT_STORAGE_KEY = "auth.oauth.pendingContext";

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

function resolveOAuthProviderCatalog(options = {}) {
  return normalizeOAuthProviderCatalog(options.providers, {
    fallback: appOAuthProviders
  });
}

function resolveOAuthDefaultProvider(options = {}) {
  const providers = resolveOAuthProviderCatalog(options);
  return normalizeAppOAuthProvider(options.defaultProvider, {
    providers,
    fallback: APP_OAUTH_DEFAULT_PROVIDER || providers[0]?.id || null
  });
}

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

function writePendingOAuthContext(context, options = {}) {
  if (!isSessionStorageAvailable()) {
    return;
  }

  const providers = resolveOAuthProviderCatalog(options);
  const provider = normalizeAppOAuthProvider(context?.provider, {
    providers,
    fallback: null
  });
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

function readPendingOAuthContext(options = {}) {
  if (!isSessionStorageAvailable()) {
    return null;
  }

  const providers = resolveOAuthProviderCatalog(options);

  try {
    const raw = window.sessionStorage.getItem(OAUTH_PENDING_CONTEXT_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    const provider = normalizeAppOAuthProvider(parsed?.provider, {
      providers,
      fallback: null
    });
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

  const providers = resolveOAuthProviderCatalog(options);
  const pendingContext = options.pendingContext || null;
  const defaultProvider = resolveOAuthDefaultProvider({
    ...options,
    providers,
    defaultProvider: options.defaultProvider || pendingContext?.defaultProvider
  });
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

  const providerFromQuery = normalizeAppOAuthProvider(search.get(OAUTH_QUERY_PARAM_PROVIDER), {
    providers,
    fallback: null
  });
  const providerFromContext = normalizeAppOAuthProvider(pendingContext?.provider, {
    providers,
    fallback: null
  });
  const provider = normalizeAppOAuthProvider(providerFromQuery || providerFromContext || defaultProvider, {
    providers,
    fallback: defaultProvider
  });

  const intent = normalizeOAuthIntent(search.get(OAUTH_QUERY_PARAM_INTENT) || pendingContext?.intent || defaultIntent, {
    fallback: defaultIntent
  });
  const returnTo = normalizeReturnToPath(
    search.get(OAUTH_QUERY_PARAM_RETURN_TO) || pendingContext?.returnTo || defaultReturnTo,
    {
      fallback: defaultReturnTo
    }
  );

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
