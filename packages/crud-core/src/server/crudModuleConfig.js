import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import {
  requireCrudNamespace
} from "@jskit-ai/resource-crud-core/shared/crudNamespaceSupport";
import {
  ROUTE_VISIBILITY_TOKENS,
  checkRouteVisibility,
  isWorkspaceRouteVisibility
} from "@jskit-ai/kernel/shared/support/visibility";

const CRUD_REQUESTED_OWNERSHIP_FILTER_AUTO = "auto";
const CRUD_REQUESTED_OWNERSHIP_FILTER_SET = new Set([
  ...ROUTE_VISIBILITY_TOKENS,
  CRUD_REQUESTED_OWNERSHIP_FILTER_AUTO
]);
const WORKSPACE_CAPABLE_TENANCY_MODES = new Set(["personal", "workspaces"]);

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
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

function resolveCrudRelativePath(namespace = "") {
  return `/${requireCrudNamespace(namespace, {
    context: "resolveCrudRelativePath"
  })}`;
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

export {
  CRUD_REQUESTED_OWNERSHIP_FILTER_AUTO,
  normalizeCrudRequestedOwnershipFilter,
  isWorkspaceRouteVisibility,
  requireCrudNamespace,
  resolveCrudRelativePath,
  normalizeCrudRelativePath,
  resolveCrudSurfacePolicy,
  resolveCrudSurfacePolicyFromAppConfig
};
