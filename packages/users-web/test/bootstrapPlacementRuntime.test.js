import assert from "node:assert/strict";
import test from "node:test";
import { CLIENT_MODULE_ROUTER_TOKEN } from "@jskit-ai/kernel/client/moduleBootstrap";
import { WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN } from "@jskit-ai/shell-web/client/placement";
import { REALTIME_SOCKET_CLIENT_TOKEN } from "@jskit-ai/realtime/client/tokens";
import { USERS_BOOTSTRAP_CHANGED_EVENT } from "@jskit-ai/users-core/shared/events/usersEvents";
import { createBootstrapPlacementRuntime } from "../src/client/runtime/bootstrapPlacementRuntime.js";

function flushTasks() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createPlacementRuntimeStub() {
  const listeners = new Set();
  const setCalls = [];
  let context = Object.freeze({
    surfaceConfig: {
      tenancyMode: "workspace",
      defaultSurfaceId: "app",
      enabledSurfaceIds: ["app"],
      surfacesById: {
        app: {
          id: "app",
          enabled: true,
          prefix: "/app",
          requiresWorkspace: true
        }
      }
    }
  });

  return {
    getContext() {
      return context;
    },
    setContext(patch = {}, { replace = false, source = "" } = {}) {
      context = Object.freeze(
        replace
          ? {
              ...patch
            }
          : {
              ...context,
              ...patch
            }
      );
      setCalls.push({
        patch,
        source
      });
      for (const listener of listeners) {
        listener({
          type: "context.updated",
          source
        });
      }
      return context;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setCalls
  };
}

function createRouterStub(initialPath = "/app/w/acme/dashboard") {
  const afterEachListeners = [];
  const router = {
    currentRoute: {
      value: {
        path: initialPath
      }
    },
    afterEach(listener) {
      afterEachListeners.push(listener);
      return () => {
        const index = afterEachListeners.indexOf(listener);
        if (index >= 0) {
          afterEachListeners.splice(index, 1);
        }
      };
    },
    emitAfterEach() {
      for (const listener of [...afterEachListeners]) {
        listener();
      }
    }
  };

  return router;
}

function createSocketStub() {
  const listeners = new Map();
  return {
    on(eventName, handler) {
      listeners.set(eventName, handler);
    },
    off(eventName, handler) {
      if (listeners.get(eventName) === handler) {
        listeners.delete(eventName);
      }
    },
    emit(eventName, payload) {
      listeners.get(eventName)?.(payload);
    }
  };
}

function createAppStub(records = {}) {
  const registry = new Map();
  for (const key of Reflect.ownKeys(records)) {
    registry.set(key, records[key]);
  }
  return {
    has(token) {
      return registry.has(token);
    },
    make(token) {
      return registry.get(token);
    },
    warn() {}
  };
}

test("bootstrap placement runtime writes user/workspace/permissions into placement context", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/app/w/acme/dashboard");
  const fetchCalls = [];
  const runtime = createBootstrapPlacementRuntime({
    app: createAppStub({
      [WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN]: placementRuntime,
      [CLIENT_MODULE_ROUTER_TOKEN]: router
    }),
    fetchBootstrap: async (workspaceSlug) => {
      fetchCalls.push(workspaceSlug);
      return {
        session: {
          authenticated: true,
          userId: 7
        },
        profile: {
          displayName: "Ada Lovelace",
          email: "ADA@EXAMPLE.COM",
          avatar: {
            effectiveUrl: "https://cdn.example.com/ada.png"
          }
        },
        workspaces: [{ id: 1, slug: "acme", name: "Acme Workspace" }],
        permissions: ["workspace.settings.view"]
      };
    }
  });

  await runtime.initialize();
  const context = placementRuntime.getContext();

  assert.deepEqual(fetchCalls, ["acme"]);
  assert.equal(context.workspace?.slug, "acme");
  assert.equal(Array.isArray(context.workspaces), true);
  assert.equal(context.workspaces.length, 1);
  assert.deepEqual(context.permissions, ["workspace.settings.view"]);
  assert.deepEqual(context.user, {
    id: 7,
    displayName: "Ada Lovelace",
    name: "Ada Lovelace",
    email: "ada@example.com",
    avatarUrl: "https://cdn.example.com/ada.png"
  });
});

test("bootstrap placement runtime does not mutate placement auth context", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  placementRuntime.setContext(
    {
      auth: {
        authenticated: true,
        oauthDefaultProvider: "github",
        oauthProviders: [{ id: "github", label: "GitHub" }]
      }
    },
    { source: "test.seed" }
  );
  const router = createRouterStub("/app/w/acme/dashboard");
  const runtime = createBootstrapPlacementRuntime({
    app: createAppStub({
      [WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN]: placementRuntime,
      [CLIENT_MODULE_ROUTER_TOKEN]: router
    }),
    fetchBootstrap: async () => {
      return {
        session: {
          authenticated: true,
          userId: 9
        },
        profile: {
          displayName: "User",
          email: "user@example.com",
          avatar: {
            effectiveUrl: ""
          }
        },
        workspaces: [{ id: 1, slug: "acme", name: "Workspace" }],
        permissions: []
      };
    }
  });

  await runtime.initialize();
  assert.deepEqual(placementRuntime.getContext().auth, {
    authenticated: true,
    oauthDefaultProvider: "github",
    oauthProviders: [{ id: "github", label: "GitHub" }]
  });
});

test("bootstrap placement runtime refetches on route changes and users.bootstrap.changed events", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/app/w/acme/dashboard");
  const socket = createSocketStub();
  const fetchCalls = [];
  const runtime = createBootstrapPlacementRuntime({
    app: createAppStub({
      [WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN]: placementRuntime,
      [CLIENT_MODULE_ROUTER_TOKEN]: router,
      [REALTIME_SOCKET_CLIENT_TOKEN]: socket
    }),
    fetchBootstrap: async (workspaceSlug) => {
      fetchCalls.push(workspaceSlug);
      return {
        session: {
          authenticated: true,
          userId: 1
        },
        profile: {
          displayName: "User",
          email: "user@example.com",
          avatar: {
            effectiveUrl: ""
          }
        },
        workspaces: [{ id: 1, slug: workspaceSlug || "acme", name: "Workspace" }],
        permissions: []
      };
    }
  });

  await runtime.initialize();
  assert.deepEqual(fetchCalls, ["acme"]);

  router.currentRoute.value.path = "/app/w/acme/customers";
  router.emitAfterEach();
  await flushTasks();
  assert.deepEqual(fetchCalls, ["acme"]);

  router.currentRoute.value.path = "/app/w/zen/dashboard";
  router.emitAfterEach();
  await flushTasks();
  assert.deepEqual(fetchCalls, ["acme", "zen"]);

  socket.emit(USERS_BOOTSTRAP_CHANGED_EVENT, {});
  await flushTasks();
  assert.deepEqual(fetchCalls, ["acme", "zen", "zen"]);
});

test("bootstrap placement runtime refetches when auth context changes", async () => {
  const placementRuntime = createPlacementRuntimeStub();
  const router = createRouterStub("/app/w/acme/dashboard");
  const fetchCalls = [];
  const runtime = createBootstrapPlacementRuntime({
    app: createAppStub({
      [WEB_PLACEMENT_RUNTIME_CLIENT_TOKEN]: placementRuntime,
      [CLIENT_MODULE_ROUTER_TOKEN]: router
    }),
    fetchBootstrap: async (workspaceSlug) => {
      fetchCalls.push(workspaceSlug);
      return {
        session: {
          authenticated: true,
          userId: 1
        },
        profile: {
          displayName: "User",
          email: "user@example.com",
          avatar: {
            effectiveUrl: ""
          }
        },
        workspaces: [{ id: 1, slug: workspaceSlug || "acme", name: "Workspace" }],
        permissions: []
      };
    }
  });

  await runtime.initialize();
  assert.deepEqual(fetchCalls, ["acme"]);

  placementRuntime.setContext(
    {
      auth: {
        authenticated: true,
        oauthDefaultProvider: "",
        oauthProviders: []
      }
    },
    {
      source: "test.auth"
    }
  );
  await flushTasks();
  await flushTasks();
  assert.deepEqual(fetchCalls, ["acme", "acme"]);
});
