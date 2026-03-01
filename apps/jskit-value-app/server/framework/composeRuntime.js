import { createPlatformRuntimeBundle } from "@jskit-ai/platform-server-runtime";
import {
  MODULE_ENABLEMENT_MODES,
  resolveDependencyGraph,
  resolveCapabilityGraph,
  addDiagnosticForMode,
  createDiagnosticsCollector,
  throwOnDiagnosticErrors
} from "@jskit-ai/module-framework-core";
import { mergeDisabled, moduleSignature } from "@jskit-ai/module-framework-core/composeUtils";

import { FRAMEWORK_PROFILE_IDS, resolveFrameworkProfile, resolveServerModuleIdsForProfile } from "../../shared/framework/profile.js";
import { PLATFORM_REPOSITORY_DEFINITIONS } from "../runtime/repositories.js";
import { PLATFORM_SERVICE_DEFINITIONS, RUNTIME_SERVICE_EXPORT_IDS } from "../runtime/services.js";
import { PLATFORM_CONTROLLER_DEFINITIONS } from "../runtime/controllers.js";
import { APP_FEATURE_SERVICE_DEFINITIONS, APP_FEATURE_CONTROLLER_DEFINITIONS } from "../runtime/appFeatureManifest.js";
import { ACTION_CONTRIBUTOR_DEFINITIONS } from "./actionContributorFragments.js";
import { FASTIFY_PLUGIN_DEFINITIONS } from "./fastifyPluginCatalog.js";
import { ROUTE_MODULE_DEFINITIONS } from "./routeModuleCatalog.js";
import { resolveServerModuleRegistry } from "./moduleRegistry.js";
import { normalizeProfileId } from "./profileUtils.js";
import { listRealtimeTopics } from "../../shared/topicRegistry.js";

const ROUTE_MODULE_ORDER = Object.freeze(ROUTE_MODULE_DEFINITIONS.map((entry) => entry.id));
const EXTENSION_MODULE_TIER = "extension";

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

function normalizeExtensionContributions(rawContributions, moduleId) {
  if (rawContributions == null) {
    return Object.freeze({});
  }

  if (typeof rawContributions !== "object" || Array.isArray(rawContributions)) {
    throw new TypeError(`Extension module "${moduleId}" contributions must be an object.`);
  }

  const normalized = {};
  for (const [key, rawIds] of Object.entries(rawContributions)) {
    if (!Array.isArray(rawIds)) {
      throw new TypeError(`Extension module "${moduleId}" contributions.${key} must be an array.`);
    }

    const normalizedIds = [];
    const seen = new Set();
    for (const rawId of rawIds) {
      const id = String(rawId || "").trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      normalizedIds.push(id);
    }

    if (normalizedIds.length > 0) {
      normalized[key] = Object.freeze(normalizedIds);
    }
  }

  return Object.freeze(normalized);
}

function normalizeExtensionModules(extensionModules) {
  if (extensionModules == null) {
    return Object.freeze([]);
  }

  if (!Array.isArray(extensionModules)) {
    throw new TypeError("extensionModules must be an array.");
  }

  const normalized = [];
  const seenIds = new Set();

  for (const rawEntry of extensionModules) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      throw new TypeError("extensionModules entries must be objects.");
    }

    const moduleId = String(rawEntry.id || "").trim();
    if (!moduleId) {
      throw new TypeError("extensionModules entries must include a non-empty id.");
    }
    if (seenIds.has(moduleId)) {
      throw new TypeError(`Duplicate extension module id "${moduleId}".`);
    }
    seenIds.add(moduleId);

    normalized.push(
      Object.freeze({
        ...rawEntry,
        id: moduleId,
        contributions: normalizeExtensionContributions(rawEntry.contributions, moduleId)
      })
    );
  }

  return Object.freeze(normalized);
}

function resolveServerRegistry(extensionModules) {
  const registry = [];
  const seenIds = new Set();

  for (const entry of [...resolveServerModuleRegistry(), ...normalizeExtensionModules(extensionModules)]) {
    const moduleId = String(entry?.id || "").trim();
    if (!moduleId) {
      continue;
    }

    if (seenIds.has(moduleId)) {
      throw new TypeError(`Duplicate server module id "${moduleId}" detected in framework registry.`);
    }
    seenIds.add(moduleId);
    registry.push(entry);
  }

  return Object.freeze(registry);
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

function collectDefinitionIdSet(definitions) {
  const ids = new Set();

  for (const definition of definitions || []) {
    const id = String(definition?.id || "").trim();
    if (id) {
      ids.add(id);
    }
  }

  return ids;
}

function collectModuleIdSet(definitions) {
  const ids = new Set();

  for (const definition of definitions || []) {
    const id = String(definition?.moduleId || "").trim();
    if (id) {
      ids.add(id);
    }
  }

  return ids;
}

function collectStringIdSet(entries) {
  const ids = new Set();

  for (const entry of entries || []) {
    const id = String(entry || "").trim();
    if (id) {
      ids.add(id);
    }
  }

  return ids;
}

function addMissingContributionDiagnostics({ diagnostics, mode, contributionKey, includedIds, availableIds }) {
  for (const id of includedIds) {
    if (availableIds.has(id)) {
      continue;
    }

    addDiagnosticForMode(diagnostics, mode, {
      code: "MODULE_CONTRIBUTION_UNKNOWN",
      message: `Contribution "${contributionKey}" references unknown id "${id}".`,
      details: {
        contributionKey,
        id
      }
    });
  }
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


function resolveProfileConstrainedModules({
  enabledModuleIds,
  mode,
  profileId,
  optionalModulePacks,
  enforceProfileRequired,
  extensionModules,
  diagnostics
} = {}) {
  const normalizedProfileId = normalizeProfileId(profileId);
  const profile = resolveFrameworkProfile(normalizedProfileId);
  const registry = resolveServerRegistry(extensionModules);
  const registryById = new Map(registry.map((entry) => [entry.id, entry]));
  const extensionModuleIds = new Set(
    registry
      .filter((entry) => String(entry?.tier || "").trim() === EXTENSION_MODULE_TIER)
      .map((entry) => entry.id)
  );

  const requiredModuleIds = new Set(profile.requiredServerModules);
  const allowedModuleIds = new Set([...profile.requiredServerModules, ...profile.optionalServerModules, ...extensionModuleIds]);
  const explicitEnabledSet = normalizeEnabledModuleIds(enabledModuleIds);
  const profileSelectedModuleIds = resolveServerModuleIdsForProfile(profile, { optionalModulePacks });
  const selectedModuleIds = explicitEnabledSet ? new Set(explicitEnabledSet) : new Set([...profileSelectedModuleIds, ...extensionModuleIds]);
  const disabledModules = [];

  if (!explicitEnabledSet && optionalModulePacks != null) {
    const packFilteredSet = new Set(profileSelectedModuleIds);
    for (const moduleId of profile.optionalServerModules) {
      if (!packFilteredSet.has(moduleId)) {
        disabledModules.push({
          id: moduleId,
          reason: "profile-pack-filtered"
        });
      }
    }
  }

  for (const moduleId of [...selectedModuleIds]) {
    if (allowedModuleIds.has(moduleId)) {
      continue;
    }

    addDiagnosticForMode(diagnostics, mode, {
      code: "MODULE_PROFILE_FORBIDDEN_MODULE",
      message: `Module "${moduleId}" is not allowed by profile "${profile.id}".`,
      details: {
        moduleId,
        profileId: profile.id
      }
    });

    if (mode !== MODULE_ENABLEMENT_MODES.strict) {
      selectedModuleIds.delete(moduleId);
      disabledModules.push({
        id: moduleId,
        reason: "profile-forbidden-module"
      });
    }
  }

  for (const moduleId of [...selectedModuleIds]) {
    if (registryById.has(moduleId)) {
      continue;
    }

    addDiagnosticForMode(diagnostics, mode, {
      code: "MODULE_PROFILE_UNKNOWN_MODULE",
      message: `Module "${moduleId}" is not registered in server module registry.`,
      details: {
        moduleId
      }
    });

    if (mode !== MODULE_ENABLEMENT_MODES.strict) {
      selectedModuleIds.delete(moduleId);
      disabledModules.push({
        id: moduleId,
        reason: "profile-unknown-module"
      });
    }
  }

  if (enforceProfileRequired) {
    for (const moduleId of requiredModuleIds) {
      if (!selectedModuleIds.has(moduleId)) {
        diagnostics.add({
          code: "MODULE_PROFILE_REQUIRED_MODULE_MISSING",
          level: "error",
          message: `Required profile module "${moduleId}" is not selected for profile "${profile.id}".`,
          details: {
            moduleId,
            profileId: profile.id
          }
        });
      }

      if (!registryById.has(moduleId)) {
        diagnostics.add({
          code: "MODULE_PROFILE_REQUIRED_MODULE_UNREGISTERED",
          level: "error",
          message: `Required profile module "${moduleId}" is not registered.`,
          details: {
            moduleId,
            profileId: profile.id
          }
        });
      }
    }
  }

  throwOnDiagnosticErrors(diagnostics, "Server module profile validation failed.");

  const activeModules = registry.filter((entry) => selectedModuleIds.has(entry.id));

  return Object.freeze({
    profile,
    moduleEntries: Object.freeze(activeModules),
    disabledModules: Object.freeze(disabledModules)
  });
}

function resolveComposedServerModuleGraph({
  enabledModuleIds,
  mode,
  context,
  profileId = FRAMEWORK_PROFILE_IDS.webSaasDefault,
  optionalModulePacks = null,
  enforceProfileRequired = false,
  extensionModules = []
} = {}) {
  const normalizedMode = normalizeCompositionMode(mode);
  const diagnostics = createDiagnosticsCollector();
  const disabledById = new Map();

  const profileResolution = resolveProfileConstrainedModules({
    enabledModuleIds,
    mode: normalizedMode,
    profileId,
    optionalModulePacks,
    enforceProfileRequired,
    extensionModules,
    diagnostics
  });

  let activeModules = profileResolution.moduleEntries.slice();
  let capabilityProviders = {};

  mergeDisabled(disabledById, profileResolution.disabledModules);

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
    profileId: profileResolution.profile.id,
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
  const diagnostics = createDiagnosticsCollector(moduleGraph.diagnostics);
  const repositoryDefinitionIds = collectDefinitionIdSet(PLATFORM_REPOSITORY_DEFINITIONS);
  const serviceDefinitionIds = collectDefinitionIdSet(PLATFORM_SERVICE_DEFINITIONS);
  const controllerDefinitionIds = collectDefinitionIdSet(PLATFORM_CONTROLLER_DEFINITIONS);
  const runtimeServiceDefinitionIds = collectStringIdSet(RUNTIME_SERVICE_EXPORT_IDS);
  const routeDefinitionIds = collectStringIdSet(ROUTE_MODULE_ORDER);
  const appFeatureServiceDefinitionIds = collectDefinitionIdSet(APP_FEATURE_SERVICE_DEFINITIONS);
  const appFeatureControllerDefinitionIds = collectDefinitionIdSet(APP_FEATURE_CONTROLLER_DEFINITIONS);
  const actionContributorDefinitionIds = collectModuleIdSet(ACTION_CONTRIBUTOR_DEFINITIONS);
  const realtimeTopicDefinitionIds = collectStringIdSet(listRealtimeTopics());
  const fastifyPluginDefinitionIds = collectDefinitionIdSet(FASTIFY_PLUGIN_DEFINITIONS);

  addMissingContributionDiagnostics({
    diagnostics,
    mode: moduleGraph.mode,
    contributionKey: "repositories",
    includedIds: repositoryIds,
    availableIds: repositoryDefinitionIds
  });
  addMissingContributionDiagnostics({
    diagnostics,
    mode: moduleGraph.mode,
    contributionKey: "services",
    includedIds: serviceIds,
    availableIds: serviceDefinitionIds
  });
  addMissingContributionDiagnostics({
    diagnostics,
    mode: moduleGraph.mode,
    contributionKey: "controllers",
    includedIds: controllerIds,
    availableIds: controllerDefinitionIds
  });
  addMissingContributionDiagnostics({
    diagnostics,
    mode: moduleGraph.mode,
    contributionKey: "runtimeServices",
    includedIds: runtimeServiceIds,
    availableIds: runtimeServiceDefinitionIds
  });
  addMissingContributionDiagnostics({
    diagnostics,
    mode: moduleGraph.mode,
    contributionKey: "routes",
    includedIds: routeModuleIds,
    availableIds: routeDefinitionIds
  });
  addMissingContributionDiagnostics({
    diagnostics,
    mode: moduleGraph.mode,
    contributionKey: "appFeatureServices",
    includedIds: appFeatureServiceIds,
    availableIds: appFeatureServiceDefinitionIds
  });
  addMissingContributionDiagnostics({
    diagnostics,
    mode: moduleGraph.mode,
    contributionKey: "appFeatureControllers",
    includedIds: appFeatureControllerIds,
    availableIds: appFeatureControllerDefinitionIds
  });
  addMissingContributionDiagnostics({
    diagnostics,
    mode: moduleGraph.mode,
    contributionKey: "actionContributorModules",
    includedIds: actionContributorModuleIds,
    availableIds: actionContributorDefinitionIds
  });
  addMissingContributionDiagnostics({
    diagnostics,
    mode: moduleGraph.mode,
    contributionKey: "realtimeTopics",
    includedIds: realtimeTopics,
    availableIds: realtimeTopicDefinitionIds
  });
  addMissingContributionDiagnostics({
    diagnostics,
    mode: moduleGraph.mode,
    contributionKey: "fastifyPlugins",
    includedIds: fastifyPluginIds,
    availableIds: fastifyPluginDefinitionIds
  });
  addMissingContributionDiagnostics({
    diagnostics,
    mode: moduleGraph.mode,
    contributionKey: "backgroundRuntimeServices",
    includedIds: backgroundRuntimeServiceIds,
    availableIds: runtimeServiceDefinitionIds
  });

  throwOnDiagnosticErrors(diagnostics, "Server module contribution validation failed.");

  return Object.freeze({
    mode: moduleGraph.mode,
    profileId: moduleGraph.profileId,
    moduleOrder: moduleGraph.moduleOrder,
    disabledModules: moduleGraph.disabledModules,
    capabilityProviders: moduleGraph.capabilityProviders,
    diagnostics: Object.freeze(diagnostics.toJSON()),
    repositoryDefinitions: Object.freeze(filterDefinitionsById(PLATFORM_REPOSITORY_DEFINITIONS, repositoryIds)),
    serviceDefinitions: Object.freeze(filterDefinitionsById(PLATFORM_SERVICE_DEFINITIONS, serviceIds)),
    controllerDefinitions: Object.freeze(filterDefinitionsById(PLATFORM_CONTROLLER_DEFINITIONS, controllerIds)),
    runtimeServiceIds: Object.freeze(filterRuntimeIds(RUNTIME_SERVICE_EXPORT_IDS, runtimeServiceIds)),
    routeModuleIds: Object.freeze(filterRouteModuleIds(ROUTE_MODULE_ORDER, routeModuleIds)),
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

function createComposedRuntimeBundles(options = {}) {
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
  normalizeCompositionMode,
  normalizeProfileId,
  normalizeExtensionContributions,
  normalizeExtensionModules,
  resolveServerRegistry,
  collectContributionIdSet,
  filterDefinitionsById,
  filterRuntimeIds,
  filterRouteModuleIds,
  moduleSignature,
  mergeDisabled,
  resolveProfileConstrainedModules
};

export { composeServerRuntimeArtifacts, createComposedRuntimeBundles, resolveComposedServerModuleGraph, __testables };
