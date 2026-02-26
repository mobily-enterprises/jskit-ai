import { createPlatformRuntimeBundle } from "@jskit-ai/platform-server-runtime";
import {
  MODULE_ENABLEMENT_MODES,
  resolveDependencyGraph,
  resolveCapabilityGraph,
  createDiagnosticsCollector
} from "@jskit-ai/module-framework-core";

import { PLATFORM_REPOSITORY_DEFINITIONS } from "../runtime/repositories.js";
import { PLATFORM_SERVICE_DEFINITIONS, RUNTIME_SERVICE_EXPORT_IDS } from "../runtime/services.js";
import { PLATFORM_CONTROLLER_DEFINITIONS } from "../runtime/controllers.js";
import { APP_FEATURE_SERVICE_DEFINITIONS, APP_FEATURE_CONTROLLER_DEFINITIONS } from "../runtime/appFeatureManifest.js";
import { ROUTE_MODULE_DEFINITIONS } from "./routeModuleCatalog.js";
import { resolveServerModuleRegistry } from "./moduleRegistry.js";

const LEGACY_ROUTE_MODULE_ORDER = Object.freeze(ROUTE_MODULE_DEFINITIONS.map((entry) => entry.id));
const FRAMEWORK_COMPOSITION_MODE_ENV_KEY = "FRAMEWORK_COMPOSITION_MODE";

function normalizeEnabledModuleIds(enabledModuleIds) {
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return null;
  }

  return new Set(enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean));
}

function normalizeCompositionMode(mode) {
  const normalized = String(mode || MODULE_ENABLEMENT_MODES.strict).trim().toLowerCase();
  if (normalized !== MODULE_ENABLEMENT_MODES.strict && normalized !== MODULE_ENABLEMENT_MODES.permissive) {
    throw new TypeError(`Unsupported framework composition mode "${normalized}".`);
  }
  return normalized;
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

function mergeDisabled(disabledById, entries) {
  for (const entry of entries || []) {
    if (!entry || !entry.id) {
      continue;
    }

    const existing = disabledById.get(entry.id);
    if (!existing) {
      disabledById.set(entry.id, { ...entry });
      continue;
    }

    const reasons = new Set([existing.reason, entry.reason].filter(Boolean));
    disabledById.set(entry.id, {
      ...existing,
      ...entry,
      reason: Array.from(reasons).join(", ")
    });
  }
}

function moduleSignature(modules) {
  return modules
    .map((module) => module.id)
    .slice()
    .sort((left, right) => left.localeCompare(right))
    .join("|");
}

function resolveComposedServerModuleGraph({ enabledModuleIds, mode, context } = {}) {
  const normalizedMode = normalizeCompositionMode(mode);
  const diagnostics = createDiagnosticsCollector();
  const disabledById = new Map();

  let activeModules = resolveActiveModules(enabledModuleIds);
  let capabilityProviders = {};

  while (true) {
    const before = moduleSignature(activeModules);

    const dependencyResult = resolveDependencyGraph({
      modules: activeModules,
      mode: normalizedMode,
      context,
      diagnostics
    });
    activeModules = dependencyResult.modules;
    mergeDisabled(disabledById, dependencyResult.disabledModules);

    const capabilityResult = resolveCapabilityGraph({
      modules: activeModules,
      mode: normalizedMode,
      diagnostics
    });
    activeModules = capabilityResult.modules;
    capabilityProviders = capabilityResult.capabilityProviders;
    mergeDisabled(disabledById, capabilityResult.disabledModules);

    if (before === moduleSignature(activeModules)) {
      break;
    }
  }

  return Object.freeze({
    mode: normalizedMode,
    moduleEntries: Object.freeze(activeModules.slice()),
    moduleOrder: Object.freeze(activeModules.map((entry) => entry.id)),
    disabledModules: Object.freeze(
      Array.from(disabledById.values()).sort((left, right) => left.id.localeCompare(right.id))
    ),
    capabilityProviders: Object.freeze({ ...capabilityProviders }),
    diagnostics: Object.freeze(diagnostics.toJSON())
  });
}

function composeServerRuntimeArtifacts(options = {}) {
  const moduleGraph = resolveComposedServerModuleGraph(options);
  const activeModules = moduleGraph.moduleEntries;

  const repositoryIds = collectContributionIdSet(activeModules, "repositories");
  const serviceIds = collectContributionIdSet(activeModules, "services");
  const controllerIds = collectContributionIdSet(activeModules, "controllers");
  const runtimeServiceIds = collectContributionIdSet(activeModules, "runtimeServices");
  const routeModuleIds = collectContributionIdSet(activeModules, "routes");
  const appFeatureServiceIds = collectContributionIdSet(activeModules, "appFeatureServices");
  const appFeatureControllerIds = collectContributionIdSet(activeModules, "appFeatureControllers");
  const actionContributorModuleIds = collectContributionIdSet(activeModules, "actionContributorModules");
  const realtimeTopics = collectContributionIdSet(activeModules, "realtimeTopics");
  const fastifyPluginIds = collectContributionIdSet(activeModules, "fastifyPlugins");
  const backgroundRuntimeServiceIds = collectContributionIdSet(activeModules, "backgroundRuntimeServices");

  return Object.freeze({
    mode: moduleGraph.mode,
    moduleOrder: moduleGraph.moduleOrder,
    disabledModules: moduleGraph.disabledModules,
    capabilityProviders: moduleGraph.capabilityProviders,
    diagnostics: moduleGraph.diagnostics,
    repositoryDefinitions: Object.freeze(filterDefinitionsById(PLATFORM_REPOSITORY_DEFINITIONS, repositoryIds)),
    serviceDefinitions: Object.freeze(filterDefinitionsById(PLATFORM_SERVICE_DEFINITIONS, serviceIds)),
    controllerDefinitions: Object.freeze(filterDefinitionsById(PLATFORM_CONTROLLER_DEFINITIONS, controllerIds)),
    runtimeServiceIds: Object.freeze(filterRuntimeIds(RUNTIME_SERVICE_EXPORT_IDS, runtimeServiceIds)),
    routeModuleIds: Object.freeze(filterRouteModuleIds(LEGACY_ROUTE_MODULE_ORDER, routeModuleIds)),
    appFeatureServiceDefinitions: Object.freeze(filterDefinitionsById(APP_FEATURE_SERVICE_DEFINITIONS, appFeatureServiceIds)),
    appFeatureControllerDefinitions: Object.freeze(
      filterDefinitionsById(APP_FEATURE_CONTROLLER_DEFINITIONS, appFeatureControllerIds)
    ),
    actionContributorModuleIds: Object.freeze(Array.from(actionContributorModuleIds)),
    realtimeTopics: Object.freeze(Array.from(realtimeTopics)),
    fastifyPluginIds: Object.freeze(Array.from(fastifyPluginIds)),
    backgroundRuntimeServiceIds: Object.freeze(Array.from(backgroundRuntimeServiceIds))
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
  FRAMEWORK_COMPOSITION_MODE_ENV_KEY,
  normalizeEnabledModuleIds,
  normalizeCompositionMode,
  resolveActiveModules,
  collectContributionIdSet,
  filterDefinitionsById,
  filterRuntimeIds,
  filterRouteModuleIds,
  moduleSignature,
  mergeDisabled
};

export {
  FRAMEWORK_COMPOSITION_MODE_ENV_KEY,
  composeServerRuntimeArtifacts,
  createComposedLegacyRuntimeBundles,
  resolveComposedServerModuleGraph,
  __testables
};
