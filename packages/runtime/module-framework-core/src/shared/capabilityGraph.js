import { MODULE_ENABLEMENT_MODES } from "./descriptor.js";
import { createDiagnosticsCollector, throwOnDiagnosticErrors } from "./diagnostics.js";
import { satisfiesVersion } from "./dependencyGraph.js";

function normalizeMode(mode) {
  const normalized = String(mode || MODULE_ENABLEMENT_MODES.strict).trim().toLowerCase();
  if (normalized !== MODULE_ENABLEMENT_MODES.strict && normalized !== MODULE_ENABLEMENT_MODES.permissive) {
    throw new TypeError(`Unsupported composition mode \"${normalized}\".`);
  }
  return normalized;
}

function addDiagnosticForMode(diagnostics, mode, input) {
  diagnostics.add({
    ...input,
    level: mode === MODULE_ENABLEMENT_MODES.strict ? "error" : "warn"
  });
}

function buildCapabilityProviders(modules) {
  const providersByCapability = new Map();
  const duplicateProviders = [];

  for (const module of modules) {
    for (const capability of module.providesCapabilities || []) {
      if (!providersByCapability.has(capability.id)) {
        providersByCapability.set(capability.id, {
          capabilityId: capability.id,
          moduleId: module.id,
          version: capability.version
        });
        continue;
      }

      duplicateProviders.push({
        capabilityId: capability.id,
        winner: providersByCapability.get(capability.id),
        contender: {
          capabilityId: capability.id,
          moduleId: module.id,
          version: capability.version
        }
      });
    }
  }

  return {
    providersByCapability,
    duplicateProviders
  };
}

function collectCapabilityRequirementIssues(module, providersByCapability) {
  const issues = [];

  for (const requirement of module.requiresCapabilities || []) {
    const provider = providersByCapability.get(requirement.id);

    if (!provider) {
      if (!requirement.optional) {
        issues.push({
          code: "MODULE_CAPABILITY_MISSING",
          capabilityId: requirement.id,
          range: requirement.range || null
        });
      }
      continue;
    }

    if (requirement.range && !satisfiesVersion(provider.version, requirement.range)) {
      issues.push({
        code: "MODULE_CAPABILITY_RANGE_MISMATCH",
        capabilityId: requirement.id,
        range: requirement.range,
        actualVersion: provider.version,
        providerModuleId: provider.moduleId
      });
    }
  }

  return issues;
}

function resolveCapabilityGraph({ modules = [], mode = MODULE_ENABLEMENT_MODES.strict, diagnostics } = {}) {
  const normalizedMode = normalizeMode(mode);
  const collector = diagnostics || createDiagnosticsCollector();
  const disabledById = new Map();

  let activeModules = modules.slice();

  while (true) {
    let changed = false;

    const { providersByCapability, duplicateProviders } = buildCapabilityProviders(activeModules);

    if (duplicateProviders.length > 0) {
      const duplicateModuleIds = new Set();

      for (const duplicate of duplicateProviders) {
        addDiagnosticForMode(collector, normalizedMode, {
          code: "MODULE_CAPABILITY_PROVIDER_CONFLICT",
          moduleId: duplicate.contender.moduleId,
          message: `Capability \"${duplicate.capabilityId}\" is provided by both \"${duplicate.winner.moduleId}\" and \"${duplicate.contender.moduleId}\".`,
          details: duplicate
        });

        duplicateModuleIds.add(duplicate.contender.moduleId);
      }

      if (normalizedMode === MODULE_ENABLEMENT_MODES.strict) {
        throwOnDiagnosticErrors(collector, "Capability graph validation failed.");
      }

      const duplicateSet = new Set(duplicateModuleIds);
      activeModules = activeModules.filter((module) => !duplicateSet.has(module.id));
      for (const moduleId of duplicateSet) {
        disabledById.set(moduleId, {
          id: moduleId,
          reason: "capability-provider-conflict"
        });
      }
      changed = true;
    }

    const { providersByCapability: refreshedProviders } = buildCapabilityProviders(activeModules);
    const modulesToDisable = [];

    for (const module of activeModules) {
      const issues = collectCapabilityRequirementIssues(module, refreshedProviders);
      if (issues.length === 0) {
        continue;
      }

      for (const issue of issues) {
        const issueMessage =
          issue.code === "MODULE_CAPABILITY_RANGE_MISMATCH"
            ? `Module \"${module.id}\" requires capability \"${issue.capabilityId}\" range \"${issue.range}\" but provider \"${issue.providerModuleId}\" has \"${issue.actualVersion}\".`
            : `Module \"${module.id}\" requires missing capability \"${issue.capabilityId}\".`;

        addDiagnosticForMode(collector, normalizedMode, {
          code: issue.code,
          moduleId: module.id,
          message: issueMessage,
          details: issue
        });
      }

      if (normalizedMode === MODULE_ENABLEMENT_MODES.strict) {
        throwOnDiagnosticErrors(collector, "Capability graph validation failed.");
      }

      modulesToDisable.push({
        id: module.id,
        reason: "capability-requirement-failed",
        issues
      });
    }

    if (modulesToDisable.length > 0) {
      const disableSet = new Set(modulesToDisable.map((entry) => entry.id));
      activeModules = activeModules.filter((module) => !disableSet.has(module.id));
      for (const moduleToDisable of modulesToDisable) {
        disabledById.set(moduleToDisable.id, moduleToDisable);
      }
      changed = true;
    }

    if (!changed) {
      const providers = {};
      const { providersByCapability: finalProviders } = buildCapabilityProviders(activeModules);
      for (const [capabilityId, provider] of finalProviders.entries()) {
        providers[capabilityId] = provider;
      }

      return {
        mode: normalizedMode,
        modules: activeModules,
        disabledModules: Array.from(disabledById.values()).sort((left, right) => left.id.localeCompare(right.id)),
        capabilityProviders: providers,
        diagnostics: collector
      };
    }
  }
}

const __testables = {
  normalizeMode,
  buildCapabilityProviders,
  collectCapabilityRequirementIssues
};

export { resolveCapabilityGraph, __testables };
