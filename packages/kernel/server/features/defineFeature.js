import { isRecord } from "../../shared/support/normalize.js";
import { capabilityKey, defineProvider } from "../../shared/capabilities/defineProvider.js";
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

const RESOURCE_RUNTIME = "runtime.resources";
const RESERVED_LOCAL_NAMES = Object.freeze(["actionCatalogue", "resourceRuntime", "resources", "systemContext"]);

function withoutActionCatalogue(dependencies) {
  const { actionCatalogue, resourceRuntime, ...featureDependencies } = dependencies;
  return Object.freeze(featureDependencies);
}

/**
 * The table resources a feature owns: each a table resource, or
 * `{ resource, ...serverOnlyExtras }` such as its row policy and write hooks.
 * The resource runtime checks the entries; the kernel only passes them on.
 * @param {unknown} owns
 * @param {string} featureId
 */
function normalizeOwns(owns, featureId) {
  if (owns === undefined) {
    return null;
  }
  if (!Array.isArray(owns) || owns.length < 1 || !owns.every(isRecord)) {
    throw new TypeError(`Feature "${featureId}" owns must be a non-empty array of table resources or { resource } entries.`);
  }
  return Object.freeze([...owns]);
}

/**
 * Why a feature needs to work across every workspace and user.
 * @param {unknown} systemScope
 * @param {string} featureId
 */
function normalizeSystemScope(systemScope, featureId) {
  if (systemScope === undefined) {
    return null;
  }
  if (typeof systemScope !== "string" || !systemScope.trim()) {
    throw new TypeError(`Feature "${featureId}" systemScope must say why it works across every workspace and user.`);
  }
  return systemScope.trim();
}

/**
 * What setup receives besides its own dependencies: the handles of the
 * resources the feature owns, and the system context factory the resource
 * runtime answers for its declared system scope, whose every call names its
 * reason.
 * @param {Record<string, any>} dependencies
 * @param {{ featureId: string, owns: ReadonlyArray<object> | null, systemScope: string | null }} featureResources
 */
async function resourceDependencies({ resourceRuntime }, { featureId, owns, systemScope }) {
  return {
    ...(owns ? { resources: await resourceRuntime.own(featureId, owns) } : {}),
    ...(systemScope ? { systemContext: resourceRuntime.declareSystemScope(featureId, systemScope) } : {})
  };
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
  hints = {},
  setup = () => ({}),
  actions = [],
  actionDefaults = {},
  boot = null,
  shutdown = null,
  owns = undefined,
  systemScope = undefined
} = {}) {
  for (const localName of RESERVED_LOCAL_NAMES) {
    if (Object.hasOwn(requires, localName) || Object.hasOwn(optional, localName)) {
      throw new TypeError(`Feature dependencies reserve the local names ${RESERVED_LOCAL_NAMES.join(", ")}.`);
    }
  }
  const featureId = String(id || "");
  // Compared as the runtime resolves it, so "Runtime.Resources" or " runtime.resources" is refused as well.
  if ([...Object.values(requires), ...Object.values(optional)].some((capability) => capabilityKey(capability) === RESOURCE_RUNTIME)) {
    throw new TypeError(
      `Feature "${featureId}" must not require ${RESOURCE_RUNTIME}: it receives handles for the resources it owns, and a system context with systemScope.`
    );
  }
  // readable-check: allow method-probe - input validation: a feature definition must have setup()
  if (typeof setup !== "function") {
    throw new TypeError(`Feature "${featureId}" setup must be a function.`);
  }

  const actionFactory = normalizeActionFactory(actions, featureId);
  const featureResources = {
    featureId,
    owns: normalizeOwns(owns, featureId),
    systemScope: normalizeSystemScope(systemScope, featureId)
  };

  return defineProvider({
    id,
    requires: {
      ...requires,
      actionCatalogue: "runtime.actions",
      ...(featureResources.owns || featureResources.systemScope ? { resourceRuntime: RESOURCE_RUNTIME } : {})
    },
    optional,
    provides,
    hints: {
      ...(featureResources.owns || featureResources.systemScope
        ? { [RESOURCE_RUNTIME]: "Install @jskit-ai/resource-runtime, whose ResourceRuntimeProvider provides it." }
        : {}),
      ...hints
    },
    async setup(dependencies, context) {
      const { actionCatalogue } = dependencies;
      const featureDependencies = withoutActionCatalogue(dependencies);
      const featureContext = Object.freeze({ ...context, actionCatalogue });
      const setupDependencies = Object.freeze({
        ...featureDependencies,
        ...(await resourceDependencies(dependencies, featureResources))
      });
      const outputs = normalizeProviderOutputs(
        { id: featureId, provides },
        await setup(setupDependencies, featureContext)
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
