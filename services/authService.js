import { createClient } from "@supabase/supabase-js";
import { AppError } from "../lib/errors.js";
import {
  AUTH_ACCESS_TOKEN_MAX_LENGTH,
  AUTH_RECOVERY_TOKEN_MAX_LENGTH,
  AUTH_REFRESH_TOKEN_MAX_LENGTH
} from "../shared/auth/authConstraints.js";
import { normalizeEmail } from "../shared/auth/utils.js";
import { validators } from "../shared/auth/validators.js";

const ACCESS_TOKEN_COOKIE = "sb_access_token";
const REFRESH_TOKEN_COOKIE = "sb_refresh_token";
const DEFAULT_AUDIENCE = "authenticated";
const PASSWORD_RESET_PATH = "reset-password";

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
  const tokenHash = String(payload?.tokenHash || payload?.token_hash || "").trim();
  const type = String(payload?.type || "recovery")
    .trim()
    .toLowerCase();
  const accessToken = String(payload?.accessToken || payload?.access_token || "").trim();
  const refreshToken = String(payload?.refreshToken || payload?.refresh_token || "").trim();

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

function mapAuthError(error, fallbackStatus) {
  if (isTransientSupabaseError(error)) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }

  const message = String(error?.message || "Authentication failed.");
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

  const status = Number.isInteger(Number(fallbackStatus)) ? Number(fallbackStatus) : 400;
  if (status >= 500) {
    return new AppError(503, "Authentication service temporarily unavailable. Please retry.");
  }
  if (status === 401) {
    return new AppError(401, "Invalid email or password.");
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
  const isProduction = options.nodeEnv === "production";
  const jwtAudience = String(options.jwtAudience || DEFAULT_AUDIENCE);
  const passwordResetRedirectUrl = buildPasswordResetRedirectUrl({
    appPublicUrl: options.appPublicUrl
  });
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
    const user = sessionResponse.data?.user || session?.user || null;

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
        throw new AppError(409, "Email is already linked to another account.");
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

    return {
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
    await setSessionFromRequestCookies(request);

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

    await syncProfileFromSupabaseUser(updateResponse.data.user, updateResponse.data.user.email);
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
      session: updateResponse.data.session || sessionResponse.data.session || null
    };
  }

  async function changePassword(request, payload) {
    ensureConfigured();

    const currentPassword = String(payload?.currentPassword || "");
    const newPassword = String(payload?.newPassword || "");
    const supabase = getSupabaseClient();
    const sessionResponse = await setSessionFromRequestCookies(request);

    const email = normalizeEmail(sessionResponse.data.user?.email || "");
    if (!email) {
      throw new AppError(500, "Authenticated user email could not be resolved.");
    }

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

    return {
      profile,
      session: updateResponse.data.session || sessionResponse.data.session || null
    };
  }

  async function signOutOtherSessions(request) {
    ensureConfigured();
    const supabase = getSupabaseClient();
    await setSessionFromRequestCookies(request);

    let response;
    try {
      response = await supabase.auth.signOut({
        scope: "others"
      });
    } catch (error) {
      throw mapAuthError(error, 500);
    }

    if (response.error) {
      throw mapAuthError(response.error, Number(response.error?.status || 400));
    }
  }

  async function getSecurityStatus() {
    return {
      mfa: {
        status: "not_enabled",
        enrolled: false,
        methods: []
      }
    };
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
    requestPasswordReset,
    completePasswordRecovery,
    resetPassword,
    updateDisplayName,
    changePassword,
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
  mapRecoveryError,
  mapPasswordUpdateError,
  mapProfileUpdateError,
  mapCurrentPasswordError,
  parseHttpUrl,
  buildPasswordResetRedirectUrl,
  safeRequestCookies,
  cookieOptions,
  isExpiredJwtError,
  classifyJwtVerifyError
};

export { createAuthService, __testables };
