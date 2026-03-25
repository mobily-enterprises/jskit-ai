import { normalizeActionDomain } from "../../shared/actions/actionDefinitions.js";
import { createNoopAuditAdapter } from "../../shared/actions/audit.js";
import { createNoopIdempotencyAdapter } from "../../shared/actions/idempotency.js";
import { createNoopObservabilityAdapter } from "../../shared/actions/observability.js";
import { createActionRegistry } from "../../shared/actions/registry.js";
import { createSurfaceRuntime } from "../../shared/surface/runtime.js";
import { isContainerToken } from "../../shared/support/containerToken.js";
import { normalizeObject } from "../../shared/support/normalize.js";
import { installServiceRegistrationApi } from "../registries/serviceRegistrationRegistry.js";
import {
  ensureActionSurfaceSourceRegistry,
  resolveActionSurfaceSourceIds
} from "../registries/actionSurfaceSourceRegistry.js";
import {
  normalizeContributorEntry,
  normalizeNestedEntries,
  registerTaggedSingleton,
  resolveTaggedEntries as resolveRegistryTaggedEntries
} from "../registries/primitives.js";

const ACTION_RUNTIME_API = Object.freeze({
  createActionRegistry,
  createNoopIdempotencyAdapter,
  createNoopAuditAdapter,
  createNoopObservabilityAdapter
});
let ACTION_RUNTIME_CONTRIBUTOR_INDEX = 0;

function createSurfaceRuntimeFromAppConfig(scope) {
  if (!scope || typeof scope.has !== "function" || typeof scope.make !== "function") {
    throw new Error("Surface runtime registration requires scope.has()/make().");
  }

  if (!scope.has("appConfig")) {
    throw new Error(
      "ActionRuntimeServiceProvider requires appConfig.surfaceDefinitions when jskit.surface.runtime is not registered."
    );
  }

  const appConfig = normalizeObject(scope.make("appConfig"));
  const surfaceDefinitions = normalizeObject(appConfig.surfaceDefinitions);
  if (Object.keys(surfaceDefinitions).length < 1) {
    throw new Error(
      "ActionRuntimeServiceProvider requires appConfig.surfaceDefinitions when jskit.surface.runtime is not registered."
    );
  }

  return createSurfaceRuntime({
    allMode: appConfig.surfaceModeAll,
    surfaces: surfaceDefinitions,
    defaultSurfaceId: appConfig.surfaceDefaultId
  });
}

function normalizeDependencyMap(value, { context = "action dependencies" } = {}) {
  const source = normalizeObject(value);
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

function resolveActionContributors(scope) {
  return resolveRegistryTaggedEntries(scope, "jskit.runtime.actions.contributors").filter(
    (entry) => entry && typeof entry === "object" && !Array.isArray(entry)
  );
}

function resolveActionContextContributors(scope) {
  return resolveRegistryTaggedEntries(scope, "jskit.runtime.actions.contextContributors")
    .map((entry) => normalizeContributorEntry(entry))
    .filter(Boolean);
}

function createActionExecutor(actionRegistry) {
  return Object.freeze({
    execute(payload) {
      const source = normalizeObject(payload);
      return actionRegistry.execute({
        actionId: source.actionId,
        version: source.version == null ? null : source.version,
        input: normalizeObject(source.input),
        context: normalizeObject(source.context),
        deps: normalizeObject(source.deps)
      });
    },
    executeStream(payload) {
      const source = normalizeObject(payload);
      return actionRegistry.executeStream({
        actionId: source.actionId,
        version: source.version == null ? null : source.version,
        input: normalizeObject(source.input),
        context: normalizeObject(source.context),
        deps: normalizeObject(source.deps)
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

function createActionContributorToken() {
  ACTION_RUNTIME_CONTRIBUTOR_INDEX += 1;
  return Symbol(`jskit.runtime.actions.contributor.${ACTION_RUNTIME_CONTRIBUTOR_INDEX}`);
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
  const source = normalizeObject(actionDefinition);
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
    const resolvedSurfaces = resolveActionSurfaceSourceIds(scope, source.surfacesFrom, {
      context: `action ${String(source.id || "<unknown>")}.surfacesFrom`
    });
    if (resolvedSurfaces.length < 1) {
      return null;
    }
    materialized.surfaces = resolvedSurfaces;
  }

  if (typeof source.execute === "function") {
    materialized.execute = async function executeMaterializedAction(input, context, runtimeDependencies = {}) {
      const runtimeDeps = normalizeObject(runtimeDependencies);
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
  registerTaggedSingleton(
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
    "jskit.runtime.actions.contributors",
    { context }
  );
}

function normalizeSingleActionRegistration(actionDefinition, { context = "app.action" } = {}) {
  const source = normalizeObject(actionDefinition);
  const actionId = String(source.id || "").trim();
  const contributorId = String(source.contributorId || "").trim() || (actionId ? `action.${actionId}` : "");
  if (!contributorId) {
    throw new Error(`${context} requires action.id or action.contributorId.`);
  }

  const normalizedAction = {
    ...source
  };
  delete normalizedAction.contributorId;
  normalizedAction.domain = normalizeActionDomain(normalizedAction.domain, {
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

    const entries = normalizeNestedEntries(actionDefinitions);
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
  registerTaggedSingleton(
    app,
    token,
    factory,
    "jskit.runtime.actions.contextContributors",
    { context: "registerActionContextContributor" }
  );
}

class ActionRuntimeServiceProvider {
  static id = "runtime.actions";

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function" || typeof app.tag !== "function") {
      throw new Error("ActionRuntimeServiceProvider requires application singleton()/has()/tag().");
    }

    installActionRegistrationApi(app);
    ensureActionSurfaceSourceRegistry(app);
    installServiceRegistrationApi(app);

    if (!app.has("jskit.surface.runtime")) {
      app.singleton("jskit.surface.runtime", (scope) => createSurfaceRuntimeFromAppConfig(scope));
    }

    app.singleton("runtime.actions", () => ACTION_RUNTIME_API);

    if (!app.has("actionRegistry")) {
      app.singleton("actionRegistry", (scope) => {
        return createActionRegistry({
          contributors: resolveActionContributors(scope),
          idempotencyAdapter: createNoopIdempotencyAdapter(),
          auditAdapter: createNoopAuditAdapter(),
          observabilityAdapter: createNoopObservabilityAdapter(),
          logger: scope.has("jskit.logger") ? scope.make("jskit.logger") : console
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
  resolveActionContributors,
  resolveActionContextContributors,
  registerActionContextContributor,
  ActionRuntimeServiceProvider
};
