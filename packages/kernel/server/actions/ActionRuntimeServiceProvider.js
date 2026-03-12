import * as actionRuntime from "../../shared/actions/index.js";
import { KERNEL_TOKENS } from "../../shared/support/tokens.js";

const ACTION_RUNTIME_API = Object.freeze({
  ...actionRuntime
});
const ACTION_RUNTIME_CONTRIBUTOR_TAG = Symbol.for("jskit.runtime.actions.contributors");
const ACTION_CONTEXT_CONTRIBUTOR_TAG = Symbol.for("jskit.runtime.actions.contextContributors");
const LOGGER_TOKEN = Symbol.for("jskit.logger");
const ACTION_SURFACE_SOURCE_SET = new Set(["enabled", "workspace", "console"]);

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

function normalizeActionBundleSpec(definitionSet, { context = "registerActionDefinitions" } = {}) {
  const source = normalizePlainObject(definitionSet);
  const contributorId = String(source.contributorId || "").trim();
  const domain = actionRuntime.normalizeActionDomain(source.domain, {
    context: `${context} domain`
  });
  const actions = Array.isArray(source.actions) ? [...source.actions] : [];
  const enabled = source.enabled;

  if (!contributorId) {
    throw new Error(`${context} contributorId is required.`);
  }
  if (typeof enabled !== "undefined" && typeof enabled !== "function") {
    throw new Error(`${context} enabled must be a function when provided.`);
  }

  return Object.freeze({
    contributorId,
    domain,
    dependencies: normalizeDependencyMap(source.dependencies, {
      context: `${context}.dependencies`
    }),
    enabled: typeof enabled === "function" ? enabled : null,
    actions: Object.freeze(actions)
  });
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

function resolveSurfaceRuntime(scope) {
  if (!scope || typeof scope.has !== "function" || typeof scope.make !== "function") {
    throw new Error("Action definition materialization requires scope.has()/make().");
  }
  if (!scope.has(KERNEL_TOKENS.SurfaceRuntime)) {
    throw new Error("Action definition surfacesFrom requires KERNEL_TOKENS.SurfaceRuntime.");
  }
  return scope.make(KERNEL_TOKENS.SurfaceRuntime);
}

function resolveSurfaceIdsFromSource(scope, sourceName, { context = "action.surfacesFrom" } = {}) {
  const normalizedSource = String(sourceName || "").trim().toLowerCase();
  if (!ACTION_SURFACE_SOURCE_SET.has(normalizedSource)) {
    throw new Error(`${context} must be one of: enabled, workspace, console.`);
  }

  const surfaceRuntime = resolveSurfaceRuntime(scope);
  if (normalizedSource === "enabled") {
    return Object.freeze([...(surfaceRuntime.listEnabledSurfaceIds?.() || [])]);
  }
  if (normalizedSource === "workspace") {
    return Object.freeze([...(surfaceRuntime.listWorkspaceSurfaceIds?.() || [])]);
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

function materializeAction(scope, actionDefinition, bundleSpec, { bundleDependencies } = {}) {
  const source = normalizePlainObject(actionDefinition);
  const materialized = { ...source };
  const actionDependencies = materializeDependencies(scope, source.dependencies, {
    context: `action ${String(source.id || "<unknown>")}.dependencies`
  });
  const resolvedDependencies = Object.freeze({
    ...bundleDependencies,
    ...actionDependencies
  });

  if (Object.hasOwn(source, "surfaces") && Object.hasOwn(source, "surfacesFrom")) {
    throw new Error(`Action ${String(source.id || "<unknown>")} cannot define both surfaces and surfacesFrom.`);
  }

  delete materialized.dependencies;
  delete materialized.surfacesFrom;

  if (!Object.hasOwn(materialized, "domain")) {
    materialized.domain = bundleSpec.domain;
  }

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
    materialized.execute = async function executeMaterializedAction(input, context) {
      return source.execute(input, context, resolvedDependencies);
    };
  }

  return Object.freeze(materialized);
}

function materializeActionBundle(scope, bundleSpec) {
  const bundleDependencies = materializeDependencies(scope, bundleSpec.dependencies, {
    context: `action bundle ${bundleSpec.contributorId}.dependencies`
  });

  if (bundleSpec.enabled && bundleSpec.enabled({ scope, deps: bundleDependencies }) !== true) {
    return null;
  }

  const actions = [];
  for (const actionDefinition of bundleSpec.actions) {
    const materialized = materializeAction(scope, actionDefinition, bundleSpec, {
      bundleDependencies
    });
    if (materialized) {
      actions.push(materialized);
    }
  }

  return {
    contributorId: bundleSpec.contributorId,
    domain: bundleSpec.domain,
    actions: Object.freeze(actions)
  };
}

function registerActionDefinitions(app, token, definitionSet) {
  const bundleSpec = normalizeActionBundleSpec(definitionSet, {
    context: `registerActionDefinitions(${String(token)})`
  });

  registerTaggedContributor(
    app,
    token,
    (scope) => materializeActionBundle(scope, bundleSpec),
    ACTION_RUNTIME_CONTRIBUTOR_TAG,
    "registerActionDefinitions"
  );
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
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("ActionRuntimeServiceProvider requires application singleton()/has().");
    }

    app.singleton("runtime.actions", () => ACTION_RUNTIME_API);

    if (!app.has("actionRegistry")) {
      app.singleton("actionRegistry", (scope) => {
        return actionRuntime.createActionRegistry({
          contributors: resolveActionContributors(scope),
          permissionEvaluator: actionRuntime.createPermissionEvaluator(),
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
  registerActionDefinitions,
  registerActionContextContributor,
  ActionRuntimeServiceProvider
};
