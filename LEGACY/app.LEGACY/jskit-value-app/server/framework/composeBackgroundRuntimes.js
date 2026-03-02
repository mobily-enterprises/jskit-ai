import { composeServerRuntimeArtifacts } from "./composeRuntime.js";

function resolveBackgroundRuntimeServiceIds(options = {}) {
  return composeServerRuntimeArtifacts(options).backgroundRuntimeServiceIds;
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
  resolveBackgroundRuntimeServiceIds,
  resolveBackgroundRuntimes
};

export { startComposedBackgroundRuntimes, stopComposedBackgroundRuntimes, __testables };
