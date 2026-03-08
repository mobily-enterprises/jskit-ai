import * as actionRuntime from "../../shared/actions/index.js";

const ACTION_RUNTIME_API = Object.freeze({
  ...actionRuntime
});
const ACTION_RUNTIME_CONTRIBUTOR_TAG = Symbol.for("jskit.runtime.actions.contributors");
const ACTION_CONTEXT_CONTRIBUTOR_TAG = Symbol.for("jskit.runtime.actions.contextContributors");
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

function registerActionContributor(app, token, factory) {
  registerTaggedContributor(app, token, factory, ACTION_RUNTIME_CONTRIBUTOR_TAG, "registerActionContributor");
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
  registerActionContributor,
  registerActionContextContributor,
  ActionRuntimeServiceProvider
};
