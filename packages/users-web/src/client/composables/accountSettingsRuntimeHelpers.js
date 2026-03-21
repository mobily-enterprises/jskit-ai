import { ACCOUNT_SETTINGS_DEFAULTS } from "./accountSettingsRuntimeConstants.js";

function normalizeReturnToPath(value, { fallback = "/", accountSettingsPath = "/account/settings", allowedOrigins = [] } = {}) {
  const source = Array.isArray(value) ? value[0] : value;
  const rawValue = String(source || "").trim();
  if (!rawValue) {
    return fallback;
  }

  const normalizedAccountPathname =
    String(accountSettingsPath || "")
      .split("?")[0]
      .split("#")[0]
      .replace(/\/{2,}/g, "/")
      .replace(/\/+$/, "") || "/";

  if (rawValue.startsWith("/") && !rawValue.startsWith("//")) {
    const normalizedPathname = rawValue.split("?")[0].split("#")[0].replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    if (normalizedPathname === normalizedAccountPathname) {
      return fallback;
    }
    return rawValue;
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    return fallback;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return fallback;
  }

  if (allowedOrigins.length > 0 && !allowedOrigins.includes(parsed.origin)) {
    return fallback;
  }

  const normalizedPathname = String(parsed.pathname || "").replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
  if (normalizedPathname === normalizedAccountPathname) {
    return fallback;
  }

  return parsed.toString();
}

function normalizeHttpOrigin(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) {
    return "";
  }

  try {
    const parsed = new URL(rawValue);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return parsed.origin;
  } catch {
    return "";
  }
}

function resolveAllowedReturnToOrigins(contextValue = null) {
  const resolvedOrigins = [];

  if (typeof window === "object" && window?.location?.origin) {
    const currentOrigin = normalizeHttpOrigin(window.location.origin);
    if (currentOrigin) {
      resolvedOrigins.push(currentOrigin);
    }
  }

  const surfaceConfig =
    contextValue && typeof contextValue === "object" && contextValue.surfaceConfig && typeof contextValue.surfaceConfig === "object"
      ? contextValue.surfaceConfig
      : {};
  const surfacesById =
    surfaceConfig.surfacesById && typeof surfaceConfig.surfacesById === "object" ? surfaceConfig.surfacesById : {};

  for (const definition of Object.values(surfacesById)) {
    if (!definition || typeof definition !== "object") {
      continue;
    }
    const surfaceOrigin = normalizeHttpOrigin(definition.origin);
    if (!surfaceOrigin || resolvedOrigins.includes(surfaceOrigin)) {
      continue;
    }
    resolvedOrigins.push(surfaceOrigin);
  }

  return resolvedOrigins;
}

function normalizeSettingsPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizePendingInvite(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = Number(entry.id);
  const workspaceId = Number(entry.workspaceId);
  if (!Number.isInteger(id) || id < 1 || !Number.isInteger(workspaceId) || workspaceId < 1) {
    return null;
  }

  const workspaceSlug = String(entry.workspaceSlug || "").trim();
  if (!workspaceSlug) {
    return null;
  }

  const token = String(entry.token || "").trim();
  if (!token) {
    return null;
  }

  return {
    id,
    token,
    workspaceId,
    workspaceSlug,
    workspaceName: String(entry.workspaceName || workspaceSlug).trim() || workspaceSlug,
    roleId: String(entry.roleId || "member").trim().toLowerCase() || "member",
    status: String(entry.status || "pending").trim().toLowerCase() || "pending",
    expiresAt: String(entry.expiresAt || "").trim()
  };
}

function normalizeAvatarSize(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    return ACCOUNT_SETTINGS_DEFAULTS.preferences.avatarSize;
  }

  const clamped = Math.min(128, Math.max(32, numeric));
  return clamped;
}

function resolveErrorStatusCode(error) {
  const statusCode = Number(error?.statusCode || error?.status || 0);
  return Number.isInteger(statusCode) && statusCode > 0 ? statusCode : 0;
}

export {
  resolveAllowedReturnToOrigins,
  normalizeAvatarSize,
  normalizeHttpOrigin,
  normalizePendingInvite,
  normalizeReturnToPath,
  normalizeSettingsPayload,
  resolveErrorStatusCode
};
