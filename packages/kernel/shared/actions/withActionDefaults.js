import { normalizeObject } from "../support/normalize.js";

function withActionDefaults(actions = [], defaults = {}) {
  const sourceActions = Array.isArray(actions) ? actions : [];
  const sourceDefaults = normalizeObject(defaults);
  const defaultDependencies = normalizeObject(sourceDefaults.dependencies);
  const hasDefaultDependencies = Object.keys(defaultDependencies).length > 0;
  const hasDefaultDomain = Object.hasOwn(sourceDefaults, "domain");

  return Object.freeze(
    sourceActions.map((entry) => {
      const action = normalizeObject(entry);
      const actionDependencies = normalizeObject(action.dependencies);
      const next = {
        ...action
      };

      if (hasDefaultDomain && !Object.hasOwn(next, "domain")) {
        next.domain = sourceDefaults.domain;
      }

      if (hasDefaultDependencies || Object.keys(actionDependencies).length > 0) {
        next.dependencies = Object.freeze({
          ...defaultDependencies,
          ...actionDependencies
        });
      }

      return Object.freeze(next);
    })
  );
}

export { withActionDefaults };
