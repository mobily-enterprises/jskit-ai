import { createPlatformRuntimeBundle } from "@jskit-ai/platform-server-runtime";

import { PLATFORM_REPOSITORY_DEFINITIONS } from "../runtime/repositories.js";
import { PLATFORM_SERVICE_DEFINITIONS, RUNTIME_SERVICE_EXPORT_IDS } from "../runtime/services.js";
import { PLATFORM_CONTROLLER_DEFINITIONS } from "../runtime/controllers.js";
import { APP_FEATURE_SERVICE_DEFINITIONS, APP_FEATURE_CONTROLLER_DEFINITIONS } from "../runtime/appFeatureManifest.js";
import { resolveServerModuleRegistry } from "./moduleRegistry.js";

const LEGACY_ROUTE_MODULE_ORDER = Object.freeze([
  "health",
  "observability",
  "auth",
  "workspace",
  "console",
  "consoleErrors",
  "communications",
  "projects",
  "chat",
  "social",
  "billing",
  "ai",
  "settings",
  "alerts",
  "history",
  "deg2rad"
]);

function normalizeEnabledModuleIds(enabledModuleIds) {
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return null;
  }

  return new Set(enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean));
}

function resolveActiveModules(enabledModuleIds) {
  const enabledSet = normalizeEnabledModuleIds(enabledModuleIds);
  const registry = resolveServerModuleRegistry();

  if (!enabledSet) {
    return registry;
  }

  return registry.filter((entry) => enabledSet.has(entry.id));
}

function collectContributionIdSet(modules, contributionKey) {
  const ids = new Set();

  for (const moduleEntry of modules) {
    const source = moduleEntry?.contributions?.[contributionKey];
    for (const rawId of Array.isArray(source) ? source : []) {
      const id = String(rawId || "").trim();
      if (id) {
        ids.add(id);
      }
    }
  }

  return ids;
}

function filterDefinitionsById(definitions, includedIds) {
  if (includedIds.size < 1) {
    return [];
  }

  return definitions.filter((definition) => includedIds.has(definition.id));
}

function filterRuntimeIds(runtimeIds, includedIds) {
  if (includedIds.size < 1) {
    return [];
  }

  return runtimeIds.filter((id) => includedIds.has(id));
}

function filterRouteModuleIds(routeModuleIds, includedIds) {
  if (includedIds.size < 1) {
    return [];
  }

  return routeModuleIds.filter((id) => includedIds.has(id));
}

function composeServerRuntimeArtifacts({ enabledModuleIds } = {}) {
  const activeModules = resolveActiveModules(enabledModuleIds);

  const repositoryIds = collectContributionIdSet(activeModules, "repositories");
  const serviceIds = collectContributionIdSet(activeModules, "services");
  const controllerIds = collectContributionIdSet(activeModules, "controllers");
  const runtimeServiceIds = collectContributionIdSet(activeModules, "runtimeServices");
  const routeModuleIds = collectContributionIdSet(activeModules, "routes");
  const appFeatureServiceIds = collectContributionIdSet(activeModules, "appFeatureServices");
  const appFeatureControllerIds = collectContributionIdSet(activeModules, "appFeatureControllers");

  return Object.freeze({
    moduleOrder: Object.freeze(activeModules.map((entry) => entry.id)),
    repositoryDefinitions: Object.freeze(filterDefinitionsById(PLATFORM_REPOSITORY_DEFINITIONS, repositoryIds)),
    serviceDefinitions: Object.freeze(filterDefinitionsById(PLATFORM_SERVICE_DEFINITIONS, serviceIds)),
    controllerDefinitions: Object.freeze(filterDefinitionsById(PLATFORM_CONTROLLER_DEFINITIONS, controllerIds)),
    runtimeServiceIds: Object.freeze(filterRuntimeIds(RUNTIME_SERVICE_EXPORT_IDS, runtimeServiceIds)),
    routeModuleIds: Object.freeze(filterRouteModuleIds(LEGACY_ROUTE_MODULE_ORDER, routeModuleIds)),
    appFeatureServiceDefinitions: Object.freeze(filterDefinitionsById(APP_FEATURE_SERVICE_DEFINITIONS, appFeatureServiceIds)),
    appFeatureControllerDefinitions: Object.freeze(
      filterDefinitionsById(APP_FEATURE_CONTROLLER_DEFINITIONS, appFeatureControllerIds)
    )
  });
}

function createComposedLegacyRuntimeBundles(options = {}) {
  const artifacts = composeServerRuntimeArtifacts(options);

  const platformBundle = createPlatformRuntimeBundle({
    repositoryDefinitions: artifacts.repositoryDefinitions,
    serviceDefinitions: artifacts.serviceDefinitions,
    controllerDefinitions: artifacts.controllerDefinitions,
    runtimeServiceIds: artifacts.runtimeServiceIds
  });

  const appFeatureBundle = Object.freeze({
    serviceDefinitions: artifacts.appFeatureServiceDefinitions,
    controllerDefinitions: artifacts.appFeatureControllerDefinitions
  });

  return {
    artifacts,
    platformBundle,
    appFeatureBundle
  };
}

const __testables = {
  normalizeEnabledModuleIds,
  resolveActiveModules,
  collectContributionIdSet,
  filterDefinitionsById,
  filterRuntimeIds,
  filterRouteModuleIds
};

export { composeServerRuntimeArtifacts, createComposedLegacyRuntimeBundles, __testables };
