import assert from "node:assert/strict";
import test from "node:test";
import { createSurfaceRuntime } from "../shared/surface/runtime.js";
import { bootClientModules } from "./moduleBootstrap.js";

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
      app: { id: "app", pagesRoot: "app", enabled: true },
      admin: { id: "admin", pagesRoot: "admin", enabled: true }
    },
    defaultSurfaceId: "app"
  });
}

test("bootClientModules registers global routes regardless of surface mode", async () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();

  const result = await bootClientModules({
    clientModules: [
      {
        packageId: "@example/auth",
        descriptorUiRoutes: [
          {
            id: "auth.login",
            path: "/auth/login",
            scope: "global",
            autoRegister: false
          }
        ],
        module: {
          clientRoutes: [
            {
              id: "auth.login",
              name: "auth-login",
              path: "/auth/login",
              scope: "global",
              component: {}
            }
          ]
        }
      }
    ],
    router,
    surfaceRuntime,
    surfaceMode: "admin",
    logger: { info() {}, warn() {}, error() {} }
  });

  assert.equal(result.routeResults.length, 1);
  assert.equal(result.routeResults[0].declaredCount, 1);
  assert.equal(result.routeResults[0].registeredCount, 1);
  assert.equal(router.routes.length, 1);
  assert.equal(router.routes[0].path, "/auth/login");
});

test("bootClientModules filters surface routes by mode", async () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();

  const result = await bootClientModules({
    clientModules: [
      {
        packageId: "@example/admin",
        module: {
          clientRoutes: [
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
          ]
        }
      }
    ],
    router,
    surfaceRuntime,
    surfaceMode: "admin",
    logger: { info() {}, warn() {}, error() {} }
  });

  assert.equal(result.routeResults.length, 1);
  assert.equal(result.routeResults[0].declaredCount, 2);
  assert.equal(result.routeResults[0].registeredCount, 1);
  assert.equal(router.routes.length, 1);
  assert.equal(router.routes[0].path, "/admin/dashboard");
});

test("bootClientModules registers descriptor and clientRoutes with providers only", async () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const events = [];
  const loginComponent = {};
  const pinia = { id: "pinia-instance" };
  const implicitPinia = { id: "implicit-vue-global-pinia" };
  class ExampleClientProvider {
    static id = "example.client";
    register(app) {
      events.push("register");
      app.instance("example.value", 42);
      app.instance("example.pinia", app.make("jskit.client.pinia"));
    }
    boot() {
      events.push("boot");
    }
  }

  const result = await bootClientModules({
    clientModules: [
      {
        packageId: "@example/alpha",
        module: {
          clientProviders: [ExampleClientProvider],
          ExampleClientProvider
        }
      },
      {
        packageId: "@example/zeta",
        descriptorUiRoutes: [
          {
            id: "auth.default-login-2",
            name: "auth-default-login-2",
            path: "/auth/default-login-2",
            scope: "global",
            componentKey: "auth-login",
            autoRegister: true
          },
          {
            id: "auth.skipped",
            path: "/auth/skipped",
            scope: "global",
            componentKey: "auth-login",
            autoRegister: false
          },
          {
            id: "auth.login",
            path: "/auth/login",
            scope: "global",
            autoRegister: false
          },
          {
            id: "auth.callback",
            path: "/auth/callback",
            scope: "global",
            autoRegister: false
          }
        ],
        module: {
          routeComponents: {
            "auth-login": loginComponent
          },
          clientRoutes: [
            {
              id: "auth.login",
              name: "auth-login",
              path: "/auth/login",
              scope: "global",
              component: loginComponent
            }
          ]
        }
      }
    ],
    app: {
      config: {
        globalProperties: {
          $pinia: implicitPinia
        }
      }
    },
    pinia,
    router,
    surfaceRuntime,
    surfaceMode: "all",
    logger: { info() {}, warn() {}, error() {} }
  });

  assert.deepEqual(events, ["register", "boot"]);
  assert.equal(result.providerCount, 1);
  assert.equal(result.routeCount, 2);
  assert.equal(router.routes.length, 2);
  assert.equal(router.routes[0].path, "/auth/default-login-2");
  assert.equal(router.routes[0].component, loginComponent);
  assert.equal(router.routes[1].path, "/auth/login");
  assert.equal(router.routes[1].component, loginComponent);
  assert.equal(result.runtimeApp.make("example.value"), 42);
  assert.equal(result.runtimeApp.make("example.pinia"), pinia);
  assert.notEqual(result.runtimeApp.make("example.pinia"), implicitPinia);
});

test("bootClientModules does not auto-discover providers from module exports", async () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const events = [];

  class ExampleClientProvider {
    static id = "example.client";
    register() {
      events.push("register");
    }
    boot() {
      events.push("boot");
    }
  }

  const result = await bootClientModules({
    clientModules: [
      {
        packageId: "@example/no-provider-declaration",
        module: {
          ExampleClientProvider
        }
      }
    ],
    router,
    surfaceRuntime,
    surfaceMode: "all",
    logger: { info() {}, warn() {}, error() {} }
  });

  assert.equal(result.providerCount, 0);
  assert.deepEqual(events, []);
});

test("bootClientModules rejects clientRoutes without components", async () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();

  await assert.rejects(
    bootClientModules({
      clientModules: [
        {
          packageId: "@example/missing",
          module: {
            clientRoutes: [
              {
                id: "auth.login",
                path: "/auth/login",
                scope: "global",
                component: null
              }
            ]
          }
        }
      ],
      router,
      surfaceRuntime,
      surfaceMode: "all",
      logger: { info() {}, warn() {}, error() {} }
    }),
    /Client route "auth.login" from @example\/missing requires component\./
  );
});

test("bootClientModules rejects non-declared global clientRoutes", async () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const loginComponent = {};

  await assert.rejects(
    bootClientModules({
      clientModules: [
        {
          packageId: "@example/strict",
          descriptorUiRoutes: [
            {
              id: "auth.default-login-2",
              path: "/auth/default-login-2",
              scope: "global",
              componentKey: "auth-login",
              autoRegister: true
            }
          ],
          module: {
            routeComponents: {
              "auth-login": loginComponent
            },
            clientRoutes: [
              {
                id: "auth.callback",
                name: "auth-callback",
                path: "/auth/callback",
                scope: "global",
                component: loginComponent
              }
            ]
          }
        }
      ],
      router,
      surfaceRuntime,
      surfaceMode: "all",
      logger: { info() {}, warn() {}, error() {} }
    }),
    /must be declared in metadata\.ui\.routes/
  );
});

test("bootClientModules allows non-declared surface clientRoutes", async () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const dashboardComponent = {};

  const result = await bootClientModules({
    clientModules: [
      {
        packageId: "@example/surface-programmatic",
        descriptorUiRoutes: [],
        module: {
          clientRoutes: [
            {
              id: "admin.projects",
              name: "admin-projects",
              path: "/admin/projects",
              scope: "surface",
              component: dashboardComponent
            }
          ]
        }
      }
    ],
    router,
    surfaceRuntime,
    surfaceMode: "admin",
    logger: { info() {}, warn() {}, error() {} }
  });

  assert.equal(result.routeCount, 1);
  assert.equal(router.routes.length, 1);
  assert.equal(router.routes[0].path, "/admin/projects");
});

test("bootClientModules loads client providers declared in descriptorClientProviders", async () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();
  const events = [];

  await bootClientModules({
    clientModules: [
      {
        packageId: "@example/descriptor-providers",
        descriptorClientProviders: [
          {
            entrypoint: "src/client/providers/ExampleProvider.js",
            export: "ExampleProvider"
          }
        ],
        module: {
          ExampleProvider: class {
            static id = "example.descriptor.provider";
            register() {
              events.push("register");
            }
            boot() {
              events.push("boot");
            }
          }
        }
      }
    ],
    router,
    surfaceRuntime,
    surfaceMode: "all",
    logger: { info() {}, warn() {}, error() {} }
  });

  assert.deepEqual(events, ["register", "boot"]);
});

test("bootClientModules throws when descriptorClientProviders export is missing", async () => {
  const router = createRouterStub();
  const surfaceRuntime = createSurfaceRuntimeFixture();

  await assert.rejects(
    bootClientModules({
      clientModules: [
        {
          packageId: "@example/missing-provider-export",
          descriptorClientProviders: [
            {
              entrypoint: "src/client/providers/MissingProvider.js",
              export: "MissingProvider"
            }
          ],
          module: {}
        }
      ],
      router,
      surfaceRuntime,
      surfaceMode: "all",
      logger: { info() {}, warn() {}, error() {} }
    }),
    /descriptor provider export "MissingProvider" is missing or invalid/
  );
});
