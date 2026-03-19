import * as actionRuntime from "../../shared/actions/index.js";
import { createSurfaceRuntime } from "../../shared/surface/runtime.js";
import { KERNEL_TOKENS } from "../../shared/support/tokens.js";
import { installServiceRegistrationApi } from "../runtime/serviceRegistration.js";

const ACTION_RUNTIME_API = Object.freeze({
  ...actionRuntime
});
const ACTION_RUNTIME_CONTRIBUTOR_TAG = Symbol.for("jskit.runtime.actions.contributors");
const ACTION_CONTEXT_CONTRIBUTOR_TAG = Symbol.for("jskit.runtime.actions.contextContributors");
const LOGGER_TOKEN = Symbol.for("jskit.logger");
const ACTION_SURFACE_SOURCE_SET = new Set(["enabled", "console"]);
let ACTION_RUNTIME_CONTRIBUTOR_INDEX = 0;

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function isContainerToken(value) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return typeof value === "symbol" || typeof value === "function";
}

function normalizeDependencyMap(value, { context = "action dependencies" } = {}) {
  const source = normalizePlainObject(value);
  const normalized = {};

  for (const [key, token] of Object.entries(source)) {
    const dependencyName = String(key || "").trim();
    if (!dependencyName) {
      throw new Error(`${context} keys must be non-empty strings.`);
    }
    if (!isContainerToken(token)) {
      throw new Error(`${context}.${dependencyName} must be a valid container token.`);
    }
    normalized[dependencyName] = token;
  }

  return Object.freeze(normalized);
}

function normalizeContributorList(value) {
  const queue = Array.isArray(value) ? [...value] : [value];
  const contributors = [];
  while (queue.length > 0) {
    const entry = queue.shift();
    if (Array.isArray(entry)) {
      queue.push(...entry);
      continue;
    }
    if (entry == null) {
      continue;
    }
    contributors.push(entry);
  }
  return contributors;
}

function normalizeActionContextContributor(entry) {
  if (typeof entry === "function") {
    return {
      contributorId: String(entry.name || "anonymous"),
      contribute: entry
    };
  }

  if (entry && typeof entry === "object" && typeof entry.contribute === "function") {
    return {
      ...entry,
      contributorId: String(entry.contributorId || "anonymous")
    };
  }

  return null;
}

function resolveTaggedEntries(scope, tagName) {
  if (!scope || typeof scope.resolveTag !== "function") {
    return [];
  }
  return normalizeContributorList(scope.resolveTag(tagName));
}

function resolveActionContributors(scope) {
  return resolveTaggedEntries(scope, ACTION_RUNTIME_CONTRIBUTOR_TAG).filter(
    (entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  );
}

function resolveActionContextContributors(scope) {
  return resolveTaggedEntries(scope, ACTION_CONTEXT_CONTRIBUTOR_TAG)
    .map((entry) => normalizeActionContextContributor(entry))
    .filter(Boolean);
}

function createActionExecutor(actionRegistry) {
  return Object.freeze({
    execute(payload) {
      const source = normalizePlainObject(payload);
      return actionRegistry.execute({
        actionId: source.actionId,
        version: source.version == null ? null : source.version,
        input: normalizePlainObject(source.input),
        context: normalizePlainObject(source.context),
        deps: normalizePlainObject(source.deps)
      });
    },
    executeStream(payload) {
      const source = normalizePlainObject(payload);
      return actionRegistry.executeStream({
        actionId: source.actionId,
        version: source.version == null ? null : source.version,
        input: normalizePlainObject(source.input),
        context: normalizePlainObject(source.context),
        deps: normalizePlainObject(source.deps)
      });
    },
    listDefinitions() {
      return actionRegistry.listDefinitions();
    },
    getDefinition(actionId, version = null) {
      return actionRegistry.getDefinition(actionId, version);
    }
  });
}

function registerTaggedContributor(app, token, factory, tagName, label) {
  if (!app || typeof app.singleton !== "function" || typeof app.tag !== "function") {
    throw new Error(`${label} requires application singleton()/tag().`);
  }

  app.singleton(token, factory);
  app.tag(token, tagName);
}

function createActionContributorToken() {
  ACTION_RUNTIME_CONTRIBUTOR_INDEX += 1;
  return Symbol(`jskit.runtime.actions.contributor.${ACTION_RUNTIME_CONTRIBUTOR_INDEX}`);
}

function resolveSurfaceRuntime(scope) {
  if (!scope || typeof scope.has !== "function" || typeof scope.make !== "function") {
    throw new Error("Action definition materialization requires scope.has()/make().");
  }
  if (!scope.has(KERNEL_TOKENS.SurfaceRuntime)) {
    if (scope.has("appConfig")) {
      const appConfig = normalizePlainObject(scope.make("appConfig"));
      const surfaceDefinitions = normalizePlainObject(appConfig.surfaceDefinitions);
      if (Object.keys(surfaceDefinitions).length > 0) {
        return createSurfaceRuntime({
          allMode: appConfig.surfaceModeAll,
          surfaces: surfaceDefinitions,
          defaultSurfaceId: appConfig.surfaceDefaultId
        });
      }
    }
    throw new Error("Action definition surfacesFrom requires KERNEL_TOKENS.SurfaceRuntime or appConfig.surfaceDefinitions.");
  }
  return scope.make(KERNEL_TOKENS.SurfaceRuntime);
}

function resolveSurfaceIdsFromSource(scope, sourceName, { context = "action.surfacesFrom" } = {}) {
  const normalizedSource = String(sourceName || "").trim().toLowerCase();
  if (!ACTION_SURFACE_SOURCE_SET.has(normalizedSource)) {
    throw new Error(`${context} must be one of: enabled, console.`);
  }

  const surfaceRuntime = resolveSurfaceRuntime(scope);
  if (normalizedSource === "enabled") {
    return Object.freeze([...(surfaceRuntime.listEnabledSurfaceIds?.() || [])]);
  }

  return Object.freeze(
    [...(surfaceRuntime.listEnabledSurfaceIds?.() || [])].filter(
      (surfaceId) => String(surfaceId || "").trim().toLowerCase() === "console"
    )
  );
}

function materializeDependencies(scope, dependencyMap, { context = "action.dependencies" } = {}) {
  const normalizedMap = normalizeDependencyMap(dependencyMap, { context });
  const resolved = {};
  for (const [name, token] of Object.entries(normalizedMap)) {
    resolved[name] = scope.make(token);
  }
  return Object.freeze(resolved);
}

function materializeAction(scope, actionDefinition) {
  const source = normalizePlainObject(actionDefinition);
  const materialized = { ...source };
  const actionDependencies = materializeDependencies(scope, source.dependencies, {
    context: `action ${String(source.id || "<unknown>")}.dependencies`
  });
  const resolvedDependencies = actionDependencies;

  if (Object.hasOwn(source, "surfaces") && Object.hasOwn(source, "surfacesFrom")) {
    throw new Error(`Action ${String(source.id || "<unknown>")} cannot define both surfaces and surfacesFrom.`);
  }

  delete materialized.dependencies;
  delete materialized.surfacesFrom;

  if (Object.hasOwn(source, "surfacesFrom")) {
    const resolvedSurfaces = resolveSurfaceIdsFromSource(scope, source.surfacesFrom, {
      context: `action ${String(source.id || "<unknown>")}.surfacesFrom`
    });
    if (resolvedSurfaces.length < 1) {
      return null;
    }
    materialized.surfaces = resolvedSurfaces;
  }

  if (typeof source.execute === "function") {
    materialized.execute = async function executeMaterializedAction(input, context, runtimeDependencies = {}) {
      const runtimeDeps = normalizePlainObject(runtimeDependencies);
      const mergedDependencies = Object.freeze({
        ...resolvedDependencies,
        ...runtimeDeps
      });

      return source.execute(input, context, mergedDependencies);
    };
  }

  return Object.freeze(materialized);
}

function registerActionDefinition(app, actionSpec, { context = "app.action" } = {}) {
  const token = createActionContributorToken();
  registerTaggedContributor(
    app,
    token,
    (scope) => {
      const action = materializeAction(scope, actionSpec.action);
      if (!action) {
        return null;
      }

      return {
        contributorId: actionSpec.contributorId,
        domain: action.domain,
        actions: Object.freeze([action])
      };
    },
    ACTION_RUNTIME_CONTRIBUTOR_TAG,
    context
  );
}

function normalizeSingleActionRegistration(actionDefinition, { context = "app.action" } = {}) {
  const source = normalizePlainObject(actionDefinition);
  const actionId = String(source.id || "").trim();
  const contributorId = String(source.contributorId || "").trim() || (actionId ? `action.${actionId}` : "");
  if (!contributorId) {
    throw new Error(`${context} requires action.id or action.contributorId.`);
  }

  const normalizedAction = {
    ...source
  };
  delete normalizedAction.contributorId;
  normalizedAction.domain = actionRuntime.normalizeActionDomain(normalizedAction.domain, {
    context: `${context} domain`
  });

  return Object.freeze({
    contributorId,
    action: Object.freeze(normalizedAction)
  });
}

function installActionRegistrationApi(app) {
  if (typeof app.action === "function" && typeof app.actions === "function") {
    return;
  }

  const registerActions = function registerActions(actionDefinitions = []) {
    if (!Array.isArray(actionDefinitions)) {
      throw new Error("app.actions requires an array of action definitions.");
    }

    const entries = normalizeContributorList(actionDefinitions);
    for (const entry of entries) {
      this.action(entry);
    }
    return this;
  };

  const registerAction = function registerAction(actionDefinition = {}) {
    const actionSpec = normalizeSingleActionRegistration(actionDefinition, {
      context: "app.action"
    });
    registerActionDefinition(this, actionSpec, { context: "app.action" });
    return this;
  };

  Object.defineProperty(app, "actions", {
    configurable: true,
    writable: true,
    value: registerActions
  });
  Object.defineProperty(app, "action", {
    configurable: true,
    writable: true,
    value: registerAction
  });
}

function registerActionContextContributor(app, token, factory) {
  registerTaggedContributor(
    app,
    token,
    factory,
    ACTION_CONTEXT_CONTRIBUTOR_TAG,
    "registerActionContextContributor"
  );
}

class ActionRuntimeServiceProvider {
  static id = "runtime.actions";

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function" || typeof app.tag !== "function") {
      throw new Error("ActionRuntimeServiceProvider requires application singleton()/has()/tag().");
    }

    installActionRegistrationApi(app);
    installServiceRegistrationApi(app);

    app.singleton("runtime.actions", () => ACTION_RUNTIME_API);

    if (!app.has("actionRegistry")) {
      app.singleton("actionRegistry", (scope) => {
        return actionRuntime.createActionRegistry({
          contributors: resolveActionContributors(scope),
          idempotencyAdapter: actionRuntime.createNoopIdempotencyAdapter(),
          auditAdapter: actionRuntime.createNoopAuditAdapter(),
          observabilityAdapter: actionRuntime.createNoopObservabilityAdapter(),
          logger: scope.has(LOGGER_TOKEN) ? scope.make(LOGGER_TOKEN) : console
        });
      });
    }

    if (!app.has("actionExecutor")) {
      app.singleton("actionExecutor", (scope) => createActionExecutor(scope.make("actionRegistry")));
    }
  }

  boot() {}
}

export {
  ACTION_RUNTIME_CONTRIBUTOR_TAG,
  ACTION_CONTEXT_CONTRIBUTOR_TAG,
  resolveActionContributors,
  resolveActionContextContributors,
  registerActionContextContributor,
  ActionRuntimeServiceProvider
};
