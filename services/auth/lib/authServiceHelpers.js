import { randomBytes } from "node:crypto";
import { AppError } from "../../../lib/errors.js";
import {
  AUTH_ACCESS_TOKEN_MAX_LENGTH,
  AUTH_RECOVERY_TOKEN_MAX_LENGTH,
  AUTH_REFRESH_TOKEN_MAX_LENGTH
} from "../../../shared/auth/authConstraints.js";
import {
  AUTH_METHOD_DEFINITIONS,
  AUTH_METHOD_EMAIL_OTP_ID,
  AUTH_METHOD_EMAIL_OTP_PROVIDER,
  AUTH_METHOD_KIND_OAUTH,
  AUTH_METHOD_KIND_OTP,
  AUTH_METHOD_KIND_PASSWORD,
  AUTH_METHOD_MINIMUM_ENABLED,
  AUTH_METHOD_PASSWORD_ID,
  AUTH_METHOD_PASSWORD_PROVIDER,
  buildOAuthMethodId
} from "../../../shared/auth/authMethods.js";
import {
  AUTH_OAUTH_DEFAULT_PROVIDER,
  AUTH_OAUTH_PROVIDERS,
  normalizeOAuthProvider as normalizeSupportedOAuthProvider
} from "../../../shared/auth/oauthProviders.js";
import { validators } from "../../../shared/auth/validators.js";

const PASSWORD_RESET_PATH = "reset-password";
const OAUTH_LOGIN_PATH = "login";
const OAUTH_LOGIN_INTENT = "login";
const OAUTH_LINK_INTENT = "link";
const OTP_VERIFY_TYPE = "email";

const INVALID_JWT_ERROR_CODES = new Set([
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWT_INVALID",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JWS_INVALID",
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JWKS_NO_MATCHING_KEY"
]);

const TRANSIENT_JWT_ERROR_CODES = new Set(["ERR_JWKS_TIMEOUT", "ERR_JOSE_GENERIC", "ERR_JWKS_INVALID"]);

const TRANSIENT_AUTH_MESSAGE_PARTS = [
  "network",
  "fetch",
  "timeout",
  "timed out",
  "econn",
  "enotfound",
  "socket",
  "temporar"
];

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

function displayNameFromEmail(email) {
  const local = String(email || "").split("@")[0] || "user";
  return local.slice(0, 120);
}

function resolveDisplayName(supabaseUser, fallbackEmail) {
  const metadataDisplayName = String(supabaseUser?.user_metadata?.display_name || "").trim();
  if (metadataDisplayName) {
    return metadataDisplayName.slice(0, 120);
  }

  return displayNameFromEmail(fallbackEmail);
}

function resolveDisplayNameFromClaims(claims, fallbackEmail) {
  const metadataDisplayName = String(claims?.user_metadata?.display_name || "").trim();
  if (metadataDisplayName) {
    return metadataDisplayName.slice(0, 120);
  }

  return displayNameFromEmail(fallbackEmail);
}

function isTransientAuthMessage(message) {
  const normalized = String(message || "").toLowerCase();
  return TRANSIENT_AUTH_MESSAGE_PARTS.some((part) => normalized.includes(part));
}

function isTransientSupabaseError(error) {
  if (!error) {
    return false;
  }

  const status = Number(error.status || error.statusCode);
  if (Number.isFinite(status) && status >= 500) {
    return true;
  }

  return isTransientAuthMessage(error.message);
}

function sanitizeAuthMessage(message, fallback = "Authentication request could not be processed.") {
  const normalized = String(message || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, 320);
}

function mapAuthError(error, fallbackStatus) {
  if (isTransientSupabaseError(error)) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  const message = sanitizeAuthMessage(error?.message, "Authentication failed.");
  const lower = message.toLowerCase();

  if (lower.includes("already registered") || lower.includes("already been registered")) {
    return new AppError(409, "Email is already registered.");
  }

  if (lower.includes("email not confirmed") || lower.includes("confirm your email")) {
    return new AppError(403, "Account exists but email confirmation is required before login.");
  }

  if (lower.includes("invalid login credentials") || lower.includes("invalid credentials")) {
    return new AppError(401, "Invalid email or password.");
  }

  if (
    lower.includes("already linked") ||
    lower.includes("identity is already linked") ||
    (lower.includes("identity") && lower.includes("already exists"))
  ) {
    return new AppError(409, "This sign-in method is already linked.");
  }

  if (lower.includes("manual linking is disabled")) {
    return new AppError(
      409,
      "Provider linking is disabled in Supabase. Enable Manual Linking in Supabase Auth settings to link or unlink providers."
    );
  }

  if (
    lower.includes("last identity") ||
    lower.includes("only identity") ||
    (lower.includes("at least one") && lower.includes("identity"))
  ) {
    return new AppError(409, "At least one linked sign-in method must remain available.");
  }

  if (lower.includes("identity") && lower.includes("not found")) {
    return new AppError(409, "This sign-in method is not currently linked.");
  }

  const status = Number.isInteger(Number(fallbackStatus)) ? Number(fallbackStatus) : 400;
  if (status >= 500) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }
  if (status === 401) {
    return new AppError(401, "Invalid email or password.");
  }
  if (status >= 400 && status < 500 && message && message !== "Authentication failed.") {
    return new AppError(status, message);
  }

  return new AppError(status, "Authentication request could not be processed.");
}

function validationError(fieldErrors) {
  return new AppError(400, "Validation failed.", {
    details: {
      fieldErrors
    }
  });
}

function isUserNotFoundLikeAuthError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("user not found") ||
    message.includes("no user") ||
    message.includes("email not found") ||
    message.includes("signup is disabled") ||
    message.includes("signups not allowed")
  );
}

function mapRecoveryError(error) {
  if (isTransientSupabaseError(error)) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  const status = Number(error?.status || error?.statusCode);
  if (status === 429) {
    return new AppError(429, "Too many recovery attempts. Please wait and try again.");
  }

  return new AppError(401, "Recovery link is invalid or has expired.");
}

function mapPasswordUpdateError(error) {
  if (isTransientSupabaseError(error)) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  const message = String(error?.message || "").toLowerCase();
  if (message.includes("same") && message.includes("password")) {
    return validationError({
      password: "New password must be different from the current password."
    });
  }

  return validationError({
    password: "Unable to update password with the provided value."
  });
}

function buildDisabledPasswordSecret() {
  const randomSegment = randomBytes(24).toString("base64url");
  // Supabase password updates follow bcrypt's 72-byte input limit.
  return `disabled-A1!-${randomSegment}`;
}

function mapOtpVerifyError(error) {
  if (isTransientSupabaseError(error)) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  return new AppError(401, "One-time code is invalid or expired.");
}

function mapProfileUpdateError(error) {
  if (isTransientSupabaseError(error)) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  return validationError({
    displayName: "Unable to update profile details."
  });
}

function mapCurrentPasswordError(error) {
  if (isTransientSupabaseError(error)) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  const status = Number(error?.status || error?.statusCode);
  if (status === 400 || status === 401 || status === 403) {
    return validationError({
      currentPassword: "Current password is incorrect."
    });
  }

  return validationError({
    currentPassword: "Unable to verify current password."
  });
}

function parseHttpUrl(rawValue, variableName) {
  let parsedUrl;
  try {
    parsedUrl = new URL(rawValue);
  } catch {
    throw new Error(`${variableName} must be a valid absolute URL.`);
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`${variableName} must start with http:// or https://.`);
  }

  return parsedUrl;
}

function buildPasswordResetRedirectUrl(options) {
  const appPublicUrl = String(options.appPublicUrl || "").trim();

  if (!appPublicUrl) {
    throw new Error("APP_PUBLIC_URL is required to build password reset links.");
  }

  const baseUrl = parseHttpUrl(appPublicUrl, "APP_PUBLIC_URL");
  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname = `${baseUrl.pathname}/`;
  }
  baseUrl.search = "";
  baseUrl.hash = "";
  return new URL(PASSWORD_RESET_PATH, baseUrl).toString();
}

function buildOtpLoginRedirectUrl(options) {
  const appPublicUrl = String(options.appPublicUrl || "").trim();

  if (!appPublicUrl) {
    throw new Error("APP_PUBLIC_URL is required to build OTP login redirects.");
  }

  const baseUrl = parseHttpUrl(appPublicUrl, "APP_PUBLIC_URL");
  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname = `${baseUrl.pathname}/`;
  }
  baseUrl.search = "";
  baseUrl.hash = "";
  return new URL(OAUTH_LOGIN_PATH, baseUrl).toString();
}

function normalizeOAuthIntent(value, { fallback = OAUTH_LOGIN_INTENT } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === OAUTH_LOGIN_INTENT || normalized === OAUTH_LINK_INTENT) {
    return normalized;
  }

  return fallback || OAUTH_LOGIN_INTENT;
}

function normalizeReturnToPath(value, { fallback = "/" } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }

  return normalized;
}

function buildOAuthRedirectUrl(options) {
  const appPublicUrl = String(options.appPublicUrl || "").trim();
  const provider = normalizeSupportedOAuthProvider(options.provider, { fallback: null });
  const intent = normalizeOAuthIntent(options.intent, { fallback: OAUTH_LOGIN_INTENT });
  const callbackPath = String(options.callbackPath || OAUTH_LOGIN_PATH).trim();
  const returnTo = normalizeReturnToPath(options.returnTo, { fallback: "/" });

  if (!appPublicUrl) {
    throw new Error("APP_PUBLIC_URL is required to build OAuth login redirects.");
  }

  if (!provider) {
    throw new Error(`OAuth provider must be one of: ${AUTH_OAUTH_PROVIDERS.join(", ")}.`);
  }

  if (!callbackPath) {
    throw new Error("OAuth callback path is required.");
  }

  const baseUrl = parseHttpUrl(appPublicUrl, "APP_PUBLIC_URL");
  if (!baseUrl.pathname.endsWith("/")) {
    baseUrl.pathname = `${baseUrl.pathname}/`;
  }
  baseUrl.search = "";
  baseUrl.hash = "";

  const redirectUrl = new URL(callbackPath, baseUrl);
  redirectUrl.searchParams.set("oauthProvider", provider);
  redirectUrl.searchParams.set("oauthIntent", intent);
  if (returnTo) {
    redirectUrl.searchParams.set("oauthReturnTo", returnTo);
  }
  return redirectUrl.toString();
}

function buildOAuthLoginRedirectUrl(options) {
  return buildOAuthRedirectUrl({
    ...options,
    intent: OAUTH_LOGIN_INTENT,
    callbackPath: OAUTH_LOGIN_PATH
  });
}

function buildOAuthLinkRedirectUrl(options) {
  return buildOAuthRedirectUrl({
    ...options,
    intent: OAUTH_LINK_INTENT,
    callbackPath: OAUTH_LOGIN_PATH
  });
}

function normalizeOAuthProviderInput(value) {
  const provider = normalizeSupportedOAuthProvider(value, { fallback: null });
  if (provider) {
    return provider;
  }

  throw validationError({
    provider: `OAuth provider must be one of: ${AUTH_OAUTH_PROVIDERS.join(", ")}.`
  });
}

function parseOAuthCompletePayload(payload = {}) {
  const provider = normalizeOAuthProviderInput(payload.provider || AUTH_OAUTH_DEFAULT_PROVIDER);
  const code = String(payload.code || "").trim();
  const accessToken = String(payload.accessToken || "").trim();
  const refreshToken = String(payload.refreshToken || "").trim();
  const errorCode = String(payload.error || "").trim();
  const errorDescription = String(payload.errorDescription || "").trim();
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

function mapOAuthCallbackError(errorCode, errorDescription) {
  const normalizedCode = String(errorCode || "")
    .trim()
    .toLowerCase();

  if (normalizedCode === "access_denied") {
    return new AppError(401, "OAuth sign-in was cancelled.");
  }

  const description = String(errorDescription || "").trim();
  if (description) {
    return new AppError(401, `OAuth sign-in failed: ${description}`);
  }

  return new AppError(401, "OAuth sign-in failed.");
}

function normalizeIdentityProviderId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function collectProviderIdsFromSupabaseUser(user) {
  const providerIds = new Set();

  const appProvider = normalizeIdentityProviderId(user?.app_metadata?.provider);
  if (appProvider) {
    providerIds.add(appProvider);
  }

  const appProviders = Array.isArray(user?.app_metadata?.providers) ? user.app_metadata.providers : [];
  for (const provider of appProviders) {
    const normalized = normalizeIdentityProviderId(provider);
    if (normalized) {
      providerIds.add(normalized);
    }
  }

  const identities = Array.isArray(user?.identities) ? user.identities : [];
  for (const identity of identities) {
    const normalized = normalizeIdentityProviderId(identity?.provider);
    if (normalized) {
      providerIds.add(normalized);
    }
  }

  return [...providerIds];
}

function buildAuthMethodsStatusFromProviderIds(providerIds, options = {}) {
  const normalizedProviders = Array.isArray(providerIds)
    ? providerIds.map(normalizeIdentityProviderId).filter(Boolean)
    : [];
  const uniqueProviders = new Set(normalizedProviders);
  const passwordSignInEnabled = options.passwordSignInEnabled !== false;
  const passwordSetupRequired = options.passwordSetupRequired === true;
  const methods = [];

  for (const definition of AUTH_METHOD_DEFINITIONS) {
    if (definition.kind === AUTH_METHOD_KIND_PASSWORD) {
      const configured = uniqueProviders.has(AUTH_METHOD_PASSWORD_PROVIDER);
      const enabled = configured && passwordSignInEnabled;
      methods.push({
        id: AUTH_METHOD_PASSWORD_ID,
        kind: AUTH_METHOD_KIND_PASSWORD,
        provider: AUTH_METHOD_PASSWORD_PROVIDER,
        label: definition.label,
        configured,
        enabled,
        canEnable: configured && !enabled,
        canDisable: false,
        supportsSecretUpdate: true,
        requiresCurrentPassword: enabled && !passwordSetupRequired
      });
      continue;
    }

    if (definition.kind === AUTH_METHOD_KIND_OTP) {
      methods.push({
        id: AUTH_METHOD_EMAIL_OTP_ID,
        kind: AUTH_METHOD_KIND_OTP,
        provider: AUTH_METHOD_EMAIL_OTP_PROVIDER,
        label: definition.label,
        configured: true,
        enabled: true,
        canEnable: false,
        canDisable: false,
        supportsSecretUpdate: false,
        requiresCurrentPassword: false
      });
      continue;
    }

    if (definition.kind === AUTH_METHOD_KIND_OAUTH) {
      const provider = normalizeIdentityProviderId(definition.provider);
      const configured = uniqueProviders.has(provider);
      methods.push({
        id: buildOAuthMethodId(provider),
        kind: AUTH_METHOD_KIND_OAUTH,
        provider,
        label: definition.label,
        configured,
        enabled: configured,
        canEnable: !configured,
        canDisable: false,
        supportsSecretUpdate: false,
        requiresCurrentPassword: false
      });
    }
  }

  const enabledMethodsCount = methods.reduce((count, method) => (method.enabled ? count + 1 : count), 0);
  const minimumEnabledMethods = AUTH_METHOD_MINIMUM_ENABLED;
  const canDisableAny = enabledMethodsCount > minimumEnabledMethods;
  const configuredIdentityMethodCount = methods.reduce((count, method) => {
    if (method.kind === AUTH_METHOD_KIND_OAUTH && method.configured) {
      return count + 1;
    }
    if (method.kind === AUTH_METHOD_KIND_PASSWORD && method.configured) {
      return count + 1;
    }
    return count;
  }, 0);

  for (const method of methods) {
    if (method.kind === AUTH_METHOD_KIND_OAUTH) {
      method.canDisable = method.enabled && configuredIdentityMethodCount > 1;
      continue;
    }

    method.canDisable = method.enabled && canDisableAny;
  }

  return {
    methods,
    enabledMethodsCount,
    minimumEnabledMethods,
    canDisableAny
  };
}

function buildAuthMethodsStatusFromSupabaseUser(user, options = {}) {
  return buildAuthMethodsStatusFromProviderIds(collectProviderIdsFromSupabaseUser(user), options);
}

function buildSecurityStatusFromAuthMethodsStatus(authMethodsStatus) {
  const minimumEnabledMethods = Number(authMethodsStatus?.minimumEnabledMethods || AUTH_METHOD_MINIMUM_ENABLED);
  const enabledMethodsCount = Number.isFinite(Number(authMethodsStatus?.enabledMethodsCount))
    ? Number(authMethodsStatus.enabledMethodsCount)
    : Array.isArray(authMethodsStatus?.methods)
      ? authMethodsStatus.methods.reduce((count, method) => (method?.enabled ? count + 1 : count), 0)
      : 0;

  return {
    mfa: {
      status: "not_enabled",
      enrolled: false,
      methods: []
    },
    authPolicy: {
      minimumEnabledMethods,
      enabledMethodsCount
    },
    authMethods: Array.isArray(authMethodsStatus?.methods) ? authMethodsStatus.methods : []
  };
}

function findAuthMethodById(authMethodsStatus, methodId) {
  const normalizedMethodId = String(methodId || "")
    .trim()
    .toLowerCase();
  if (!normalizedMethodId || !Array.isArray(authMethodsStatus?.methods)) {
    return null;
  }

  return authMethodsStatus.methods.find(
    (method) =>
      String(method?.id || "")
        .trim()
        .toLowerCase() === normalizedMethodId
  );
}

function findLinkedIdentityByProvider(user, provider) {
  const normalizedProvider = normalizeIdentityProviderId(provider);
  const identities = Array.isArray(user?.identities) ? user.identities : [];

  for (const identity of identities) {
    if (normalizeIdentityProviderId(identity?.provider) === normalizedProvider) {
      return identity;
    }
  }

  return null;
}

function safeRequestCookies(request) {
  if (request?.cookies && typeof request.cookies === "object") {
    return request.cookies;
  }

  return {};
}

function cookieOptions(isProduction, maxAge) {
  const options = {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/"
  };

  if (Number.isFinite(maxAge)) {
    options.maxAge = Math.max(0, Math.floor(maxAge));
  }

  return options;
}

let joseImportPromise = null;
function loadJose() {
  if (!joseImportPromise) {
    joseImportPromise = import("jose");
  }
  return joseImportPromise;
}

function isExpiredJwtError(error) {
  const code = String(error?.code || "");
  const name = String(error?.name || "");
  return code === "ERR_JWT_EXPIRED" || name === "JWTExpired";
}

function classifyJwtVerifyError(error) {
  if (isExpiredJwtError(error)) {
    return "expired";
  }

  const code = String(error?.code || "");
  if (INVALID_JWT_ERROR_CODES.has(code)) {
    return "invalid";
  }

  if (TRANSIENT_JWT_ERROR_CODES.has(code)) {
    return "transient";
  }

  if (isTransientAuthMessage(error?.message)) {
    return "transient";
  }

  return "invalid";
}

export {
  validatePasswordRecoveryPayload,
  displayNameFromEmail,
  resolveDisplayName,
  resolveDisplayNameFromClaims,
  isTransientAuthMessage,
  isTransientSupabaseError,
  sanitizeAuthMessage,
  mapAuthError,
  validationError,
  isUserNotFoundLikeAuthError,
  mapRecoveryError,
  mapPasswordUpdateError,
  buildDisabledPasswordSecret,
  mapOtpVerifyError,
  mapProfileUpdateError,
  mapCurrentPasswordError,
  parseHttpUrl,
  buildPasswordResetRedirectUrl,
  buildOtpLoginRedirectUrl,
  normalizeOAuthIntent,
  normalizeReturnToPath,
  buildOAuthRedirectUrl,
  buildOAuthLoginRedirectUrl,
  buildOAuthLinkRedirectUrl,
  normalizeOAuthProviderInput,
  parseOAuthCompletePayload,
  parseOtpLoginVerifyPayload,
  mapOAuthCallbackError,
  normalizeIdentityProviderId,
  collectProviderIdsFromSupabaseUser,
  buildAuthMethodsStatusFromProviderIds,
  buildAuthMethodsStatusFromSupabaseUser,
  buildSecurityStatusFromAuthMethodsStatus,
  findAuthMethodById,
  findLinkedIdentityByProvider,
  safeRequestCookies,
  cookieOptions,
  loadJose,
  isExpiredJwtError,
  classifyJwtVerifyError
};
