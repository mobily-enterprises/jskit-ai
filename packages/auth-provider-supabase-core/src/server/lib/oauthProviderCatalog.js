import {
  normalizeOAuthProviderId,
  normalizeOAuthProviderList
} from "@jskit-ai/auth-core/server/oauthProviders";

const SUPABASE_OAUTH_PROVIDER_METADATA = Object.freeze({
  apple: Object.freeze({ id: "apple", label: "Apple" }),
  azure: Object.freeze({ id: "azure", label: "Microsoft" }),
  bitbucket: Object.freeze({ id: "bitbucket", label: "Bitbucket" }),
  discord: Object.freeze({ id: "discord", label: "Discord" }),
  facebook: Object.freeze({ id: "facebook", label: "Facebook" }),
  figma: Object.freeze({ id: "figma", label: "Figma" }),
  github: Object.freeze({ id: "github", label: "GitHub" }),
  gitlab: Object.freeze({ id: "gitlab", label: "GitLab" }),
  google: Object.freeze({ id: "google", label: "Google", queryParams: { prompt: "select_account" } }),
  kakao: Object.freeze({ id: "kakao", label: "Kakao" }),
  keycloak: Object.freeze({ id: "keycloak", label: "Keycloak" }),
  linkedin_oidc: Object.freeze({ id: "linkedin_oidc", label: "LinkedIn" }),
  notion: Object.freeze({ id: "notion", label: "Notion" }),
  slack: Object.freeze({ id: "slack", label: "Slack" }),
  spotify: Object.freeze({ id: "spotify", label: "Spotify" }),
  twitch: Object.freeze({ id: "twitch", label: "Twitch" }),
  twitter: Object.freeze({ id: "twitter", label: "X" }),
  workos: Object.freeze({ id: "workos", label: "WorkOS" }),
  zoom: Object.freeze({ id: "zoom", label: "Zoom" })
});

const DEFAULT_SUPABASE_OAUTH_PROVIDER_IDS = Object.freeze(["google"]);

function normalizeProviderLabel(value, fallback) {
  const normalized = String(value || "").trim();
  if (normalized.length > 0) {
    return normalized;
  }
  return String(fallback || "OAuth provider");
}

function normalizeProviderQueryParams(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const params = {};
  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = String(key || "").trim();
    const normalizedValue = String(entryValue || "").trim();
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    params[normalizedKey] = normalizedValue;
  }

  if (Object.keys(params).length < 1) {
    return null;
  }

  return Object.freeze(params);
}

function normalizeProviderLabelOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Map();
  }

  const overrides = new Map();
  for (const [providerId, label] of Object.entries(value)) {
    const normalizedProviderId = normalizeOAuthProviderId(providerId, { fallback: null });
    if (!normalizedProviderId) {
      continue;
    }

    overrides.set(normalizedProviderId, normalizeProviderLabel(label, normalizedProviderId));
  }

  return overrides;
}

function normalizeProviderQueryParamOverrides(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Map();
  }

  const overrides = new Map();
  for (const [providerId, queryParams] of Object.entries(value)) {
    const normalizedProviderId = normalizeOAuthProviderId(providerId, { fallback: null });
    if (!normalizedProviderId) {
      continue;
    }

    const normalizedQueryParams = normalizeProviderQueryParams(queryParams);
    if (normalizedQueryParams) {
      overrides.set(normalizedProviderId, normalizedQueryParams);
    }
  }

  return overrides;
}

function normalizeExplicitProviderCatalogEntry(entry) {
  if (typeof entry === "string") {
    const providerId = normalizeOAuthProviderId(entry, { fallback: null });
    if (!providerId) {
      return null;
    }

    return {
      id: providerId,
      label: normalizeProviderLabel(SUPABASE_OAUTH_PROVIDER_METADATA[providerId]?.label, providerId),
      queryParams: normalizeProviderQueryParams(SUPABASE_OAUTH_PROVIDER_METADATA[providerId]?.queryParams)
    };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const providerId = normalizeOAuthProviderId(entry.id, { fallback: null });
  if (!providerId) {
    return null;
  }

  const fallbackMetadata = SUPABASE_OAUTH_PROVIDER_METADATA[providerId] || {};
  return {
    id: providerId,
    label: normalizeProviderLabel(entry.label, fallbackMetadata.label || providerId),
    queryParams: normalizeProviderQueryParams(entry.queryParams ?? fallbackMetadata.queryParams)
  };
}

function normalizeExplicitProviderCatalog(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries = [];
  for (const entry of value) {
    const normalized = normalizeExplicitProviderCatalogEntry(entry);
    if (!normalized || entries.some((existing) => existing.id === normalized.id)) {
      continue;
    }

    entries.push(
      Object.freeze({
        id: normalized.id,
        label: normalized.label,
        queryParams: normalized.queryParams
      })
    );
  }

  return entries;
}

function resolveSupabaseOAuthProviderCatalog(options = {}) {
  const explicitCatalog = normalizeExplicitProviderCatalog(options.oauthProviderCatalog);
  const labelOverrides = normalizeProviderLabelOverrides(options.oauthProviderLabels);
  const queryParamOverrides = normalizeProviderQueryParamOverrides(options.oauthProviderQueryParams);

  let providers;
  if (explicitCatalog.length > 0) {
    providers = explicitCatalog.map((entry) => {
      const label = labelOverrides.get(entry.id) || entry.label;
      const queryParams = queryParamOverrides.get(entry.id) || entry.queryParams || null;
      return Object.freeze({
        id: entry.id,
        label,
        queryParams
      });
    });
  } else {
    const providerIds = normalizeOAuthProviderList(options.oauthProviders, {
      fallback: DEFAULT_SUPABASE_OAUTH_PROVIDER_IDS
    });

    providers = providerIds.map((providerId) => {
      const fallbackMetadata = SUPABASE_OAUTH_PROVIDER_METADATA[providerId] || {};
      const label = labelOverrides.get(providerId) || normalizeProviderLabel(fallbackMetadata.label, providerId);
      const queryParams =
        queryParamOverrides.get(providerId) || normalizeProviderQueryParams(fallbackMetadata.queryParams) || null;

      return Object.freeze({
        id: providerId,
        label,
        queryParams
      });
    });
  }

  const providerIds = Object.freeze(providers.map((provider) => provider.id));
  const providerQueryParamsById = Object.freeze(
    providers.reduce((accumulator, provider) => {
      if (provider.queryParams) {
        accumulator[provider.id] = provider.queryParams;
      }
      return accumulator;
    }, {})
  );

  const defaultProvider = normalizeOAuthProviderId(options.oauthDefaultProvider, {
    fallback: providerIds[0] || null
  });

  return {
    providers: Object.freeze(
      providers.map((provider) =>
        Object.freeze({
          id: provider.id,
          label: provider.label,
          queryParams: provider.queryParams
        })
      )
    ),
    providerIds,
    defaultProvider: providerIds.includes(defaultProvider) ? defaultProvider : providerIds[0] || null,
    providerQueryParamsById
  };
}

function normalizeOAuthProviderFromCatalog(value, { providerIds = [], fallback = null } = {}) {
  const normalizedProviderId = normalizeOAuthProviderId(value, { fallback: null });
  if (normalizedProviderId && providerIds.includes(normalizedProviderId)) {
    return normalizedProviderId;
  }

  const normalizedFallbackProviderId = normalizeOAuthProviderId(fallback, { fallback: null });
  if (normalizedFallbackProviderId && providerIds.includes(normalizedFallbackProviderId)) {
    return normalizedFallbackProviderId;
  }

  return null;
}

function resolveOAuthProviderQueryParams(providerId, { providerQueryParamsById = {} } = {}) {
  const normalizedProviderId = normalizeOAuthProviderId(providerId, { fallback: null });
  if (!normalizedProviderId) {
    return null;
  }

  const queryParams = providerQueryParamsById[normalizedProviderId];
  if (!queryParams || typeof queryParams !== "object") {
    return null;
  }

  return queryParams;
}

function buildOAuthProviderCatalogResponse(catalog) {
  const providers = Array.isArray(catalog?.providers) ? catalog.providers : [];
  const providerIds = providers.map((provider) => provider.id);

  const defaultProvider = normalizeOAuthProviderFromCatalog(catalog?.defaultProvider, {
    providerIds,
    fallback: providerIds[0] || null
  });

  return {
    providers: providers.map((provider) => ({
      id: provider.id,
      label: provider.label
    })),
    defaultProvider
  };
}

export {
  SUPABASE_OAUTH_PROVIDER_METADATA,
  DEFAULT_SUPABASE_OAUTH_PROVIDER_IDS,
  resolveSupabaseOAuthProviderCatalog,
  normalizeOAuthProviderFromCatalog,
  resolveOAuthProviderQueryParams,
  buildOAuthProviderCatalogResponse
};
