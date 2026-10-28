import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeOAuthProviderList } from "@jskit-ai/auth-core/shared/oauthProviders";
import { normalizeOAuthProviderFromCatalog } from "./oauthProviderCatalog.js";
import { validationError } from "./authErrorMappers.js";

function resolveConfiguredOAuthProviders(options = {}) {
  return normalizeOAuthProviderList(options.providerIds, { fallback: [] });
}

function normalizeOAuthProviderInput(value, options = {}) {
  const providerIds = resolveConfiguredOAuthProviders(options);
  if (providerIds.length < 1) {
    throw validationError({
      provider: { code: "auth.supabase.oauth.disabled", message: "OAuth sign-in is not enabled." }
    });
  }

  const provider = normalizeOAuthProviderFromCatalog(value, {
    providerIds,
    fallback: options.defaultProvider
  });
  if (provider) {
    return provider;
  }

  const providers = providerIds.join(", ");
  throw validationError({
    provider: {
      code: "auth.supabase.oauth.providerInvalid",
      params: { providers },
      message: `OAuth provider must be one of: ${providers}.`
    }
  });
}

function mapOAuthCallbackError(errorCode) {
  const normalizedCode = String(errorCode || "")
    .trim()
    .toLowerCase();

  if (normalizedCode === "access_denied") {
    return new AppError(401, "OAuth sign-in was cancelled.", { code: "auth.supabase.oauth.cancelled" });
  }

  return new AppError(401, "OAuth sign-in failed.", { code: "auth.supabase.oauth.failed" });
}

export {
  normalizeOAuthProviderInput,
  mapOAuthCallbackError
};
