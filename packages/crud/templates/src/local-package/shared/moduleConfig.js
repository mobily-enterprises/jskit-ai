import { normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface/registry";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import {
  USERS_ROUTE_VISIBILITY_LEVELS,
  normalizeUsersRouteVisibility,
  isWorkspaceVisibility
} from "@jskit-ai/users-core/shared/support/usersVisibility";

const CRUD_MODULE_VISIBILITY_AUTO = "auto";
const CRUD_MODULE_VISIBILITY_SET = new Set([
  ...USERS_ROUTE_VISIBILITY_LEVELS,
  CRUD_MODULE_VISIBILITY_AUTO
]);

const crudModuleConfig = Object.freeze({
  namespace: "${option:namespace|snake}",
  surface: "${option:surface|lower}",
  visibility: "${option:visibility}",
  relativePath: "/${option:directory-prefix|pathprefix}${option:namespace|kebab}"
});

function asRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeCrudVisibility(value, { fallback = CRUD_MODULE_VISIBILITY_AUTO } = {}) {
  const normalized = normalizeText(value).toLowerCase();
  if (CRUD_MODULE_VISIBILITY_SET.has(normalized)) {
    return normalized;
  }

  const normalizedFallback = normalizeText(fallback).toLowerCase();
  if (CRUD_MODULE_VISIBILITY_SET.has(normalizedFallback)) {
    return normalizedFallback;
  }

  return CRUD_MODULE_VISIBILITY_AUTO;
}

function normalizeCrudRelativePath(value, { context = "resolveCrudModulePolicy" } = {}) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw new TypeError(`${context} requires a non-empty relativePath.`);
  }

  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const compacted = withLeadingSlash.replace(/\/{2,}/g, "/");
  return compacted === "/" ? "/" : compacted.replace(/\/+$/, "") || "/";
}

function normalizeCrudSurfaceDefinitions(sourceDefinitions = {}) {
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

function resolveVisibilityForSurfaceDefinition(definition = {}) {
  if (definition.requiresWorkspace === true) {
    return "workspace";
  }
  if (definition.requiresAuth === true) {
    return "user";
  }
  return "public";
}

function resolveCrudModulePolicy({
  moduleConfig = crudModuleConfig,
  surfaceDefinitions = {},
  defaultSurfaceId = "",
  context = "resolveCrudModulePolicy"
} = {}) {
  const config = asRecord(moduleConfig);
  const normalizedDefinitions = normalizeCrudSurfaceDefinitions(surfaceDefinitions);
  const requestedSurfaceId = normalizeSurfaceId(config.surface);
  const fallbackSurfaceId = normalizeSurfaceId(defaultSurfaceId);
  const selectedSurfaceId = requestedSurfaceId || fallbackSurfaceId;
  if (!selectedSurfaceId) {
    throw new Error(
      `${context} requires crudModuleConfig.surface or an app default surface id.`
    );
  }

  const surfaceDefinition = normalizedDefinitions[selectedSurfaceId];
  if (!surfaceDefinition) {
    throw new Error(
      `${context} cannot resolve surface "${selectedSurfaceId}" from surface definitions.`
    );
  }
  if (surfaceDefinition.enabled === false) {
    throw new Error(`${context} surface "${selectedSurfaceId}" is disabled.`);
  }

  const requestedVisibility = normalizeCrudVisibility(config.visibility);
  const resolvedVisibility =
    requestedVisibility === CRUD_MODULE_VISIBILITY_AUTO
      ? resolveVisibilityForSurfaceDefinition(surfaceDefinition)
      : normalizeUsersRouteVisibility(requestedVisibility, {
          fallback: "public"
        });

  if (isWorkspaceVisibility(resolvedVisibility) && surfaceDefinition.requiresWorkspace !== true) {
    throw new Error(
      `${context} visibility "${resolvedVisibility}" requires a workspace-enabled surface.`
    );
  }

  const relativePath = normalizeCrudRelativePath(config.relativePath, {
    context
  });

  return Object.freeze({
    namespace: normalizeText(config.namespace).toLowerCase(),
    relativePath,
    surfaceId: selectedSurfaceId,
    requestedVisibility,
    visibility: resolvedVisibility,
    workspaceScoped: isWorkspaceVisibility(resolvedVisibility),
    surfaceDefinition
  });
}

function resolveCrudModulePolicyFromAppConfig(appConfig = {}, options = {}) {
  const config = asRecord(appConfig);
  return resolveCrudModulePolicy({
    ...asRecord(options),
    surfaceDefinitions: config.surfaceDefinitions,
    defaultSurfaceId: config.surfaceDefaultId
  });
}

function resolveCrudModulePolicyFromPlacementContext(placementContext = null, options = {}) {
  const context = asRecord(placementContext);
  const surfaceConfig = asRecord(context.surfaceConfig);
  return resolveCrudModulePolicy({
    ...asRecord(options),
    surfaceDefinitions: surfaceConfig.surfacesById,
    defaultSurfaceId: surfaceConfig.defaultSurfaceId
  });
}

export {
  CRUD_MODULE_VISIBILITY_AUTO,
  crudModuleConfig,
  resolveCrudModulePolicy,
  resolveCrudModulePolicyFromAppConfig,
  resolveCrudModulePolicyFromPlacementContext
};
