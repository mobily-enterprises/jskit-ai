import { createActionRegistry } from "./registry.js";
import { registerActionContributor } from "./actionDefinitions.js";
import { noActionPolicy } from "./actionPolicy.js";
import { isRecord } from "../../shared/support/normalize.js";
import { createEventRuntime } from "../runtime/eventRuntime.js";
import { silentLogger } from "../../shared/support/silentLogger.js";

/** @typedef {import("../types.js").ActionPolicy} ActionPolicy */
/** @typedef {import("../types.js").RuntimeEvents} RuntimeEvents */
/** @typedef {import("../types.js").RuntimeLogger} RuntimeLogger */

function normalizeRegistration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Action catalogue registration must be an action contributor object.");
  }

  return value;
}

/**
 * The runtime.actions capability: the actions features register, run through the
 * action pipeline with the context their contributors add.
 * @param {object} [dependencies]
 * @param {RuntimeEvents} [dependencies.events] Publishes the events an action declares; without one they reach an event runtime of the catalogue's own, which nothing listens to.
 * @param {RuntimeLogger} [dependencies.logger] Logs each execution at debug level; without one nothing is logged.
 * @param {ActionPolicy} [dependencies.policy] The application's rule for every action; without one, each action runs as declared.
 */
function createActionCatalogue({ events = createEventRuntime(), logger = silentLogger, policy = noActionPolicy } = {}) {
  const contributors = [];
  const contextContributors = [];
  const contextContributorIds = new Set();
  let registry = createActionRegistry({
    contributors,
    events,
    logger,
    policy
  });
  let sealed = false;

  function register(contributor) {
    if (sealed) {
      throw new Error("Action catalogue registration is closed after discovery or execution begins.");
    }
    const registered = registerActionContributor(normalizeRegistration(contributor), policy);
    const nextRegistry = createActionRegistry({
      contributors: [...contributors, registered],
      events,
      logger,
      policy
    });

    contributors.push(registered);
    registry = nextRegistry;
    return api;
  }

  function registerContextContributor({ id, contribute } = {}) {
    if (sealed) {
      throw new Error("Action catalogue registration is closed after discovery or execution begins.");
    }
    const contributorId = String(id || "").trim();
    if (!contributorId) {
      throw new TypeError("Action context contributor id is required.");
    }
    if (typeof contribute !== "function") {
      throw new TypeError(`Action context contributor "${contributorId}" requires contribute().`);
    }
    if (contextContributorIds.has(contributorId)) {
      throw new Error(`Action context contributor "${contributorId}" is duplicated.`);
    }
    contextContributorIds.add(contributorId);
    contextContributors.push(Object.freeze({ id: contributorId, contribute }));
    return api;
  }

  function currentRegistry() {
    sealed = true;
    return registry;
  }

  function applyContextDefaults(context, patch) {
    const next = { ...context };
    for (const [key, value] of Object.entries(isRecord(patch) ? patch : {})) {
      if (key === "requestMeta") {
        next.requestMeta = {
          ...(isRecord(value) ? value : {}),
          ...(isRecord(next.requestMeta) ? next.requestMeta : {})
        };
      } else if (!Object.hasOwn(next, key)) {
        next[key] = value;
      }
    }
    return next;
  }

  async function buildExecutionContext({ actionId, version, input, context }) {
    const registryInstance = currentRegistry();
    const definition = registryInstance.getDefinition(actionId, version);
    let enriched = { ...(isRecord(context) ? context : {}) };
    for (const contributor of contextContributors) {
      const patch = await contributor.contribute(Object.freeze({
        actionId: definition.id,
        version: definition.version,
        definition,
        input: Object.freeze({ ...(isRecord(input) ? input : {}) }),
        context: Object.freeze({ ...enriched })
      }));
      enriched = applyContextDefaults(enriched, patch);
    }
    return Object.freeze(enriched);
  }

  async function run(method, payload = {}) {
    const source = payload && typeof payload === "object" ? payload : {};
    const input = source.input && typeof source.input === "object" ? source.input : {};
    const version = source.version == null ? null : source.version;
    const context = await buildExecutionContext({
      actionId: source.actionId,
      version,
      input,
      context: source.context
    });
    return currentRegistry()[method]({
      actionId: source.actionId,
      version,
      input,
      context,
      deps: isRecord(source.deps) ? source.deps : {}
    });
  }

  function execute(payload) {
    return run("execute", payload);
  }

  function executeStream(payload) {
    return run("executeStream", payload);
  }

  function listDefinitions() {
    return currentRegistry().listDefinitions();
  }

  function getDefinition(actionId, version = null) {
    return currentRegistry().getDefinition(actionId, version);
  }

  const api = Object.freeze({
    register,
    registerContextContributor,
    execute,
    executeStream,
    listDefinitions,
    getDefinition
  });
  return api;
}

export { createActionCatalogue };
