import { resolveServerModuleRegistry } from "./moduleRegistry.js";
import { ACTION_CONTRIBUTOR_DEFINITIONS, createActionContributorsFromDefinitions } from "./actionContributorFragments.js";

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
  const filteredDefinitions = ACTION_CONTRIBUTOR_DEFINITIONS.filter((definition) => {
    if (!definition?.moduleId) {
      return true;
    }
    return contributorModuleIds.has(String(definition.moduleId || "").trim());
  });

  return createActionContributorsFromDefinitions(filteredDefinitions, dependencies);
}

function createActionContributorFactory(options = {}) {
  return function createContributors(dependencies = {}) {
    return composeActionContributors(dependencies, options);
  };
}

export { composeActionContributors, createActionContributorFactory, resolveActionContributorModuleIds };
