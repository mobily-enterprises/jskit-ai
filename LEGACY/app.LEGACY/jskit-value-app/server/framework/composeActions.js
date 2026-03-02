import { ACTION_CONTRIBUTOR_DEFINITIONS, createActionContributorsFromDefinitions } from "./actionContributorFragments.js";
import { composeServerRuntimeArtifacts } from "./composeRuntime.js";

function resolveActionContributorModuleIds(options = {}) {
  return new Set(composeServerRuntimeArtifacts(options).actionContributorModuleIds);
}

function composeActionContributors(dependencies = {}, options = {}) {
  const contributorModuleIds = resolveActionContributorModuleIds(options);
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
