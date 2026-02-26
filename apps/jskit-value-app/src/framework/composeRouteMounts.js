import { urlMountOverrides } from "../../config/urls.js";
import { listClientRouteMounts } from "./routeMountRegistry.js";

const RESERVED_ROUTE_MOUNT_PATHS = Object.freeze({
  app: Object.freeze(["/", "/choice-2"]),
  admin: Object.freeze(["/", "/settings", "/admin", "/billing", "/transcripts", "/choice-2"]),
  console: Object.freeze(["/"])
});

function normalizePath(pathValue) {
  const normalized = String(pathValue || "").trim();
  if (!normalized) {
    throw new TypeError("Route mount path must be a non-empty string.");
  }

  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const squashed = withLeadingSlash.replace(/\/+/g, "/");
  if (squashed.length > 1 && squashed.endsWith("/")) {
    return squashed.slice(0, -1);
  }

  return squashed || "/";
}

function normalizeString(value) {
  return String(value || "").trim();
}

function resolveActiveClientModules(enabledModuleIds) {
  const routeMounts = listClientRouteMounts();
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return routeMounts;
  }

  const enabledSet = new Set(enabledModuleIds.map((entry) => normalizeString(entry)).filter(Boolean));
  return routeMounts.filter((entry) => enabledSet.has(entry.moduleId));
}

function composeSurfaceRouteMounts(surface, { enabledModuleIds, mountOverrides = urlMountOverrides } = {}) {
  const normalizedSurface = normalizeString(surface).toLowerCase();
  const mountsByKey = {};
  const pathClaims = new Map();
  const keyClaims = new Map();
  const reservedPaths = new Set(
    (Array.isArray(RESERVED_ROUTE_MOUNT_PATHS[normalizedSurface]) ? RESERVED_ROUTE_MOUNT_PATHS[normalizedSurface] : []).map(
      normalizePath
    )
  );

  for (const contribution of resolveActiveClientModules(enabledModuleIds)) {
    if (!contribution || typeof contribution !== "object") {
      continue;
    }
    if (normalizeString(contribution.surface).toLowerCase() !== normalizedSurface) {
      continue;
    }

    const key = normalizeString(contribution.key);
    if (!key) {
      continue;
    }

    if (keyClaims.has(key)) {
      throw new Error(
        `Duplicate route mount key "${key}" on surface "${normalizedSurface}" (modules "${keyClaims.get(key)}" and "${contribution.moduleId}").`
      );
    }

    const defaultPath = normalizePath(contribution.defaultPath);
    const allowOverride = contribution.allowOverride !== false;
    const rawOverride =
      mountOverrides && typeof mountOverrides === "object" && Object.hasOwn(mountOverrides, key)
        ? mountOverrides[key]
        : null;
    const hasOverride = normalizeString(rawOverride).length > 0;
    if (hasOverride && !allowOverride) {
      throw new Error(`Route mount "${key}" does not allow overrides.`);
    }

    const path = hasOverride ? normalizePath(rawOverride) : defaultPath;
    if (reservedPaths.has(path)) {
      throw new Error(`Route mount "${key}" resolved to reserved path "${path}" on surface "${normalizedSurface}".`);
    }

    const existingPathClaim = pathClaims.get(path);
    if (existingPathClaim && existingPathClaim !== key) {
      throw new Error(
        `Route mount path collision on surface "${normalizedSurface}": "${path}" claimed by "${existingPathClaim}" and "${key}".`
      );
    }

    keyClaims.set(key, contribution.moduleId);
    pathClaims.set(path, key);

    mountsByKey[key] = Object.freeze({
      key,
      moduleId: contribution.moduleId,
      surface: normalizedSurface,
      defaultPath,
      path,
      allowOverride
    });
  }

  const mounts = Object.freeze(
    Object.values(mountsByKey).sort((left, right) => left.path.localeCompare(right.path) || left.key.localeCompare(right.key))
  );
  const paths = {};
  for (const [path, key] of pathClaims.entries()) {
    paths[path] = key;
  }

  return Object.freeze({
    surface: normalizedSurface,
    mounts,
    mountsByKey: Object.freeze(mountsByKey),
    paths: Object.freeze(paths)
  });
}

function resolveRouteMountPathByKey(surface, mountKey, options = {}) {
  const normalizedMountKey = normalizeString(mountKey);
  const fallbackPath = normalizeString(options?.fallbackPath);
  if (!normalizedMountKey) {
    if (fallbackPath) {
      return normalizePath(fallbackPath);
    }
    throw new TypeError("Route mount key is required.");
  }

  const mount = composeSurfaceRouteMounts(surface, options).mountsByKey[normalizedMountKey];
  if (mount) {
    return mount.path;
  }

  if (fallbackPath) {
    return normalizePath(fallbackPath);
  }

  if (options?.required === false) {
    return "";
  }

  throw new Error(`Route mount "${normalizedMountKey}" is not defined for surface "${surface}".`);
}

const __testables = {
  normalizePath
};

export {
  composeSurfaceRouteMounts,
  resolveRouteMountPathByKey,
  __testables
};
