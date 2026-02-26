import { resolveServerModuleRegistry } from "./moduleRegistry.js";

function normalizeEnabledModuleIds(enabledModuleIds) {
  if (!Array.isArray(enabledModuleIds) || enabledModuleIds.length < 1) {
    return null;
  }

  return new Set(enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean));
}

function resolveBackgroundRuntimeServiceIds({ enabledModuleIds } = {}) {
  const enabledSet = normalizeEnabledModuleIds(enabledModuleIds);
  const runtimeServiceIds = new Set();

  for (const moduleEntry of resolveServerModuleRegistry()) {
    if (enabledSet && !enabledSet.has(moduleEntry.id)) {
      continue;
    }

    const moduleRuntimeIds = moduleEntry?.contributions?.backgroundRuntimeServices;
    for (const runtimeId of Array.isArray(moduleRuntimeIds) ? moduleRuntimeIds : []) {
      const normalized = String(runtimeId || "").trim();
      if (normalized) {
        runtimeServiceIds.add(normalized);
      }
    }
  }

  return Object.freeze(Array.from(runtimeServiceIds));
}

function resolveBackgroundRuntimes(runtimeServices, options = {}) {
  const runtimeServiceIds = resolveBackgroundRuntimeServiceIds(options);
  return runtimeServiceIds
    .map((runtimeId) => runtimeServices?.[runtimeId] || null)
    .filter((runtimeService) => runtimeService !== null);
}

function startComposedBackgroundRuntimes(runtimeServices, options = {}) {
  for (const runtimeService of resolveBackgroundRuntimes(runtimeServices, options)) {
    if (typeof runtimeService?.start === "function") {
      runtimeService.start();
    }
  }
}

function stopComposedBackgroundRuntimes(runtimeServices, options = {}) {
  for (const runtimeService of resolveBackgroundRuntimes(runtimeServices, options)) {
    if (typeof runtimeService?.stop === "function") {
      runtimeService.stop();
    }
  }
}

const __testables = {
  normalizeEnabledModuleIds,
  resolveBackgroundRuntimeServiceIds,
  resolveBackgroundRuntimes
};

export { startComposedBackgroundRuntimes, stopComposedBackgroundRuntimes, __testables };
