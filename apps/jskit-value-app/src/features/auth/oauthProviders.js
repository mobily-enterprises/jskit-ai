import {
  AUTH_OAUTH_DEFAULT_PROVIDER,
  AUTH_OAUTH_PROVIDER_METADATA,
  AUTH_OAUTH_PROVIDERS,
  normalizeOAuthProvider
} from "@jskit-ai/access-core/oauthProviders";

function parseConfiguredProviderList(rawValue) {
  if (rawValue == null) {
    return [];
  }

  return String(rawValue)
    .split(",")
    .map((entry) => normalizeOAuthProvider(entry, { fallback: null }))
    .filter(Boolean);
}

function resolveEnabledProviderIds() {
  const configuredIds = parseConfiguredProviderList(import.meta?.env?.VITE_ENABLED_OAUTH_PROVIDERS);
  if (configuredIds.length < 1) {
    return [...AUTH_OAUTH_PROVIDERS];
  }

  const allowed = new Set(configuredIds);
  const ordered = AUTH_OAUTH_PROVIDERS.filter((providerId) => allowed.has(providerId));
  return ordered.length > 0 ? ordered : [AUTH_OAUTH_DEFAULT_PROVIDER];
}

const APP_OAUTH_PROVIDER_IDS = Object.freeze(resolveEnabledProviderIds());

const APP_OAUTH_PROVIDER_METADATA = Object.freeze(
  APP_OAUTH_PROVIDER_IDS.reduce((accumulator, providerId) => {
    const metadata = AUTH_OAUTH_PROVIDER_METADATA[providerId];
    if (metadata) {
      accumulator[providerId] = metadata;
    }
    return accumulator;
  }, {})
);

const APP_OAUTH_DEFAULT_PROVIDER = APP_OAUTH_PROVIDER_IDS.includes(AUTH_OAUTH_DEFAULT_PROVIDER)
  ? AUTH_OAUTH_DEFAULT_PROVIDER
  : APP_OAUTH_PROVIDER_IDS[0] || AUTH_OAUTH_DEFAULT_PROVIDER;

function normalizeAppOAuthProvider(value, { fallback = APP_OAUTH_DEFAULT_PROVIDER } = {}) {
  const normalized = normalizeOAuthProvider(value, { fallback: null });
  if (!normalized || !APP_OAUTH_PROVIDER_IDS.includes(normalized)) {
    return fallback || null;
  }

  return normalized;
}

const appOAuthProviders = Object.freeze(
  APP_OAUTH_PROVIDER_IDS.map((providerId) => APP_OAUTH_PROVIDER_METADATA[providerId]).filter(Boolean)
);

export {
  APP_OAUTH_PROVIDER_METADATA,
  APP_OAUTH_PROVIDER_IDS,
  APP_OAUTH_DEFAULT_PROVIDER,
  appOAuthProviders,
  normalizeAppOAuthProvider
};
