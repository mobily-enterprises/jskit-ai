function normalizePrefix(prefixLike) {
  const rawPrefix = String(prefixLike || "").trim();
  if (!rawPrefix || rawPrefix === "/") {
    return "";
  }

  const withLeadingSlash = rawPrefix.startsWith("/") ? rawPrefix : `/${rawPrefix}`;
  const squashed = withLeadingSlash.replace(/\/{2,}/g, "/");
  const withoutTrailingSlash = squashed.replace(/\/+$/, "");
  return withoutTrailingSlash === "/" ? "" : withoutTrailingSlash;
}

function createSurfaceRegistry(options = {}) {
  const rawSurfaces = options?.surfaces;
  if (!rawSurfaces || typeof rawSurfaces !== "object") {
    throw new Error("createSurfaceRegistry requires a surfaces object.");
  }

  const normalizedEntries = Object.entries(rawSurfaces)
    .map(([key, value]) => {
      const normalizedId = String(value?.id || key || "")
        .trim()
        .toLowerCase();
      if (!normalizedId) {
        return null;
      }

      return [
        normalizedId,
        Object.freeze({
          id: normalizedId,
          prefix: normalizePrefix(value?.prefix),
          requiresWorkspace: Boolean(value?.requiresWorkspace)
        })
      ];
    })
    .filter(Boolean);

  if (normalizedEntries.length < 1) {
    throw new Error("createSurfaceRegistry requires at least one surface definition.");
  }

  const SURFACE_REGISTRY = Object.freeze(Object.fromEntries(normalizedEntries));
  const fallbackSurfaceId = normalizedEntries[0][0];
  const requestedDefaultSurfaceId = String(options?.defaultSurfaceId || "")
    .trim()
    .toLowerCase();
  const DEFAULT_SURFACE_ID = SURFACE_REGISTRY[requestedDefaultSurfaceId]
    ? requestedDefaultSurfaceId
    : fallbackSurfaceId;

  function normalizeSurfaceId(value) {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();
    if (SURFACE_REGISTRY[normalized]) {
      return normalized;
    }

    return DEFAULT_SURFACE_ID;
  }

  function resolveSurfacePrefix(surfaceId) {
    return SURFACE_REGISTRY[normalizeSurfaceId(surfaceId)]?.prefix || "";
  }

  function surfaceRequiresWorkspace(surfaceId) {
    return Boolean(SURFACE_REGISTRY[normalizeSurfaceId(surfaceId)]?.requiresWorkspace);
  }

  function listSurfaceDefinitions() {
    return Object.values(SURFACE_REGISTRY);
  }

  return Object.freeze({
    SURFACE_REGISTRY,
    DEFAULT_SURFACE_ID,
    normalizeSurfaceId,
    resolveSurfacePrefix,
    surfaceRequiresWorkspace,
    listSurfaceDefinitions
  });
}

export { createSurfaceRegistry };
