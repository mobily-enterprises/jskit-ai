function normalizeAllowedOrigins(allowedOrigins = []) {
  const source = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
  const normalizedOrigins = [];

  for (const originValue of source) {
    const rawOrigin = String(originValue || "").trim();
    if (!rawOrigin) {
      continue;
    }

    try {
      const parsed = new URL(rawOrigin);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        continue;
      }
      const normalizedOrigin = parsed.origin;
      if (!normalizedOrigin || normalizedOrigins.includes(normalizedOrigin)) {
        continue;
      }
      normalizedOrigins.push(normalizedOrigin);
    } catch {
      continue;
    }
  }

  return normalizedOrigins;
}

function resolveAllowedReturnToOriginsFromPlacementContext(contextValue = null) {
  const resolvedOrigins = [];

  if (typeof window === "object" && window?.location?.origin) {
    const windowOrigin = normalizeAllowedOrigins(window.location.origin);
    if (windowOrigin.length > 0) {
      resolvedOrigins.push(...windowOrigin);
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
    const origins = normalizeAllowedOrigins(surfaceDefinition.origin);
    for (const origin of origins) {
      if (!resolvedOrigins.includes(origin)) {
        resolvedOrigins.push(origin);
      }
    }
  }

  return resolvedOrigins;
}

function isAuthLoopPath(pathname = "") {
  const normalizedPathname = String(pathname || "")
    .split("?")[0]
    .split("#")[0]
    .replace(/\/{2,}/g, "/")
    .replace(/\/+$/, "") || "/";
  return normalizedPathname === "/auth/login" || normalizedPathname === "/auth/signout";
}

function normalizeAuthReturnToPath(value, fallback = "/", { allowedOrigins = [] } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }

  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    if (isAuthLoopPath(normalized)) {
      return fallback;
    }
    return normalized;
  }

  let parsed;
  try {
    parsed = new URL(normalized);
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

  if (isAuthLoopPath(parsed.pathname)) {
    return fallback;
  }

  return parsed.toString();
}

export { normalizeAuthReturnToPath, resolveAllowedReturnToOriginsFromPlacementContext };
