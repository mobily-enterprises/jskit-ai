import semver from "semver";

import { MODULE_ENABLEMENT_MODES } from "./descriptor.js";
import { addDiagnosticForMode, normalizeMode } from "./compositionMode.js";
import { createDiagnosticsCollector, throwOnDiagnosticErrors } from "./diagnostics.js";

function evaluateVersionRange(version, range) {
  const normalizedRange = String(range || "").trim();
  if (!normalizedRange || normalizedRange === "*") {
    return { status: "match" };
  }

  const validRange = semver.validRange(normalizedRange, { includePrerelease: true });
  if (!validRange) {
    return { status: "invalid-range", range: normalizedRange };
  }

  const normalizedVersion = semver.valid(String(version || ""), { includePrerelease: true });
  if (!normalizedVersion) {
    return { status: "invalid-version", range: normalizedRange, version: String(version || "") };
  }

  const matches = semver.satisfies(normalizedVersion, validRange, { includePrerelease: true });
  return matches
    ? { status: "match" }
    : { status: "mismatch", range: normalizedRange, version: normalizedVersion };
}

function satisfiesVersion(version, range) {
  return evaluateVersionRange(version, range).status === "match";
}

function evaluateEnablement(modules, { context, mode, diagnostics }) {
  const activeModules = [];
  const disabledModules = [];

  for (const module of modules) {
    if (typeof module.enabled !== "function") {
      activeModules.push(module);
      continue;
    }

    try {
      const enabled = Boolean(module.enabled(context || {}));
      if (enabled) {
        activeModules.push(module);
      } else {
        disabledModules.push({
          id: module.id,
          reason: "disabled-by-predicate"
        });
      }
    } catch (error) {
      addDiagnosticForMode(diagnostics, mode, {
        code: "MODULE_ENABLEMENT_EVALUATION_FAILED",
        moduleId: module.id,
        message: `Module "${module.id}" enablement predicate threw an error.`,
        details: {
          error: error?.message || String(error)
        }
      });

      if (mode === MODULE_ENABLEMENT_MODES.strict) {
        throwOnDiagnosticErrors(diagnostics, "Dependency graph enablement evaluation failed.");
      }

      disabledModules.push({
        id: module.id,
        reason: "enablement-evaluation-failed"
      });
    }
  }

  return {
    activeModules,
    disabledModules
  };
}

function collectDependencyIssues(module, activeById) {
  const issues = [];
  for (const dependency of module.dependsOnModules || []) {
    const dependencyModule = activeById.get(dependency.id);
    if (!dependencyModule) {
      if (!dependency.optional) {
        issues.push({
          code: "MODULE_DEPENDENCY_MISSING",
          dependencyId: dependency.id,
          range: dependency.range || null
        });
      }
      continue;
    }

    if (dependency.range) {
      const evaluation = evaluateVersionRange(dependencyModule.version, dependency.range);
      if (evaluation.status === "invalid-range") {
        issues.push({
          code: "MODULE_DEPENDENCY_RANGE_INVALID",
          dependencyId: dependency.id,
          range: evaluation.range
        });
      } else if (evaluation.status === "invalid-version") {
        issues.push({
          code: "MODULE_DEPENDENCY_VERSION_INVALID",
          dependencyId: dependency.id,
          range: evaluation.range,
          actualVersion: evaluation.version
        });
      } else if (evaluation.status === "mismatch") {
        issues.push({
          code: "MODULE_DEPENDENCY_RANGE_MISMATCH",
          dependencyId: dependency.id,
          range: evaluation.range,
          actualVersion: evaluation.version
        });
      }
    }
  }

  return issues;
}

function insertSorted(queue, value) {
  queue.push(value);
  queue.sort((left, right) => left.localeCompare(right));
}

function topologicalSort(modules) {
  const byId = new Map(modules.map((module) => [module.id, module]));
  const indegreeById = new Map();
  const adjacencyById = new Map();

  for (const module of modules) {
    indegreeById.set(module.id, 0);
    adjacencyById.set(module.id, new Set());
  }

  for (const module of modules) {
    for (const dependency of module.dependsOnModules || []) {
      if (!byId.has(dependency.id)) {
        continue;
      }
      const outgoing = adjacencyById.get(dependency.id);
      if (!outgoing.has(module.id)) {
        outgoing.add(module.id);
        indegreeById.set(module.id, indegreeById.get(module.id) + 1);
      }
    }
  }

  const queue = [];
  for (const [id, indegree] of indegreeById.entries()) {
    if (indegree === 0) {
      queue.push(id);
    }
  }
  queue.sort((left, right) => left.localeCompare(right));

  const orderedIds = [];

  while (queue.length > 0) {
    const id = queue.shift();
    orderedIds.push(id);

    for (const dependentId of adjacencyById.get(id)) {
      const nextIndegree = indegreeById.get(dependentId) - 1;
      indegreeById.set(dependentId, nextIndegree);
      if (nextIndegree === 0) {
        insertSorted(queue, dependentId);
      }
    }
  }

  if (orderedIds.length === modules.length) {
    return {
      orderedModules: orderedIds.map((id) => byId.get(id)),
      cycleIds: []
    };
  }

  const orderedIdSet = new Set(orderedIds);
  const cycleIds = modules
    .map((module) => module.id)
    .filter((id) => !orderedIdSet.has(id))
    .sort((left, right) => left.localeCompare(right));

  return {
    orderedModules: orderedIds.map((id) => byId.get(id)),
    cycleIds
  };
}

function resolveDependencyGraph({ modules = [], mode = MODULE_ENABLEMENT_MODES.strict, context = {}, diagnostics } = {}) {
  const normalizedMode = normalizeMode(mode);
  const collector = diagnostics || createDiagnosticsCollector();
  const disabledById = new Map();

  const { activeModules: enabledModules, disabledModules: predicateDisabled } = evaluateEnablement(modules, {
    context,
    mode: normalizedMode,
    diagnostics: collector
  });

  for (const disabledModule of predicateDisabled) {
    disabledById.set(disabledModule.id, disabledModule);
  }

  let activeModules = enabledModules.slice();
  let changed = true;

  while (changed) {
    changed = false;

    const activeById = new Map(activeModules.map((module) => [module.id, module]));
    const toDisable = [];

    for (const module of activeModules) {
      const issues = collectDependencyIssues(module, activeById);
      if (issues.length === 0) {
        continue;
      }

      for (const issue of issues) {
        let issueMessage;
        if (issue.code === "MODULE_DEPENDENCY_RANGE_MISMATCH") {
          issueMessage = `Module \"${module.id}\" requires \"${issue.dependencyId}\" range \"${issue.range}\" but found \"${issue.actualVersion}\".`;
        } else if (issue.code === "MODULE_DEPENDENCY_RANGE_INVALID") {
          issueMessage = `Module \"${module.id}\" has invalid dependency range \"${issue.range}\" for \"${issue.dependencyId}\".`;
        } else if (issue.code === "MODULE_DEPENDENCY_VERSION_INVALID") {
          issueMessage = `Module \"${module.id}\" dependency \"${issue.dependencyId}\" has invalid version \"${issue.actualVersion}\".`;
        } else {
          issueMessage = `Module \"${module.id}\" requires missing module \"${issue.dependencyId}\".`;
        }

        addDiagnosticForMode(collector, normalizedMode, {
          code: issue.code,
          moduleId: module.id,
          message: issueMessage,
          details: issue
        });
      }

      if (normalizedMode === MODULE_ENABLEMENT_MODES.strict) {
        throwOnDiagnosticErrors(collector, "Dependency graph validation failed.");
      }

      toDisable.push({
        id: module.id,
        reason: "dependency-validation-failed",
        issues
      });
    }

    if (toDisable.length > 0) {
      const disableSet = new Set(toDisable.map((entry) => entry.id));
      activeModules = activeModules.filter((module) => !disableSet.has(module.id));
      for (const disabledModule of toDisable) {
        disabledById.set(disabledModule.id, disabledModule);
      }
      changed = true;
    }
  }

  while (true) {
    const { orderedModules, cycleIds } = topologicalSort(activeModules);
    if (cycleIds.length === 0) {
      return {
        mode: normalizedMode,
        modules: orderedModules,
        disabledModules: Array.from(disabledById.values()).sort((left, right) => left.id.localeCompare(right.id)),
        diagnostics: collector
      };
    }

    addDiagnosticForMode(collector, normalizedMode, {
      code: "MODULE_DEPENDENCY_CYCLE",
      message: `Dependency cycle detected: ${cycleIds.join(", ")}.`,
      details: {
        cycleIds
      }
    });

    if (normalizedMode === MODULE_ENABLEMENT_MODES.strict) {
      throwOnDiagnosticErrors(collector, "Dependency graph validation failed.");
    }

    const cycleSet = new Set(cycleIds);
    activeModules = activeModules.filter((module) => !cycleSet.has(module.id));
    for (const id of cycleSet) {
      disabledById.set(id, {
        id,
        reason: "dependency-cycle"
      });
    }
  }
}

const __testables = {
  normalizeMode,
  evaluateVersionRange,
  topologicalSort
};

export { resolveDependencyGraph, satisfiesVersion, __testables };
