import { normalizeLowerText, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

function normalizeIdentity(identityLike) {
  const source = identityLike && typeof identityLike === "object" ? identityLike : {};
  const provider = normalizeLowerText(source.provider || source.authProvider);
  const providerUserId = normalizeText(source.providerUserId || source.authProviderUserSid);
  if (!provider || !providerUserId) {
    return null;
  }

  return {
    provider,
    providerUserId
  };
}

export { normalizeIdentity };
