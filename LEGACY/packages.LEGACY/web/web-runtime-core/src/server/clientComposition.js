function normalizeString(value) {
  return String(value || "").trim();
}

function normalizePath(pathValue) {
  const normalized = normalizeString(pathValue);
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

function normalizePathname(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return "/";
  }

  const withoutTrailingSlash = normalized !== "/" ? normalized.replace(/\/+$/, "") : "/";
  return withoutTrailingSlash || "/";
}

function normalizeMountPathSuffix(value) {
  const normalized = normalizeString(value);
  if (!normalized || normalized === "/") {
    return "";
  }

  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+/g, "/").replace(/\/+$/, "");
}

function joinMountPath(basePath, suffix = "") {
  const normalizedBasePath = normalizePathname(basePath);
  const normalizedSuffix = normalizeMountPathSuffix(suffix);
  if (!normalizedSuffix) {
    return normalizedBasePath;
  }

  if (normalizedBasePath === "/") {
    return normalizedSuffix;
  }

  return normalizePathname(`${normalizedBasePath}${normalizedSuffix}`);
}

function resolveActiveClientModules(moduleRegistry = [], enabledModuleIds) {
  const modules = Array.isArray(moduleRegistry) ? moduleRegistry : [];
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return modules;
  }

  const enabledSet = new Set(enabledModuleIds.map((entry) => normalizeString(entry)).filter(Boolean));
  return modules.filter((entry) => enabledSet.has(normalizeString(entry?.id)));
}

function composeClientApiFromModules({
  moduleRegistry = [],
  request,
  requestStream,
  clearCsrfTokenCache,
  enabledModuleIds
} = {}) {
  if (typeof request !== "function") {
    throw new TypeError("composeClientApiFromModules requires request function.");
  }

  const api = {};
  for (const moduleEntry of resolveActiveClientModules(moduleRegistry, enabledModuleIds)) {
    const apiDefinition = moduleEntry?.client?.api;
    if (!apiDefinition || typeof apiDefinition !== "object") {
      continue;
    }

    const key = normalizeString(apiDefinition.key);
    if (!key) {
      continue;
    }

    if (Object.hasOwn(api, key)) {
      throw new Error(`Duplicate client API key "${key}" in module registry.`);
    }
    if (typeof apiDefinition.createApi !== "function") {
      throw new TypeError(`Client API definition for key "${key}" must define createApi().`);
    }

    api[key] = apiDefinition.createApi({
      request,
      requestStream
    });
  }

  if (typeof clearCsrfTokenCache === "function") {
    api.clearCsrfTokenCache = clearCsrfTokenCache;
  }

  return api;
}

function composeGuardPoliciesFromModules({ moduleRegistry = [], enabledModuleIds } = {}) {
  const policies = {};

  for (const moduleEntry of resolveActiveClientModules(moduleRegistry, enabledModuleIds)) {
    const guardPolicies =
      moduleEntry?.client?.guardPolicies && typeof moduleEntry.client.guardPolicies === "object"
        ? moduleEntry.client.guardPolicies
        : null;
    if (!guardPolicies) {
      continue;
    }

    for (const [policyId, policy] of Object.entries(guardPolicies)) {
      const normalizedPolicyId = normalizeString(policyId);
      if (!normalizedPolicyId) {
        continue;
      }
      if (Object.hasOwn(policies, normalizedPolicyId)) {
        throw new Error(`Duplicate guard policy "${normalizedPolicyId}" in client module registry.`);
      }

      policies[normalizedPolicyId] = Object.freeze({
        ...(policy && typeof policy === "object" ? policy : {}),
        moduleId: moduleEntry.id
      });
    }
  }

  return Object.freeze(policies);
}

function composeRealtimeTopicContributionsFromModules({ moduleRegistry = [], enabledModuleIds } = {}) {
  const topicsByModule = {};
  const allTopics = new Set();

  for (const moduleEntry of resolveActiveClientModules(moduleRegistry, enabledModuleIds)) {
    const topics = (Array.isArray(moduleEntry?.client?.realtimeTopics) ? moduleEntry.client.realtimeTopics : [])
      .map((entry) => normalizeString(entry))
      .filter(Boolean);

    topicsByModule[moduleEntry.id] = topics;
    for (const topic of topics) {
      allTopics.add(topic);
    }
  }

  return {
    topics: Array.from(allTopics).sort((left, right) => left.localeCompare(right)),
    topicsByModule
  };
}

function composeRealtimeInvalidationDefinitionsFromModules({ moduleRegistry = [], enabledModuleIds } = {}) {
  const invalidationDefinitions = {};

  for (const moduleEntry of resolveActiveClientModules(moduleRegistry, enabledModuleIds)) {
    const contributions = moduleEntry?.client?.realtimeInvalidation;
    for (const contribution of Array.isArray(contributions) ? contributions : []) {
      if (!contribution || typeof contribution !== "object") {
        continue;
      }

      const topic = normalizeString(contribution.topic);
      const invalidatorId = normalizeString(contribution.invalidatorId);
      if (!topic || !invalidatorId) {
        continue;
      }

      if (Object.hasOwn(invalidationDefinitions, topic)) {
        throw new Error(`Duplicate realtime invalidation strategy for topic "${topic}".`);
      }

      invalidationDefinitions[topic] = Object.freeze({
        topic,
        invalidatorId,
        refreshBootstrap: Boolean(contribution.refreshBootstrap),
        refreshConsoleBootstrap: Boolean(contribution.refreshConsoleBootstrap),
        moduleId: moduleEntry.id
      });
    }
  }

  return Object.freeze(invalidationDefinitions);
}

function composeSurfaceRouteMountsFromContributions({
  routeMountContributions = [],
  surface,
  enabledModuleIds,
  mountOverrides = {},
  reservedPathsBySurface = {}
} = {}) {
  const normalizedSurface = normalizeString(surface).toLowerCase();
  const mountsByKey = {};
  const pathClaims = new Map();
  const keyClaims = new Map();
  const reservedPaths = new Set(
    (Array.isArray(reservedPathsBySurface[normalizedSurface]) ? reservedPathsBySurface[normalizedSurface] : []).map(
      normalizePath
    )
  );

  for (const contribution of resolveActiveClientModules(routeMountContributions, enabledModuleIds)) {
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
      mountOverrides && typeof mountOverrides === "object" && Object.hasOwn(mountOverrides, key) ? mountOverrides[key] : null;
    const hasOverride = normalizeString(rawOverride).length > 0;
    if (hasOverride && !allowOverride) {
      throw new Error(`Route mount "${key}" does not allow overrides.`);
    }

    const resolvedPath = hasOverride ? normalizePath(rawOverride) : defaultPath;
    if (reservedPaths.has(resolvedPath)) {
      throw new Error(`Route mount "${key}" resolved to reserved path "${resolvedPath}" on surface "${normalizedSurface}".`);
    }

    const existingPathClaim = pathClaims.get(resolvedPath);
    if (existingPathClaim && existingPathClaim !== key) {
      throw new Error(
        `Route mount path collision on surface "${normalizedSurface}": "${resolvedPath}" claimed by "${existingPathClaim}" and "${key}".`
      );
    }

    keyClaims.set(key, contribution.moduleId);
    pathClaims.set(resolvedPath, key);
    mountsByKey[key] = Object.freeze({
      key,
      moduleId: contribution.moduleId,
      surface: normalizedSurface,
      defaultPath,
      path: resolvedPath,
      allowOverride
    });
  }

  const mounts = Object.freeze(
    Object.values(mountsByKey).sort((left, right) => left.path.localeCompare(right.path) || left.key.localeCompare(right.key))
  );
  const paths = {};
  for (const [pathValue, key] of pathClaims.entries()) {
    paths[pathValue] = key;
  }

  return Object.freeze({
    surface: normalizedSurface,
    mounts,
    mountsByKey: Object.freeze(mountsByKey),
    paths: Object.freeze(paths)
  });
}

function resolveRouteMountPathByKey({
  surface,
  mountKey,
  composeRouteMounts,
  fallbackPath = "",
  required = true
} = {}) {
  if (typeof composeRouteMounts !== "function") {
    throw new TypeError("resolveRouteMountPathByKey requires composeRouteMounts.");
  }

  const normalizedMountKey = normalizeString(mountKey);
  const normalizedFallbackPath = normalizeString(fallbackPath);
  if (!normalizedMountKey) {
    if (normalizedFallbackPath) {
      return normalizePath(normalizedFallbackPath);
    }
    throw new TypeError("Route mount key is required.");
  }

  const mount = composeRouteMounts(surface).mountsByKey[normalizedMountKey];
  if (mount) {
    return mount.path;
  }
  if (normalizedFallbackPath) {
    return normalizePath(normalizedFallbackPath);
  }
  if (!required) {
    return "";
  }

  throw new Error(`Route mount "${normalizedMountKey}" is not defined for surface "${surface}".`);
}

function composeSurfaceRouterOptionsFromModules({
  moduleRegistry = [],
  surface,
  enabledModuleIds,
  defaultsBySurface = {}
} = {}) {
  const normalizedSurface = normalizeString(surface).toLowerCase();
  const baseDefaults = defaultsBySurface[normalizedSurface] || defaultsBySurface.default || {};
  const base = { ...baseDefaults };

  for (const moduleEntry of resolveActiveClientModules(moduleRegistry, enabledModuleIds)) {
    const contribution = moduleEntry?.client?.router?.[normalizedSurface];
    if (!contribution || typeof contribution !== "object") {
      continue;
    }
    for (const [key, value] of Object.entries(contribution)) {
      if (!Object.hasOwn(base, key)) {
        continue;
      }
      base[key] = Boolean(value);
    }
  }

  return base;
}

function composeSurfaceRouteFragmentsFromModules({
  moduleRegistry = [],
  surface,
  enabledModuleIds,
  routeMounts
} = {}) {
  const normalizedSurface = normalizeString(surface).toLowerCase();
  const fragments = [];
  const claimedFragmentIds = new Set();

  for (const moduleEntry of resolveActiveClientModules(moduleRegistry, enabledModuleIds)) {
    const contributedFragments = moduleEntry?.client?.routeFragments?.[normalizedSurface];
    for (const contribution of Array.isArray(contributedFragments) ? contributedFragments : []) {
      if (!contribution || typeof contribution !== "object") {
        continue;
      }

      const id = normalizeString(contribution.id);
      if (!id) {
        continue;
      }
      if (claimedFragmentIds.has(id)) {
        throw new Error(`Duplicate client route fragment "${id}" on surface "${normalizedSurface}".`);
      }
      if (typeof contribution.createRoutes !== "function") {
        throw new TypeError(`Route fragment "${id}" must define createRoutes().`);
      }

      const mountKey = normalizeString(contribution.mountKey);
      const mount = mountKey && routeMounts?.mountsByKey ? routeMounts.mountsByKey[mountKey] : null;
      if (mountKey && !mount) {
        throw new Error(`Route fragment "${id}" requires unknown route mount "${mountKey}" on surface "${normalizedSurface}".`);
      }

      const baseOptions =
        contribution.options && typeof contribution.options === "object" && !Array.isArray(contribution.options)
          ? { ...contribution.options }
          : {};

      if (mount) {
        baseOptions.mountKey = mount.key;
        baseOptions.mountPath = mount.path;
      }

      claimedFragmentIds.add(id);
      fragments.push(
        Object.freeze({
          id,
          order: Number.isFinite(contribution.order) ? Number(contribution.order) : 100,
          createRoutes: contribution.createRoutes,
          options: Object.freeze(baseOptions)
        })
      );
    }
  }

  return Object.freeze(fragments.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)));
}

function composeNavigationFragmentsFromModules({
  moduleRegistry = [],
  surface,
  enabledModuleIds,
  routeMounts
} = {}) {
  const normalizedSurface = normalizeString(surface).toLowerCase();
  const fragments = [];

  for (const moduleEntry of resolveActiveClientModules(moduleRegistry, enabledModuleIds)) {
    const contributions = moduleEntry?.client?.navigation?.[normalizedSurface];
    for (const contribution of Array.isArray(contributions) ? contributions : []) {
      const mountKey = normalizeString(contribution?.mountKey);
      const mount = mountKey && routeMounts?.mountsByKey ? routeMounts.mountsByKey[mountKey] : null;
      if (mountKey && !mount) {
        throw new Error(
          `Navigation fragment "${normalizeString(contribution?.id)}" requires unknown mount "${mountKey}" on "${normalizedSurface}".`
        );
      }

      const mountPathSuffix = normalizeMountPathSuffix(contribution?.mountPathSuffix);
      const path = mount ? joinMountPath(mount.path, mountPathSuffix) : contribution?.path;
      fragments.push({
        ...contribution,
        path,
        moduleId: moduleEntry.id
      });
    }
  }

  return fragments;
}

function isPathMatch(pathname, targetPath) {
  const normalizedPathname = normalizePathname(pathname);
  const normalizedTargetPath = normalizePathname(targetPath);
  if (normalizedTargetPath === "/") {
    return normalizedPathname === "/";
  }

  return normalizedPathname === normalizedTargetPath || normalizedPathname.startsWith(`${normalizedTargetPath}/`);
}

function resolveNavigationDestinationTitle(pathname, navigationItems) {
  const items = (Array.isArray(navigationItems) ? navigationItems : [])
    .filter((entry) => entry && typeof entry === "object")
    .sort((left, right) => normalizePathname(right.to).length - normalizePathname(left.to).length);

  for (const item of items) {
    if (isPathMatch(pathname, item.to)) {
      const destinationTitle = normalizeString(item.destinationTitle || item.title);
      if (destinationTitle) {
        return destinationTitle;
      }
    }
  }

  return "";
}

const __testables = {
  normalizePath,
  normalizePathname,
  normalizeMountPathSuffix,
  joinMountPath
};

export {
  resolveActiveClientModules,
  composeClientApiFromModules,
  composeGuardPoliciesFromModules,
  composeRealtimeTopicContributionsFromModules,
  composeRealtimeInvalidationDefinitionsFromModules,
  composeSurfaceRouteMountsFromContributions,
  resolveRouteMountPathByKey,
  composeSurfaceRouterOptionsFromModules,
  composeSurfaceRouteFragmentsFromModules,
  composeNavigationFragmentsFromModules,
  resolveNavigationDestinationTitle,
  __testables
};
