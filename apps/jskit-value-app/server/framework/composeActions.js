import { createActionContributors as createLegacyActionContributors } from "../runtime/actions/contributorManifest.js";
import { resolveServerModuleRegistry } from "./moduleRegistry.js";

function resolveActionContributorModuleIds({ enabledModuleIds } = {}) {
  const enabledSet = Array.isArray(enabledModuleIds)
    ? new Set(enabledModuleIds.map((entry) => String(entry || "").trim()).filter(Boolean))
    : null;

  const moduleIds = new Set();

  for (const moduleEntry of resolveServerModuleRegistry()) {
    if (enabledSet && !enabledSet.has(moduleEntry.id)) {
      continue;
    }

    for (const moduleId of Array.isArray(moduleEntry?.contributions?.actionContributorModules)
      ? moduleEntry.contributions.actionContributorModules
      : []) {
      const normalized = String(moduleId || "").trim();
      if (normalized) {
        moduleIds.add(normalized);
      }
    }
  }

  return moduleIds;
}

function composeActionContributors(dependencies = {}, { enabledModuleIds } = {}) {
  const contributorModuleIds = resolveActionContributorModuleIds({ enabledModuleIds });
  const contributors = createLegacyActionContributors(dependencies);

  if (contributorModuleIds.size < 1) {
    return contributors;
  }

  return contributors.filter((contributor) => {
    const moduleId = String(contributor?.moduleId || contributor?.id || "").trim();
    if (!moduleId) {
      return true;
    }

    return contributorModuleIds.has(moduleId);
  });
}

function createActionContributorFactory(options = {}) {
  return function createContributors(dependencies = {}) {
    return composeActionContributors(dependencies, options);
  };
}

export { composeActionContributors, createActionContributorFactory, resolveActionContributorModuleIds };
