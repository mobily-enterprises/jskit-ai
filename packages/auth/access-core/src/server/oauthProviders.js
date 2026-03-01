const OAUTH_PROVIDER_ID_PATTERN = "^[a-z0-9][a-z0-9_-]{1,31}$";
const OAUTH_PROVIDER_ID_REGEX = new RegExp(OAUTH_PROVIDER_ID_PATTERN);

function normalizeOAuthProviderId(value, { fallback = null } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (OAUTH_PROVIDER_ID_REGEX.test(normalized)) {
    return normalized;
  }

  const fallbackNormalized = String(fallback || "")
    .trim()
    .toLowerCase();
  if (OAUTH_PROVIDER_ID_REGEX.test(fallbackNormalized)) {
    return fallbackNormalized;
  }

  return null;
}

function isValidOAuthProviderId(value) {
  return Boolean(normalizeOAuthProviderId(value, { fallback: null }));
}

function normalizeOAuthProviderList(value, { fallback = [] } = {}) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : value == null
        ? []
        : [value];

  const normalized = [];
  for (const entry of source) {
    const providerId = normalizeOAuthProviderId(entry, { fallback: null });
    if (!providerId || normalized.includes(providerId)) {
      continue;
    }
    normalized.push(providerId);
  }

  if (normalized.length > 0) {
    return normalized;
  }

  if (!Array.isArray(fallback)) {
    return [];
  }

  if (fallback.length < 1) {
    return [];
  }

  return normalizeOAuthProviderList(fallback, { fallback: [] });
}

export {
  OAUTH_PROVIDER_ID_PATTERN,
  OAUTH_PROVIDER_ID_REGEX,
  normalizeOAuthProviderId,
  isValidOAuthProviderId,
  normalizeOAuthProviderList
};
