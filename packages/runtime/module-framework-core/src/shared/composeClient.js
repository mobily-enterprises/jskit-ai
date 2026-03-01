import { MODULE_ENABLEMENT_MODES, validateModuleDescriptors } from "./descriptor.js";
import { normalizeMode } from "./compositionMode.js";
import { resolveMounts } from "./mountResolver.js";
import { moduleSignature } from "./composeUtils.js";
import { createDiagnosticsCollector, throwOnDiagnosticErrors } from "./diagnostics.js";
import { resolveComposedModules } from "./composedModules.js";

const CLIENT_HOOK_PHASES = Object.freeze(["api", "routes", "guards", "nav", "realtime", "featureFlags"]);

function normalizeArrayOutput(output) {
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

function normalizeObjectOutput(output) {
  if (output == null) {
    return [];
  }

  if (Array.isArray(output)) {
    return output.filter((entry) => entry != null);
  }

  return [output];
}

function executeHook({ module, hookFn, hookType, context, mode, diagnostics }) {
  try {
    return hookFn(context);
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
      throwOnDiagnosticErrors(diagnostics, "Client module composition failed.");
    }

    return undefined;
  }
}

function mergeRecordFragments(target, fragments, { module, phase, mode, diagnostics }) {
  for (const fragment of fragments) {
    if (!fragment || typeof fragment !== "object" || Array.isArray(fragment)) {
      diagnostics.add({
        code: "MODULE_CLIENT_FRAGMENT_INVALID",
        level: mode === MODULE_ENABLEMENT_MODES.strict ? "error" : "warn",
        moduleId: module.id,
        message: `Module \"${module.id}\" returned invalid ${phase} fragment; expected object.`
      });

      if (mode === MODULE_ENABLEMENT_MODES.strict) {
        throwOnDiagnosticErrors(diagnostics, "Client module composition failed.");
      }

      continue;
    }

    for (const [key, value] of Object.entries(fragment)) {
      if (Object.hasOwn(target, key)) {
        diagnostics.add({
          code: "MODULE_CLIENT_FRAGMENT_KEY_CONFLICT",
          level: mode === MODULE_ENABLEMENT_MODES.strict ? "error" : "warn",
          moduleId: module.id,
          message: `Duplicate ${phase} key \"${key}\" detected from module \"${module.id}\".`
        });

        if (mode === MODULE_ENABLEMENT_MODES.strict) {
          throwOnDiagnosticErrors(diagnostics, "Client module composition failed.");
        }

        continue;
      }

      target[key] = value;
    }
  }
}

function composeClientModules({
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

  const clientArtifacts = {
    api: {},
    routes: [],
    guards: [],
    nav: [],
    realtime: [],
    featureFlags: {}
  };

  const baseHookContext = {
    ...(context || {}),
    mode: normalizedMode,
    mounts: mountResolution.mountsByKey,
    mountPaths: mountResolution.paths,
    capabilityProviders: resolved.capabilityProviders
  };

  for (const module of resolved.modules) {
    for (const phase of CLIENT_HOOK_PHASES) {
      const hookFn = module.client?.[phase];
      if (typeof hookFn !== "function") {
        continue;
      }

      const contribution = executeHook({
        module,
        hookFn,
        hookType: `client.${phase}`,
        context: {
          ...baseHookContext,
          module
        },
        mode: normalizedMode,
        diagnostics
      });

      if (phase === "api" || phase === "featureFlags") {
        mergeRecordFragments(clientArtifacts[phase], normalizeObjectOutput(contribution), {
          module,
          phase,
          mode: normalizedMode,
          diagnostics
        });
        continue;
      }

      const normalized = normalizeArrayOutput(contribution).map((entry) => withModuleId(module, entry));
      clientArtifacts[phase].push(...normalized);
    }
  }

  return {
    mode: normalizedMode,
    moduleOrder: resolved.modules.map((module) => module.id),
    disabledModules: resolved.disabledModules,
    mounts: mountResolution.mountsByKey,
    mountPaths: mountResolution.paths,
    capabilityProviders: resolved.capabilityProviders,
    ...clientArtifacts,
    diagnostics: diagnostics.toJSON()
  };
}

const __testables = {
  normalizeMode,
  resolveComposedModules,
  mergeRecordFragments,
  moduleSignature
};

export { composeClientModules, __testables };
