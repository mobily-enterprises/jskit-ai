import { AppError } from "@jskit-ai/kernel/server/runtime/errors";
import { normalizeRecordId } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeEmail } from "@jskit-ai/auth-core/server/utils";
import { loadJose, isExpiredJwtError } from "./authJwt.js";

const DEV_AUTH_TOKEN_PREFIX = "jskit-dev.";
const DEV_AUTH_ISSUER = "jskit:dev-auth";
const DEFAULT_DEV_AUTH_ACCESS_TTL_SECONDS = 60 * 60 * 12;
const DEFAULT_DEV_AUTH_REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();

function parseBoolean(value, fallback = false) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }
  return fallback;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function normalizeRequestHostname(request) {
  const hostHeader = String(request?.headers?.host || "").trim();
  if (!hostHeader) {
    return "";
  }

  const firstHost = hostHeader.split(",")[0]?.trim();
  if (!firstHost) {
    return "";
  }

  try {
    return new URL(`http://${firstHost}`).hostname.trim().toLowerCase();
  } catch {
    return firstHost
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(":")[0]
      .trim()
      .toLowerCase();
  }
}

function resolveDirectRemoteAddress(request) {
  return String(request?.socket?.remoteAddress || request?.raw?.socket?.remoteAddress || "").trim();
}

function normalizeLoopbackIp(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/^::ffff:/, "");
}

function isLoopbackIp(value) {
  const normalized = normalizeLoopbackIp(value);
  return normalized === "::1" || normalized === "127.0.0.1" || normalized.startsWith("127.");
}

function isLoopbackHostname(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "127.0.0.1"
  );
}

function isLocalDevAuthRequest(request) {
  return (
    isLoopbackIp(resolveDirectRemoteAddress(request)) &&
    isLoopbackHostname(normalizeRequestHostname(request))
  );
}

function isDevAuthToken(token) {
  return String(token || "").trim().startsWith(DEV_AUTH_TOKEN_PREFIX);
}

function stripDevAuthTokenPrefix(token) {
  return String(token || "").trim().slice(DEV_AUTH_TOKEN_PREFIX.length);
}

function resolveDevAuthConfig({
  enabled = false,
  secret = "",
  nodeEnv = "development",
  jwtAudience = "authenticated",
  accessTtlSeconds = DEFAULT_DEV_AUTH_ACCESS_TTL_SECONDS,
  refreshTtlSeconds = DEFAULT_DEV_AUTH_REFRESH_TTL_SECONDS
} = {}) {
  return Object.freeze({
    enabled: parseBoolean(enabled, false),
    secret: String(secret || "").trim(),
    isProduction: String(nodeEnv || "development").trim().toLowerCase() === "production",
    jwtAudience: String(jwtAudience || "authenticated").trim() || "authenticated",
    accessTtlSeconds: normalizePositiveInteger(accessTtlSeconds, DEFAULT_DEV_AUTH_ACCESS_TTL_SECONDS),
    refreshTtlSeconds: normalizePositiveInteger(refreshTtlSeconds, DEFAULT_DEV_AUTH_REFRESH_TTL_SECONDS)
  });
}

function assertDevAuthBootstrapConfig(config, { usersRepository = null } = {}) {
  if (!config?.enabled) {
    return;
  }

  if (config.isProduction) {
    throw new Error("AUTH_DEV_BYPASS_ENABLED must not be enabled in production.");
  }
  if (!config.secret) {
    throw new Error("AUTH_DEV_BYPASS_SECRET is required when AUTH_DEV_BYPASS_ENABLED=true.");
  }
  if (!usersRepository || typeof usersRepository.findById !== "function" || typeof usersRepository.findByEmail !== "function") {
    throw new Error(
      "Dev auth bootstrap requires usersRepository with findById() and findByEmail() when AUTH_DEV_BYPASS_ENABLED=true."
    );
  }
}

function ensureDevAuthBootstrapAvailable(config, request) {
  if (!config?.enabled || config?.isProduction) {
    throw new AppError(404, "Not found.");
  }
  if (!config.secret) {
    throw new AppError(500, "AUTH_DEV_BYPASS_SECRET is required when AUTH_DEV_BYPASS_ENABLED=true.");
  }
  if (!isLocalDevAuthRequest(request)) {
    throw new AppError(403, "Dev auth bootstrap is only available from localhost.");
  }
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

async function resolveProfileFromTokenClaims(payload, { usersRepository = null } = {}) {
  const userId = normalizeRecordId(payload?.sub, { fallback: null });
  if (userId && usersRepository && typeof usersRepository.findById === "function") {
    const latest = await usersRepository.findById(userId);
    if (latest?.id) {
      return latest;
    }
  }

  const profile = buildProfileFromTokenClaims(payload);
  if (profile) {
    return profile;
  }

  throw new AppError(401, "Dev session is invalid.");
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

async function resolveDevAuthProfile(input = {}, { usersRepository = null, validationError } = {}) {
  if (!usersRepository || typeof usersRepository.findById !== "function") {
    throw new AppError(500, "Dev auth bootstrap requires usersRepository.findById().");
  }

  const normalizedUserId = normalizeRecordId(input?.userId, { fallback: null });
  const normalizedEmail = normalizeEmail(input?.email || "");
  if (!normalizedUserId && !normalizedEmail) {
    throw validationError({
      userId: "Provide a user id or email.",
      email: "Provide a user id or email."
    });
  }

  const fieldErrors = {};

  if (normalizedUserId) {
    const byId = await usersRepository.findById(normalizedUserId);
    if (byId?.id) {
      return byId;
    }
    fieldErrors.userId = "User not found.";
  }

  if (normalizedEmail) {
    if (typeof usersRepository.findByEmail !== "function") {
      throw new AppError(500, "Dev auth bootstrap requires usersRepository.findByEmail() for email lookup.");
    }

    const byEmail = await usersRepository.findByEmail(normalizedEmail);
    if (byEmail?.id) {
      return byEmail;
    }
    fieldErrors.email = "User not found.";
  }

  throw validationError(fieldErrors);
}

async function authenticateDevAuthRequest(
  { request, accessToken = "", refreshToken = "" },
  { config, usersRepository = null } = {}
) {
  const hasDevAccessToken = isDevAuthToken(accessToken);
  const hasDevRefreshToken = isDevAuthToken(refreshToken);
  if (!hasDevAccessToken && !hasDevRefreshToken) {
    return null;
  }

  if (!config?.enabled || config?.isProduction || !config?.secret || !isLocalDevAuthRequest(request)) {
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
        usersRepository
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
    usersRepository
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
  assertDevAuthBootstrapConfig,
  authenticateDevAuthRequest,
  createDevAuthSession,
  ensureDevAuthBootstrapAvailable,
  isDevAuthToken,
  resolveDevAuthConfig,
  resolveDevAuthProfile
};
