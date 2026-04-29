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
      provider: "OAuth sign-in is not enabled."
    });
  }

  const provider = normalizeOAuthProviderFromCatalog(value, {
    providerIds,
    fallback: options.defaultProvider
  });
  if (provider) {
    return provider;
  }

  throw validationError({
    provider: `OAuth provider must be one of: ${providerIds.join(", ")}.`
  });
}

function mapOAuthCallbackError(errorCode) {
  const normalizedCode = String(errorCode || "")
    .trim()
    .toLowerCase();

  if (normalizedCode === "access_denied") {
    return new AppError(401, "OAuth sign-in was cancelled.");
  }

  return new AppError(401, "OAuth sign-in failed.");
}

export {
  normalizeOAuthProviderInput,
  mapOAuthCallbackError
};
