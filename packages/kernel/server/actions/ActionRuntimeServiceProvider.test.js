import assert from "node:assert/strict";
import test from "node:test";

import { KERNEL_TOKENS } from "../../shared/support/tokens.js";
import {
  EMPTY_INPUT_VALIDATOR,
  OBJECT_INPUT_VALIDATOR,
  allowPublic
} from "../../shared/actions/actionContributorHelpers.js";
import {
  ActionRuntimeServiceProvider,
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
  assert.equal(typeof app.action, "function");
  assert.equal(typeof app.actions, "function");

  const api = app.make("runtime.actions");
  assert.equal(typeof api.createActionRegistry, "function");
  assert.equal(typeof app.make("actionExecutor")?.execute, "function");
});

test("ActionRuntimeServiceProvider materializes dependencies and surfaces for app.actions bundles", async () => {
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

  app.actions({
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
        consoleUsersOnly: false,
        input: { schema: OBJECT_INPUT_VALIDATOR },
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

test("app.actions + resolveActionContributors provide canonical contributor wiring", () => {
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

  app.actions({
    contributorId: "alpha",
    domain: "settings",
    actions: []
  });
  app.actions({
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

test("app.actions accepts custom action domains", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.actions({
    contributorId: "custom",
    domain: "completeCalendar",
    actions: []
  });

  const contributors = resolveActionContributors(app);
  assert.equal(contributors.length, 1);
  assert.equal(contributors[0].contributorId, "custom");
  assert.equal(contributors[0].domain, "completecalendar");
});

test("app.action registers a single action with default contributor id", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.action({
    id: "test.single",
    domain: "workspace",
    kind: "query",
    channels: ["internal"],
    surfaces: ["app"],
    consoleUsersOnly: false,
    input: EMPTY_INPUT_VALIDATOR,
    permission: allowPublic,
    idempotency: "none",
    audit: { actionName: "test.single" },
    observability: {},
    async execute() {
      return { ok: true };
    }
  });

  const contributors = resolveActionContributors(app);
  assert.equal(contributors.length, 1);
  assert.equal(contributors[0].contributorId, "action.test.single");
  assert.equal(contributors[0].actions.length, 1);
  assert.equal(contributors[0].actions[0].id, "test.single");
});

test("app.actions skips disabled bundles", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);
  app.singleton("test.null.service", () => null);

  app.actions({
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

test("EMPTY_INPUT_VALIDATOR allows empty input and rejects unexpected fields", async () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.singleton(KERNEL_TOKENS.SurfaceRuntime, () => ({
    listEnabledSurfaceIds() {
      return ["app"];
    },
    listWorkspaceSurfaceIds() {
      return ["app"];
    }
  }));

  app.actions({
    contributorId: "test.empty-input",
    domain: "settings",
    actions: [
      {
        id: "test.empty-input",
        version: 1,
        kind: "query",
        channels: ["internal"],
        surfaces: ["app"],
        consoleUsersOnly: false,
        input: EMPTY_INPUT_VALIDATOR,
        permission: allowPublic,
        idempotency: "none",
        audit: { actionName: "test.empty-input" },
        observability: {},
        async execute() {
          return { ok: true };
        }
      }
    ]
  });

  const actionExecutor = app.make("actionExecutor");

  const okResult = await actionExecutor.execute({
    actionId: "test.empty-input",
    context: { channel: "internal", surface: "app" }
  });
  assert.deepEqual(okResult, { ok: true });

  await assert.rejects(
    () =>
      actionExecutor.execute({
        actionId: "test.empty-input",
        input: { unexpected: true },
        context: { channel: "internal", surface: "app" }
      }),
    (error) => error?.code === "ACTION_VALIDATION_FAILED"
  );
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

test("app.actions rejects invalid domain identifiers", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  assert.throws(
    () =>
      app.actions({
        contributorId: "invalid",
        domain: "invalid domain",
        actions: []
      }),
    /must match/
  );
});
