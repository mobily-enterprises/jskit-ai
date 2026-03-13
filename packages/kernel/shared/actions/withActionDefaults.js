function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function withActionDefaults(actions = [], defaults = {}) {
  const sourceActions = Array.isArray(actions) ? actions : [];
  const sourceDefaults = normalizePlainObject(defaults);
  const defaultDependencies = normalizePlainObject(sourceDefaults.dependencies);
  const hasDefaultDependencies = Object.keys(defaultDependencies).length > 0;
  const hasDefaultDomain = Object.hasOwn(sourceDefaults, "domain");

  return Object.freeze(
    sourceActions.map((entry) => {
      const action = normalizePlainObject(entry);
      const actionDependencies = normalizePlainObject(action.dependencies);
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
