import { MODULE_ENABLEMENT_MODES, validateModuleDescriptors } from "./descriptor.js";
import { normalizeMode } from "./compositionMode.js";
import { resolveDependencyGraph } from "./dependencyGraph.js";
import { resolveCapabilityGraph } from "./capabilityGraph.js";
import { resolveMounts } from "./mountResolver.js";
import { resolveConflicts } from "./conflicts.js";
import { mergeDisabled, moduleSignature } from "./composeUtils.js";
import { createDiagnosticsCollector, throwOnDiagnosticErrors } from "./diagnostics.js";

const SERVER_HOOK_PHASES = Object.freeze([
  "repositories",
  "services",
  "controllers",
  "routes",
  "fastifyPlugins",
  "actions",
  "realtimeTopics",
  "workers",
  "migrations",
  "seeds",
  "docs"
]);

const DIAGNOSTIC_HOOK_PHASES = Object.freeze(["startupChecks", "healthChecks"]);

function resolveComposedModules({ modules, mode, context, diagnostics }) {
  const disabledById = new Map();
  let activeModules = modules.slice();
  let capabilityProviders = {};

  while (true) {
    const before = moduleSignature(activeModules);

    const dependencyResult = resolveDependencyGraph({
      modules: activeModules,
      mode,
      context,
      diagnostics
    });
    activeModules = dependencyResult.modules;
    mergeDisabled(disabledById, dependencyResult.disabledModules);

    const capabilityResult = resolveCapabilityGraph({
      modules: activeModules,
      mode,
      diagnostics
    });
    activeModules = capabilityResult.modules;
    capabilityProviders = capabilityResult.capabilityProviders;
    mergeDisabled(disabledById, capabilityResult.disabledModules);

    const after = moduleSignature(activeModules);
    if (before === after) {
      break;
    }
  }

  return {
    modules: activeModules,
    capabilityProviders,
    disabledModules: Array.from(disabledById.values()).sort((left, right) => left.id.localeCompare(right.id))
  };
}

function normalizeHookOutput(output) {
  if (output == null) {
    return [];
  }
  if (Array.isArray(output)) {
    return output.filter((entry) => entry != null);
  }
  return [output];
}

function withModuleId(module, entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }

  if (Object.hasOwn(entry, "moduleId")) {
    return entry;
  }

  return {
    ...entry,
    moduleId: module.id
  };
}

function executeModuleHook({ module, hookFn, hookType, context, mode, diagnostics }) {
  try {
    return normalizeHookOutput(hookFn(context)).map((entry) => withModuleId(module, entry));
  } catch (error) {
    diagnostics.add({
      code: "MODULE_HOOK_EXECUTION_FAILED",
      level: mode === MODULE_ENABLEMENT_MODES.strict ? "error" : "warn",
      moduleId: module.id,
      message: `Module "${module.id}" ${hookType} hook execution failed.`,
      details: {
        hookType,
        error: error?.message || String(error)
      }
    });

    if (mode === MODULE_ENABLEMENT_MODES.strict) {
      throwOnDiagnosticErrors(diagnostics, "Server module composition failed.");
    }

    return [];
  }
}

function composeServerModules({
  modules = [],
  mode = MODULE_ENABLEMENT_MODES.strict,
  context = {},
  mountOverrides = {},
  reservedMountPaths = []
} = {}) {
  const normalizedMode = normalizeMode(mode);
  const diagnostics = createDiagnosticsCollector();
  const descriptors = validateModuleDescriptors(modules);

  const resolved = resolveComposedModules({
    modules: descriptors,
    mode: normalizedMode,
    context,
    diagnostics
  });

  const mountResolution = resolveMounts({
    modules: resolved.modules,
    overrides: mountOverrides,
    reservedPaths: reservedMountPaths,
    mode: normalizedMode,
    diagnostics
  });

  const serverArtifacts = {
    repositories: [],
    services: [],
    controllers: [],
    routes: [],
    fastifyPlugins: [],
    actions: [],
    realtimeTopics: [],
    workers: [],
    migrations: [],
    seeds: [],
    docs: []
  };

  const baseHookContext = {
    ...(context || {}),
    mode: normalizedMode,
    mounts: mountResolution.mountsByKey,
    mountPaths: mountResolution.paths,
    capabilityProviders: resolved.capabilityProviders
  };

  for (const module of resolved.modules) {
    for (const phase of SERVER_HOOK_PHASES) {
      const hookFn = module.server?.[phase];
      if (typeof hookFn !== "function") {
        continue;
      }

      const contributionContext = {
        ...baseHookContext,
        module
      };

      const contributions = executeModuleHook({
        module,
        hookFn,
        hookType: `server.${phase}`,
        context: contributionContext,
        mode: normalizedMode,
        diagnostics
      });

      serverArtifacts[phase].push(...contributions);
    }
  }

  const conflictResolution = resolveConflicts({
    modules: resolved.modules,
    routes: serverArtifacts.routes,
    actions: serverArtifacts.actions,
    topics: serverArtifacts.realtimeTopics,
    mode: normalizedMode,
    diagnostics
  });

  serverArtifacts.routes = conflictResolution.routes;
  serverArtifacts.actions = conflictResolution.actions;
  serverArtifacts.realtimeTopics = conflictResolution.topics;

  const startupChecks = [];
  const healthChecks = [];

  for (const module of resolved.modules) {
    for (const phase of DIAGNOSTIC_HOOK_PHASES) {
      const hookFn = module.diagnostics?.[phase];
      if (typeof hookFn !== "function") {
        continue;
      }

      const checks = executeModuleHook({
        module,
        hookFn,
        hookType: `diagnostics.${phase}`,
        context: {
          ...baseHookContext,
          module,
          artifacts: serverArtifacts
        },
        mode: normalizedMode,
        diagnostics
      });

      if (phase === "startupChecks") {
        startupChecks.push(...checks);
      } else {
        healthChecks.push(...checks);
      }
    }
  }

  return {
    mode: normalizedMode,
    moduleOrder: resolved.modules.map((module) => module.id),
    disabledModules: resolved.disabledModules,
    mounts: mountResolution.mountsByKey,
    mountPaths: mountResolution.paths,
    capabilityProviders: resolved.capabilityProviders,
    ...serverArtifacts,
    startupChecks,
    healthChecks,
    diagnostics: diagnostics.toJSON()
  };
}

const __testables = {
  normalizeMode,
  resolveComposedModules,
  executeModuleHook,
  normalizeHookOutput,
  moduleSignature
};

export { composeServerModules, __testables };
