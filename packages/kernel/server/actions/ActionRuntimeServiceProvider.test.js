import assert from "node:assert/strict";
import test from "node:test";

import { KERNEL_TOKENS } from "../../shared/support/tokens.js";
import { OBJECT_INPUT_SCHEMA, allowPublic } from "../../shared/actions/actionContributorHelpers.js";
import {
  ActionRuntimeServiceProvider,
  registerActionDefinitions,
  registerActionContextContributor,
  resolveActionContributors,
  resolveActionContextContributors
} from "./ActionRuntimeServiceProvider.js";

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

test("ActionRuntimeServiceProvider registers runtime actions api and action executor", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  assert.equal(app.singletons.has("runtime.actions"), true);
  assert.equal(app.singletons.has("actionRegistry"), true);
  assert.equal(app.singletons.has("actionExecutor"), true);

  const api = app.make("runtime.actions");
  assert.equal(typeof api.createActionRegistry, "function");
  assert.equal(typeof app.make("actionExecutor")?.execute, "function");
});

test("ActionRuntimeServiceProvider materializes dependencies and surfaces for registered action bundles", async () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.singleton(KERNEL_TOKENS.SurfaceRuntime, () => ({
    listEnabledSurfaceIds() {
      return ["app", "admin", "console"];
    },
    listWorkspaceSurfaceIds() {
      return ["app", "admin"];
    }
  }));

  app.singleton("test.echo.service", () => ({
    echo(input) {
      return { echoed: input, ok: true };
    }
  }));

  registerActionDefinitions(app, "test.actionDefinitions", {
    contributorId: "test.actions",
    domain: "workspace",
    dependencies: {
      echoService: "test.echo.service"
    },
    actions: [
      {
        id: "test.echo",
        version: 1,
        kind: "query",
        channels: ["internal"],
        surfacesFrom: "workspace",
        visibility: "public",
        input: { schema: OBJECT_INPUT_SCHEMA },
        permission: allowPublic,
        idempotency: "none",
        audit: { actionName: "test.echo" },
        observability: {},
        async execute(input, _context, deps) {
          return deps.echoService.echo(input);
        }
      }
    ]
  });

  const actionExecutor = app.make("actionExecutor");
  const definitions = actionExecutor.listDefinitions();
  assert.equal(definitions.some((definition) => definition.id === "test.echo"), true);
  assert.deepEqual(definitions.find((definition) => definition.id === "test.echo")?.surfaces, ["app", "admin"]);

  const result = await actionExecutor.execute({
    actionId: "test.echo",
    input: { value: "ok" },
    context: { channel: "internal", surface: "app" }
  });
  assert.deepEqual(result, { echoed: { value: "ok" }, ok: true });
});

test("registerActionDefinitions + resolveActionContributors provide canonical contributor wiring", () => {
  const app = createSingletonApp();
  app.singleton(KERNEL_TOKENS.SurfaceRuntime, () => ({
    listEnabledSurfaceIds() {
      return ["app", "admin", "console"];
    },
    listWorkspaceSurfaceIds() {
      return ["app", "admin"];
    }
  }));

  registerActionDefinitions(app, "test.actionDefinitions.alpha", {
    contributorId: "alpha",
    domain: "settings",
    actions: []
  });
  registerActionDefinitions(app, "test.actionDefinitions.beta", {
    contributorId: "beta",
    domain: "auth",
    actions: []
  });

  const contributors = resolveActionContributors(app);
  assert.deepEqual(
    contributors.map((entry) => entry.contributorId).sort(),
    ["alpha", "beta"]
  );
});

test("registerActionDefinitions skips disabled bundles", () => {
  const app = createSingletonApp();
  app.singleton("test.null.service", () => null);

  registerActionDefinitions(app, "test.actionDefinitions.alpha", {
    contributorId: "alpha",
    domain: "auth",
    dependencies: {
      authService: "test.null.service"
    },
    enabled({ deps }) {
      return deps.authService != null;
    },
    actions: []
  });

  const contributors = resolveActionContributors(app);
  assert.deepEqual(contributors, []);
});

test("registerActionContextContributor + resolveActionContextContributors provide context contributor wiring", () => {
  const app = createSingletonApp();

  registerActionContextContributor(app, "test.actionContextContributor.alpha", () => ({
    contributorId: "alpha",
    contribute() {
      return { actor: null };
    }
  }));
  registerActionContextContributor(app, "test.actionContextContributor.beta", () => ({
    contributorId: "beta",
    contribute() {
      return { permissions: [] };
    }
  }));

  const contributors = resolveActionContextContributors(app);
  assert.deepEqual(
    contributors.map((entry) => entry.contributorId).sort(),
    ["alpha", "beta"]
  );
});
