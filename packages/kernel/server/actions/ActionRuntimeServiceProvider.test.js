import assert from "node:assert/strict";
import test from "node:test";
import { createSchema } from "json-rest-schema";

import {
  emptyInputValidator
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
  assert.equal(app.singletons.has("jskit.surface.runtime"), true);
  assert.equal(typeof app.action, "function");
  assert.equal(typeof app.actions, "function");
  assert.equal(typeof app.actionSurfaceSource, "function");
  assert.equal(typeof app.service, "function");

  const api = app.make("runtime.actions");
  assert.equal(typeof api.createActionRegistry, "function");
  assert.equal(typeof app.make("actionExecutor")?.execute, "function");
});

test("ActionRuntimeServiceProvider materializes dependencies and surfaces for app.actions arrays", async () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.singleton("jskit.surface.runtime", () => ({
    listEnabledSurfaceIds() {
      return ["app", "admin", "console"];
    }
  }));

  app.singleton("test.echo.service", () => ({
    echo(input) {
      return { echoed: input, ok: true };
    }
  }));

  app.actions([
    {
      id: "test.echo",
      domain: "workspace",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfacesFrom: "enabled",
      dependencies: {
        echoService: "test.echo.service"
      },
      input: {
        schema: createSchema({
          value: {
            type: "string",
            required: false
          }
        }),
        mode: "patch"
      },
      idempotency: "none",
      audit: { actionName: "test.echo" },
      observability: {},
      async execute(input, _context, deps) {
        return deps.echoService.echo(input);
      }
    }
  ]);

  const actionExecutor = app.make("actionExecutor");
  const definitions = actionExecutor.listDefinitions();
  assert.equal(definitions.some((definition) => definition.id === "test.echo"), true);
  assert.deepEqual(definitions.find((definition) => definition.id === "test.echo")?.surfaces, ["app", "admin", "console"]);

  const result = await actionExecutor.execute({
    actionId: "test.echo",
    input: { value: "ok" },
    context: { channel: "internal", surface: "app" }
  });
  assert.deepEqual(result, { echoed: { value: "ok" }, ok: true });
});

test("ActionRuntimeServiceProvider registers SurfaceRuntime from appConfig when token is absent", async () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.singleton("appConfig", () => ({
    surfaceModeAll: "all",
    surfaceDefaultId: "home",
    surfaceDefinitions: {
      home: { id: "home", pagesRoot: "", enabled: true, requiresAuth: false, requiresWorkspace: false },
      console: { id: "console", pagesRoot: "console", enabled: true, requiresAuth: true, requiresWorkspace: false }
    }
  }));

  app.actions([
    {
      id: "test.surfaces.from.appconfig",
      domain: "workspace",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfacesFrom: "enabled",
      input: emptyInputValidator,
      idempotency: "none",
      audit: { actionName: "test.surfaces.from.appconfig" },
      observability: {},
      async execute() {
        return { ok: true };
      }
    }
  ]);

  const actionExecutor = app.make("actionExecutor");
  const definition = actionExecutor.getDefinition("test.surfaces.from.appconfig");
  assert.deepEqual(definition.surfaces, ["home", "console"]);
});

test("ActionRuntimeServiceProvider materializes custom surfacesFrom aliases registered via app.actionSurfaceSource", async () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.singleton("jskit.surface.runtime", () => ({
    listEnabledSurfaceIds() {
      return ["home", "app", "admin", "console"];
    }
  }));

  app.actionSurfaceSource("workspace", () => ["app", "admin"]);

  app.actions([
    {
      id: "test.workspace.alias",
      domain: "workspace",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfacesFrom: "workspace",
      input: emptyInputValidator,
      idempotency: "none",
      audit: { actionName: "test.workspace.alias" },
      observability: {},
      async execute() {
        return { ok: true };
      }
    }
  ]);

  const actionExecutor = app.make("actionExecutor");
  const definition = actionExecutor.getDefinition("test.workspace.alias");
  assert.deepEqual(definition?.surfaces, ["app", "admin"]);
});

test("ActionRuntimeServiceProvider does not infer service method bindings from action source", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.singleton("test.customer.service", () => ({
    createRecord(input) {
      return input;
    }
  }));

  app.actions([
    {
      id: "test.customer.create",
      domain: "workspace",
      version: 1,
      kind: "command",
      channels: ["internal"],
      surfaces: ["admin"],
      dependencies: {
        customerService: "test.customer.service"
      },
      input: emptyInputValidator,
      idempotency: "optional",
      audit: { actionName: "test.customer.create" },
      observability: {},
      async execute(input, _context, deps) {
        return deps.customerService.createRecord(input);
      }
    }
  ]);

  const contributors = resolveActionContributors(app);
  const action = contributors[0]?.actions?.[0];
  assert.equal(Object.hasOwn(action || {}, "serviceMethodBindings"), false);
});

test("app.actions + resolveActionContributors provide canonical contributor wiring", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);
  app.singleton("jskit.surface.runtime", () => ({
    listEnabledSurfaceIds() {
      return ["app", "admin", "console"];
    }
  }));

  app.actions([
    {
      id: "alpha.one",
      domain: "settings",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfaces: ["app"],
      input: emptyInputValidator,
      idempotency: "none",
      audit: { actionName: "alpha.one" },
      observability: {},
      async execute() {
        return { ok: true };
      }
    }
  ]);
  app.actions([
    {
      id: "beta.one",
      domain: "auth",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfaces: ["app"],
      input: emptyInputValidator,
      idempotency: "none",
      audit: { actionName: "beta.one" },
      observability: {},
      async execute() {
        return { ok: true };
      }
    }
  ]);

  const contributors = resolveActionContributors(app);
  assert.deepEqual(
    contributors.map((entry) => entry.contributorId).sort(),
    ["action.alpha.one", "action.beta.one"]
  );
});

test("action runtime execute merges static and per-execution dependencies", async () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.singleton("jskit.surface.runtime", () => ({
    listEnabledSurfaceIds() {
      return ["app"];
    }
  }));

  app.singleton("test.static.service", () => ({
    label: "static"
  }));

  app.actions([
    {
      id: "test.deps.merge",
      domain: "workspace",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfaces: ["app"],
      dependencies: {
        staticService: "test.static.service"
      },
      input: emptyInputValidator,
      idempotency: "none",
      audit: { actionName: "test.deps.merge" },
      observability: {},
      async execute(_input, _context, deps) {
        return {
          staticLabel: deps.staticService?.label || "",
          dynamicValue: deps.dynamicValue || ""
        };
      }
    }
  ]);

  const actionExecutor = app.make("actionExecutor");
  const result = await actionExecutor.execute({
    actionId: "test.deps.merge",
    context: {
      channel: "internal",
      surface: "app"
    },
    deps: {
      dynamicValue: "runtime"
    }
  });

  assert.deepEqual(result, {
    staticLabel: "static",
    dynamicValue: "runtime"
  });
});

test("app.actions accepts custom action domains", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.actions([
    {
      id: "custom.domain.check",
      domain: "completeCalendar",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfaces: ["app"],
      input: emptyInputValidator,
      idempotency: "none",
      audit: { actionName: "custom.domain.check" },
      observability: {},
      async execute() {
        return { ok: true };
      }
    }
  ]);

  const contributors = resolveActionContributors(app);
  assert.equal(contributors.length, 1);
  assert.equal(contributors[0].contributorId, "action.custom.domain.check");
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
    input: emptyInputValidator,
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

test("app.actions requires an array", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  assert.throws(() => app.actions({}), /requires an array/);
});

test("emptyInputValidator allows empty input and rejects unexpected fields", async () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.singleton("jskit.surface.runtime", () => ({
    listEnabledSurfaceIds() {
      return ["app"];
    }
  }));

  app.actions([
    {
      id: "test.empty-input",
      domain: "settings",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfaces: ["app"],
      input: emptyInputValidator,
      idempotency: "none",
      audit: { actionName: "test.empty-input" },
      observability: {},
      async execute() {
        return { ok: true };
      }
    }
  ]);

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
      app.actions([
        {
          id: "invalid.domain",
          domain: "invalid domain",
          version: 1,
          kind: "query",
          channels: ["internal"],
          surfaces: ["app"],
          input: emptyInputValidator,
          idempotency: "none",
          audit: { actionName: "invalid.domain" },
          observability: {},
          async execute() {
            return {};
          }
        }
      ]),
    /must match/
  );
});

test("app.actions rejects unsupported surfacesFrom aliases", () => {
  const app = createSingletonApp();
  const provider = new ActionRuntimeServiceProvider();
  provider.register(app);

  app.singleton("jskit.surface.runtime", () => ({
    listEnabledSurfaceIds() {
      return ["app", "admin"];
    }
  }));

  app.actions([
    {
      id: "workspace.alias.invalid",
      domain: "workspace",
      version: 1,
      kind: "query",
      channels: ["internal"],
      surfacesFrom: "workspace",
      input: emptyInputValidator,
      idempotency: "none",
      audit: { actionName: "workspace.alias.invalid" },
      observability: {},
      async execute() {
        return {};
      }
    }
  ]);

  assert.throws(
    () => app.make("actionExecutor"),
    /references unknown surface source "workspace". Register it via app.actionSurfaceSource\(\)\./
  );
});
