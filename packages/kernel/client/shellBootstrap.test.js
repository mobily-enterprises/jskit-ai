import assert from "node:assert/strict";
import test from "node:test";
import { createSurfaceRuntime } from "../shared/surface/runtime.js";
import {
  bootstrapClientShellApp,
  createClientBootstrapLogger,
  createSurfaceShellRouter,
  shellScrollBehavior
} from "./shellBootstrap.js";
import { getClientAppConfig } from "./appConfig.js";

function createSurfaceRuntimeFixture() {
  return createSurfaceRuntime({
    allMode: "all",
    surfaces: {
      app: { id: "app", pagesRoot: "app", enabled: true },
      admin: { id: "admin", pagesRoot: "admin", enabled: true }
    },
    defaultSurfaceId: "app"
  });
}

test("createSurfaceShellRouter builds active routes and installs a guard", () => {
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const guards = [];
  const routerState = {
    options: null
  };

  const { router, activeRoutes, fallbackRoute } = createSurfaceShellRouter({
    createRouter(options) {
      routerState.options = options;
      return {
        beforeEach(guard) {
          guards.push(guard);
        }
      };
    },
    history: { kind: "memory" },
    routes: [
      {
        path: "/app/home",
        name: "app-home",
        component: {}
      },
      {
        path: "/admin/home",
        name: "admin-home",
        component: {}
      }
    ],
    surfaceRuntime,
    surfaceMode: "app",
    notFoundComponent: {},
    guard: {
      webRootAllowed: "yes"
    }
  });

  assert.ok(router);
  assert.equal(guards.length, 1);
  assert.equal(routerState.options.routes.length, activeRoutes.length);
  assert.equal(activeRoutes.some((route) => route.path === "/app/home"), true);
  assert.equal(activeRoutes.some((route) => route.path === "/admin/home"), false);
  assert.equal(activeRoutes.some((route) => route.path === "/:pathMatch(.*)*"), true);
  assert.equal(fallbackRoute.path, "/:pathMatch(.*)*");
  assert.equal(routerState.options.scrollBehavior, shellScrollBehavior);
});

test("createSurfaceShellRouter lets an app replace or disable the scroll behaviour", () => {
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const custom = () => ({ top: 42 });
  const seen = [];
  for (const scrollBehavior of [custom, false]) {
    createSurfaceShellRouter({
      createRouter(options) {
        seen.push(options);
        return {};
      },
      routes: [],
      surfaceRuntime,
      surfaceMode: "app",
      notFoundComponent: {},
      scrollBehavior
    });
  }
  assert.equal(seen[0].scrollBehavior, custom);
  assert.equal(Object.hasOwn(seen[1], "scrollBehavior"), false);
});

test("shellScrollBehavior opens new screens at the top and keeps in-page changes still", () => {
  const surface = { path: "/home", meta: { jskit: { surface: "home" } } };
  const settings = { path: "/home/settings", meta: {} };
  const general = { path: "/home/settings/general", meta: {} };
  const profile = { path: "/home/settings/profile", meta: {} };
  const contacts = { path: "/home/contacts", meta: {} };
  const contact = { path: "/home/contacts/:id", meta: {} };
  const at = (path, matched, extra = {}) => ({ path, matched, hash: "", ...extra });

  const saved = { left: 0, top: 640 };
  assert.equal(shellScrollBehavior(at("/home/contacts", [surface, contacts]), at("/home", [surface]), saved), saved);
  assert.deepEqual(shellScrollBehavior(at("/home/contacts", [surface, contacts]), at("/home", [surface]), null), { top: 0 });
  // Another record of the same screen type is still a new screen.
  assert.deepEqual(
    shellScrollBehavior(at("/home/contacts/2", [surface, contact]), at("/home/contacts/1", [surface, contact]), null),
    { top: 0 }
  );
  // Query, hash or tab changes within one page keep the position.
  assert.equal(shellScrollBehavior(at("/home/contacts", [surface, contacts]), at("/home/contacts", [surface, contacts]), null), false);
  assert.equal(
    shellScrollBehavior(at("/home/settings/profile", [surface, settings, profile]), at("/home/settings/general", [surface, settings, general]), null),
    false
  );
  assert.deepEqual(
    shellScrollBehavior(at("/home/contacts", [surface, contacts], { hash: "#recent" }), at("/home", [surface]), null),
    { el: "#recent", top: 0 }
  );
});

test("createClientBootstrapLogger enables debug from env flag", () => {
  const logger = createClientBootstrapLogger({
    env: { VITE_JSKIT_CLIENT_DEBUG: "1" }
  });

  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.debug, "function");
  assert.equal(logger.isDebugEnabled, true);
});

test("bootstrapClientShellApp hands hooks and modules one logger that carries its debug flag", async () => {
  for (const debugEnabled of [false, true]) {
    let routeTableReads = 0;
    const seenLoggers = [];
    const router = {
      addRoute() {},
      getRoutes() {
        routeTableReads += 1;
        return [];
      },
      async isReady() {}
    };
    const result = await bootstrapClientShellApp({
      createApp: () => ({ use() {}, mount() {} }),
      router,
      surfaceRuntime: createSurfaceRuntimeFixture(),
      logger: { info() {}, warn() {}, error() {} },
      debugEnabled,
      bootClientModules: async ({ logger }) => {
        seenLoggers.push(logger);
        return {};
      },
      onAfterRouterReady: ({ logger }) => seenLoggers.push(logger)
    });

    assert.equal(result.debugEnabled, debugEnabled);
    assert.equal(result.logger.isDebugEnabled, debugEnabled);
    assert.deepEqual(seenLoggers, [result.logger, result.logger]);
    assert.equal(routeTableReads > 0, debugEnabled);
  }
});

test("bootstrapClientShellApp boots modules, reinstalls fallback route, and mounts app", async () => {
  const calls = [];
  const logs = [];
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const plugin = { name: "vuetify-like-plugin" };
  const pinia = { id: "pinia-instance" };
  const queryClient = { id: "query-client-instance" };
  const fallbackRoute = {
    name: "not-found",
    path: "/:pathMatch(.*)*",
    component: {}
  };

  const app = {
    used: [],
    mountedAt: "",
    use(entry) {
      this.used.push(entry);
      return this;
    },
    mount(selector) {
      this.mountedAt = selector;
      calls.push(`mount:${selector}`);
    }
  };

  const router = {
    routes: [fallbackRoute],
    addRoute(route) {
      calls.push(`add:${route.name || route.path}`);
      this.routes.push(route);
    },
    hasRoute(name) {
      return this.routes.some((route) => String(route?.name || "") === String(name || ""));
    },
    removeRoute(name) {
      calls.push(`remove:${name}`);
      this.routes = this.routes.filter((route) => String(route?.name || "") !== String(name || ""));
    },
    getRoutes() {
      return [...this.routes];
    },
    async isReady() {
      calls.push("isReady");
    }
  };

  const result = await bootstrapClientShellApp({
    createApp(rootComponent) {
      calls.push(`createApp:${String(rootComponent || "")}`);
      return app;
    },
    rootComponent: "RootComponent",
    appConfig: {
      crud: {
        contacts: {
          namespace: "crm",
          visibility: "workspace"
        }
      }
    },
    appPlugins: [plugin],
    pinia,
    queryClient,
    router,
    bootClientModules: async (context) => {
      calls.push("bootClientModules");
      assert.equal(context.app, app);
      assert.equal(context.pinia, pinia);
      assert.equal(context.queryClient, queryClient);
      assert.equal(context.router, router);
      assert.equal(typeof context.logger.debug, "function");
      return {
        modules: ["@example/main"],
        providerCount: 1,
        routeCount: 3
      };
    },
    surfaceRuntime,
    surfaceMode: "app",
    env: { VITE_JSKIT_CLIENT_DEBUG: "1" },
    fallbackRoute,
    logger: {
      info(payload, message) {
        logs.push({ payload, message });
      },
      warn() {},
      error() {}
    },
    onAfterModulesBootstrapped(context) {
      calls.push(`after:${context.clientBootstrap.routeCount}`);
    },
    onAfterRouterReady(context) {
      calls.push(`router-ready:${context.clientBootstrap.routeCount}`);
    }
  });

  assert.equal(result.debugEnabled, true);
  assert.deepEqual(getClientAppConfig().crud?.contacts, {
    namespace: "crm",
    visibility: "workspace"
  });
  assert.equal(app.used[0], plugin);
  assert.equal(app.used[1], router);
  assert.equal(app.mountedAt, "#app");
  assert.equal(logs.length, 1);
  assert.equal(calls.includes("bootClientModules"), true);
  assert.equal(calls.includes("remove:not-found"), true);
  assert.equal(calls.includes("add:not-found"), true);
  assert.equal(calls.includes("isReady"), true);
  assert.equal(calls.includes("after:3"), true);
  assert.equal(calls.includes("router-ready:3"), true);
});

test("bootstrapClientShellApp installs the app's vue-i18n once and translates JSKIT through it", async () => {
  const { createI18n } = await import("vue-i18n");
  const { registerJskitMessages, useJskitText } = await import("./i18n.js");
  registerJskitMessages({ jskit: { shell: { back: "Back" } } });
  const i18n = createI18n({ legacy: false, locale: "it", messages: { it: { jskit: { shell: { back: "Indietro" } } } } });
  for (const appPlugins of [[], [i18n]]) {
    const used = [];
    await bootstrapClientShellApp({
      createApp: () => ({ use(plugin) { used.push(plugin); }, mount() {} }),
      router: { addRoute() {}, getRoutes: () => [], async isReady() {} },
      surfaceRuntime: createSurfaceRuntimeFixture(),
      logger: { info() {}, warn() {}, error() {} },
      appPlugins,
      i18n,
      bootClientModules: async () => ({})
    });
    assert.equal(used.filter((plugin) => plugin === i18n).length, 1);
  }
  assert.equal(useJskitText().t("jskit.shell.back"), "Indietro");
  assert.equal(i18n.global.getLocaleMessage("en").jskit.shell.back, "Back");
  delete globalThis.__JSKIT_CLIENT_I18N__;
});
