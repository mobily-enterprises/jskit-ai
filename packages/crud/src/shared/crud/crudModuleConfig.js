import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import {
  resolveApiBasePath
} from "@jskit-ai/users-core/shared/support/usersApiPaths";
import {
  USERS_ROUTE_VISIBILITY_LEVELS,
  normalizeScopedRouteVisibility,
  isWorkspaceVisibility
} from "@jskit-ai/users-core/shared/support/usersVisibility";

const DEFAULT_OWNERSHIP_FILTER = "workspace";
const CRUD_REQUESTED_OWNERSHIP_FILTER_AUTO = "auto";
const CRUD_REQUESTED_OWNERSHIP_FILTER_SET = new Set([
  ...USERS_ROUTE_VISIBILITY_LEVELS,
  CRUD_REQUESTED_OWNERSHIP_FILTER_AUTO
]);
const CRUD_MODULE_ID = "crud";

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeCrudNamespace(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCrudOwnershipFilter(value, { fallback = DEFAULT_OWNERSHIP_FILTER } = {}) {
  return normalizeRouteVisibility(value, { fallback });
}

function normalizeCrudRequestedOwnershipFilter(value, { fallback = CRUD_REQUESTED_OWNERSHIP_FILTER_AUTO } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (CRUD_REQUESTED_OWNERSHIP_FILTER_SET.has(normalized)) {
    return normalized;
  }

  const normalizedFallback = normalizeText(fallback).toLowerCase();
  if (CRUD_REQUESTED_OWNERSHIP_FILTER_SET.has(normalizedFallback)) {
    return normalizedFallback;
  }

  return CRUD_REQUESTED_OWNERSHIP_FILTER_AUTO;
}

function requireCrudNamespace(namespace, { context = "CRUD config" } = {}) {
  const normalizedNamespace = normalizeCrudNamespace(namespace);
  if (!normalizedNamespace) {
    throw new TypeError(`${context} requires a non-empty namespace.`);
  }

  return normalizedNamespace;
}

function resolveCrudNamespacePath(namespace = "") {
  const normalizedNamespace = requireCrudNamespace(namespace, {
    context: "resolveCrudNamespacePath"
  });
  return `/${normalizedNamespace}`;
}

function resolveCrudRelativePath(namespace = "") {
  return resolveCrudNamespacePath(namespace);
}

function normalizeCrudRelativePath(relativePath = "", { context = "resolveCrudSurfacePolicy" } = {}) {
  const normalizedPath = normalizeText(relativePath);
  if (!normalizedPath) {
    throw new TypeError(`${context} requires a non-empty relativePath.`);
  }

  const withLeadingSlash = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
  const compacted = withLeadingSlash.replace(/\/{2,}/g, "/");
  return compacted === "/" ? "/" : compacted.replace(/\/+$/, "") || "/";
}

function resolveCrudApiBasePath({ namespace = "", surfaceRequiresWorkspace = false } = {}) {
  const relativePath = resolveCrudRelativePath(namespace);
  return resolveApiBasePath({
    surfaceRequiresWorkspace: surfaceRequiresWorkspace === true,
    relativePath
  });
}

function resolveCrudTableName(namespace = "") {
  const normalizedNamespace = requireCrudNamespace(namespace, {
    context: "resolveCrudTableName"
  });
  return `crud_${normalizedNamespace.replace(/-/g, "_")}`;
}

function resolveCrudTokenPart(namespace = "") {
  const normalizedNamespace = requireCrudNamespace(namespace, {
    context: "resolveCrudTokenPart"
  });
  return normalizedNamespace.replace(/-/g, "_");
}

function resolveCrudActionIdPrefix(namespace = "") {
  const tokenPart = resolveCrudTokenPart(namespace);
  return `crud.${tokenPart}`;
}

function resolveCrudContributorId(namespace = "") {
  const tokenPart = resolveCrudTokenPart(namespace);
  return `crud.${tokenPart}`;
}

function resolveCrudDomain(namespace = "") {
  return "crud";
}

function resolveCrudToken(namespace = "", suffix = "") {
  const contributorId = resolveCrudContributorId(namespace);
  return suffix ? `${contributorId}.${suffix}` : contributorId;
}

function resolveCrudConfig(source = {}) {
  const settings = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  const namespace = requireCrudNamespace(settings.namespace, {
    context: "resolveCrudConfig"
  });
  const ownershipFilter = normalizeCrudOwnershipFilter(settings.ownershipFilter);

  return Object.freeze({
    namespace,
    ownershipFilter,
    workspaceScoped: isWorkspaceVisibility(ownershipFilter),
    namespacePath: resolveCrudNamespacePath(namespace),
    relativePath: resolveCrudRelativePath(namespace),
    apiBasePath: resolveCrudApiBasePath({ namespace }),
    tableName: resolveCrudTableName(namespace),
    actionIdPrefix: resolveCrudActionIdPrefix(namespace),
    contributorId: resolveCrudContributorId(namespace),
    domain: resolveCrudDomain(namespace),
    repositoryToken: resolveCrudToken(namespace, "repository"),
    serviceToken: resolveCrudToken(namespace, "service")
  });
}

function normalizeSurfaceDefinitions(sourceDefinitions = {}) {
  const definitions = asRecord(sourceDefinitions);
  const normalized = {};

  for (const [key, value] of Object.entries(definitions)) {
    const definition = asRecord(value);
    const surfaceId = normalizeSurfaceId(definition.id || key);
    if (!surfaceId) {
      continue;
    }

    normalized[surfaceId] = Object.freeze({
      ...definition,
      id: surfaceId,
      enabled: definition.enabled !== false,
      requiresAuth: definition.requiresAuth === true,
      requiresWorkspace: definition.requiresWorkspace === true
    });
  }

  return Object.freeze(normalized);
}

function resolveOwnershipFilterFromSurfaceDefinition(definition = {}) {
  if (definition.requiresWorkspace === true) {
    return "workspace";
  }
  if (definition.requiresAuth === true) {
    return "user";
  }
  return "public";
}

function resolveCrudSurfacePolicy(
  sourceConfig = {},
  {
    surfaceDefinitions = {},
    defaultSurfaceId = "",
    context = "resolveCrudSurfacePolicy"
  } = {}
) {
  const config = asRecord(sourceConfig);
  const normalizedDefinitions = normalizeSurfaceDefinitions(surfaceDefinitions);
  const requestedSurfaceId = normalizeSurfaceId(config.surface);
  const fallbackSurfaceId = normalizeSurfaceId(defaultSurfaceId);
  const surfaceId = requestedSurfaceId || fallbackSurfaceId;
  if (!surfaceId) {
    throw new Error(`${context} requires surface or defaultSurfaceId.`);
  }

  const surfaceDefinition = normalizedDefinitions[surfaceId];
  if (!surfaceDefinition) {
    throw new Error(`${context} cannot resolve surface "${surfaceId}".`);
  }
  if (surfaceDefinition.enabled === false) {
    throw new Error(`${context} surface "${surfaceId}" is disabled.`);
  }

  const requestedOwnershipFilter = normalizeCrudRequestedOwnershipFilter(config.ownershipFilter);
  const ownershipFilter =
    requestedOwnershipFilter === CRUD_REQUESTED_OWNERSHIP_FILTER_AUTO
      ? resolveOwnershipFilterFromSurfaceDefinition(surfaceDefinition)
      : normalizeScopedRouteVisibility(requestedOwnershipFilter, {
          fallback: "public"
        });

  if (isWorkspaceVisibility(ownershipFilter) && surfaceDefinition.requiresWorkspace !== true) {
    throw new Error(
      `${context} ownershipFilter "${ownershipFilter}" requires a workspace-enabled surface.`
    );
  }

  const relativePath = normalizeCrudRelativePath(config.relativePath || resolveCrudRelativePath(config.namespace), {
    context
  });

  return Object.freeze({
    surfaceId,
    ownershipFilter,
    requestedOwnershipFilter,
    workspaceScoped: isWorkspaceVisibility(ownershipFilter),
    relativePath,
    surfaceDefinition
  });
}

function resolveCrudSurfacePolicyFromAppConfig(sourceConfig = {}, appConfig = {}, options = {}) {
  const config = asRecord(appConfig);
  return resolveCrudSurfacePolicy(sourceConfig, {
    ...asRecord(options),
    surfaceDefinitions: config.surfaceDefinitions,
    defaultSurfaceId: config.surfaceDefaultId
  });
}

function resolveCrudConfigsFromModules(modulesSource = {}) {
  const modules = modulesSource && typeof modulesSource === "object" && !Array.isArray(modulesSource)
    ? modulesSource
    : {};
  const configs = [];
  const seenContributorIds = new Set();

  for (const moduleConfig of Object.values(modules)) {
    const source = moduleConfig && typeof moduleConfig === "object" && !Array.isArray(moduleConfig)
      ? moduleConfig
      : {};

    if (normalizeText(source.module).toLowerCase() !== CRUD_MODULE_ID) {
      continue;
    }

    const resolved = resolveCrudConfig(source);
    if (seenContributorIds.has(resolved.contributorId)) {
      throw new Error(`Duplicate CRUD namespace in config.modules: "${resolved.namespace}".`);
    }
    seenContributorIds.add(resolved.contributorId);
    configs.push(resolved);
  }

  return configs;
}

function resolveCrudConfigFromModules(modulesSource = {}, options = {}) {
  const configs = resolveCrudConfigsFromModules(modulesSource);
  const hasNamespace = Object.hasOwn(options, "namespace");
  if (hasNamespace) {
    const normalizedNamespace = requireCrudNamespace(options.namespace, {
      context: "resolveCrudConfigFromModules"
    });
    return configs.find((entry) => entry.namespace === normalizedNamespace) || null;
  }

  if (configs.length === 1) {
    return configs[0];
  }

  return null;
}

export {
  CRUD_MODULE_ID,
  DEFAULT_OWNERSHIP_FILTER,
  CRUD_REQUESTED_OWNERSHIP_FILTER_AUTO,
  normalizeCrudNamespace,
  normalizeCrudOwnershipFilter,
  normalizeCrudRequestedOwnershipFilter,
  isWorkspaceVisibility,
  requireCrudNamespace,
  resolveCrudNamespacePath,
  resolveCrudRelativePath,
  normalizeCrudRelativePath,
  resolveCrudApiBasePath,
  resolveCrudTableName,
  resolveCrudActionIdPrefix,
  resolveCrudContributorId,
  resolveCrudDomain,
  resolveCrudConfig,
  resolveCrudSurfacePolicy,
  resolveCrudSurfacePolicyFromAppConfig,
  resolveCrudConfigsFromModules,
  resolveCrudConfigFromModules
};
