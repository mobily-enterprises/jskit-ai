function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeProviderId(value) {
  const normalized = normalizeText(value).toLowerCase();
  return normalized;
}

function resolveProfileIdentity(profileLike) {
  const source = profileLike && typeof profileLike === "object" ? profileLike : {};
  const provider = normalizeProviderId(source.authProvider);
  const providerUserId = normalizeText(source.authProviderUserId);

  if (!provider || !providerUserId) {
    return null;
  }

  return { provider, providerUserId };
}

export { resolveProfileIdentity };
