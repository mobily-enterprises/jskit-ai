import assert from "node:assert/strict";
import test from "node:test";
import { createPinia } from "pinia";
import {
  ShellWebClientProvider,
  resolveAppPlacementTopologyExport
} from "../src/client/providers/ShellWebClientProvider.js";
import { useShellErrorPresentationStore } from "../src/client/stores/useShellErrorPresentationStore.js";
const CLIENT_APP_CONFIG_GLOBAL_KEY = "__JSKIT_CLIENT_APP_CONFIG__";

function setClientAppConfig(source = {}) {
  const normalized =
    source && typeof source === "object" && !Array.isArray(source) ? Object.freeze({ ...source }) : Object.freeze({});
  if (typeof globalThis === "object" && globalThis) {
    globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY] = normalized;
  }
  return normalized;
}

function createAppDouble({ surfaceRuntime = null } = {}) {
  const singletons = new Map();
  const singletonInstances = new Map();
  const provided = [];
  const plugins = [];
  const pinia = createPinia();

  const vueApp = {
    config: {
      globalProperties: {
        $pinia: pinia
      }
    },
    use(plugin, options) {
      plugins.push({ plugin, options });
      return this;
    },
    provide(key, value) {
      provided.push({ key, value });
    }
  };

  return {
    singletons,
    provided,
    plugins,
    pinia,
    vueApp,
    _tags: new Map(),
    singleton(token, factory) {
      singletons.set(token, factory);
    },
    tag(token, tagName) {
      const current = this._tags.get(tagName) || [];
      current.push(token);
      this._tags.set(tagName, current);
    },
    has(token) {
      if (token === "jskit.client.vue.app") {
        return true;
      }
      if (token === "jskit.client.pinia") {
        return true;
      }
      if (token === "jskit.client.surface.runtime") {
        return Boolean(surfaceRuntime);
      }
      return singletons.has(token) || singletonInstances.has(token);
    },
    make(token) {
      if (token === "jskit.client.vue.app") {
        return vueApp;
      }
      if (token === "jskit.client.pinia") {
        return pinia;
      }
      if (token === "jskit.client.surface.runtime" && surfaceRuntime) {
        return surfaceRuntime;
      }
      if (singletonInstances.has(token)) {
        return singletonInstances.get(token);
      }
      const factory = singletons.get(token);
      if (!factory) {
        throw new Error(`Unknown token ${String(token)}`);
      }
      const instance = factory(this);
      singletonInstances.set(token, instance);
      return instance;
    },
    resolveTag(tagName) {
      return (this._tags.get(tagName) || []).map((token) => this.make(token));
    }
  };
}

async function withFetchStub(responsePayload, callback) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return responsePayload;
    }
  });

  try {
    return await callback();
  } finally {
    if (previousFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = previousFetch;
    }
  }
}

async function withFetchImplementation(fetchImplementation, callback) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImplementation;

  try {
    return await callback();
  } finally {
    if (previousFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = previousFetch;
    }
  }
}

test("shell web client provider preserves append-only placement topology object exports", () => {
  const warnings = [];
  const topology = {
    placements: [
      {
        id: "shell.primary-nav",
        surfaces: ["*"],
        variants: {
          compact: { outlet: "shell-layout:primary-menu" },
          medium: { outlet: "shell-layout:primary-menu" },
          expanded: { outlet: "shell-layout:primary-menu" }
        }
      }
    ]
  };

  const resolved = resolveAppPlacementTopologyExport(topology, {
    warn(payload, message) {
      warnings.push({ payload, message });
    }
  });

  assert.equal(resolved, topology);
  assert.deepEqual(warnings, []);
});

test("shell web client provider binds runtime and injects it into Vue app", async () => {
  await withFetchStub({ surfaceAccess: {} }, async () => {
    const app = createAppDouble();
    const provider = new ShellWebClientProvider();

    provider.register(app);
    assert.equal(app.singletons.has("runtime.web-placement.client"), true);
    assert.equal(app.singletons.has("runtime.web-error.client"), true);
    assert.equal(app.singletons.has("runtime.web-error.presentation-store.client"), true);

    await provider.boot(app);
    assert.equal(app.plugins.length, 1);
    assert.equal(typeof app.plugins[0].plugin.install, "function");
    assert.equal(typeof app.plugins[0].options?.queryClient, "object");

    const providedByKey = new Map(app.provided.map((entry) => [entry.key, entry.value]));

    assert.equal(providedByKey.has("jskit.shell-web.runtime.web-placement.client"), true);
    assert.equal(providedByKey.has("jskit.shell-web.runtime.web-error.client"), true);
    assert.equal(providedByKey.has("jskit.shell-web.runtime.web-error.presentation-store.client"), true);

    const placementRuntime = providedByKey.get("jskit.shell-web.runtime.web-placement.client");
    assert.equal(typeof placementRuntime.getPlacements, "function");
    assert.equal(typeof placementRuntime.getContext, "function");
    assert.equal(typeof placementRuntime.setContext, "function");
    assert.equal(typeof placementRuntime.getContext().surfaceConfig, "object");

    const errorRuntime = providedByKey.get("jskit.shell-web.runtime.web-error.client");
    assert.equal(typeof errorRuntime.report, "function");
    assert.equal(typeof errorRuntime.configure, "function");

    const errorStore = providedByKey.get("jskit.shell-web.runtime.web-error.presentation-store.client");
    assert.equal(typeof errorStore.getState, "function");
    assert.equal(typeof errorStore.present, "function");

    const errorPresentationStore = useShellErrorPresentationStore(app.pinia);
    assert.equal(errorPresentationStore.revision, 0);
    assert.equal(typeof errorPresentationStore.present, "function");
    errorStore.present("banner", { message: "Hello" });
    assert.equal(errorPresentationStore.channels.banner[0].message, "Hello");
  });
});

test("shell web client provider resolves surface config from client app config", async () => {
  setClientAppConfig({
    tenancyMode: "workspaces",
    surfaceAccessPolicies: {
      public: {}
    }
  });

  try {
    await withFetchStub({ surfaceAccess: {} }, async () => {
      const app = createAppDouble({
        surfaceRuntime: {
          DEFAULT_SURFACE_ID: "app",
          listEnabledSurfaceIds() {
            return ["app", "admin", "console"];
          },
          listSurfaceDefinitions() {
            return [
              { id: "app", pagesRoot: "w/[workspaceSlug]", requiresWorkspace: true, enabled: true },
              { id: "admin", pagesRoot: "w/[workspaceSlug]/admin", requiresWorkspace: true, enabled: true },
              { id: "console", pagesRoot: "console", requiresWorkspace: false, enabled: true }
            ];
          }
        }
      });
      const provider = new ShellWebClientProvider();
      provider.register(app);

      await provider.boot(app);

      const placementRuntime = app.make("runtime.web-placement.client");
      const context = placementRuntime.getContext();
      assert.equal(context.surfaceConfig.tenancyMode, "workspaces");
      assert.equal(context.surfaceConfig.defaultSurfaceId, "app");
      assert.deepEqual(context.surfaceConfig.enabledSurfaceIds, ["app", "admin", "console"]);
      assert.deepEqual(context.surfaceAccessPolicies, {
        public: {}
      });
    });
  } finally {
    setClientAppConfig({});
  }
});

test("shell web client provider clears generic surface access on bootstrap 401", async () => {
  await withFetchImplementation(async () => ({
    ok: false,
    status: 401
  }), async () => {
    const app = createAppDouble();
    const provider = new ShellWebClientProvider();
    provider.register(app);

    const placementRuntime = app.make("runtime.web-placement.client");
    placementRuntime.setContext(
      {
        surfaceAccess: {
          consoleowner: true
        }
      },
      {
        source: "test.seed"
      }
    );

    await provider.boot(app);
    assert.deepEqual(placementRuntime.getContext().surfaceAccess, {});
  });
});
