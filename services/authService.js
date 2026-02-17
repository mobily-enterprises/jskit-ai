import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import { AppError } from "../lib/errors.js";
import {
  AUTH_ACCESS_TOKEN_MAX_LENGTH,
  AUTH_RECOVERY_TOKEN_MAX_LENGTH,
  AUTH_REFRESH_TOKEN_MAX_LENGTH
} from "../shared/auth/authConstraints.js";
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
} from "../shared/auth/authMethods.js";
import {
  AUTH_OAUTH_DEFAULT_PROVIDER,
  AUTH_OAUTH_PROVIDERS,
  normalizeOAuthProvider as normalizeSupportedOAuthProvider
} from "../shared/auth/oauthProviders.js";
import { normalizeEmail } from "../shared/auth/utils.js";
import { validators } from "../shared/auth/validators.js";

const ACCESS_TOKEN_COOKIE = "sb_access_token";
const REFRESH_TOKEN_COOKIE = "sb_refresh_token";
const DEFAULT_AUDIENCE = "authenticated";
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
  const normalizedProviders = Array.isArray(providerIds) ? providerIds.map(normalizeIdentityProviderId).filter(Boolean) : [];
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

function createAuthService(options) {
  const supabaseUrl = String(options.supabaseUrl || "");
  const supabasePublishableKey = String(options.supabasePublishableKey || "");
  const userProfilesRepository = options.userProfilesRepository;
  const userSettingsRepository = options.userSettingsRepository || null;
  const isProduction = options.nodeEnv === "production";
  const jwtAudience = String(options.jwtAudience || DEFAULT_AUDIENCE);
  const passwordResetRedirectUrl = buildPasswordResetRedirectUrl({
    appPublicUrl: options.appPublicUrl
  });
  const otpLoginRedirectUrl = buildOtpLoginRedirectUrl({
    appPublicUrl: options.appPublicUrl
  });
  const appPublicUrl = String(options.appPublicUrl || "");
  let supabaseClient = null;

  const issuerUrl = supabaseUrl ? new URL("/auth/v1", supabaseUrl).toString().replace(/\/$/, "") : "";
  const jwksUrl = issuerUrl ? `${issuerUrl}/.well-known/jwks.json` : "";

  let jwksResolver = null;

  function ensureConfigured() {
    if (!supabaseUrl || !supabasePublishableKey) {
      throw new AppError(500, "Supabase auth is not configured. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.");
    }
  }

  function getSupabaseClient() {
    ensureConfigured();
    if (supabaseClient) {
      return supabaseClient;
    }

    supabaseClient = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    return supabaseClient;
  }

  function createStatelessSupabaseClient() {
    ensureConfigured();
    return createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  async function getJwksResolver() {
    if (jwksResolver) {
      return jwksResolver;
    }

    const jose = await loadJose();
    jwksResolver = jose.createRemoteJWKSet(new URL(jwksUrl));
    return jwksResolver;
  }

  async function verifyAccessToken(accessToken) {
    const jose = await loadJose();
    const jwks = await getJwksResolver();

    try {
      const { payload } = await jose.jwtVerify(accessToken, jwks, {
        issuer: issuerUrl,
        audience: jwtAudience,
        clockTolerance: 5
      });

      return {
        status: "valid",
        payload
      };
    } catch (error) {
      return {
        status: classifyJwtVerifyError(error)
      };
    }
  }

  async function verifyAccessTokenViaSupabase(accessToken) {
    const supabase = getSupabaseClient();

    try {
      const response = await supabase.auth.getUser(accessToken);
      if (response.error) {
        if (isTransientSupabaseError(response.error)) {
          return { status: "transient" };
        }

        return { status: "invalid" };
      }

      if (!response.data?.user) {
        return { status: "invalid" };
      }

      const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email);
      return {
        status: "valid",
        profile
      };
    } catch (error) {
      if (isTransientSupabaseError(error)) {
        return { status: "transient" };
      }

      return { status: "invalid" };
    }
  }

  async function setSessionFromRequestCookies(request) {
    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[ACCESS_TOKEN_COOKIE] || "").trim();
    const refreshToken = String(cookies[REFRESH_TOKEN_COOKIE] || "").trim();

    if (!accessToken || !refreshToken) {
      throw new AppError(401, "Authentication required.");
    }

    const supabase = getSupabaseClient();
    let sessionResponse;
    try {
      sessionResponse = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });
    } catch (error) {
      throw mapRecoveryError(error);
    }

    const session = sessionResponse.data?.session || null;
    const user = sessionResponse.data?.user || null;

    if (sessionResponse.error || !session || !user) {
      throw mapRecoveryError(sessionResponse.error);
    }

    return {
      ...sessionResponse,
      data: {
        ...sessionResponse.data,
        session,
        user
      }
    };
  }

  async function resolveCurrentSupabaseUser(request) {
    const supabase = getSupabaseClient();
    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[ACCESS_TOKEN_COOKIE] || "").trim();
    let user = null;
    let session = null;

    if (accessToken) {
      try {
        const userResponse = await supabase.auth.getUser(accessToken);
        if (!userResponse.error && userResponse.data?.user) {
          user = userResponse.data.user;
        } else if (userResponse.error && isTransientSupabaseError(userResponse.error)) {
          throw mapAuthError(userResponse.error, 503);
        }
      } catch (error) {
        if (isTransientSupabaseError(error)) {
          throw mapAuthError(error, 503);
        }
      }
    }

    if (!user) {
      const sessionResponse = await setSessionFromRequestCookies(request);
      user = sessionResponse.data.user || null;
      session = sessionResponse.data.session || null;
    }

    if (typeof supabase.auth.getUser === "function") {
      try {
        const userResponse = await supabase.auth.getUser();
        if (!userResponse.error && userResponse.data?.user) {
          user = userResponse.data.user;
        } else if (userResponse.error && isTransientSupabaseError(userResponse.error)) {
          throw mapAuthError(userResponse.error, 503);
        }
      } catch (error) {
        if (isTransientSupabaseError(error)) {
          throw mapAuthError(error, 503);
        }
      }
    }

    if (typeof supabase.auth.getUserIdentities === "function") {
      try {
        const identitiesResponse = await supabase.auth.getUserIdentities();
        if (!identitiesResponse.error && Array.isArray(identitiesResponse.data?.identities)) {
          user = {
            ...(user || {}),
            identities: identitiesResponse.data.identities
          };
        } else if (identitiesResponse.error && isTransientSupabaseError(identitiesResponse.error)) {
          throw mapAuthError(identitiesResponse.error, 503);
        }
      } catch (error) {
        if (isTransientSupabaseError(error)) {
          throw mapAuthError(error, 503);
        }
      }
    }

    if (!user) {
      throw new AppError(401, "Authentication required.");
    }

    return {
      session,
      user
    };
  }

  function writeSessionCookies(reply, session) {
    const accessToken = String(session?.access_token || "");
    const refreshToken = String(session?.refresh_token || "");
    if (!accessToken || !refreshToken) {
      return;
    }

    const accessMaxAge = Number.isFinite(Number(session?.expires_in)) ? Number(session.expires_in) : 3600;
    const refreshMaxAge = Math.max(accessMaxAge * 24, 86400);

    reply.setCookie(ACCESS_TOKEN_COOKIE, accessToken, cookieOptions(isProduction, accessMaxAge));
    reply.setCookie(REFRESH_TOKEN_COOKIE, refreshToken, cookieOptions(isProduction, refreshMaxAge));
  }

  function clearSessionCookies(reply) {
    const clearOptions = cookieOptions(isProduction, 0);
    reply.clearCookie(ACCESS_TOKEN_COOKIE, clearOptions);
    reply.clearCookie(REFRESH_TOKEN_COOKIE, clearOptions);
  }

  function profileNeedsUpdate(existing, nextProfile) {
    if (!existing) {
      return true;
    }

    return existing.email !== nextProfile.email || existing.displayName !== nextProfile.displayName;
  }

  function requireSynchronizedProfile(profile) {
    if (profile && Number.isFinite(Number(profile.id)) && String(profile.displayName || "").trim()) {
      return profile;
    }

    throw new AppError(500, "Authentication profile synchronization failed. Please retry.");
  }

  async function syncProfileMirror(nextProfile) {
    try {
      const existing = await userProfilesRepository.findBySupabaseUserId(nextProfile.supabaseUserId);
      if (!profileNeedsUpdate(existing, nextProfile)) {
        return requireSynchronizedProfile(existing);
      }

      const upserted = await userProfilesRepository.upsert(nextProfile);
      return requireSynchronizedProfile(upserted);
    } catch (error) {
      if (String(error?.code || "") === "USER_PROFILE_EMAIL_CONFLICT") {
        throw new AppError(
          409,
          "This email is already registered with another sign-in method. Sign in with that method, then link this provider in Settings > Security."
        );
      }

      throw error;
    }
  }

  async function syncProfileFromSupabaseUser(supabaseUser, fallbackEmail) {
    const supabaseUserId = String(supabaseUser?.id || "").trim();
    const email = normalizeEmail(supabaseUser?.email || fallbackEmail);

    if (!supabaseUserId || !email) {
      throw new AppError(500, "Supabase user payload is missing required fields.");
    }

    return syncProfileMirror({
      supabaseUserId,
      email,
      displayName: resolveDisplayName(supabaseUser, email)
    });
  }

  async function syncProfileFromJwtClaims(claims) {
    const supabaseUserId = String(claims?.sub || "").trim();
    if (!supabaseUserId) {
      throw new AppError(401, "Token is missing subject claim.");
    }

    const existing = await userProfilesRepository.findBySupabaseUserId(supabaseUserId);
    const emailFromToken = normalizeEmail(claims?.email || "");

    if (!emailFromToken) {
      if (existing) {
        return existing;
      }
      throw new AppError(401, "Token is missing email claim.");
    }

    return syncProfileMirror({
      supabaseUserId,
      email: emailFromToken,
      displayName: resolveDisplayNameFromClaims(claims, emailFromToken)
    });
  }

  async function resolvePasswordSignInPolicyForUserId(userId) {
    if (!userSettingsRepository || typeof userSettingsRepository.ensureForUserId !== "function") {
      return {
        passwordSignInEnabled: true,
        passwordSetupRequired: false
      };
    }

    const settings = await userSettingsRepository.ensureForUserId(userId);
    return {
      passwordSignInEnabled: settings?.passwordSignInEnabled !== false,
      passwordSetupRequired: settings?.passwordSetupRequired === true
    };
  }

  async function setPasswordSignInEnabledForUserId(userId, enabled, options = {}) {
    if (!userSettingsRepository || typeof userSettingsRepository.updatePasswordSignInEnabled !== "function") {
      throw new AppError(500, "Password sign-in settings repository is not configured.");
    }

    const updated = await userSettingsRepository.updatePasswordSignInEnabled(userId, enabled, options);
    return {
      passwordSignInEnabled: updated.passwordSignInEnabled !== false,
      passwordSetupRequired: updated.passwordSetupRequired === true
    };
  }

  async function setPasswordSetupRequiredForUserId(userId, required) {
    if (!userSettingsRepository || typeof userSettingsRepository.updatePasswordSetupRequired !== "function") {
      return;
    }

    await userSettingsRepository.updatePasswordSetupRequired(userId, required);
  }

  async function resolveCurrentAuthContext(request) {
    const current = await resolveCurrentSupabaseUser(request);
    const profile = await syncProfileFromSupabaseUser(current.user, current.user?.email || "");
    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(profile.id);
    const authMethodsStatus = buildAuthMethodsStatusFromSupabaseUser(current.user, passwordSignInPolicy);

    return {
      ...current,
      profile,
      passwordSignInEnabled: passwordSignInPolicy.passwordSignInEnabled,
      passwordSetupRequired: passwordSignInPolicy.passwordSetupRequired,
      authMethodsStatus
    };
  }

  async function register(payload) {
    ensureConfigured();

    const parsed = validators.registerInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const response = await supabase.auth.signUp({
      email: parsed.email,
      password: parsed.password,
      options: {
        data: {
          display_name: displayNameFromEmail(parsed.email)
        }
      }
    });

    if (response.error) {
      throw mapAuthError(response.error, 400);
    }

    if (!response.data?.user) {
      throw new AppError(500, "Supabase sign-up did not return a user.");
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, parsed.email);

    if (!response.data.session) {
      return {
        requiresEmailConfirmation: true,
        email: parsed.email,
        profile,
        session: null
      };
    }

    return {
      requiresEmailConfirmation: false,
      profile,
      session: response.data.session
    };
  }

  async function login(payload) {
    ensureConfigured();

    const parsed = validators.loginInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const response = await supabase.auth.signInWithPassword({
      email: parsed.email,
      password: parsed.password
    });

    if (response.error || !response.data?.user || !response.data?.session) {
      throw mapAuthError(response.error, 401);
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, parsed.email);
    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(profile.id);
    if (!passwordSignInPolicy.passwordSignInEnabled) {
      throw new AppError(401, "Invalid email or password.");
    }

    return {
      profile,
      session: response.data.session
    };
  }

  async function requestOtpLogin(payload) {
    ensureConfigured();

    const parsed = validators.forgotPasswordInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      response = await supabase.auth.signInWithOtp({
        email: parsed.email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: otpLoginRedirectUrl
        }
      });
    } catch (error) {
      if (isTransientSupabaseError(error)) {
        throw mapAuthError(error, 503);
      }

      return {
        ok: true,
        message: "If an account exists for that email, a one-time code has been sent."
      };
    }

    if (response.error) {
      if (isTransientSupabaseError(response.error)) {
        throw mapAuthError(response.error, 503);
      }

      if (isUserNotFoundLikeAuthError(response.error)) {
        return {
          ok: true,
          message: "If an account exists for that email, a one-time code has been sent."
        };
      }

      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }

    return {
      ok: true,
      message: "If an account exists for that email, a one-time code has been sent."
    };
  }

  async function verifyOtpLogin(payload) {
    ensureConfigured();

    const parsed = parseOtpLoginVerifyPayload(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      if (parsed.tokenHash) {
        response = await supabase.auth.verifyOtp({
          token_hash: parsed.tokenHash,
          type: parsed.type
        });
      } else {
        response = await supabase.auth.verifyOtp({
          email: parsed.email,
          token: parsed.token,
          type: parsed.type
        });
      }
    } catch (error) {
      throw mapOtpVerifyError(error);
    }

    if (response.error || !response.data?.session || !response.data?.user) {
      throw mapOtpVerifyError(response.error);
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email || parsed.email);

    return {
      profile,
      session: response.data.session
    };
  }

  async function oauthStart(payload = {}) {
    ensureConfigured();

    const provider = normalizeOAuthProviderInput(payload.provider || AUTH_OAUTH_DEFAULT_PROVIDER);
    const returnTo = normalizeReturnToPath(payload.returnTo, { fallback: "/" });
    const redirectTo = buildOAuthLoginRedirectUrl({
      appPublicUrl,
      provider,
      returnTo
    });

    const supabase = getSupabaseClient();
    let response;
    try {
      response = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo,
          queryParams: provider === "google" ? { prompt: "select_account" } : undefined
        }
      });
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error || !response.data?.url) {
      throw mapAuthError(response.error, 400);
    }

    return {
      provider,
      returnTo,
      url: String(response.data.url)
    };
  }

  async function startProviderLink(request, payload = {}) {
    ensureConfigured();

    const provider = normalizeOAuthProviderInput(payload.provider || AUTH_OAUTH_DEFAULT_PROVIDER);
    const returnTo = normalizeReturnToPath(payload.returnTo, { fallback: "/" });
    await setSessionFromRequestCookies(request);

    const supabase = getSupabaseClient();
    if (typeof supabase.auth.linkIdentity !== "function") {
      throw new AppError(500, "Supabase client does not support identity linking in this environment.");
    }

    const redirectTo = buildOAuthLinkRedirectUrl({
      appPublicUrl,
      provider,
      returnTo
    });

    let response;
    try {
      response = await supabase.auth.linkIdentity({
        provider,
        options: {
          redirectTo,
          queryParams: provider === "google" ? { prompt: "select_account" } : undefined
        }
      });
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error || !response.data?.url) {
      throw mapAuthError(response.error, 400);
    }

    return {
      provider,
      returnTo,
      url: String(response.data.url)
    };
  }

  async function oauthComplete(payload = {}) {
    ensureConfigured();

    const parsed = parseOAuthCompletePayload(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    if (parsed.errorCode) {
      throw mapOAuthCallbackError(parsed.errorCode, parsed.errorDescription);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      if (parsed.hasSessionPair) {
        response = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken
        });
      } else {
        response = await supabase.auth.exchangeCodeForSession(parsed.code);
      }
    } catch (error) {
      throw mapRecoveryError(error);
    }

    if (response.error || !response.data?.session || !response.data?.user) {
      throw mapRecoveryError(response.error);
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email);

    return {
      provider: parsed.provider,
      profile,
      session: response.data.session
    };
  }

  async function requestPasswordReset(payload) {
    ensureConfigured();

    const parsed = validators.forgotPasswordInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const options = { redirectTo: passwordResetRedirectUrl };
    let response;
    try {
      response = await supabase.auth.resetPasswordForEmail(parsed.email, options);
      /* c8 ignore next 4 -- supabase-js returns auth/transport failures as response.error;
       * this catch exists only for unexpected non-Auth throws from SDK/runtime internals. */
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error) {
      throw mapAuthError(response.error, 400);
    }

    return {
      ok: true,
      message: "If an account exists for that email, a password reset link has been sent."
    };
  }

  async function completePasswordRecovery(payload) {
    ensureConfigured();

    const parsed = validatePasswordRecoveryPayload(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    let response;
    try {
      if (parsed.hasCode) {
        response = await supabase.auth.exchangeCodeForSession(parsed.code);
      } else if (parsed.hasTokenHash) {
        response = await supabase.auth.verifyOtp({
          type: "recovery",
          token_hash: parsed.tokenHash
        });
      } else {
        response = await supabase.auth.setSession({
          access_token: parsed.accessToken,
          refresh_token: parsed.refreshToken
        });
      }
      /* c8 ignore next 3 -- defensive: supabase-js usually surfaces failures via response.error. */
    } catch (error) {
      throw mapRecoveryError(error);
    }

    if (response.error) {
      throw mapRecoveryError(response.error);
    }

    /* c8 ignore next 3 -- defensive against malformed SDK responses without explicit error payload. */
    if (!response.data?.session || !response.data?.user) {
      throw new AppError(401, "Recovery link is invalid or has expired.");
    }

    const profile = await syncProfileFromSupabaseUser(response.data.user, response.data.user.email);

    return {
      profile,
      session: response.data.session
    };
  }

  async function resetPassword(request, payload) {
    ensureConfigured();

    const parsed = validators.resetPasswordInput(payload);
    if (Object.keys(parsed.fieldErrors).length > 0) {
      throw validationError(parsed.fieldErrors);
    }

    const supabase = getSupabaseClient();
    const sessionResponse = await setSessionFromRequestCookies(request);
    const profile = await syncProfileFromSupabaseUser(sessionResponse.data.user, sessionResponse.data.user?.email || "");
    const passwordSignInPolicy = await resolvePasswordSignInPolicyForUserId(profile.id);
    if (!passwordSignInPolicy.passwordSignInEnabled) {
      throw new AppError(409, "Password sign-in is disabled for this account.");
    }

    let updateResponse;
    try {
      updateResponse = await supabase.auth.updateUser({
        password: parsed.password
      });
    } catch (error) {
      throw mapPasswordUpdateError(error);
    }

    if (updateResponse.error || !updateResponse.data?.user) {
      throw mapPasswordUpdateError(updateResponse.error);
    }

    const updatedProfile = await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);
    await setPasswordSetupRequiredForUserId(updatedProfile.id, false);
  }

  async function updateDisplayName(request, displayName) {
    ensureConfigured();

    const normalizedDisplayName = String(displayName || "").trim();
    if (!normalizedDisplayName) {
      throw validationError({
        displayName: "Display name is required."
      });
    }

    const supabase = getSupabaseClient();
    const sessionResponse = await setSessionFromRequestCookies(request);

    let updateResponse;
    try {
      updateResponse = await supabase.auth.updateUser({
        data: {
          display_name: normalizedDisplayName
        }
      });
    } catch (error) {
      throw mapProfileUpdateError(error);
    }

    if (updateResponse.error || !updateResponse.data?.user) {
      throw mapProfileUpdateError(updateResponse.error);
    }

    const profile = await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);

    return {
      profile,
      session: sessionResponse.data.session
    };
  }

  async function changePassword(request, payload) {
    ensureConfigured();

    const currentPassword = String(payload?.currentPassword || "");
    const newPassword = String(payload?.newPassword || "");
    const requireCurrentPassword = payload?.requireCurrentPassword !== false;
    const supabase = getSupabaseClient();
    const sessionResponse = await setSessionFromRequestCookies(request);

    const email = normalizeEmail(sessionResponse.data.user?.email || "");
    if (!email) {
      throw new AppError(500, "Authenticated user email could not be resolved.");
    }

    if (requireCurrentPassword) {
      const verificationClient = createStatelessSupabaseClient();
      let verifyResponse;
      try {
        verifyResponse = await verificationClient.auth.signInWithPassword({
          email,
          password: currentPassword
        });
      } catch (error) {
        throw mapCurrentPasswordError(error);
      }

      if (verifyResponse.error || !verifyResponse.data?.session) {
        throw mapCurrentPasswordError(verifyResponse.error);
      }
    }

    let updateResponse;
    try {
      updateResponse = await supabase.auth.updateUser({
        password: newPassword
      });
    } catch (error) {
      throw mapPasswordUpdateError(error);
    }

    if (updateResponse.error || !updateResponse.data?.user) {
      throw mapPasswordUpdateError(updateResponse.error);
    }

    const profile = await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);
    await setPasswordSetupRequiredForUserId(profile.id, false);

    return {
      profile,
      session: sessionResponse.data.session
    };
  }

  async function unlinkProvider(request, payload = {}) {
    ensureConfigured();

    const provider = normalizeOAuthProviderInput(payload.provider);
    const supabase = getSupabaseClient();
    if (typeof supabase.auth.unlinkIdentity !== "function") {
      throw new AppError(500, "Supabase client does not support identity unlinking in this environment.");
    }

    await setSessionFromRequestCookies(request);
    const current = await resolveCurrentAuthContext(request);
    const methodId = buildOAuthMethodId(provider);
    const providerMethod = findAuthMethodById(current.authMethodsStatus, methodId);
    if (!providerMethod || !providerMethod.configured) {
      throw validationError({
        provider: `${provider} is not linked to this account.`
      });
    }

    if (!providerMethod.canDisable) {
      throw new AppError(409, "At least one sign-in method must remain enabled.");
    }

    const identity = findLinkedIdentityByProvider(current.user, provider);
    if (!identity) {
      throw new AppError(409, "Linked identity details could not be resolved for this provider.");
    }

    let response;
    try {
      response = await supabase.auth.unlinkIdentity(identity);
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error) {
      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }

    const refreshed = await resolveCurrentAuthContext(request);
    return {
      securityStatus: buildSecurityStatusFromAuthMethodsStatus(refreshed.authMethodsStatus)
    };
  }

  async function setPasswordSignInEnabled(request, payload = {}) {
    ensureConfigured();

    if (typeof payload?.enabled !== "boolean") {
      throw validationError({
        enabled: "Enabled must be a boolean."
      });
    }

    const supabase = getSupabaseClient();
    await setSessionFromRequestCookies(request);
    const current = await resolveCurrentAuthContext(request);
    const passwordMethod = findAuthMethodById(current.authMethodsStatus, AUTH_METHOD_PASSWORD_ID);

    if (!passwordMethod) {
      throw new AppError(500, "Password method configuration could not be resolved.");
    }

    if (payload.enabled && !passwordMethod.configured) {
      throw validationError({
        enabled: "Set a password before enabling password sign-in."
      });
    }

    if (!payload.enabled && !passwordMethod.canDisable) {
      throw new AppError(409, "At least one sign-in method must remain enabled.");
    }

    if (!payload.enabled && passwordMethod.configured) {
      let updateResponse = null;
      try {
        updateResponse = await supabase.auth.updateUser({
          // Supabase does not support null password removal; rotate to high-entropy unknown secret.
          password: buildDisabledPasswordSecret()
        });
      } catch {
        // Some Supabase projects require re-authenticated password updates.
        // Treat secret rotation as best-effort and still disable app-level password sign-in.
        updateResponse = null;
      }

      if (!updateResponse || updateResponse.error || !updateResponse.data?.user) {
        updateResponse = null;
      }

      if (updateResponse?.data?.user) {
        await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);
      }
    }

    const passwordSignInOptions = !payload.enabled && passwordMethod.configured ? { passwordSetupRequired: true } : {};
    const nextPasswordSignInPolicy = await setPasswordSignInEnabledForUserId(
      current.profile.id,
      payload.enabled,
      passwordSignInOptions
    );
    const nextAuthMethodsStatus = buildAuthMethodsStatusFromSupabaseUser(current.user, nextPasswordSignInPolicy);

    return {
      securityStatus: buildSecurityStatusFromAuthMethodsStatus(nextAuthMethodsStatus)
    };
  }

  async function signOutOtherSessions(request) {
    ensureConfigured();
    const supabase = getSupabaseClient();
    await setSessionFromRequestCookies(request);
    const response = await supabase.auth.signOut({
      scope: "others"
    });

    if (response.error) {
      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }
  }

  async function getSecurityStatus(request) {
    if (!request) {
      const authMethodsStatus = buildAuthMethodsStatusFromProviderIds([AUTH_METHOD_PASSWORD_PROVIDER], {
        passwordSignInEnabled: true,
        passwordSetupRequired: false
      });
      return buildSecurityStatusFromAuthMethodsStatus(authMethodsStatus);
    }

    const current = await resolveCurrentAuthContext(request);
    return buildSecurityStatusFromAuthMethodsStatus(current.authMethodsStatus);
  }

  async function authenticateRequest(request) {
    ensureConfigured();

    const cookies = safeRequestCookies(request);
    const accessToken = String(cookies[ACCESS_TOKEN_COOKIE] || "");
    const refreshToken = String(cookies[REFRESH_TOKEN_COOKIE] || "");

    if (!accessToken) {
      return {
        authenticated: false,
        clearSession: false,
        session: null,
        transientFailure: false
      };
    }

    const verification = await verifyAccessToken(accessToken);

    if (verification.status === "valid") {
      const profile = await syncProfileFromJwtClaims(verification.payload);
      return {
        authenticated: true,
        profile,
        clearSession: false,
        session: null,
        transientFailure: false
      };
    }

    if (verification.status === "transient") {
      return {
        authenticated: false,
        clearSession: false,
        session: null,
        transientFailure: true
      };
    }

    if (verification.status === "invalid") {
      const supabaseVerification = await verifyAccessTokenViaSupabase(accessToken);
      if (supabaseVerification.status === "valid") {
        return {
          authenticated: true,
          profile: supabaseVerification.profile,
          clearSession: false,
          session: null,
          transientFailure: false
        };
      }

      if (supabaseVerification.status === "transient") {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: true
        };
      }
    }

    if (!refreshToken) {
      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    const supabase = getSupabaseClient();
    let refreshResponse;
    try {
      refreshResponse = await supabase.auth.refreshSession({ refresh_token: refreshToken });
      /* c8 ignore next 17 -- defensive: refreshSession usually resolves with { error } for auth/transport issues. */
    } catch (error) {
      if (isTransientSupabaseError(error)) {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: true
        };
      }

      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    if (refreshResponse.error) {
      if (isTransientSupabaseError(refreshResponse.error)) {
        return {
          authenticated: false,
          clearSession: false,
          session: null,
          transientFailure: true
        };
      }

      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    if (!refreshResponse.data?.session || !refreshResponse.data?.user) {
      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }

    const profile = await syncProfileFromSupabaseUser(refreshResponse.data.user, refreshResponse.data.user.email);

    return {
      authenticated: true,
      profile,
      clearSession: false,
      session: refreshResponse.data.session,
      transientFailure: false
    };
  }

  function hasAccessTokenCookie(request) {
    const cookies = safeRequestCookies(request);
    return Boolean(cookies[ACCESS_TOKEN_COOKIE]);
  }

  return {
    register,
    login,
    requestOtpLogin,
    verifyOtpLogin,
    oauthStart,
    oauthComplete,
    startProviderLink,
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword,
    updateDisplayName,
    changePassword,
    setPasswordSignInEnabled,
    unlinkProvider,
    signOutOtherSessions,
    getSecurityStatus,
    authenticateRequest,
    hasAccessTokenCookie,
    writeSessionCookies,
    clearSessionCookies
  };
}

const __testables = {
  validatePasswordRecoveryPayload,
  displayNameFromEmail,
  resolveDisplayName,
  resolveDisplayNameFromClaims,
  isTransientAuthMessage,
  isTransientSupabaseError,
  mapAuthError,
  validationError,
  isUserNotFoundLikeAuthError,
  mapRecoveryError,
  mapPasswordUpdateError,
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
  isExpiredJwtError,
  classifyJwtVerifyError
};

export { createAuthService, __testables };
