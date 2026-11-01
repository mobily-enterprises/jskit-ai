import { isRecord } from "../../shared/support/normalize.js";
import { defineProvider } from "../../shared/capabilities/defineProvider.js";
import { normalizeProviderOutputs } from "../../shared/capabilities/runtime.js";

/** @typedef {import("../types.js").FeatureDefinition} FeatureDefinition */

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

  return actions.map((value) => {
    if (!isRecord(value)) {
      throw new TypeError(`Feature "${featureId}" actions must contain action definition objects.`);
    }
    return Object.freeze({
      ...defaults,
      ...value
    });
  });
}

function withoutActionCatalogue(dependencies) {
  const { actionCatalogue, ...featureDependencies } = dependencies;
  return Object.freeze(featureDependencies);
}

/**
 * An absent definition reaches the checks below, which name what is missing.
 * @param {FeatureDefinition} [definition]
 */
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
  if (Object.hasOwn(requires, "actionCatalogue") || Object.hasOwn(optional, "actionCatalogue")) {
    throw new TypeError("Feature dependencies reserve the local name actionCatalogue.");
  }
  const featureId = String(id || "");
  // readable-check: allow method-probe - input validation: a feature definition must have setup()
  if (typeof setup !== "function") {
    throw new TypeError(`Feature "${featureId}" setup must be a function.`);
  }

  const actionFactory = normalizeActionFactory(actions, featureId);

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
      const outputs = normalizeProviderOutputs(
        { id: featureId, provides },
        await setup(Object.freeze(featureDependencies), featureContext)
      );
      const featureActions = await actionFactory(
        Object.freeze({
          ...featureDependencies,
          ...outputs
        }),
        featureContext
      );
      if (!Array.isArray(featureActions)) {
        throw new TypeError(`Feature "${featureId}" actions() must return an array.`);
      }

      const materializedActions = applyActionDefaults(featureActions, actionDefaults, featureId);

      if (materializedActions.length > 0) {
        actionCatalogue.register({
          contributorId: featureId,
          domain,
          actions: materializedActions
        });
      }
      return outputs;
    },
    // readable-check: allow method-probe - input validation: a feature's boot() and shutdown() are optional
    boot: typeof boot === "function"
      ? (dependencies, context) => boot(withoutActionCatalogue(dependencies), context)
      : boot,
    shutdown: typeof shutdown === "function"
      ? (dependencies, context) => shutdown(withoutActionCatalogue(dependencies), context)
      : shutdown
  });
}

export { defineFeature };
