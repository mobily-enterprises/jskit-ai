import { AppError } from "@jskit-ai/server-runtime-core/errors";
import {
  AUTH_ACCESS_TOKEN_MAX_LENGTH,
  AUTH_RECOVERY_TOKEN_MAX_LENGTH,
  AUTH_REFRESH_TOKEN_MAX_LENGTH
} from "@jskit-ai/access-core/server/authConstraints";
import { normalizeOAuthProviderList } from "@jskit-ai/access-core/server/oauthProviders";
import { validators } from "@jskit-ai/access-core/server/validators";
import { normalizeOAuthProviderFromCatalog } from "./oauthProviderCatalog.js";
import { validationError } from "./authErrorMappers.js";

const OTP_VERIFY_TYPE = "email";

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

function validatePasswordRecoveryPayload(payload) {
  const code = String(payload?.code || "").trim();
  const tokenHash = String(payload?.tokenHash || "").trim();
  const type = String(payload?.type || "recovery")
    .trim()
    .toLowerCase();
  const accessToken = String(payload?.accessToken || "").trim();
  const refreshToken = String(payload?.refreshToken || "").trim();

  const fieldErrors = {};

  if (type !== "recovery") {
    fieldErrors.type = "Only recovery password reset links are supported.";
  }

  if (code.length > AUTH_RECOVERY_TOKEN_MAX_LENGTH) {
    fieldErrors.code = "Recovery code is too long.";
  }

  if (tokenHash.length > AUTH_RECOVERY_TOKEN_MAX_LENGTH) {
    fieldErrors.tokenHash = "Recovery token is too long.";
  }

  if (accessToken.length > AUTH_ACCESS_TOKEN_MAX_LENGTH) {
    fieldErrors.accessToken = "Access token is too long.";
  }

  if (refreshToken.length > AUTH_REFRESH_TOKEN_MAX_LENGTH) {
    fieldErrors.refreshToken = "Refresh token is too long.";
  }

  if ((accessToken && !refreshToken) || (!accessToken && refreshToken)) {
    if (!accessToken) {
      fieldErrors.accessToken = "Access token is required when a refresh token is provided.";
    }
    if (!refreshToken) {
      fieldErrors.refreshToken = "Refresh token is required when an access token is provided.";
    }
  }

  const hasCode = Boolean(code);
  const hasTokenHash = Boolean(tokenHash);
  const hasSessionPair = Boolean(accessToken && refreshToken);

  if (!hasCode && !hasTokenHash && !hasSessionPair) {
    fieldErrors.recovery = "Recovery token is required.";
  }

  return {
    code,
    tokenHash,
    type,
    accessToken,
    refreshToken,
    hasCode,
    hasTokenHash,
    hasSessionPair,
    fieldErrors
  };
}

function parseOAuthCompletePayload(payload = {}, options = {}) {
  const provider = normalizeOAuthProviderInput(payload.provider || options.defaultProvider, options);
  const code = String(payload.code || "").trim();
  const accessToken = String(payload.accessToken || "").trim();
  const refreshToken = String(payload.refreshToken || "").trim();
  const errorCode = String(payload.error || payload.error_code || "").trim();
  const errorDescription = String(payload.errorDescription || payload.error_description || "").trim();
  const fieldErrors = {};

  if (code.length > AUTH_RECOVERY_TOKEN_MAX_LENGTH) {
    fieldErrors.code = "OAuth code is too long.";
  }

  if (errorCode.length > 128) {
    fieldErrors.error = "OAuth error code is too long.";
  }

  if (errorDescription.length > 1024) {
    fieldErrors.errorDescription = "OAuth error description is too long.";
  }

  if (accessToken.length > AUTH_ACCESS_TOKEN_MAX_LENGTH) {
    fieldErrors.accessToken = "Access token is too long.";
  }

  if (refreshToken.length > AUTH_REFRESH_TOKEN_MAX_LENGTH) {
    fieldErrors.refreshToken = "Refresh token is too long.";
  }

  if ((accessToken && !refreshToken) || (!accessToken && refreshToken)) {
    if (!accessToken) {
      fieldErrors.accessToken = "Access token is required when a refresh token is provided.";
    }
    if (!refreshToken) {
      fieldErrors.refreshToken = "Refresh token is required when an access token is provided.";
    }
  }

  const hasSessionPair = Boolean(accessToken && refreshToken);

  if (!code && !errorCode && !hasSessionPair) {
    fieldErrors.code = "OAuth code is required when access/refresh tokens are not provided.";
  }

  return {
    provider,
    code,
    accessToken,
    refreshToken,
    hasSessionPair,
    errorCode,
    errorDescription,
    fieldErrors
  };
}

function parseOtpLoginVerifyPayload(payload = {}) {
  const parsedEmail = validators.forgotPasswordInput(payload);
  const token = String(payload?.token || "").trim();
  const tokenHash = String(payload?.tokenHash || "").trim();
  const type = String(payload?.type || OTP_VERIFY_TYPE)
    .trim()
    .toLowerCase();
  const fieldErrors = {
    ...parsedEmail.fieldErrors
  };

  if (type !== OTP_VERIFY_TYPE) {
    fieldErrors.type = "Only email OTP verification is supported.";
  }

  if (!token && !tokenHash) {
    fieldErrors.token = "One-time code is required.";
  }

  if (token && token.length > AUTH_RECOVERY_TOKEN_MAX_LENGTH) {
    fieldErrors.token = "One-time code is too long.";
  }

  if (tokenHash && tokenHash.length > AUTH_RECOVERY_TOKEN_MAX_LENGTH) {
    fieldErrors.tokenHash = "One-time token hash is too long.";
  }

  if (token && parsedEmail.fieldErrors.email) {
    fieldErrors.email = parsedEmail.fieldErrors.email;
  } else if (tokenHash) {
    delete fieldErrors.email;
  }

  return {
    email: parsedEmail.email,
    token,
    tokenHash,
    type,
    fieldErrors
  };
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
  validatePasswordRecoveryPayload,
  parseOAuthCompletePayload,
  parseOtpLoginVerifyPayload,
  mapOAuthCallbackError
};
