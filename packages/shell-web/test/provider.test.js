import assert from "node:assert/strict";
import test from "node:test";
import { createPinia } from "pinia";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { createClientComponentRegistry } from "../../kernel/client/componentRegistry.js";
import { createSurfaceRuntime } from "@jskit-ai/kernel/shared/surface/runtime";
import {
  ShellWebClientProvider,
  resolveAppPlacementTopologyExport
} from "../src/client/providers/ShellWebClientProvider.js";

const CLIENT_APP_CONFIG_GLOBAL_KEY = "__JSKIT_CLIENT_APP_CONFIG__";

function response(payload = {}, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    }
  };
}

async function withGlobal(name, value, callback) {
  const hadPrevious = Object.hasOwn(globalThis, name);
  const previous = globalThis[name];
  globalThis[name] = value;
  try {
    return await callback();
  } finally {
    if (hadPrevious) {
      globalThis[name] = previous;
    } else {
      delete globalThis[name];
    }
  }
}

function createVueApp() {
  const provided = new Map();
  return {
    config: {},
    provided,
    provide(key, value) {
      provided.set(key, value);
    },
    use() {
      return this;
    }
  };
}

function createRouter() {
  const errorHandlers = [];
  return {
    currentRoute: { value: { path: "/" } },
    onError(handler) {
      errorHandlers.push(handler);
      return () => {};
    }
  };
}

function createSurfaceRuntimeFixture() {
  return createSurfaceRuntime({
    allMode: "all",
    surfaces: {
      app: { id: "app", pagesRoot: "app", enabled: true }
    },
    defaultSurfaceId: "app"
  });
}

async function startShell({
  bootstrapPayload = {},
  bootstrapResponse = null,
  queryClient = null
} = {}) {
  let shell = null;
  const Probe = defineProvider({
    id: "test.shell.probe",
    requires: { value: "client.shell" },
    setup({ value }) {
      shell = value;
    }
  });
  const vueApp = createVueApp();
  const pinia = createPinia();
  const router = createRouter();
  const components = createClientComponentRegistry();
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const logger = { debug() {}, info() {}, warn() {}, error() {} };
  const fetchImplementation = async () => bootstrapResponse || response(bootstrapPayload);

  return withGlobal("fetch", fetchImplementation, async () =>
    withGlobal(CLIENT_APP_CONFIG_GLOBAL_KEY, Object.freeze({}), async () => {
      const runtime = createCapabilityRuntime({
        profile: "test",
        providers: [ShellWebClientProvider, Probe],
        inputs: {
          "client.components": components,
          "client.logger": logger,
          "client.pinia": pinia,
          "client.query": queryClient,
          "client.router": router,
          "client.surface": surfaceRuntime,
          "client.vue": vueApp
        }
      });
      await runtime.start();
      return { components, pinia, router, runtime, shell, vueApp };
    })
  );
}

test("shell capability owns placement, bootstrap, refresh, errors, and recovery without a container", async () => {
  const fixture = await startShell({
    bootstrapPayload: {
      surfaceAccess: {
        app: { allowed: true }
      }
    }
  });

  assert.equal(fixture.runtime.diagnostics().lifecycleState, "started");
  assert.deepEqual(Object.keys(fixture.shell).sort(), [
    "asyncModuleRecovery",
    "bootstrap",
    "bootstrapHandlers",
    "error",
    "errorPresentationStore",
    "placement",
    "refresh",
    "requestRecovery"
  ]);
  assert.deepEqual(fixture.shell.placement.getContext().surfaceAccess, {
    app: { allowed: true }
  });
  assert.equal(
    fixture.vueApp.provided.get("jskit.shell-web.runtime.web-placement.client"),
    fixture.shell.placement
  );
  assert.equal(
    fixture.vueApp.provided.get("jskit.shell-web.runtime.web-error.client"),
    fixture.shell.error
  );

  await fixture.runtime.shutdown();
  assert.equal(fixture.runtime.diagnostics().lifecycleState, "stopped");
});

test("shell refresh updates bootstrap state and active pull queries", async () => {
  let refetchCount = 0;
  const fixture = await startShell({
    queryClient: {
      getQueryCache() {
        return null;
      },
      async refetchQueries() {
        refetchCount += 1;
      }
    }
  });

  const result = await fixture.shell.refresh.refresh("test");
  assert.equal(result.bootstrapRefreshed, true);
  assert.equal(result.queriesRefetched, true);
  assert.equal(refetchCount, 1);
  await fixture.runtime.shutdown();
});

test("shell bootstrap clears surface access after an unauthenticated response", async () => {
  const fixture = await startShell({
    bootstrapResponse: response({}, { ok: false, status: 401 })
  });
  assert.deepEqual(fixture.shell.placement.getContext().surfaceAccess, {});
  await fixture.runtime.shutdown();
});

test("shell placement topology export accepts append-only objects and arrays", () => {
  const logger = { warn() {} };
  const topology = { mode: "append", placements: [] };
  assert.equal(resolveAppPlacementTopologyExport(topology, logger), topology);
  assert.deepEqual(resolveAppPlacementTopologyExport([], logger), []);
});
