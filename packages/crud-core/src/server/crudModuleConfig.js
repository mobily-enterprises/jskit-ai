import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import {
  normalizeCrudNamespace,
  requireCrudNamespace
} from "../shared/crudNamespaceSupport.js";
import {
  resolveScopedApiBasePath
} from "@jskit-ai/kernel/shared/surface";
import {
  ROUTE_VISIBILITY_TOKENS,
  checkRouteVisibility,
  isWorkspaceRouteVisibility
} from "@jskit-ai/kernel/shared/support/visibility";

const DEFAULT_OWNERSHIP_FILTER = "workspace";
const CRUD_REQUESTED_OWNERSHIP_FILTER_AUTO = "auto";
const CRUD_REQUESTED_OWNERSHIP_FILTER_SET = new Set([
  ...ROUTE_VISIBILITY_TOKENS,
  CRUD_REQUESTED_OWNERSHIP_FILTER_AUTO
]);
const CRUD_MODULE_ID = "crud";
const WORKSPACE_CAPABLE_TENANCY_MODES = new Set(["personal", "workspaces"]);

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeCrudOwnershipFilter(value, { fallback = DEFAULT_OWNERSHIP_FILTER } = {}) {
  const normalizedValue = normalizeText(value).toLowerCase();
  const normalizedFallback = normalizeText(fallback).toLowerCase();
  const resolved = normalizedValue || normalizedFallback;
  return checkRouteVisibility(resolved, {
    context: "normalizeCrudOwnershipFilter ownershipFilter"
  });
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
  return resolveScopedApiBasePath({
    routeBase: surfaceRequiresWorkspace === true ? "/w/:workspaceSlug" : "/",
    relativePath,
    strictParams: false
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
    workspaceScoped: isWorkspaceRouteVisibility(ownershipFilter),
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
      : checkRouteVisibility(requestedOwnershipFilter, {
          context: `${context} ownershipFilter`
        });

  if (isWorkspaceRouteVisibility(ownershipFilter) && surfaceDefinition.requiresWorkspace !== true) {
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
    workspaceScoped: isWorkspaceRouteVisibility(ownershipFilter),
    relativePath,
    surfaceDefinition
  });
}

function resolveCrudSurfacePolicyFromAppConfig(sourceConfig = {}, appConfig = {}, options = {}) {
  const config = asRecord(appConfig);
  const requestedSurfaceId = normalizeSurfaceId(asRecord(sourceConfig).surface);
  const fallbackSurfaceId = normalizeSurfaceId(config.surfaceDefaultId);
  const resolvedSurfaceId = requestedSurfaceId || fallbackSurfaceId;

  try {
    return resolveCrudSurfacePolicy(sourceConfig, {
      ...asRecord(options),
      surfaceDefinitions: config.surfaceDefinitions,
      defaultSurfaceId: config.surfaceDefaultId
    });
  } catch (error) {
    const normalizedTenancyMode = normalizeText(config.tenancyMode).toLowerCase();
    const message = String(error?.message || "");
    if (
      message.includes("cannot resolve surface") &&
      (resolvedSurfaceId === "admin" || resolvedSurfaceId === "app") &&
      WORKSPACE_CAPABLE_TENANCY_MODES.has(normalizedTenancyMode)
    ) {
      error.message = `${message} Workspace-capable tenancy mode "${normalizedTenancyMode}" usually requires ` +
        '@jskit-ai/workspaces-core, which defines the "app" and "admin" surfaces. ' +
        "Install that package or add matching surface definitions in config/public.js.";
    }
    throw error;
  }
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
  isWorkspaceRouteVisibility,
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
