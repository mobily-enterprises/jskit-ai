import { normalizeOAuthProviderId } from "@jskit-ai/access-core/oauthProviders";

const APP_DEFAULT_OAUTH_PROVIDERS = Object.freeze([
  Object.freeze({
    id: "google",
    label: "Google"
  })
]);

function normalizeProviderLabel(value, fallback) {
  const normalized = String(value || "").trim();
  if (normalized.length > 0) {
    return normalized;
  }

  return String(fallback || "OAuth provider");
}

function normalizeOAuthProviderCatalog(catalog, { fallback = APP_DEFAULT_OAUTH_PROVIDERS } = {}) {
  const source = Array.isArray(catalog) ? catalog : [];
  const normalizedProviders = [];

  for (const entry of source) {
    const providerId = normalizeOAuthProviderId(entry?.id ?? entry, { fallback: null });
    if (!providerId || normalizedProviders.some((provider) => provider.id === providerId)) {
      continue;
    }

    normalizedProviders.push(
      Object.freeze({
        id: providerId,
        label: normalizeProviderLabel(entry?.label, providerId)
      })
    );
  }

  if (normalizedProviders.length > 0) {
    return Object.freeze(normalizedProviders);
  }

  if (!Array.isArray(fallback) || fallback.length < 1) {
    return Object.freeze([]);
  }

  if (fallback === catalog) {
    return Object.freeze([]);
  }

  return normalizeOAuthProviderCatalog(fallback, { fallback: [] });
}

function normalizeAppOAuthProvider(value, options = {}) {
  const providersInput = Object.prototype.hasOwnProperty.call(options, "providers")
    ? options.providers
    : APP_DEFAULT_OAUTH_PROVIDERS;
  const providerCatalog = normalizeOAuthProviderCatalog(providersInput, { fallback: [] });
  if (providerCatalog.length < 1) {
    return null;
  }

  const normalizedProvider = normalizeOAuthProviderId(value, { fallback: null });
  if (normalizedProvider && providerCatalog.some((provider) => provider.id === normalizedProvider)) {
    return normalizedProvider;
  }

  const fallback = Object.prototype.hasOwnProperty.call(options, "fallback")
    ? options.fallback
    : providerCatalog[0]?.id || null;
  const normalizedFallback = normalizeOAuthProviderId(fallback, {
    fallback: null
  });
  if (!normalizedFallback) {
    return null;
  }

  return providerCatalog.some((provider) => provider.id === normalizedFallback) ? normalizedFallback : null;
}

function buildAppOAuthProviderMetadata(providers = APP_DEFAULT_OAUTH_PROVIDERS) {
  const providerCatalog = normalizeOAuthProviderCatalog(providers, { fallback: [] });
  return Object.freeze(
    providerCatalog.reduce((accumulator, provider) => {
      accumulator[provider.id] = provider;
      return accumulator;
    }, {})
  );
}

const appOAuthProviders = normalizeOAuthProviderCatalog(APP_DEFAULT_OAUTH_PROVIDERS);
const APP_OAUTH_PROVIDER_IDS = Object.freeze(appOAuthProviders.map((provider) => provider.id));
const APP_OAUTH_PROVIDER_METADATA = buildAppOAuthProviderMetadata(appOAuthProviders);
const APP_OAUTH_DEFAULT_PROVIDER = normalizeAppOAuthProvider(null, {
  providers: appOAuthProviders,
  fallback: APP_OAUTH_PROVIDER_IDS[0] || null
});

export {
  APP_DEFAULT_OAUTH_PROVIDERS,
  APP_OAUTH_PROVIDER_METADATA,
  APP_OAUTH_PROVIDER_IDS,
  APP_OAUTH_DEFAULT_PROVIDER,
  appOAuthProviders,
  normalizeOAuthProviderCatalog,
  normalizeAppOAuthProvider,
  buildAppOAuthProviderMetadata
};
