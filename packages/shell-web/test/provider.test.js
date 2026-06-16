import assert from "node:assert/strict";
import test from "node:test";
import { createPinia } from "pinia";
import {
  ShellWebClientProvider,
  resolveAppPlacementTopologyExport
} from "../src/client/providers/ShellWebClientProvider.js";
import {
  isMissingDynamicModule
} from "../src/client/providers/appModuleLoadFailure.js";
import {
  SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY
} from "../src/client/asyncModuleRecovery/index.js";
import {
  SHELL_REQUEST_RECOVERY_RUNTIME_KEY
} from "../src/client/requestRecovery/index.js";
import { useShellErrorPresentationStore } from "../src/client/stores/useShellErrorPresentationStore.js";
const CLIENT_APP_CONFIG_GLOBAL_KEY = "__JSKIT_CLIENT_APP_CONFIG__";

async function withTemporaryGlobal(name, value, callback) {
  const hadPrevious = Object.prototype.hasOwnProperty.call(globalThis, name);
  const previousValue = globalThis[name];
  globalThis[name] = value;

  try {
    return await callback();
  } finally {
    if (hadPrevious) {
      globalThis[name] = previousValue;
    } else {
      delete globalThis[name];
    }
  }
}

function setClientAppConfig(source = {}) {
  const normalized =
    source && typeof source === "object" && !Array.isArray(source) ? Object.freeze({ ...source }) : Object.freeze({});
  if (typeof globalThis === "object" && globalThis) {
    globalThis[CLIENT_APP_CONFIG_GLOBAL_KEY] = normalized;
  }
  return normalized;
}

function createAppDouble({ surfaceRuntime = null, queryClient = null, router = null } = {}) {
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
      if (token === "jskit.client.query-client") {
        return Boolean(queryClient);
      }
      if (token === "jskit.client.router") {
        return Boolean(router);
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
      if (token === "jskit.client.query-client" && queryClient) {
        return queryClient;
      }
      if (token === "jskit.client.router" && router) {
        return router;
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
  return withFetchImplementation(async () => ({
    ok: true,
    async json() {
      return responsePayload;
    }
  }), callback);
}

async function withFetchImplementation(fetchImplementation, callback) {
  return withTemporaryGlobal("fetch", fetchImplementation, callback);
}

async function withWindowDouble(windowObject, callback) {
  return withTemporaryGlobal("window", windowObject, callback);
}

function createWindowDouble({ href = "https://example.test/home" } = {}) {
  const listeners = new Map();
  const reloadCalls = [];
  const location = {
    href,
    reload() {
      reloadCalls.push(location.href);
    }
  };

  return {
    listeners,
    reloadCalls,
    location,
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    }
  };
}

function createQueryCacheDouble(initialQueries = []) {
  const listeners = [];
  const queries = [...initialQueries];

  return {
    queries,
    getAll() {
      return queries;
    },
    subscribe(listener) {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    },
    emit(event) {
      for (const listener of [...listeners]) {
        listener(event);
      }
    }
  };
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

test("shell web boot import classifier does not swallow fetched dynamic module failures", () => {
  assert.equal(
    isMissingDynamicModule(
      new Error("Cannot find module '/src/placement.js' imported from /src/main.js"),
      "/src/placement.js"
    ),
    true
  );
  assert.equal(
    isMissingDynamicModule(
      new Error("Failed to fetch dynamically imported module: http://localhost:5173/src/placement.js?t=123"),
      "/src/placement.js"
    ),
    false
  );
});

test("shell web client provider binds runtime and injects it into Vue app", async () => {
  await withFetchStub({ surfaceAccess: {} }, async () => {
    const app = createAppDouble();
    const provider = new ShellWebClientProvider();

    provider.register(app);
    assert.equal(app.singletons.has("runtime.web-placement.client"), true);
    assert.equal(app.singletons.has("runtime.web-error.client"), true);
    assert.equal(app.singletons.has("runtime.web-error.presentation-store.client"), true);
    assert.equal(app.singletons.has("runtime.web-refresh.client"), true);
    assert.equal(app.singletons.has("runtime.web-async-module-recovery.client"), true);
    assert.equal(app.singletons.has("runtime.web-request-recovery.client"), true);

    await provider.boot(app);
    assert.equal(app.plugins.length, 0);

    const providedByKey = new Map(app.provided.map((entry) => [entry.key, entry.value]));

    assert.equal(providedByKey.has("jskit.shell-web.runtime.web-placement.client"), true);
    assert.equal(providedByKey.has("jskit.shell-web.runtime.web-refresh.client"), true);
    assert.equal(providedByKey.has("jskit.shell-web.runtime.web-error.client"), true);
    assert.equal(providedByKey.has(SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY), true);
    assert.equal(providedByKey.has(SHELL_REQUEST_RECOVERY_RUNTIME_KEY), true);
    assert.equal(providedByKey.has("jskit.shell-web.runtime.web-error.presentation-store.client"), true);

    const placementRuntime = providedByKey.get("jskit.shell-web.runtime.web-placement.client");
    assert.equal(typeof placementRuntime.getPlacements, "function");
    assert.equal(typeof placementRuntime.getContext, "function");
    assert.equal(typeof placementRuntime.setContext, "function");
    assert.equal(typeof placementRuntime.getContext().surfaceConfig, "object");

    const errorRuntime = providedByKey.get("jskit.shell-web.runtime.web-error.client");
    assert.equal(typeof errorRuntime.report, "function");
    assert.equal(typeof errorRuntime.configure, "function");

    const refreshRuntime = providedByKey.get("jskit.shell-web.runtime.web-refresh.client");
    assert.equal(typeof refreshRuntime.refresh, "function");

    const asyncModuleRecoveryRuntime = providedByKey.get(SHELL_ASYNC_MODULE_RECOVERY_RUNTIME_KEY);
    assert.equal(typeof asyncModuleRecoveryRuntime.install, "function");
    assert.equal(typeof asyncModuleRecoveryRuntime.notify, "function");
    assert.equal(typeof asyncModuleRecoveryRuntime.reload, "function");

    const requestRecoveryRuntime = providedByKey.get(SHELL_REQUEST_RECOVERY_RUNTIME_KEY);
    assert.equal(typeof requestRecoveryRuntime.install, "function");
    assert.equal(typeof requestRecoveryRuntime.report, "function");
    assert.equal(typeof requestRecoveryRuntime.reload, "function");

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

test("shell refresh runtime refreshes bootstrap and active queries by default", async () => {
  await withFetchStub({ surfaceAccess: { home: true } }, async () => {
    const refetchCalls = [];
    const queryClient = {
      async refetchQueries(filters = {}, options = {}) {
        refetchCalls.push({ filters, options });
      }
    };
    const app = createAppDouble({ queryClient });
    const provider = new ShellWebClientProvider();
    provider.register(app);

    const refreshRuntime = app.make("runtime.web-refresh.client");
    const result = await refreshRuntime.refresh("test-refresh");

    assert.equal(result.reason, "test-refresh");
    assert.equal(result.bootstrapRefreshed, true);
    assert.equal(result.queriesRefetched, true);
    assert.equal(refetchCalls.length, 1);
    assert.equal(refetchCalls[0].filters.type, "active");
    assert.equal(refetchCalls[0].options.throwOnError, false);
    assert.equal(refetchCalls[0].filters.predicate({}), true);
    assert.equal(refetchCalls[0].filters.predicate({ meta: {} }), true);
    assert.equal(refetchCalls[0].filters.predicate({ meta: { jskit: { refreshOnPull: true } } }), true);
    assert.equal(refetchCalls[0].filters.predicate({ meta: { jskitRefresh: "pull" } }), true);
    assert.equal(refetchCalls[0].filters.predicate({ meta: { jskit: { refreshOnPull: false } } }), false);
    assert.equal(refetchCalls[0].filters.predicate({ meta: { jskitRefresh: false } }), false);
  });
});

test("shell refresh runtime reports recoverable retry errors as banners", async () => {
  await withFetchStub({ surfaceAccess: { home: true } }, async () => {
    const queryClient = {
      async refetchQueries() {
        throw new Error("Network unavailable");
      }
    };
    const app = createAppDouble({ queryClient });
    const provider = new ShellWebClientProvider();
    provider.register(app);

    const refreshRuntime = app.make("runtime.web-refresh.client");
    const result = await refreshRuntime.refresh("test-refresh");

    assert.equal(result.error instanceof Error, true);

    const errorStore = app.make("runtime.web-error.presentation-store.client");
    const state = errorStore.getState();
    assert.equal(state.channels.banner.length, 1);
    assert.equal(state.channels.banner[0].message, "Unable to refresh. Check the connection and try again.");
    assert.equal(state.channels.banner[0].action.label, "Retry");
  });
});

test("shell request recovery reports active query transport failures with retry actions", async () => {
  await withFetchStub({ surfaceAccess: {} }, async () => {
    const refetchCalls = [];
    const queryCache = createQueryCacheDouble();
    const queryClient = {
      getQueryCache() {
        return queryCache;
      },
      async refetchQueries(filters = {}, options = {}) {
        refetchCalls.push({ filters, options });
      }
    };
    const app = createAppDouble({ queryClient });
    const provider = new ShellWebClientProvider();
    provider.register(app);
    await provider.boot(app);
    const reportEvents = [];
    app.make("runtime.web-error.client").subscribe((event = {}) => {
      reportEvents.push(event);
    });

    const failedQuery = {
      queryHash: "[\"project-access\"]",
      queryKey: ["project-access"],
      meta: {
        jskit: {
          requestRecoveryLabel: "Project access",
          requestRecoverySource: "project-access.panel",
          requestRecoveryDedupeKey: "project-access",
          requestRecoveryMethod: "GET",
          requestRecoveryDedupeWindowMs: 100
        }
      },
      state: {
        status: "error",
        fetchStatus: "idle",
        error: {
          status: 0,
          message: "Network request failed."
        },
        errorUpdateCount: 1
      },
      isActive() {
        return true;
      }
    };
    queryCache.emit({ type: "updated", query: failedQuery });

    const errorStore = app.make("runtime.web-error.presentation-store.client");
    const state = errorStore.getState();
    assert.equal(state.channels.banner.length, 1);
    assert.equal(
      state.channels.banner[0].message,
      "Project access could not reach the server or network. Check the connection and try again."
    );
    assert.equal(state.channels.banner[0].action.label, "Retry");
    assert.equal(state.channels.banner[0].dedupeKey, "project-access");
    assert.equal(reportEvents[0]?.result?.event?.source, "project-access.panel");
    assert.equal(reportEvents[0]?.result?.decision?.dedupeWindowMs, 100);

    await state.channels.banner[0].action.handler();
    assert.equal(refetchCalls.length, 1);
    assert.deepEqual(refetchCalls[0].filters, {
      queryKey: ["project-access"],
      exact: true,
      type: "active"
    });
    assert.deepEqual(refetchCalls[0].options, {
      throwOnError: false
    });
  });
});

test("shell request recovery dismisses query presentations after recovery", async () => {
  await withFetchStub({ surfaceAccess: {} }, async () => {
    const queryCache = createQueryCacheDouble();
    const queryClient = {
      getQueryCache() {
        return queryCache;
      },
      async refetchQueries() {}
    };
    const app = createAppDouble({ queryClient });
    const provider = new ShellWebClientProvider();
    provider.register(app);
    await provider.boot(app);

    const query = {
      queryHash: "[\"project-access\"]",
      queryKey: ["project-access"],
      meta: {
        jskit: {
          requestRecoveryLabel: "Project access",
          requestRecoverySource: "project-access.panel",
          requestRecoveryDedupeKey: "project-access",
          requestRecoveryMethod: "GET"
        }
      },
      state: {
        status: "error",
        fetchStatus: "idle",
        error: {
          status: 0,
          message: "Network request failed."
        },
        errorUpdateCount: 1
      },
      isActive() {
        return true;
      }
    };
    queryCache.emit({ type: "updated", query });

    const errorStore = app.make("runtime.web-error.presentation-store.client");
    assert.equal(errorStore.getState().channels.banner.length, 1);

    query.state = {
      status: "success",
      fetchStatus: "idle",
      data: {
        ok: true
      },
      error: null,
      errorUpdateCount: 1
    };
    queryCache.emit({ type: "updated", query });

    assert.equal(errorStore.getState().channels.banner.length, 0);
  });
});

test("shell request recovery ignores query transport failures without a safe read method", async () => {
  await withFetchStub({ surfaceAccess: {} }, async () => {
    const queryCache = createQueryCacheDouble();
    const queryClient = {
      getQueryCache() {
        return queryCache;
      },
      async refetchQueries() {}
    };
    const app = createAppDouble({ queryClient });
    const provider = new ShellWebClientProvider();
    provider.register(app);
    await provider.boot(app);

    for (const [queryKey, meta] of [
      [["unmarked"], {}],
      [["unsafe"], {
        jskit: {
          requestRecoveryMethod: "POST"
        }
      }]
    ]) {
      queryCache.emit({
        type: "updated",
        query: {
          queryHash: JSON.stringify(queryKey),
          queryKey,
          meta,
          state: {
            status: "error",
            fetchStatus: "idle",
            error: {
              status: 0,
              message: "Network request failed."
            },
            errorUpdateCount: 1
          },
          isActive() {
            return true;
          }
        }
      });
    }

    const errorStore = app.make("runtime.web-error.presentation-store.client");
    assert.equal(errorStore.getState().channels.banner.length, 0);
  });
});

test("shell request recovery ignores ordinary active query validation failures", async () => {
  await withFetchStub({ surfaceAccess: {} }, async () => {
    const queryCache = createQueryCacheDouble();
    const queryClient = {
      getQueryCache() {
        return queryCache;
      },
      async refetchQueries() {}
    };
    const app = createAppDouble({ queryClient });
    const provider = new ShellWebClientProvider();
    provider.register(app);
    await provider.boot(app);

    queryCache.emit({
      type: "updated",
        query: {
          queryHash: "[\"project-access\"]",
          queryKey: ["project-access"],
          meta: {
            jskit: {
              requestRecoveryMethod: "GET"
            }
          },
          state: {
          status: "error",
          fetchStatus: "idle",
          error: {
            status: 422,
            message: "Invalid input."
          },
          errorUpdateCount: 1
        },
        isActive() {
          return true;
        }
      }
    });

    const errorStore = app.make("runtime.web-error.presentation-store.client");
    assert.equal(errorStore.getState().channels.banner.length, 0);
  });
});

test("shell bootstrap transport failures report through request recovery", async () => {
  let fetchCalls = 0;
  await withFetchImplementation(async () => {
    fetchCalls += 1;
    throw new TypeError("Failed to fetch");
  }, async () => {
    const app = createAppDouble();
    const provider = new ShellWebClientProvider();
    provider.register(app);
    await provider.boot(app);

    const errorStore = app.make("runtime.web-error.presentation-store.client");
    const state = errorStore.getState();
    assert.equal(state.channels.banner.length, 1);
    assert.equal(
      state.channels.banner[0].message,
      "App data could not reach the server or network. Check the connection and try again."
    );
    assert.equal(state.channels.banner[0].action.label, "Retry");

    await state.channels.banner[0].action.handler();
    assert.equal(fetchCalls, 2);
  });
});

test("shell web client provider reports dynamic import failures through async module recovery", async () => {
  await withFetchStub({ surfaceAccess: {} }, async () => {
    const routerErrorHandlers = [];
    const replacedPaths = [];
    const router = {
      onError(handler) {
        routerErrorHandlers.push(handler);
        return () => null;
      },
      replace(fullPath) {
        replacedPaths.push(fullPath);
      }
    };
    const app = createAppDouble({ router });
    const provider = new ShellWebClientProvider();
    provider.register(app);
    await provider.boot(app);

    assert.equal(routerErrorHandlers.length, 2);

    const chunkError = new Error("Failed to fetch dynamically imported module: /assets/page.js");
    for (const handler of routerErrorHandlers) {
      handler(chunkError, {
        fullPath: "/app/dashboard"
      });
    }

    const errorStore = app.make("runtime.web-error.presentation-store.client");
    const state = errorStore.getState();
    assert.equal(state.channels.banner.length, 1);
    assert.equal(
      state.channels.banner[0].message,
      "Page did not download. The app may have been updated, or the network request failed."
    );
    assert.equal(state.channels.banner[0].severity, "warning");
    assert.equal(state.channels.banner[0].action.label, "Reload");
    assert.deepEqual(replacedPaths, []);
  });
});

test("shell web async module recovery reload action checks the document before reloading", async () => {
  const windowObject = createWindowDouble();
  await withWindowDouble(windowObject, async () => {
    const fetchCalls = [];
    await withFetchImplementation(async (input, init = {}) => {
      fetchCalls.push({ input, init });
      return {
        ok: true,
        status: 200,
        async json() {
          return { surfaceAccess: {} };
        }
      };
    }, async () => {
      const routerErrorHandlers = [];
      const router = {
        onError(handler) {
          routerErrorHandlers.push(handler);
          return () => null;
        },
        replace() {}
      };
      const app = createAppDouble({ router });
      const provider = new ShellWebClientProvider();
      provider.register(app);
      await provider.boot(app);

      const chunkError = new Error("Failed to fetch dynamically imported module: /assets/page.js");
      routerErrorHandlers[0](chunkError, {
        fullPath: "/home/settings"
      });

      const errorStore = app.make("runtime.web-error.presentation-store.client");
      const banner = errorStore.getState().channels.banner[0];
      await banner.action.handler();

      assert.deepEqual(windowObject.reloadCalls, ["https://example.test/home"]);
      const reloadFetch = fetchCalls.find((entry) => entry.input === "https://example.test/home");
      assert.equal(reloadFetch?.init?.cache, "no-store");
      assert.equal(reloadFetch?.init?.credentials, "same-origin");
    });
  });
});

test("shell web async module recovery keeps the page alive when reload check fails", async () => {
  const windowObject = createWindowDouble();
  await withWindowDouble(windowObject, async () => {
    await withFetchImplementation(async (input) => {
      if (input === "https://example.test/home") {
        throw new TypeError("Failed to fetch");
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { surfaceAccess: {} };
        }
      };
    }, async () => {
      const app = createAppDouble();
      const provider = new ShellWebClientProvider();
      provider.register(app);
      await provider.boot(app);

      const recoveryRuntime = app.make("runtime.web-async-module-recovery.client");
      const reloaded = await recoveryRuntime.reload();

      assert.equal(reloaded, false);
      assert.deepEqual(windowObject.reloadCalls, []);
      const errorStore = app.make("runtime.web-error.presentation-store.client");
      const state = errorStore.getState();
      assert.equal(state.channels.banner.length, 1);
      assert.equal(
        state.channels.banner[0].message,
        "The app cannot reload because the app server is not reachable. Restart the server, then click Reload."
      );
      assert.equal(state.channels.banner[0].action.label, "Reload");
    });
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
