import * as actionRuntimeCore from "../../lib/index.js";

const ACTION_RUNTIME_CORE_API = Object.freeze({
  ...actionRuntimeCore
});
const ACTION_RUNTIME_CONTRIBUTOR_TAG = "runtime.actions.contributors";
const LOGGER_TOKEN = Symbol.for("jskit.logger");

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
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
    if (entry && typeof entry === "object") {
      contributors.push(entry);
    }
  }
  return contributors;
}

function resolveActionContributors(scope) {
  if (!scope || typeof scope.resolveTag !== "function") {
    return [];
  }
  return normalizeContributorList(scope.resolveTag(ACTION_RUNTIME_CONTRIBUTOR_TAG));
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

class ActionRuntimeCoreServiceProvider {
  static id = "runtime.actions";

  register(app) {
    if (!app || typeof app.singleton !== "function" || typeof app.has !== "function") {
      throw new Error("ActionRuntimeCoreServiceProvider requires application singleton()/has().");
    }

    app.singleton("runtime.actions", () => ACTION_RUNTIME_CORE_API);

    if (!app.has("actionRegistry")) {
      app.singleton("actionRegistry", (scope) => {
        const contributors = resolveActionContributors(scope);
        if (contributors.length < 1) {
          return null;
        }

        return actionRuntimeCore.createActionRegistry({
          contributors,
          permissionEvaluator: actionRuntimeCore.createPermissionEvaluator(),
          idempotencyAdapter: actionRuntimeCore.createNoopIdempotencyAdapter(),
          auditAdapter: actionRuntimeCore.createNoopAuditAdapter(),
          observabilityAdapter: actionRuntimeCore.createNoopObservabilityAdapter(),
          logger: scope.has(LOGGER_TOKEN) ? scope.make(LOGGER_TOKEN) : console
        });
      });
    }

    if (!app.has("actionExecutor")) {
      app.singleton("actionExecutor", (scope) => {
        const actionRegistry = scope.make("actionRegistry");
        if (!actionRegistry) {
          return null;
        }
        return createActionExecutor(actionRegistry);
      });
    }
  }

  boot() {}
}

export { ACTION_RUNTIME_CONTRIBUTOR_TAG, ActionRuntimeCoreServiceProvider };
