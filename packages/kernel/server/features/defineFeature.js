import { isRecord } from "../../shared/support/normalize.js";
import { defineProvider } from "../../shared/capabilities/defineProvider.js";

function exactOutputNames(value, expectedNames, featureId) {
  const outputs = value == null ? {} : value;
  if (!isRecord(outputs)) {
    throw new TypeError(`Feature "${featureId}" setup() must return its declared capability outputs.`);
  }

  const actualNames = Object.keys(outputs).sort();
  const normalizedExpectedNames = [...expectedNames].sort();
  if (
    actualNames.length !== normalizedExpectedNames.length ||
    actualNames.some((name, index) => name !== normalizedExpectedNames[index])
  ) {
    throw new TypeError(
      `Feature "${featureId}" setup() outputs must be exactly: ${normalizedExpectedNames.join(", ") || "<none>"}.`
    );
  }

  return Object.freeze({ ...outputs });
}

function normalizeActionFactory(value, featureId) {
  if (value == null) {
    return () => [];
  }
  if (typeof value === "function") {
    return value;
  }
  if (Array.isArray(value)) {
    return () => value;
  }
  throw new TypeError(`Feature "${featureId}" actions must be an array or function.`);
}

function applyActionDefaults(actions, defaults, featureId) {
  if (!isRecord(defaults)) {
    throw new TypeError(`Feature "${featureId}" actionDefaults must be an object.`);
  }
  if (Object.hasOwn(defaults, "dependencies")) {
    throw new TypeError(`Feature "${featureId}" actionDefaults cannot declare container dependencies.`);
  }

  return actions.map((value) => {
    if (!isRecord(value)) {
      throw new TypeError(`Feature "${featureId}" actions must contain action definition objects.`);
    }
    if (Object.hasOwn(value, "dependencies")) {
      throw new TypeError(`Feature "${featureId}" actions cannot declare container dependencies.`);
    }
    return Object.freeze({ ...defaults, ...value });
  });
}

function withoutActionCatalogue(dependencies) {
  const { actionCatalogue, ...featureDependencies } = dependencies;
  return Object.freeze(featureDependencies);
}

function defineFeature({
  id,
  domain = id,
  requires = {},
  optional = {},
  provides = {},
  setup = () => ({}),
  actions = [],
  actionDefaults = {},
  boot = null,
  shutdown = null
} = {}) {
  if (Object.hasOwn(requires || {}, "actionCatalogue") || Object.hasOwn(optional || {}, "actionCatalogue")) {
    throw new TypeError("Feature dependencies reserve the local name actionCatalogue.");
  }
  if (typeof setup !== "function") {
    throw new TypeError(`Feature "${String(id || "")}" setup must be a function.`);
  }

  const actionFactory = normalizeActionFactory(actions, String(id || ""));
  const expectedOutputNames = Object.keys(provides || {});

  return defineProvider({
    id,
    requires: {
      ...requires,
      actionCatalogue: "runtime.actions"
    },
    optional,
    provides,
    async setup(dependencies, context) {
      const { actionCatalogue } = dependencies;
      const featureDependencies = withoutActionCatalogue(dependencies);
      const featureContext = Object.freeze({ ...context, actionCatalogue });
      const outputs = exactOutputNames(
        await setup(Object.freeze(featureDependencies), featureContext),
        expectedOutputNames,
        String(id || "")
      );
      const featureActions = await actionFactory(
        Object.freeze({
          ...featureDependencies,
          ...outputs
        }),
        featureContext
      );
      if (!Array.isArray(featureActions)) {
        throw new TypeError(`Feature "${String(id || "")}" actions() must return an array.`);
      }

      const materializedActions = applyActionDefaults(featureActions, actionDefaults, String(id || ""));

      if (materializedActions.length > 0) {
        actionCatalogue.register({
          contributorId: String(id || ""),
          domain,
          actions: materializedActions
        });
      }
      return outputs;
    },
    boot: typeof boot === "function"
      ? (dependencies, context) => boot(withoutActionCatalogue(dependencies), context)
      : boot,
    shutdown: typeof shutdown === "function"
      ? (dependencies, context) => shutdown(withoutActionCatalogue(dependencies), context)
      : shutdown
  });
}

export { defineFeature };
