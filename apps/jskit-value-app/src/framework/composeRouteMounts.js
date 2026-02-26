import { urlMountAliasOverrides, urlMountOverrides } from "../../config/urls.js";
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

function normalizeAliasList(aliasValues, fallbackPath) {
  const aliases = [];
  const seenAliases = new Set();

  for (const aliasValue of Array.isArray(aliasValues) ? aliasValues : []) {
    const normalizedAlias = normalizePath(aliasValue);
    if (normalizedAlias === fallbackPath || seenAliases.has(normalizedAlias)) {
      continue;
    }
    seenAliases.add(normalizedAlias);
    aliases.push(normalizedAlias);
  }

  return aliases;
}

function composeSurfaceRouteMounts(
  surface,
  {
    enabledModuleIds,
    mountOverrides = urlMountOverrides,
    mountAliasOverrides = urlMountAliasOverrides
  } = {}
) {
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

    const routeAliases = normalizeAliasList(
      [
        ...(path !== defaultPath ? [defaultPath] : []),
        ...(Array.isArray(contribution.aliases) ? contribution.aliases : []),
        ...(Array.isArray(mountAliasOverrides?.[key]) ? mountAliasOverrides[key] : [])
      ],
      path
    );

    for (const alias of routeAliases) {
      if (reservedPaths.has(alias)) {
        throw new Error(`Route mount alias "${alias}" for "${key}" is reserved on surface "${normalizedSurface}".`);
      }

      const existingAliasClaim = pathClaims.get(alias);
      if (existingAliasClaim && existingAliasClaim !== key) {
        throw new Error(
          `Route mount alias collision on surface "${normalizedSurface}": "${alias}" claimed by "${existingAliasClaim}" and "${key}".`
        );
      }
    }

    keyClaims.set(key, contribution.moduleId);
    pathClaims.set(path, key);
    for (const alias of routeAliases) {
      pathClaims.set(alias, key);
    }

    mountsByKey[key] = Object.freeze({
      key,
      moduleId: contribution.moduleId,
      surface: normalizedSurface,
      defaultPath,
      path,
      allowOverride,
      aliases: Object.freeze(routeAliases)
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

function resolveRouteMountAliasesByKey(surface, mountKey, options = {}) {
  const normalizedMountKey = normalizeString(mountKey);
  if (!normalizedMountKey) {
    return Object.freeze([]);
  }

  const mount = composeSurfaceRouteMounts(surface, options).mountsByKey[normalizedMountKey];
  return Object.freeze(mount ? [...mount.aliases] : []);
}

const __testables = {
  normalizePath,
  normalizeAliasList
};

export {
  composeSurfaceRouteMounts,
  resolveRouteMountPathByKey,
  resolveRouteMountAliasesByKey,
  __testables
};
