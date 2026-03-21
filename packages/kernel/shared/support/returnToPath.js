import { normalizePathname } from "../surface/paths.js";

function normalizeHttpOrigin(value = "") {
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

function normalizeAllowedOrigins(allowedOrigins = []) {
  const source = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
  const normalizedOrigins = [];

  for (const originValue of source) {
    const normalizedOrigin = normalizeHttpOrigin(originValue);
    if (!normalizedOrigin || normalizedOrigins.includes(normalizedOrigin)) {
      continue;
    }
    normalizedOrigins.push(normalizedOrigin);
  }

  return normalizedOrigins;
}

function normalizeBlockedPathnames(blockedPathnames = []) {
  const source = Array.isArray(blockedPathnames) ? blockedPathnames : [blockedPathnames];
  const normalizedPathnames = [];

  for (const pathnameValue of source) {
    const rawPathname = String(pathnameValue || "").trim();
    if (!rawPathname) {
      continue;
    }
    const normalizedPathname = normalizePathname(rawPathname);
    if (normalizedPathnames.includes(normalizedPathname)) {
      continue;
    }
    normalizedPathnames.push(normalizedPathname);
  }

  return normalizedPathnames;
}

function resolveAllowedOriginsFromPlacementContext(contextValue = null, { includeWindowOrigin = true } = {}) {
  const resolvedOrigins = [];

  if (includeWindowOrigin && typeof window === "object" && window?.location?.origin) {
    const windowOrigin = normalizeHttpOrigin(window.location.origin);
    if (windowOrigin) {
      resolvedOrigins.push(windowOrigin);
    }
  }

  const surfaceConfig =
    contextValue && typeof contextValue === "object" && contextValue.surfaceConfig && typeof contextValue.surfaceConfig === "object"
      ? contextValue.surfaceConfig
      : {};
  const surfacesById =
    surfaceConfig.surfacesById && typeof surfaceConfig.surfacesById === "object" ? surfaceConfig.surfacesById : {};

  for (const surfaceDefinition of Object.values(surfacesById)) {
    if (!surfaceDefinition || typeof surfaceDefinition !== "object") {
      continue;
    }

    const normalizedOrigin = normalizeHttpOrigin(surfaceDefinition.origin);
    if (!normalizedOrigin || resolvedOrigins.includes(normalizedOrigin)) {
      continue;
    }
    resolvedOrigins.push(normalizedOrigin);
  }

  return resolvedOrigins;
}

function normalizeReturnToPath(
  value,
  {
    fallback = "/",
    allowedOrigins = [],
    blockedPathnames = [],
    pickFirstArrayValue = false
  } = {}
) {
  const source = pickFirstArrayValue && Array.isArray(value) ? value[0] : value;
  const rawValue = String(source || "").trim();
  if (!rawValue) {
    return fallback;
  }

  const normalizedBlockedPathnames = normalizeBlockedPathnames(blockedPathnames);

  if (rawValue.startsWith("/") && !rawValue.startsWith("//")) {
    const normalizedPathname = normalizePathname(rawValue);
    if (normalizedBlockedPathnames.includes(normalizedPathname)) {
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

  const normalizedAllowedOrigins = normalizeAllowedOrigins(allowedOrigins);
  if (normalizedAllowedOrigins.length > 0 && !normalizedAllowedOrigins.includes(parsed.origin)) {
    return fallback;
  }

  const normalizedPathname = normalizePathname(parsed.pathname);
  if (normalizedBlockedPathnames.includes(normalizedPathname)) {
    return fallback;
  }

  return parsed.toString();
}

export {
  normalizeAllowedOrigins,
  normalizeHttpOrigin,
  normalizeReturnToPath,
  resolveAllowedOriginsFromPlacementContext
};
