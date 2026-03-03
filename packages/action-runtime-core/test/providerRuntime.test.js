import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveActionContributors,
  registerActionContributor,
  ActionRuntimeCoreServiceProvider
} from "../src/server/providers/ActionRuntimeCoreServiceProvider.js";
import { ActionRuntimeCoreClientProvider } from "../src/client/providers/ActionRuntimeCoreClientProvider.js";
import { OBJECT_INPUT_SCHEMA, allowPublic } from "../src/lib/actionContributorHelpers.js";

function createSingletonApp() {
  const singletons = new Map();
  const instances = new Map();
  const tags = new Map();
  return {
    singletons,
    has(token) {
      return singletons.has(token) || instances.has(token);
    },
    singleton(token, factory) {
      singletons.set(token, {
        factory,
        resolved: false,
        value: undefined
      });
    },
    tag(token, tagName) {
      if (!this.has(token)) {
        throw new Error(`Cannot tag unresolved token "${String(token)}".`);
      }
      if (!tags.has(tagName)) {
        tags.set(tagName, new Set());
      }
      tags.get(tagName).add(token);
    },
    resolveTag(tagName) {
      const tagged = tags.get(tagName);
      if (!tagged) {
        return [];
      }
      return [...tagged].map((token) => this.make(token));
    },
    make(token) {
      if (instances.has(token)) {
        return instances.get(token);
      }
      if (!singletons.has(token)) {
        throw new Error(`Token "${String(token)}" is not registered.`);
      }
      const entry = singletons.get(token);
      if (!entry.resolved) {
        entry.value = entry.factory(this);
        entry.resolved = true;
        instances.set(token, entry.value);
      }
      return entry.value;
    }
  };
}

test("ActionRuntimeCoreServiceProvider registers runtime actions api", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeCoreServiceProvider();
  provider.register(app);

  assert.equal(app.singletons.has("runtime.actions"), true);
  const api = app.make("runtime.actions");
  assert.equal(typeof api.createActionRegistry, "function");
});

test("ActionRuntimeCoreServiceProvider builds actionExecutor from registered contributors", async () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeCoreServiceProvider();
  provider.register(app);

  registerActionContributor(app, "test.actionContributor", () => ({
    contributorId: "test.actions",
    domain: "auth",
    actions: [
      {
        id: "test.echo",
        version: 1,
        kind: "query",
        channels: ["internal"],
        surfaces: ["app"],
        visibility: "public",
        inputSchema: OBJECT_INPUT_SCHEMA,
        permission: allowPublic,
        idempotency: "none",
        audit: { actionName: "test.echo" },
        observability: {},
        async execute(input) {
          return { echoed: input };
        }
      }
    ]
  }));

  const actionExecutor = app.make("actionExecutor");
  assert.equal(typeof actionExecutor?.execute, "function");
  assert.equal(actionExecutor.listDefinitions().some((definition) => definition.id === "test.echo"), true);

  const result = await actionExecutor.execute({
    actionId: "test.echo",
    input: { value: "ok" }
  });
  assert.deepEqual(result, { echoed: { value: "ok" } });
});

test("registerActionContributor + resolveActionContributors provide canonical contributor wiring", () => {
  const app = createSingletonApp();

  registerActionContributor(app, "test.actionContributor.alpha", () => ({ contributorId: "alpha", actions: [] }));
  registerActionContributor(app, "test.actionContributor.beta", () => [{ contributorId: "beta", actions: [] }]);

  const contributors = resolveActionContributors(app);
  assert.deepEqual(
    contributors.map((entry) => entry.contributorId).sort(),
    ["alpha", "beta"]
  );
});

test("ActionRuntimeCoreClientProvider registers runtime actions client api", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeCoreClientProvider();
  provider.register(app);

  assert.equal(app.singletons.has("runtime.actions.client"), true);
  const api = app.make("runtime.actions.client");
  assert.equal(typeof api.createActionRegistry, "function");
});
