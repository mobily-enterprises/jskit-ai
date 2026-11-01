import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { ensureDevAuthRuntimeAvailable, resolveDevAuthPolicyFromEnv } from "@jskit-ai/auth-core/server/devAuth";
import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
import { AUTH_TEXTS, authFieldError } from "@jskit-ai/auth-core/server/authTexts";
import { validationError } from "./authErrorMappers.js";
import { loadJose, isExpiredJwtError } from "./authJwt.js";

const DEV_AUTH_TOKEN_PREFIX = "jskit-dev.";
const DEV_AUTH_ISSUER = "jskit:dev-auth";
const DEFAULT_DEV_AUTH_ACCESS_TTL_SECONDS = 60 * 60 * 12;
const DEFAULT_DEV_AUTH_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function isDevAuthToken(token) {
  return String(token || "").trim().startsWith(DEV_AUTH_TOKEN_PREFIX);
}

function stripDevAuthTokenPrefix(token) {
  return String(token || "").trim().slice(DEV_AUTH_TOKEN_PREFIX.length);
}

/**
 * Dev auth's policy (AUTH_DEV_BYPASS_ENABLED and AUTH_DEV_BYPASS_SECRET), and
 * the audience and lifetimes of the tokens it signs.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {string} jwtAudience
 */
function resolveDevAuthConfig(env, jwtAudience) {
  return Object.freeze({
    ...resolveDevAuthPolicyFromEnv(env),
    jwtAudience,
    accessTtlSeconds: normalizePositiveInteger(env.AUTH_DEV_ACCESS_TTL_SECONDS, DEFAULT_DEV_AUTH_ACCESS_TTL_SECONDS),
    refreshTtlSeconds: normalizePositiveInteger(env.AUTH_DEV_REFRESH_TTL_SECONDS, DEFAULT_DEV_AUTH_REFRESH_TTL_SECONDS)
  });
}

function buildProfileFromTokenClaims(payload) {
  const id = normalizeRecordId(payload?.sub, { fallback: null });
  const email = normalizeEmail(payload?.email || "");
  if (!id || !email) {
    return null;
  }

  const displayName = String(payload?.displayName || "").trim();
  const username = String(payload?.username || "")
    .trim()
    .toLowerCase();
  const authProvider = String(payload?.authProvider || "dev")
    .trim()
    .toLowerCase();
  const authProviderUserSid = String(payload?.authProviderUserSid || payload?.sub || "").trim();

  return {
    id,
    email,
    username,
    displayName: displayName || email || `User ${id}`,
    authProvider,
    authProviderUserSid,
    avatarStorageKey: null,
    avatarVersion: null
  };
}

/**
 * @param {any} payload
 * @param {{ userProfilesRepository: import("../types.js").SupabaseUserProfiles }} dependencies
 */
async function resolveProfileFromTokenClaims(payload, { userProfilesRepository }) {
  const userId = normalizeRecordId(payload?.sub, { fallback: null });
  if (userId) {
    const latest = await userProfilesRepository.findById(userId);
    if (latest?.id) {
      return latest;
    }
  }

  const profile = buildProfileFromTokenClaims(payload);
  if (profile) {
    return profile;
  }

  throw new AppError(401, "Dev session is invalid.", { code: "auth.supabase.dev.sessionInvalid" });
}

async function signDevAuthToken(kind, profile, config) {
  const jose = await loadJose();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const ttlSeconds = kind === "refresh" ? config.refreshTtlSeconds : config.accessTtlSeconds;
  const token = await new jose.SignJWT({
    kind,
    email: String(profile?.email || "").trim().toLowerCase(),
    displayName: String(profile?.displayName || "").trim(),
    username: String(profile?.username || "")
      .trim()
      .toLowerCase(),
    authProvider: String(profile?.authProvider || "dev")
      .trim()
      .toLowerCase(),
    authProviderUserSid: String(profile?.authProviderUserSid || profile?.id || "").trim()
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(DEV_AUTH_ISSUER)
    .setAudience(config.jwtAudience)
    .setSubject(String(profile?.id || "").trim())
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + ttlSeconds)
    .sign(encoder.encode(config.secret));

  return `${DEV_AUTH_TOKEN_PREFIX}${token}`;
}

async function verifyDevAuthToken(token, kind, config) {
  if (!isDevAuthToken(token) || !config?.secret) {
    return {
      status: "invalid",
      payload: null
    };
  }

  const jose = await loadJose();
  try {
    const { payload } = await jose.jwtVerify(stripDevAuthTokenPrefix(token), encoder.encode(config.secret), {
      issuer: DEV_AUTH_ISSUER,
      audience: config.jwtAudience
    });

    if (String(payload?.kind || "").trim() !== kind) {
      return {
        status: "invalid",
        payload: null
      };
    }

    return {
      status: "valid",
      payload
    };
  } catch (error) {
    if (isExpiredJwtError(error)) {
      return {
        status: "expired",
        payload: null
      };
    }

    return {
      status: "invalid",
      payload: null
    };
  }
}

async function createDevAuthSession(profile, config) {
  return {
    access_token: await signDevAuthToken("access", profile, config),
    refresh_token: await signDevAuthToken("refresh", profile, config),
    expires_in: config.accessTtlSeconds,
    token_type: "bearer"
  };
}

/**
 * The app user a dev login names by id or email.
 * @param {{ userId?: unknown, email?: unknown }} input
 * @param {{ userProfilesRepository: import("../types.js").SupabaseUserProfiles }} dependencies
 */
async function resolveDevAuthProfile(input, { userProfilesRepository }) {
  const normalizedUserId = normalizeRecordId(input.userId, { fallback: null });
  const normalizedEmail = normalizeEmail(input.email || "");
  if (!normalizedUserId && !normalizedEmail) {
    throw validationError({
      userId: authFieldError(AUTH_TEXTS.devUserRequired),
      email: authFieldError(AUTH_TEXTS.devUserRequired)
    });
  }

  const fieldErrors = {};

  if (normalizedUserId) {
    const byId = await userProfilesRepository.findById(normalizedUserId);
    if (byId?.id) {
      return byId;
    }
    fieldErrors.userId = authFieldError(AUTH_TEXTS.devUserNotFound);
  }

  if (normalizedEmail) {
    const byEmail = await userProfilesRepository.findByEmail(normalizedEmail);
    if (byEmail?.id) {
      return byEmail;
    }
    fieldErrors.email = authFieldError(AUTH_TEXTS.devUserNotFound);
  }

  throw validationError(fieldErrors);
}

/**
 * @param {{ request: object, accessToken?: string, refreshToken?: string }} tokens
 * @param {object} dependencies
 * @param {import("../types.js").SupabaseConfig["devAuth"]} dependencies.config
 * @param {import("../types.js").SupabaseUserProfiles} dependencies.userProfilesRepository
 */
async function authenticateDevAuthRequest(
  { request, accessToken = "", refreshToken = "" },
  { config, userProfilesRepository }
) {
  const hasDevAccessToken = isDevAuthToken(accessToken);
  const hasDevRefreshToken = isDevAuthToken(refreshToken);
  if (!hasDevAccessToken && !hasDevRefreshToken) {
    return null;
  }

  try {
    ensureDevAuthRuntimeAvailable(config, request);
  } catch {
    return {
      authenticated: false,
      clearSession: true,
      session: null,
      transientFailure: false
    };
  }

  if (hasDevAccessToken) {
    const accessVerification = await verifyDevAuthToken(accessToken, "access", config);
    if (accessVerification.status === "valid") {
      const profile = await resolveProfileFromTokenClaims(accessVerification.payload, {
        userProfilesRepository
      });
      return {
        authenticated: true,
        profile,
        clearSession: false,
        session: null,
        transientFailure: false
      };
    }

    if (accessVerification.status === "invalid" && !hasDevRefreshToken) {
      return {
        authenticated: false,
        clearSession: true,
        session: null,
        transientFailure: false
      };
    }
  }

  if (!hasDevRefreshToken) {
    return {
      authenticated: false,
      clearSession: true,
      session: null,
      transientFailure: false
    };
  }

  const refreshVerification = await verifyDevAuthToken(refreshToken, "refresh", config);
  if (refreshVerification.status !== "valid") {
    return {
      authenticated: false,
      clearSession: true,
      session: null,
      transientFailure: false
    };
  }

  const profile = await resolveProfileFromTokenClaims(refreshVerification.payload, {
    userProfilesRepository
  });
  return {
    authenticated: true,
    profile,
    clearSession: false,
    session: await createDevAuthSession(profile, config),
    transientFailure: false
  };
}

export {
  authenticateDevAuthRequest,
  createDevAuthSession,
  isDevAuthToken,
  resolveDevAuthConfig,
  resolveDevAuthProfile
};
