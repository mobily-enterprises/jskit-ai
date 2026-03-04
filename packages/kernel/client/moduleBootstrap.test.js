import assert from "node:assert/strict";
import test from "node:test";
import { createSurfaceRuntime } from "../shared/surface/runtime.js";
import { bootClientModules, registerClientModuleRoutes } from "./moduleBootstrap.js";

function createRouterStub() {
  const routes = [];
  return {
    routes,
    addRoute(route) {
      routes.push(route);
    }
  };
}

function createSurfaceRuntimeFixture() {
  return createSurfaceRuntime({
    allMode: "all",
    surfaces: {
      app: { id: "app", prefix: "/app", enabled: true },
      admin: { id: "admin", prefix: "/admin", enabled: true }
    },
    defaultSurfaceId: "app"
  });
}

test("registerClientModuleRoutes registers global routes", () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();

  const result = registerClientModuleRoutes({
    packageId: "@example/auth",
    routes: [
      {
        id: "auth.login",
        name: "auth-login",
        path: "/auth/login",
        scope: "global",
        component: {}
      }
    ],
    router,
    surfaceRuntime,
    surfaceMode: "admin",
    seenRoutePaths: new Set(),
    seenRouteNames: new Set()
  });

  assert.equal(result.declaredCount, 1);
  assert.equal(result.registeredCount, 1);
  assert.equal(router.routes.length, 1);
  assert.equal(router.routes[0].path, "/auth/login");
});

test("registerClientModuleRoutes filters surface routes by mode", () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();

  const result = registerClientModuleRoutes({
    packageId: "@example/admin",
    routes: [
      {
        id: "admin.dashboard",
        name: "admin-dashboard",
        path: "/admin/dashboard",
        scope: "surface",
        component: {}
      },
      {
        id: "app.dashboard",
        name: "app-dashboard",
        path: "/app/dashboard",
        scope: "surface",
        component: {}
      }
    ],
    router,
    surfaceRuntime,
    surfaceMode: "admin",
    seenRoutePaths: new Set(),
    seenRouteNames: new Set()
  });

  assert.equal(result.declaredCount, 2);
  assert.equal(result.registeredCount, 1);
  assert.equal(router.routes.length, 1);
  assert.equal(router.routes[0].path, "/admin/dashboard");
});

test("bootClientModules boots provider-only modules and bootClient modules", async () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const events = [];

  class ExampleClientProvider {
    static id = "example.client";

    register(app) {
      app.instance("example.value", 42);
      events.push("register");
    }

    boot() {
      events.push("boot");
    }
  }

  const result = await bootClientModules({
    clientModules: [
      {
        packageId: "@example/provider-only",
        module: {
          ExampleClientProvider
        }
      },
      {
        packageId: "@example/with-hook",
        module: {
          clientRoutes: [
            {
              id: "public.landing",
              name: "public-landing",
              path: "/landing",
              scope: "global",
              component: {}
            }
          ],
          async bootClient(context) {
            events.push(`bootClient:${context.packageId}`);
          }
        }
      }
    ],
    router,
    surfaceRuntime,
    surfaceMode: "all",
    logger: { info() {}, warn() {}, error() {} }
  });

  assert.deepEqual(events, ["register", "boot", "bootClient:@example/with-hook"]);
  assert.equal(result.providerCount, 1);
  assert.equal(result.routeCount, 1);
  assert.equal(router.routes.length, 1);
  assert.equal(result.runtimeApp.make("example.value"), 42);
});
