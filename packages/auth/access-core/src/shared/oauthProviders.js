const AUTH_OAUTH_PROVIDER_METADATA = Object.freeze({
  google: Object.freeze({
    id: "google",
    label: "Google"
  })
});

const AUTH_OAUTH_PROVIDERS = Object.freeze(Object.keys(AUTH_OAUTH_PROVIDER_METADATA));
const AUTH_OAUTH_DEFAULT_PROVIDER = "google";

function normalizeOAuthProvider(value, { fallback = AUTH_OAUTH_DEFAULT_PROVIDER } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (AUTH_OAUTH_PROVIDERS.includes(normalized)) {
    return normalized;
  }

  return fallback || null;
}

function isSupportedOAuthProvider(value) {
  return Boolean(normalizeOAuthProvider(value, { fallback: null }));
}

export {
  AUTH_OAUTH_PROVIDER_METADATA,
  AUTH_OAUTH_PROVIDERS,
  AUTH_OAUTH_DEFAULT_PROVIDER,
  normalizeOAuthProvider,
  isSupportedOAuthProvider
};
