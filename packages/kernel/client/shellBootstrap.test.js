import assert from "node:assert/strict";
import test from "node:test";
import { createSurfaceRuntime } from "../shared/surface/runtime.js";
import {
  bootstrapClientShellApp,
  createClientBootstrapLogger,
  createSurfaceShellRouter
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
      surfaceDefinitions: {
        app: { id: "app", pagesRoot: "app", requiresAuth: false },
        admin: { id: "admin", pagesRoot: "admin", requiresAuth: false }
      },
      defaultSurfaceId: "app",
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
});

test("createClientBootstrapLogger enables debug from env flag", () => {
  const logger = createClientBootstrapLogger({
    env: { VITE_JSKIT_CLIENT_DEBUG: "1" }
  });

  assert.equal(typeof logger.info, "function");
  assert.equal(typeof logger.debug, "function");
  assert.equal(logger.isDebugEnabled, true);
});

test("bootstrapClientShellApp boots modules, reinstalls fallback route, and mounts app", async () => {
  const calls = [];
  const logs = [];
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const plugin = { name: "vuetify-like-plugin" };
  const pinia = { id: "pinia-instance" };
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
    router,
    bootClientModules: async (context) => {
      calls.push("bootClientModules");
      assert.equal(context.app, app);
      assert.equal(context.pinia, pinia);
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
});
