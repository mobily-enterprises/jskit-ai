import { createActionRegistry } from "../../shared/actions/registry.js";
import { isRecord } from "../../shared/support/normalize.js";

function normalizeRegistration(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Action catalogue registration must be an action contributor object.");
  }

  return value;
}

function createActionCatalogue({
  idempotencyAdapter,
  auditAdapter,
  observabilityAdapter,
  events,
  logger = null
} = {}) {
  const contributors = [];
  const contextContributors = [];
  const contextContributorIds = new Set();
  let registry = createActionRegistry({
    contributors,
    idempotencyAdapter,
    auditAdapter,
    observabilityAdapter,
    events,
    logger
  });
  let sealed = false;

  function register(contributor) {
    if (sealed) {
      throw new Error("Action catalogue registration is closed after discovery or execution begins.");
    }
    const nextContributors = [...contributors, normalizeRegistration(contributor)];
    const nextRegistry = createActionRegistry({
      contributors: nextContributors,
      idempotencyAdapter,
      auditAdapter,
      observabilityAdapter,
      events,
      logger
    });

    contributors.push(contributor);
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

  async function execute(payload = {}) {
    const source = payload && typeof payload === "object" ? payload : {};
    const input = source.input && typeof source.input === "object" ? source.input : {};
    const context = await buildExecutionContext({
      actionId: source.actionId,
      version: source.version == null ? null : source.version,
      input,
      context: source.context
    });
    return currentRegistry().execute({
      actionId: source.actionId,
      version: source.version == null ? null : source.version,
      input,
      context,
      deps: isRecord(source.deps) ? source.deps : {}
    });
  }

  async function executeStream(payload = {}) {
    const source = payload && typeof payload === "object" ? payload : {};
    const input = source.input && typeof source.input === "object" ? source.input : {};
    const context = await buildExecutionContext({
      actionId: source.actionId,
      version: source.version == null ? null : source.version,
      input,
      context: source.context
    });
    return currentRegistry().executeStream({
      actionId: source.actionId,
      version: source.version == null ? null : source.version,
      input,
      context,
      deps: isRecord(source.deps) ? source.deps : {}
    });
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
